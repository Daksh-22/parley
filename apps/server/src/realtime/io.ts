import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { redisPub, redisSub } from '../lib/redis.js';
import { Membership } from '../models/membership.model.js';
import { socketAuthMiddleware } from './socket-auth.js';
import { registerHandlers, MAX_ROOMS_PER_USER } from './handlers.js';
import { registerAiHandlers } from './ai-handlers.js';
import { setAiIo } from '../ai/events.js';
import { presenceConnect, presenceDisconnect, listOnlineUserIds } from './presence.js';
import { roomChannel } from './serialize.js';
import type { AppServer } from './types.js';

export interface CreateIoOptions {
  // Override the adapter's pub/sub pair. Tests use this to run a second
  // instance in the same process with its own subscriber connection.
  redisClients?: { pub: Redis; sub: Redis };
}

export function createIo(httpServer: HttpServer, options: CreateIoOptions = {}): AppServer {
  const io: AppServer = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
    // Payload cap at the transport level. Individual events are further
    // constrained by zod schemas.
    maxHttpBufferSize: 16 * 1024,
  });

  // Redis adapter: room broadcasts and io.emit fan out across every server
  // instance, which is what lets the websocket-only fleet scale horizontally.
  const { pub, sub } = options.redisClients ?? { pub: redisPub, sub: redisSub };
  io.adapter(createAdapter(pub, sub));

  // The AI layer broadcasts through this injection seam; registering it here
  // means every environment that creates an io server gets it for free.
  if (env.AI_ENABLED) setAiIo(io);

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    logger.debug({ socketId: socket.id, userId }, 'socket connected');

    // Handlers are registered synchronously so no early event is lost. The
    // membership gate inside each handler covers the window before the
    // channel subscriptions below complete.
    registerHandlers(io, socket);
    if (env.AI_ENABLED) registerAiHandlers(io, socket);

    void (async () => {
      const memberships = await Membership.find({ userId })
        .select('roomId')
        .limit(MAX_ROOMS_PER_USER);
      await Promise.all(memberships.map((m) => socket.join(roomChannel(m.roomId.toHexString()))));
      await presenceConnect(io, userId);
      socket.emit('presence:state', { online: await listOnlineUserIds() });
    })().catch((err: unknown) => {
      logger.error({ err, socketId: socket.id, userId }, 'post-connect setup failed');
      socket.disconnect(true);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, userId, reason }, 'socket disconnected');
      presenceDisconnect(io, userId).catch((err: unknown) => {
        logger.error({ err, userId }, 'presence disconnect failed');
      });
    });
  });

  return io;
}

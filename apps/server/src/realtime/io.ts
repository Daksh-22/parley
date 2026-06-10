import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { Membership } from '../models/membership.model.js';
import { socketAuthMiddleware } from './socket-auth.js';
import { registerHandlers, MAX_ROOMS_PER_USER } from './handlers.js';
import { presenceConnect, presenceDisconnect, listOnlineUserIds } from './presence.js';
import { roomChannel } from './serialize.js';
import type { AppServer } from './types.js';

export function createIo(httpServer: HttpServer): AppServer {
  const io: AppServer = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
    // Payload cap at the transport level. Individual events are further
    // constrained by zod schemas.
    maxHttpBufferSize: 16 * 1024,
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const { userId } = socket.data;
    logger.debug({ socketId: socket.id, userId }, 'socket connected');

    // Handlers are registered synchronously so no early event is lost. The
    // membership gate inside each handler covers the window before the
    // channel subscriptions below complete.
    registerHandlers(io, socket);

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

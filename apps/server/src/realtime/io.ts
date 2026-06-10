import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { socketAuthMiddleware } from './socket-auth.js';

export function createIo(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
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
    logger.debug({ socketId: socket.id, userId: socket.data.userId }, 'socket connected');
    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}

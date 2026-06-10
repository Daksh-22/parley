import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';

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

  // Every connection must authenticate. The real JWT middleware replaces this
  // in the auth module; until it is registered, nothing may connect.
  io.use((_socket, next) => {
    next(new Error('unauthorized'));
  });

  return io;
}

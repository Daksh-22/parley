import { verifyAccessToken } from '../auth/tokens.js';
import type { AppSocket } from './types.js';

/**
 * Handshake authentication. Rejecting here means the connection never
 * completes, so every connected socket is guaranteed to carry a verified
 * userId in socket.data. Event handlers must always read identity from
 * socket.data.userId and never from client payloads.
 */
export function socketAuthMiddleware(socket: AppSocket, next: (err?: Error) => void): void {
  const token: unknown = socket.handshake.auth['token'];
  const userId = typeof token === 'string' ? verifyAccessToken(token) : null;
  if (!userId) {
    next(new Error('unauthorized'));
    return;
  }
  socket.data.userId = userId;
  next();
}

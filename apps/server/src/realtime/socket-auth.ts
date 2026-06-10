import { verifyAccessToken } from '../auth/tokens.js';
import { logger } from '../lib/logger.js';
import { checkConnectionRate } from './rate-limit.js';
import type { AppSocket } from './types.js';

/**
 * Handshake authentication. Rejecting here means the connection never
 * completes, so every connected socket is guaranteed to carry a verified
 * userId in socket.data. Event handlers must always read identity from
 * socket.data.userId and never from client payloads.
 *
 * Connection attempts are also rate limited per IP before any token work.
 */
export function socketAuthMiddleware(socket: AppSocket, next: (err?: Error) => void): void {
  void (async () => {
    // Behind nginx the X-Forwarded-For chain is appended by the proxy;
    // handshake.address already honors it for the first hop.
    const ip = socket.handshake.address || 'unknown';
    const rate = await checkConnectionRate(ip);
    if (!rate.allowed) {
      next(new Error('rate_limited'));
      return;
    }
    const token: unknown = socket.handshake.auth['token'];
    const userId = typeof token === 'string' ? verifyAccessToken(token) : null;
    if (!userId) {
      next(new Error('unauthorized'));
      return;
    }
    socket.data.userId = userId;
    next();
  })().catch((err: unknown) => {
    logger.error({ err }, 'socket auth middleware failed');
    next(new Error('internal error'));
  });
}

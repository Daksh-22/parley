import type { z } from 'zod';
import type { Ack } from '@parley/shared';
import { WsError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { AppSocket } from './types.js';

type AckFn<T> = (response: Ack<T>) => void;

/**
 * Wraps a socket event handler with the three guarantees every handler must
 * provide: zod validation of the raw payload, an ack on every code path, and
 * structured logging instead of swallowed errors. Unknown payload keys are
 * stripped by zod, so a forged senderId never even reaches a handler.
 */
export function wrapHandler<S extends z.ZodType, T>(
  socket: AppSocket,
  event: string,
  schema: S,
  handler: (payload: z.infer<S>) => Promise<T>,
): (rawPayload: unknown, ack?: unknown) => void {
  return (rawPayload: unknown, ack?: unknown) => {
    const respond: AckFn<T> = typeof ack === 'function' ? (ack as AckFn<T>) : () => undefined;

    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      respond({
        ok: false,
        error: {
          code: 'VALIDATION',
          message: first ? `${first.path.join('.')}: ${first.message}` : 'Invalid payload',
        },
      });
      return;
    }

    handler(parsed.data as z.infer<S>)
      .then((data) => respond({ ok: true, data }))
      .catch((err: unknown) => {
        if (err instanceof WsError) {
          respond({ ok: false, error: { code: err.code, message: err.message } });
          return;
        }
        logger.error(
          { err, event, socketId: socket.id, userId: socket.data.userId },
          'socket handler failed',
        );
        respond({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong' } });
      });
  };
}

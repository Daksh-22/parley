import type { z } from 'zod';
import { HttpError } from './errors.js';

export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    const message = first ? `${path ? `${path}: ` : ''}${first.message}` : 'Invalid request';
    throw new HttpError(400, 'VALIDATION', message);
  }
  return result.data as z.output<S>;
}

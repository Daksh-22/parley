import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env.js';

// The type claim prevents a refresh token from being replayed as an access
// token or vice versa.
const claimsSchema = z.object({
  sub: z.string().regex(/^[a-f0-9]{24}$/),
  type: z.enum(['access', 'refresh']),
});

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL_SECONDS,
  });
}

function verify(token: string, secret: string, expectedType: 'access' | 'refresh'): string | null {
  try {
    const decoded = jwt.verify(token, secret);
    const claims = claimsSchema.safeParse(decoded);
    if (!claims.success || claims.data.type !== expectedType) return null;
    return claims.data.sub;
  } catch {
    return null;
  }
}

/** Returns the userId, or null for anything invalid or expired. */
export function verifyAccessToken(token: string): string | null {
  return verify(token, env.JWT_ACCESS_SECRET, 'access');
}

/** Returns the userId, or null for anything invalid or expired. */
export function verifyRefreshToken(token: string): string | null {
  return verify(token, env.JWT_REFRESH_SECRET, 'refresh');
}

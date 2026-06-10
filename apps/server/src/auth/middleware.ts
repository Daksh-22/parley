import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../lib/errors.js';
import { verifyAccessToken } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  const userId = token ? verifyAccessToken(token) : null;
  if (!userId) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Valid access token required'));
    return;
  }
  req.userId = userId;
  next();
}

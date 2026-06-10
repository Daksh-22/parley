import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { registerRequestSchema, loginRequestSchema } from '@parley/shared';
import { env } from '../../config/env.js';
import { HttpError, isDuplicateKeyError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { User } from '../../models/user.model.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../auth/tokens.js';
import { requireAuth } from '../../auth/middleware.js';
import { toPublicUser } from '../../auth/serialize.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'parley_refresh';

// In production the web app and the API live on different sites, so the
// refresh cookie must be SameSite=None and Secure. In local dev both run on
// localhost (same site, plain http), so Lax without Secure is correct.
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: env.NODE_ENV === 'production' ? ('none' as const) : ('lax' as const),
  path: '/auth',
  maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
};

function setRefreshCookie(res: Response, userId: string): void {
  res.cookie(REFRESH_COOKIE, signRefreshToken(userId), cookieOptions);
}

authRouter.use(
  '/auth',
  rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 10_000 : 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, slow down' } },
  }),
);

authRouter.post('/auth/register', async (req, res) => {
  const body = parseOrThrow(registerRequestSchema, req.body);
  const passwordHash = await hashPassword(body.password);
  try {
    const user = await User.create({
      username: body.username.toLowerCase(),
      passwordHash,
      displayName: body.displayName,
      avatarSeed: randomUUID(),
    });
    setRefreshCookie(res, user._id.toHexString());
    res.status(201).json({
      accessToken: signAccessToken(user._id.toHexString()),
      user: toPublicUser(user),
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'That username is already taken');
    }
    throw err;
  }
});

authRouter.post('/auth/login', async (req, res) => {
  const body = parseOrThrow(loginRequestSchema, req.body);
  const user = await User.findOne({ username: body.username.toLowerCase() });
  // Same response for unknown user and wrong password: no username probing.
  const ok = user !== null && (await verifyPassword(user.passwordHash, body.password));
  if (!user || !ok) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  }
  setRefreshCookie(res, user._id.toHexString());
  res.json({
    accessToken: signAccessToken(user._id.toHexString()),
    user: toPublicUser(user),
  });
});

authRouter.post('/auth/refresh', async (req, res) => {
  const token: unknown = req.cookies?.[REFRESH_COOKIE];
  const userId = typeof token === 'string' ? verifyRefreshToken(token) : null;
  if (!userId) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Valid refresh token required');
  }
  const user = await User.findById(userId);
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  }
  // Rotation: every refresh issues a fresh refresh token alongside the access token.
  setRefreshCookie(res, userId);
  res.json({
    accessToken: signAccessToken(userId),
    user: toPublicUser(user),
  });
});

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Account no longer exists');
  }
  res.json({ user: toPublicUser(user) });
});

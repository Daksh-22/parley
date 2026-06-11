import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Citation } from '@parley/shared';
import { env } from '../../config/env.js';
import { HttpError, WsError } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { requireAuth } from '../../auth/middleware.js';
import { Pat, generatePatPlaintext, hashPat } from '../../models/pat.model.js';
import { Room } from '../../models/room.model.js';
import { getUserRoomIds, hybridRetrieve } from '../../ai/retrieval.js';
import { preflight, startAsk, type StreamEmitter } from '../../ai/ask.js';
import { startCatchup } from '../../ai/digest.js';
import { getPublicUser } from '../../realtime/user-cache.js';

export const memoryRouter = Router();

// ---------------------------------------------------------------------------
// Personal access token management (cookie/JWT authenticated app users)
// ---------------------------------------------------------------------------

const createTokenSchema = z.object({ name: z.string().trim().min(1).max(64) });

memoryRouter.post('/tokens', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const { name } = parseOrThrow(createTokenSchema, req.body);
  const count = await Pat.countDocuments({ userId, revokedAt: null });
  if (count >= 10) {
    throw new HttpError(403, 'TOKEN_LIMIT', 'You can have at most 10 active tokens');
  }
  const plaintext = generatePatPlaintext();
  const pat = await Pat.create({ userId, name, tokenHash: hashPat(plaintext) });
  // The plaintext is returned exactly once and never stored.
  res.status(201).json({
    token: plaintext,
    id: pat._id.toHexString(),
    name: pat.name,
    createdAt: pat.createdAt.toISOString(),
  });
});

memoryRouter.get('/tokens', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const tokens = await Pat.find({ userId }).sort({ _id: -1 }).limit(50);
  res.json({
    tokens: tokens.map((t) => ({
      id: t._id.toHexString(),
      name: t.name,
      createdAt: t.createdAt.toISOString(),
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      revoked: t.revokedAt !== null,
    })),
  });
});

memoryRouter.post('/tokens/:id/revoke', requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const result = await Pat.updateOne(
    { _id: req.params.id, userId, revokedAt: null },
    { revokedAt: new Date() },
  );
  if (result.matchedCount === 0) throw new HttpError(404, 'NOT_FOUND', 'Token not found');
  res.json({ revoked: true });
});

// ---------------------------------------------------------------------------
// PAT-authenticated, read-only memory API: the MCP server's backend.
// Enforces the exact same query-time permission filters as the app, because
// it calls the exact same functions.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      patUserId?: string;
    }
  }
}

async function requirePat(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer pat_') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      next(new HttpError(401, 'UNAUTHORIZED', 'A personal access token is required'));
      return;
    }
    const pat = await Pat.findOne({ tokenHash: hashPat(token), revokedAt: null });
    if (!pat) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Token is invalid or revoked'));
      return;
    }
    req.patUserId = pat.userId.toHexString();
    // Throttled usage stamp: at most one write per minute per token.
    if (!pat.lastUsedAt || Date.now() - pat.lastUsedAt.getTime() > 60_000) {
      Pat.updateOne({ _id: pat._id }, { lastUsedAt: new Date() }).catch(() => undefined);
    }
    next();
  } catch (err) {
    next(err);
  }
}

function requireAiOn(): void {
  if (!env.AI_ENABLED) {
    throw new HttpError(503, 'AI_UNAVAILABLE', 'Memory features are turned off on this server');
  }
}

const searchSchema = z.object({
  query: z.string().trim().min(2).max(600),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

memoryRouter.post('/memory/search', requirePat, async (req, res) => {
  requireAiOn();
  const userId = req.patUserId as string;
  const { query, limit } = parseOrThrow(searchSchema, req.body);
  const roomIds = await getUserRoomIds(userId);
  const sources = await hybridRetrieve(query, roomIds, limit);
  const rooms = await Room.find({ _id: { $in: [...new Set(sources.map((s) => s.roomId))] } });
  const roomNames = new Map(rooms.map((r) => [r._id.toHexString(), r.name]));
  const results = [];
  for (const source of sources) {
    const sender = source.senderId ? await getPublicUser(source.senderId) : null;
    results.push({
      kind: source.kind,
      room: roomNames.get(source.roomId) ?? 'unknown',
      sender: sender?.displayName ?? source.filename ?? null,
      createdAt: source.createdAt,
      text: source.text,
    });
  }
  res.json({ results });
});

/** Buffers a streamed answer into a single response for HTTP callers. */
function bufferedAnswer(): {
  emitter: StreamEmitter;
  result: Promise<{ answer: string; citations: Citation[]; cached: boolean }>;
} {
  let resolve!: (v: { answer: string; citations: Citation[]; cached: boolean }) => void;
  let reject!: (e: Error) => void;
  const result = new Promise<{ answer: string; citations: Citation[]; cached: boolean }>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    },
  );
  return {
    emitter: {
      start: () => undefined,
      delta: () => undefined,
      done: (e) => resolve({ answer: e.answer, citations: e.citations, cached: e.cached }),
      error: (e) => reject(new HttpError(502, e.code, e.message)),
    },
    result,
  };
}

function presentCitations(citations: Citation[]): object[] {
  return citations.map((c) => ({
    index: c.index,
    kind: c.kind,
    sender: c.senderName ?? null,
    createdAt: c.createdAt ?? null,
    snippet: c.snippet,
  }));
}

const askSchema = z.object({ question: z.string().trim().min(3).max(600) });

memoryRouter.post('/memory/ask', requirePat, async (req, res) => {
  requireAiOn();
  const userId = req.patUserId as string;
  const { question } = parseOrThrow(askSchema, req.body);
  try {
    await preflight(userId);
  } catch (err) {
    if (err instanceof WsError) throw new HttpError(429, err.code, err.message);
    throw err;
  }
  const { emitter, result } = bufferedAnswer();
  startAsk({ userId, question, scope: 'global', persistToRoom: false, emitter });
  const answer = await result;
  res.json({
    answer: answer.answer,
    cached: answer.cached,
    citations: presentCitations(answer.citations),
  });
});

const catchupSchema = z.object({ room: z.string().trim().min(1).max(64) });

memoryRouter.post('/memory/catchup', requirePat, async (req, res) => {
  requireAiOn();
  const userId = req.patUserId as string;
  const { room: roomQuery } = parseOrThrow(catchupSchema, req.body);
  const room = await Room.findOne({ slug: roomQuery.replace(/^#/, '').toLowerCase() });
  if (!room) throw new HttpError(404, 'NOT_FOUND', 'Room not found');
  const roomId = room._id.toHexString();
  // Same gate as the app: membership and the room memory switch.
  const allowed = await getUserRoomIds(userId, roomId);
  if (allowed.length === 0) {
    throw new HttpError(403, 'FORBIDDEN', 'You are not a member of this room, or memory is off');
  }
  try {
    await preflight(userId);
  } catch (err) {
    if (err instanceof WsError) throw new HttpError(429, err.code, err.message);
    throw err;
  }
  const { emitter, result } = bufferedAnswer();
  startCatchup({ userId, roomId, emitter });
  const digest = await result;
  res.json({
    digest: digest.answer,
    citations: presentCitations(digest.citations),
  });
});

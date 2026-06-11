import { Router } from 'express';
import { redis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import { Message } from '../../models/message.model.js';
import { AiCall } from '../../models/ai-call.model.js';

// Public aggregate stats: counts only, never content, cached for a minute.

export const statsRouter = Router();

const CACHE_KEY = 'stats:public';
const CACHE_SECONDS = 60;

statsRouter.get('/stats', async (_req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }
  } catch (err) {
    logger.warn({ err }, 'stats cache read failed');
  }

  const [messagesStored, aiAnswersServed] = await Promise.all([
    Message.countDocuments({}),
    AiCall.countDocuments({ ok: true }),
  ]);
  const stats = {
    messagesStored,
    aiAnswersServed,
    uptimeSeconds: Math.round(process.uptime()),
  };
  redis.set(CACHE_KEY, JSON.stringify(stats), 'EX', CACHE_SECONDS).catch(() => undefined);
  res.json(stats);
});

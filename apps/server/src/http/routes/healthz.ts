import { Router } from 'express';
import { mongoHealthy } from '../../lib/mongo.js';
import { redisHealthy } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { qdrantHealthy } from '../../ai/vector-store.js';

export const healthzRouter = Router();

healthzRouter.get('/healthz', async (_req, res) => {
  const [mongo, redis] = await Promise.all([mongoHealthy(), redisHealthy()]);
  // Chat health never depends on the AI stack. Qdrant status is reported
  // for operators but does not gate the 200.
  const ai = env.AI_ENABLED
    ? { enabled: true, qdrant: (await qdrantHealthy()) ? 'ok' : 'down' }
    : { enabled: false };
  const healthy = mongo && redis;
  res.status(healthy ? 200 : 503).json({
    service: 'parley-server',
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: {
      mongo: mongo ? 'ok' : 'down',
      redis: redis ? 'ok' : 'down',
    },
    ai,
  });
});

import { Router } from 'express';
import { mongoHealthy } from '../../lib/mongo.js';
import { redisHealthy } from '../../lib/redis.js';

export const healthzRouter = Router();

healthzRouter.get('/healthz', async (_req, res) => {
  const [mongo, redis] = await Promise.all([mongoHealthy(), redisHealthy()]);
  const healthy = mongo && redis;
  res.status(healthy ? 200 : 503).json({
    service: 'parley-server',
    status: healthy ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    dependencies: {
      mongo: mongo ? 'ok' : 'down',
      redis: redis ? 'ok' : 'down',
    },
  });
});

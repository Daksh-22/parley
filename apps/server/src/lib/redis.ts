import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

function createClient(purpose: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  client.on('error', (err) => {
    logger.error({ err, purpose }, 'redis client error');
  });
  return client;
}

// Main client for presence, rate limiting, and general commands.
export const redis = createClient('main');

// The Socket.IO redis adapter requires dedicated pub and sub connections,
// because a subscribed connection cannot issue regular commands.
export const redisPub = createClient('socketio-pub');
export const redisSub = createClient('socketio-sub');

export async function connectRedis(): Promise<void> {
  await Promise.all([redis.connect(), redisPub.connect(), redisSub.connect()]);
  logger.info('redis connected');
}

export async function disconnectRedis(): Promise<void> {
  await Promise.all([redis.quit(), redisPub.quit(), redisSub.quit()]);
  logger.info('redis disconnected');
}

export async function redisHealthy(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}

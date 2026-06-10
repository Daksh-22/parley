import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';

// Per-user daily token quota in Redis. Checked before every model call,
// recorded with real usage after. Keys expire on their own.

function quotaKey(userId: string): string {
  const now = new Date();
  const day = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
  return `ai:quota:${userId}:${day}`;
}

export async function quotaRemaining(userId: string): Promise<number> {
  const used = Number((await redis.get(quotaKey(userId))) ?? 0);
  return Math.max(0, env.AI_DAILY_TOKEN_QUOTA - used);
}

export async function recordTokenUsage(userId: string, tokens: number): Promise<void> {
  const key = quotaKey(userId);
  await redis
    .multi()
    .incrby(key, Math.max(0, Math.round(tokens)))
    .expire(key, 60 * 60 * 48)
    .exec();
}

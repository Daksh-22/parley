import { randomUUID } from 'node:crypto';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';

// Sliding-window rate limiter with a temporary mute, atomic via Lua.
// A sorted set holds one member per action timestamped in ms. Exceeding the
// limit sets a mute key with a TTL; while muted, every attempt is refused
// with the seconds remaining, and the window is cleared so the mute is the
// single source of truth.
//
// Returns {allowed, retryAfterSeconds}.
const SLIDING_WINDOW_LUA = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {0, redis.call('TTL', KEYS[2])}
end
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
  redis.call('DEL', KEYS[1])
  return {0, tonumber(ARGV[4])}
end
redis.call('ZADD', KEYS[1], now, ARGV[5])
redis.call('PEXPIRE', KEYS[1], window)
return {1, 0}
`;

export interface RateResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

async function slidingWindow(
  key: string,
  limit: number,
  windowMs: number,
  muteSeconds: number,
): Promise<RateResult> {
  const result = (await redis.eval(
    SLIDING_WINDOW_LUA,
    2,
    `rl:${key}`,
    `rl:mute:${key}`,
    Date.now(),
    windowMs,
    limit,
    muteSeconds,
    randomUUID(),
  )) as [number, number];
  return { allowed: result[0] === 1, retryAfterSeconds: result[1] };
}

/** Messages per user. Spec: 10 per 10 seconds, then a temporary mute. */
export function checkMessageRate(userId: string): Promise<RateResult> {
  return slidingWindow(
    `msg:${userId}`,
    env.MSG_RATE_LIMIT,
    env.MSG_RATE_WINDOW_MS,
    env.MSG_MUTE_SECONDS,
  );
}

/** Room joins per user: join flood protection. */
export function checkJoinRate(userId: string): Promise<RateResult> {
  return slidingWindow(
    `join:${userId}`,
    env.JOIN_RATE_LIMIT,
    env.JOIN_RATE_WINDOW_MS,
    env.JOIN_MUTE_SECONDS,
  );
}

/** Socket connection attempts per IP. */
export function checkConnectionRate(ip: string): Promise<RateResult> {
  return slidingWindow(
    `conn:${ip}`,
    env.CONN_RATE_LIMIT,
    env.CONN_RATE_WINDOW_MS,
    env.CONN_MUTE_SECONDS,
  );
}

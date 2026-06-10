import type { AppServer } from './types.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { User } from '../models/user.model.js';

// Presence contract:
//   presence:online:{userId} exists (TTL 30s)  <=>  user is online.
// A per-user connection count tracks multiple tabs so presence does not
// flicker when one of several tabs closes. Both keys carry TTLs so a crashed
// instance can never strand a user as permanently online: the keys simply
// expire.
const ONLINE_TTL_SECONDS = 30;
const CONN_TTL_SECONDS = 90;
const HEARTBEAT_INTERVAL_MS = 15_000;

const onlineKey = (userId: string): string => `presence:online:${userId}`;
const connsKey = (userId: string): string => `presence:conns:${userId}`;

// userIds with at least one socket connected to THIS instance, with local
// connection counts. The heartbeat refreshes Redis TTLs for these.
const localConnections = new Map<string, number>();

// In-flight presence writes. Graceful shutdown drains these before closing
// the Mongo and Redis connections they depend on.
const inFlight = new Set<Promise<unknown>>();

function tracked<T>(work: Promise<T>): Promise<T> {
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  return work;
}

/** Awaits all in-flight presence writes. Called during graceful shutdown. */
export async function drainPresence(): Promise<void> {
  await Promise.allSettled([...inFlight]);
}

let heartbeat: NodeJS.Timeout | null = null;

function ensureHeartbeat(): void {
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    void (async () => {
      if (localConnections.size === 0) return;
      const pipeline = redis.pipeline();
      for (const userId of localConnections.keys()) {
        pipeline.set(onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS);
        pipeline.expire(connsKey(userId), CONN_TTL_SECONDS);
      }
      await pipeline.exec();
    })().catch((err: unknown) => {
      logger.error({ err }, 'presence heartbeat failed');
    });
  }, HEARTBEAT_INTERVAL_MS);
  // Never keep the process alive just for presence refreshes.
  heartbeat.unref();
}

export function presenceConnect(io: AppServer, userId: string): Promise<void> {
  return tracked(doPresenceConnect(io, userId));
}

export function presenceDisconnect(io: AppServer, userId: string): Promise<void> {
  return tracked(doPresenceDisconnect(io, userId));
}

async function doPresenceConnect(io: AppServer, userId: string): Promise<void> {
  ensureHeartbeat();
  localConnections.set(userId, (localConnections.get(userId) ?? 0) + 1);

  const results = await redis
    .multi()
    .incr(connsKey(userId))
    .expire(connsKey(userId), CONN_TTL_SECONDS)
    .set(onlineKey(userId), '1', 'EX', ONLINE_TTL_SECONDS)
    .exec();

  const connCount = results?.[0]?.[1];
  if (connCount === 1) {
    // First connection anywhere: the user just came online.
    io.emit('presence:update', { userId, online: true, lastSeenAt: null });
  }
}

async function doPresenceDisconnect(io: AppServer, userId: string): Promise<void> {
  const local = (localConnections.get(userId) ?? 1) - 1;
  if (local <= 0) localConnections.delete(userId);
  else localConnections.set(userId, local);

  const remaining = await redis.decr(connsKey(userId));
  if (remaining > 0) return;

  // Last connection anywhere: the user went offline.
  await redis.del(connsKey(userId), onlineKey(userId));
  const lastSeenAt = new Date();
  await User.updateOne({ _id: userId }, { lastSeenAt });
  io.emit('presence:update', { userId, online: false, lastSeenAt: lastSeenAt.toISOString() });
}

/** Online userIds for the initial presence:state push, capped for safety. */
export async function listOnlineUserIds(cap = 1000): Promise<string[]> {
  const prefix = 'presence:online:';
  const ids: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      ids.push(key.slice(prefix.length));
      if (ids.length >= cap) return ids;
    }
  } while (cursor !== '0');
  return ids;
}

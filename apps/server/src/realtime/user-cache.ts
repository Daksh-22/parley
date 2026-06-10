import type { PublicUser } from '@parley/shared';
import { User } from '../models/user.model.js';
import { toPublicUser } from '../auth/serialize.js';

const TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

interface CacheEntry {
  user: PublicUser;
  expiresAt: number;
}

// Per-process cache of public user summaries, embedded into message wire
// payloads. Sixty seconds of staleness on a display name is an acceptable
// trade for removing a Mongo lookup from the message hot path.
const cache = new Map<string, CacheEntry>();

export async function getPublicUser(userId: string): Promise<PublicUser | null> {
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > Date.now()) return hit.user;

  const doc = await User.findById(userId);
  if (!doc) {
    cache.delete(userId);
    return null;
  }
  if (cache.size >= MAX_ENTRIES) {
    // Drop the oldest insertion. Map iterates in insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const user = toPublicUser(doc);
  cache.set(userId, { user, expiresAt: Date.now() + TTL_MS });
  return user;
}

export function invalidatePublicUser(userId: string): void {
  cache.delete(userId);
}

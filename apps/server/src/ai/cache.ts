import { createHash } from 'node:crypto';
import type { Citation } from '@parley/shared';
import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { getEmbedder } from './provider.js';

// Semantic answer cache. The key includes a permission fingerprint: a hash
// of the asker's sorted, memory-enabled room memberships plus the ask scope.
// Any membership change, room-memory toggle, or scope difference produces a
// different fingerprint, so a cached answer can never cross a permission
// boundary by construction. Entries expire on a TTL and are capped per
// fingerprint.

const MAX_ENTRIES_PER_FINGERPRINT = 20;
const SIMILARITY_THRESHOLD = 0.95;

export interface CachedAnswer {
  question: string;
  answer: string;
  citations: Citation[];
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

interface CacheEntry extends CachedAnswer {
  vector: number[];
}

export function permissionFingerprint(roomIds: string[], scope: string): string {
  const material = `${scope}|${[...roomIds].sort().join(',')}`;
  return createHash('sha256').update(material).digest('hex').slice(0, 32);
}

const cacheKey = (fingerprint: string): string => `ai:cache:${fingerprint}`;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  // Embeddings are unit vectors from every provider here.
  return dot;
}

export async function cacheLookup(
  fingerprint: string,
  question: string,
): Promise<CachedAnswer | null> {
  try {
    const raw = await redis.lrange(cacheKey(fingerprint), 0, MAX_ENTRIES_PER_FINGERPRINT - 1);
    if (raw.length === 0) return null;
    const [vector] = await getEmbedder().embed([question]);
    if (!vector) return null;
    let best: { entry: CacheEntry; similarity: number } | null = null;
    for (const item of raw) {
      const entry = JSON.parse(item) as CacheEntry;
      const similarity = cosine(vector, entry.vector);
      if (similarity >= SIMILARITY_THRESHOLD && (!best || similarity > best.similarity)) {
        best = { entry, similarity };
      }
    }
    return best ? best.entry : null;
  } catch (err) {
    logger.warn({ err }, 'cache lookup failed');
    return null;
  }
}

export async function cacheStore(
  fingerprint: string,
  question: string,
  answer: CachedAnswer,
): Promise<void> {
  try {
    const [vector] = await getEmbedder().embed([question]);
    if (!vector) return;
    const entry: CacheEntry = { ...answer, vector };
    await redis
      .multi()
      .lpush(cacheKey(fingerprint), JSON.stringify(entry))
      .ltrim(cacheKey(fingerprint), 0, MAX_ENTRIES_PER_FINGERPRINT - 1)
      .expire(cacheKey(fingerprint), env.AI_CACHE_TTL_SECONDS)
      .exec();
  } catch (err) {
    logger.warn({ err }, 'cache store failed');
  }
}

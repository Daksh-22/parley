import { createHash } from 'node:crypto';
import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

// One collection holds both message and document-chunk vectors. Every point
// carries roomId in its payload, and every search filters on the caller's
// current room memberships: permission is evaluated at query time, never at
// index time.

export interface VectorPayload {
  kind: 'message' | 'doc';
  roomId: string;
  text: string;
  createdAt: string;
  messageId?: string;
  senderId?: string;
  docId?: string;
  chunkIndex?: number;
  page?: number;
  filename?: string;
  [key: string]: unknown;
}

export interface VectorHit {
  id: string;
  score: number;
  payload: VectorPayload;
}

let client: QdrantClient | null = null;

export function qdrant(): QdrantClient {
  if (!client) client = new QdrantClient({ url: env.QDRANT_URL });
  return client;
}

/** Deterministic Qdrant point id from a stable content key. */
export function pointId(key: string): string {
  const hex = createHash('md5').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function ensureCollection(): Promise<void> {
  const collections = await qdrant().getCollections();
  const exists = collections.collections.some((c) => c.name === env.QDRANT_COLLECTION);
  if (!exists) {
    await qdrant().createCollection(env.QDRANT_COLLECTION, {
      vectors: { size: env.AI_EMBED_DIMENSIONS, distance: 'Cosine' },
    });
    await qdrant().createPayloadIndex(env.QDRANT_COLLECTION, {
      field_name: 'roomId',
      field_schema: 'keyword',
      wait: true,
    });
    await qdrant().createPayloadIndex(env.QDRANT_COLLECTION, {
      field_name: 'kind',
      field_schema: 'keyword',
      wait: true,
    });
    logger.info({ collection: env.QDRANT_COLLECTION }, 'qdrant collection created');
  }
}

export async function upsertVectors(
  points: { id: string; vector: number[]; payload: VectorPayload }[],
): Promise<void> {
  if (points.length === 0) return;
  await qdrant().upsert(env.QDRANT_COLLECTION, { wait: true, points });
}

/**
 * Vector search constrained to the given rooms. An empty roomIds list
 * short-circuits to no results: no memberships means no knowledge.
 */
export async function searchVectors(
  vector: number[],
  options: { roomIds: string[]; limit: number; kind?: 'message' | 'doc' },
): Promise<VectorHit[]> {
  if (options.roomIds.length === 0) return [];
  const must: object[] = [{ key: 'roomId', match: { any: options.roomIds } }];
  if (options.kind) must.push({ key: 'kind', match: { value: options.kind } });
  const result = await qdrant().search(env.QDRANT_COLLECTION, {
    vector,
    limit: options.limit,
    filter: { must },
    with_payload: true,
  });
  return result.map((hit) => ({
    id: String(hit.id),
    score: hit.score,
    payload: hit.payload as unknown as VectorPayload,
  }));
}

export async function deleteVectorsByRoom(roomId: string): Promise<void> {
  await qdrant().delete(env.QDRANT_COLLECTION, {
    wait: true,
    filter: { must: [{ key: 'roomId', match: { value: roomId } }] },
  });
}

export async function deleteVectorsByDoc(docId: string): Promise<void> {
  await qdrant().delete(env.QDRANT_COLLECTION, {
    wait: true,
    filter: { must: [{ key: 'docId', match: { value: docId } }] },
  });
}

export async function qdrantHealthy(): Promise<boolean> {
  try {
    await qdrant().getCollections();
    return true;
  } catch {
    return false;
  }
}

export async function countVectors(): Promise<number> {
  const result = await qdrant().count(env.QDRANT_COLLECTION, { exact: true });
  return result.count;
}

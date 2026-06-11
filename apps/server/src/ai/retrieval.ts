import { Membership } from '../models/membership.model.js';
import { Message } from '../models/message.model.js';
import { env } from '../config/env.js';
import { getEmbedder } from './provider.js';
import { searchVectors } from './vector-store.js';
import { approxTokens } from './tokens.js';

// Hybrid retrieval: a vector leg (Qdrant) and a lexical leg (Mongo text
// index), fused with reciprocal rank fusion. Both legs are filtered by the
// requesting user's CURRENT room memberships, resolved here at query time:
// revoked access is revoked knowledge, no matter when content was indexed.

const RRF_K = 60;
const LEG_LIMIT = 20;

export interface RetrievedSource {
  key: string;
  kind: 'message' | 'doc';
  roomId: string;
  text: string;
  createdAt: string;
  score: number;
  messageId?: string;
  senderId?: string;
  docId?: string;
  chunkIndex?: number;
  page?: number;
  filename?: string;
}

/**
 * The single permission gate for every retrieval path: the rooms the user is
 * a member of right now. With restrictToRoom set, the result is that room or
 * nothing, never a room the user does not belong to.
 */
export async function getUserRoomIds(userId: string, restrictToRoom?: string): Promise<string[]> {
  const memberships = await Membership.find({ userId }).select('roomId');
  const ids = memberships.map((m) => m.roomId.toHexString());
  if (restrictToRoom) return ids.includes(restrictToRoom) ? [restrictToRoom] : [];
  return ids;
}

export async function hybridRetrieve(
  question: string,
  roomIds: string[],
  limit = 12,
): Promise<RetrievedSource[]> {
  if (roomIds.length === 0) return [];

  const [vectorHits, lexicalHits] = await Promise.all([
    vectorLeg(question, roomIds),
    lexicalLeg(question, roomIds),
  ]);

  // Reciprocal rank fusion: score(source) = sum over legs of 1/(k + rank).
  const fused = new Map<string, RetrievedSource>();
  const addLeg = (sources: RetrievedSource[]): void => {
    sources.forEach((source, rank) => {
      const existing = fused.get(source.key);
      const contribution = 1 / (RRF_K + rank + 1);
      if (existing) existing.score += contribution;
      else fused.set(source.key, { ...source, score: contribution });
    });
  };
  addLeg(vectorHits);
  addLeg(lexicalHits);

  const ranked = [...fused.values()].sort((a, b) => b.score - a.score);

  // Near-duplicate collapse on normalized text. Recall commands indexed by
  // older builds are filtered here as well: a question is not a source.
  const seen = new Set<string>();
  const deduped: RetrievedSource[] = [];
  for (const source of ranked) {
    if (source.text.startsWith('@recall ')) continue;
    const normalized = source.text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(source);
    if (deduped.length >= limit) break;
  }
  return deduped;
}

async function vectorLeg(question: string, roomIds: string[]): Promise<RetrievedSource[]> {
  const [vector] = await getEmbedder().embed([question]);
  if (!vector) return [];
  const hits = await searchVectors(vector, { roomIds, limit: LEG_LIMIT });
  return hits.map((hit) => ({
    key:
      hit.payload.kind === 'message'
        ? `message:${hit.payload.messageId}`
        : `doc:${hit.payload.docId}:${hit.payload.chunkIndex}`,
    kind: hit.payload.kind,
    roomId: hit.payload.roomId,
    text: hit.payload.text,
    createdAt: hit.payload.createdAt,
    score: 0,
    messageId: hit.payload.messageId,
    senderId: hit.payload.senderId,
    docId: hit.payload.docId,
    chunkIndex: hit.payload.chunkIndex,
    page: hit.payload.page,
    filename: hit.payload.filename,
  }));
}

async function lexicalLeg(question: string, roomIds: string[]): Promise<RetrievedSource[]> {
  const hits = await Message.find(
    {
      $text: { $search: question },
      roomId: { $in: roomIds },
      // $ne also matches legacy documents that predate the kind field.
      kind: { $ne: 'ai' },
    },
    { score: { $meta: 'textScore' } },
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(LEG_LIMIT);
  return hits.map((message) => ({
    key: `message:${message._id.toHexString()}`,
    kind: 'message' as const,
    roomId: message.roomId.toHexString(),
    text: message.body,
    createdAt: message.createdAt.toISOString(),
    score: 0,
    messageId: message._id.toHexString(),
    senderId: message.senderId.toHexString(),
  }));
}

/** Pack the strongest sources into the context token budget, in rank order. */
export function packToBudget(
  sources: RetrievedSource[],
  budgetTokens = env.AI_CONTEXT_TOKEN_BUDGET,
): RetrievedSource[] {
  const packed: RetrievedSource[] = [];
  let used = 0;
  for (const source of sources) {
    const cost = approxTokens(source.text) + 30;
    if (used + cost > budgetTokens) continue;
    packed.push(source);
    used += cost;
  }
  return packed;
}

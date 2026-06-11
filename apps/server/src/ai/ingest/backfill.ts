// Backfill: embed every historical user message into the vector store.
// Run with: pnpm ai:backfill (idempotent, safe to rerun).
/* eslint-disable no-console -- operational script, stdout is the interface */
import { connectMongo, disconnectMongo } from '../../lib/mongo.js';
import { connectRedis, disconnectRedis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { Message } from '../../models/message.model.js';
import { getEmbedder } from '../provider.js';
import { ensureCollection, pointId, upsertVectors, type VectorPayload } from '../vector-store.js';

const BATCH = 64;

async function main(): Promise<void> {
  if (!env.AI_ENABLED) {
    console.error('AI_ENABLED is false. Set it to true to backfill.');
    process.exit(1);
  }
  await connectMongo();
  await connectRedis();
  await ensureCollection();

  // $ne matches documents created before the kind field existed, which a
  // plain { kind: 'user' } filter would silently skip. Recall commands are
  // questions, never knowledge.
  const filter = { kind: { $ne: 'ai' as const }, body: { $not: /^@recall / } };
  const total = await Message.countDocuments(filter);
  console.log(`Backfilling ${total} messages into ${env.QDRANT_COLLECTION}`);

  let processed = 0;
  let lastId: string | null = null;
  for (;;) {
    const batch = await Message.find({
      ...filter,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .sort({ _id: 1 })
      .limit(BATCH);
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]?._id.toHexString() ?? null;

    const vectors = await getEmbedder().embed(batch.map((m) => m.body));
    const points = batch.flatMap((message, i) => {
      const vector = vectors[i];
      if (!vector) return [];
      const payload: VectorPayload = {
        kind: 'message',
        roomId: message.roomId.toHexString(),
        messageId: message._id.toHexString(),
        senderId: message.senderId.toHexString(),
        createdAt: message.createdAt.toISOString(),
        text: message.body,
      };
      return [{ id: pointId(`msg:${message._id.toHexString()}`), vector, payload }];
    });
    await upsertVectors(points);
    processed += batch.length;
    console.log(`  ${processed}/${total}`);
  }

  console.log('Backfill complete.');
  await disconnectMongo();
  await disconnectRedis();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

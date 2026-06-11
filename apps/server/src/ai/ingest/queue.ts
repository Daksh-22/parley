import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../lib/redis.js';
import { Message } from '../../models/message.model.js';
import { DocumentModel } from '../../models/document.model.js';
import { embedBatched } from './batcher.js';
import { chunkDocument } from './chunker.js';
import { pointId, upsertVectors, type VectorPayload } from '../vector-store.js';
import { getAiIo } from '../events.js';

// The queue name is namespaced by collection so a dev server and a test run
// sharing one Redis can never steal each other's jobs: a worker bound to
// another Mongo database would complete them as silent no-ops.
const QUEUE_NAME = `ai-ingest-${env.QDRANT_COLLECTION}`;
export const DLQ_KEY = 'ai:dlq';

type IngestJob = { kind: 'message'; messageId: string } | { kind: 'doc'; docId: string };

// BullMQ manages its own redis connections and requires
// maxRetriesPerRequest to be disabled on them.
function bullConnection(): ConnectionOptions {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<IngestJob> | null = null;
let worker: Worker<IngestJob> | null = null;

export function ingestQueue(): Queue<IngestJob> {
  if (!queue) {
    queue = new Queue<IngestJob>(QUEUE_NAME, { connection: bullConnection() });
  }
  return queue;
}

/** Idempotent enqueue: the jobId is derived from the content id. */
export async function enqueueMessageEmbed(messageId: string): Promise<void> {
  if (!env.AI_ENABLED) return;
  await ingestQueue().add(
    'message',
    { kind: 'message', messageId },
    {
      jobId: `msg-${messageId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 5000,
      removeOnFail: 5000,
    },
  );
}

export async function enqueueDocIngest(docId: string): Promise<void> {
  if (!env.AI_ENABLED) return;
  await ingestQueue().add(
    'doc',
    { kind: 'doc', docId },
    {
      jobId: `doc-${docId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  );
}

export async function processMessageJob(messageId: string): Promise<void> {
  const message = await Message.findById(messageId);
  // Deleted, or AI-generated: AI messages are never ingested, preventing
  // the model from retrieving and amplifying its own output. The @recall
  // trigger itself is a command, not knowledge: ingesting it would make a
  // question retrieve itself as the top source for its own answer.
  if (!message || message.kind !== 'user') return;
  if (message.body.startsWith('@recall ')) return;
  const vector = await embedBatched(message.body);
  const payload: VectorPayload = {
    kind: 'message',
    roomId: message.roomId.toHexString(),
    messageId: message._id.toHexString(),
    senderId: message.senderId.toHexString(),
    createdAt: message.createdAt.toISOString(),
    text: message.body,
  };
  // Deterministic point id makes retries and re-deliveries idempotent.
  await upsertVectors([{ id: pointId(`msg:${messageId}`), vector, payload }]);
}

export async function processDocJob(docId: string): Promise<void> {
  const doc = await DocumentModel.findById(docId);
  if (!doc) return;
  try {
    const chunks = chunkDocument(doc.text, doc.pageOffsets);
    const points = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      if (!chunk) continue;
      const vector = await embedBatched(chunk.text);
      points.push({
        id: pointId(`doc:${docId}:${i}`),
        vector,
        payload: {
          kind: 'doc' as const,
          roomId: doc.roomId.toHexString(),
          docId: doc._id.toHexString(),
          chunkIndex: i,
          page: chunk.page,
          filename: doc.filename,
          createdAt: doc.createdAt.toISOString(),
          text: chunk.text,
        },
      });
    }
    await upsertVectors(points);
    doc.status = 'ready';
    doc.chunkCount = points.length;
    doc.error = null;
    await doc.save();
  } catch (err) {
    doc.status = 'failed';
    doc.error = err instanceof Error ? err.message.slice(0, 500) : 'ingestion failed';
    await doc.save();
    throw err;
  } finally {
    getAiIo()
      ?.to(`room:${doc.roomId.toHexString()}`)
      .emit('ai:doc:status', {
        roomId: doc.roomId.toHexString(),
        docId: doc._id.toHexString(),
        filename: doc.filename,
        status: doc.status,
        chunkCount: doc.chunkCount,
        error: doc.error ?? undefined,
      });
  }
}

export function startIngestWorker(): void {
  if (worker) return;
  worker = new Worker<IngestJob>(
    QUEUE_NAME,
    async (job: Job<IngestJob>) => {
      if (job.data.kind === 'message') await processMessageJob(job.data.messageId);
      else await processDocJob(job.data.docId);
    },
    { connection: bullConnection(), concurrency: 8 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'ingest job failed');
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      // Attempts exhausted: dead-letter for operator inspection.
      void redis.lpush(
        DLQ_KEY,
        JSON.stringify({ data: job.data, error: err.message, failedAt: new Date().toISOString() }),
      );
    }
  });
  logger.info('ai ingest worker started');
}

export async function stopIngestWorker(): Promise<void> {
  await worker?.close();
  worker = null;
  await queue?.close();
  queue = null;
}

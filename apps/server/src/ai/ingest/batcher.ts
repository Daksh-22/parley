import { getEmbedder } from '../provider.js';

interface PendingEmbed {
  text: string;
  resolve: (vector: number[]) => void;
  reject: (err: unknown) => void;
}

const MAX_BATCH = 64;
const MAX_WAIT_MS = 200;

const pending: PendingEmbed[] = [];
let timer: NodeJS.Timeout | null = null;

/**
 * Coalesces concurrent embedding requests into batched provider calls of up
 * to 64 texts. Callers await a single vector; the batcher owns the batching.
 */
export function embedBatched(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    pending.push({ text, resolve, reject });
    if (pending.length >= MAX_BATCH) {
      void flush();
    } else if (!timer) {
      timer = setTimeout(() => void flush(), MAX_WAIT_MS);
      timer.unref();
    }
  });
}

async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = pending.splice(0, MAX_BATCH);
  if (batch.length === 0) return;
  try {
    const vectors = await getEmbedder().embed(batch.map((p) => p.text));
    batch.forEach((p, i) => {
      const vector = vectors[i];
      if (vector) p.resolve(vector);
      else p.reject(new Error('embedding batch returned too few vectors'));
    });
  } catch (err) {
    for (const p of batch) p.reject(err);
  }
  // More may have queued while the provider call ran.
  if (pending.length > 0) void flush();
}

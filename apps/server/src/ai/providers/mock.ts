import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  EmbeddingClient,
  LLMClient,
} from '../types.js';
import { approxTokens } from '../tokens.js';

// Deterministic provider for tests and keyless CI. Same input, same output,
// every time, no network.

function seededRandom(seed: number): () => number {
  // mulberry32
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(text: string): number {
  return createHash('sha256').update(text).digest().readUInt32LE(0);
}

/**
 * Hash-based fake embeddings. Identical text maps to an identical unit
 * vector, so exact-text queries retrieve their source with cosine 1.0,
 * which is what the integration tests rely on. To give the vector leg a
 * little semantic-ish behavior with zero dependencies, the vector is the
 * normalized sum of per-token hash vectors: texts sharing words land closer
 * than unrelated texts.
 */
export class MockEmbeddingClient implements EmbeddingClient {
  readonly provider = 'mock';
  readonly model = 'mock-embed-1';

  constructor(readonly dimensions: number) {}

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((text) => this.embedOne(text)));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1);
    const parts = tokens.length > 0 ? tokens : [text];
    for (const token of parts) {
      const rand = seededRandom(hashSeed(token));
      for (let i = 0; i < this.dimensions; i += 1) {
        (vector as number[])[i] = (vector[i] ?? 0) + (rand() * 2 - 1);
      }
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}

export class MockLLMClient implements LLMClient {
  readonly provider = 'mock';
  readonly model = 'mock-chat-1';

  async completeStreaming(
    request: CompletionRequest,
    onDelta: (delta: string) => void,
  ): Promise<CompletionResult> {
    const text = this.cannedAnswer(request);
    // Stream in small chunks so the client-side streaming path is exercised.
    for (let i = 0; i < text.length; i += 24) {
      onDelta(text.slice(i, i + 24));
      await new Promise((resolve) => setImmediate(resolve));
    }
    return { text, usage: this.usage(request, text) };
  }

  completeStructured<S extends z.ZodTypeAny>(
    request: CompletionRequest,
    schema: S,
  ): Promise<{ data: z.output<S>; usage: CompletionUsage }> {
    // Deterministic structured output: tests seed the expected shape through
    // a JSON block in the prompt when they need specific content; otherwise
    // an empty-but-valid object is synthesized from the schema.
    const prompt = request.messages.map((m) => m.content).join('\n');
    const seeded = /MOCK_STRUCTURED:(\{.*\})/s.exec(prompt);
    const candidate: unknown = seeded?.[1] ? JSON.parse(seeded[1]) : { decisions: [] };
    const data = schema.parse(candidate) as z.output<S>;
    return Promise.resolve({
      data,
      usage: this.usage(request, JSON.stringify(candidate)),
    });
  }

  rerank(query: string, candidates: string[], topK: number): Promise<number[]> {
    // Deterministic rerank: score by shared lowercase token overlap with the
    // query, tie-broken by original index for stability.
    const queryTokens = new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1),
    );
    const scored = candidates.map((text, index) => {
      const tokens = text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
      const overlap = tokens.filter((t) => queryTokens.has(t)).length;
      return { index, score: overlap };
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return Promise.resolve(scored.slice(0, topK).map((s) => s.index));
  }

  private cannedAnswer(request: CompletionRequest): string {
    const prompt = request.messages.map((m) => m.content).join('\n');
    const sourceCount = (prompt.match(/^\[\d+\]/gm) ?? []).length;
    if (sourceCount === 0) {
      return 'The history I can see does not contain an answer to this question.';
    }
    // Cite the first and last source so citation mapping is testable.
    const lastRef = sourceCount > 1 ? ` and confirmed later [${sourceCount}]` : '';
    return `Based on the room history, the relevant point was raised [1]${lastRef}. This is a deterministic mock answer used in tests and keyless development.`;
  }

  private usage(request: CompletionRequest, text: string): CompletionUsage {
    const inputTokens = approxTokens(
      request.system + request.messages.map((m) => m.content).join(''),
    );
    return { inputTokens, outputTokens: approxTokens(text) };
  }
}

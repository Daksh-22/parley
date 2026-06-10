import type { z } from 'zod';

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  usage: CompletionUsage;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessageInput[];
  maxTokens: number;
  temperature?: number;
}

/**
 * Streaming chat completion plus structured output. Implementations must be
 * side-effect free beyond the provider call itself: no tools, no actions.
 * Retrieved content reaches these methods only inside data delimiters.
 */
export interface LLMClient {
  readonly provider: string;
  readonly model: string;
  /** Streams text deltas via onDelta, resolves with the full result. */
  completeStreaming(
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult>;
  /** Structured output validated against the given zod schema. */
  completeStructured<S extends z.ZodTypeAny>(
    request: CompletionRequest,
    schema: S,
    signal?: AbortSignal,
  ): Promise<{ data: z.output<S>; usage: CompletionUsage }>;
  /**
   * Orders candidate texts by relevance to the query, best first.
   * Returns indexes into the candidates array. Used by the rerank stage.
   */
  rerank(
    query: string,
    candidates: string[],
    topK: number,
    signal?: AbortSignal,
  ): Promise<number[]>;
}

export interface EmbeddingClient {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  /** Batch embed. Order of output matches order of input. */
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

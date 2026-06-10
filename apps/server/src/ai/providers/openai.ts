import OpenAI from 'openai';
import type { z } from 'zod';
import type {
  CompletionRequest,
  CompletionResult,
  CompletionUsage,
  EmbeddingClient,
  LLMClient,
} from '../types.js';
import { parseIndexArray, zodToJsonSchemaLoose } from './anthropic.js';

export class OpenAILLMClient implements LLMClient {
  readonly provider = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async completeStreaming(
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.2,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      { signal },
    );
    let text = '';
    let usage: CompletionUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        };
      }
    }
    return { text, usage };
  }

  async completeStructured<S extends z.ZodTypeAny>(
    request: CompletionRequest,
    schema: S,
    signal?: AbortSignal,
  ): Promise<{ data: z.output<S>; usage: CompletionUsage }> {
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'result',
            schema: { ...zodToJsonSchemaLoose(schema), additionalProperties: false },
            strict: false,
          },
        },
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      },
      { signal },
    );
    const content = response.choices[0]?.message?.content ?? '{}';
    return {
      data: schema.parse(JSON.parse(content)) as z.output<S>,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  async rerank(
    query: string,
    candidates: string[],
    topK: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const list = candidates
      .map((text, i) => `[${i}] ${text.slice(0, 400).replace(/\n/g, ' ')}`)
      .join('\n');
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'You rank passages by relevance to a query. Respond with only a JSON array of passage indexes, most relevant first. No prose.',
          },
          {
            role: 'user',
            content: `Query: ${query}\n\nPassages:\n${list}\n\nTop ${topK} indexes:`,
          },
        ],
      },
      { signal },
    );
    return parseIndexArray(response.choices[0]?.message?.content ?? '', candidates.length, topK);
  }
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly provider = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    readonly dimensions: number,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const response = await this.client.embeddings.create(
      { model: this.model, input: texts, dimensions: this.dimensions },
      { signal },
    );
    // The API returns embeddings with an index field; order defensively.
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

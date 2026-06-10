import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { CompletionRequest, CompletionResult, CompletionUsage, LLMClient } from '../types.js';

export class AnthropicLLMClient implements LLMClient {
  readonly provider = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async completeStreaming(
    request: CompletionRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature ?? 0.2,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      },
      { signal },
    );
    stream.on('text', (delta) => onDelta(delta));
    const final = await stream.finalMessage();
    const text = final.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
      },
    };
  }

  async completeStructured<S extends z.ZodTypeAny>(
    request: CompletionRequest,
    schema: S,
    signal?: AbortSignal,
  ): Promise<{ data: z.output<S>; usage: CompletionUsage }> {
    // Structured output through forced tool use: the model must call the
    // single tool whose input schema is the requested shape.
    const jsonSchema = zodToJsonSchemaLoose(schema);
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        temperature: 0,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        tools: [
          {
            name: 'emit_result',
            description: 'Emit the structured result.',
            input_schema: jsonSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_result' },
      },
      { signal },
    );
    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) throw new Error('anthropic structured output returned no tool call');
    return {
      data: schema.parse(toolUse.input) as z.output<S>,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
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
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 200,
        temperature: 0,
        system:
          'You rank passages by relevance to a query. Respond with only a JSON array of passage indexes, most relevant first. No prose.',
        messages: [
          {
            role: 'user',
            content: `Query: ${query}\n\nPassages:\n${list}\n\nTop ${topK} indexes:`,
          },
        ],
      },
      { signal },
    );
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return parseIndexArray(text, candidates.length, topK);
  }
}

export function parseIndexArray(text: string, max: number, topK: number): number[] {
  const match = /\[[\d,\s]*\]/.exec(text);
  if (!match) return Array.from({ length: Math.min(topK, max) }, (_, i) => i);
  const parsed = JSON.parse(match[0]) as number[];
  const valid = parsed.filter((n) => Number.isInteger(n) && n >= 0 && n < max);
  const unique = [...new Set(valid)];
  return unique.slice(0, topK);
}

/**
 * Minimal zod-to-JSON-schema for the object shapes used in this app
 * (objects, arrays, strings, numbers, enums). Deliberately not a general
 * converter: it covers what the structured extraction schemas need.
 */
export function zodToJsonSchemaLoose(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as { _def: { typeName: string } })._def;
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchemaLoose(value);
        if (!(value instanceof Object && 'isOptional' in value && value.isOptional())) {
          required.push(key);
        }
      }
      return { type: 'object', properties, required };
    }
    case 'ZodArray':
      return {
        type: 'array',
        items: zodToJsonSchemaLoose((schema as unknown as { element: z.ZodTypeAny }).element),
      };
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodEnum':
      return {
        type: 'string',
        enum: (def as unknown as { values: string[] }).values,
      };
    case 'ZodOptional':
      return zodToJsonSchemaLoose((def as unknown as { innerType: z.ZodTypeAny }).innerType);
    default:
      return {};
  }
}

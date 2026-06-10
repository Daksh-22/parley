import { env } from '../config/env.js';
import type { EmbeddingClient, LLMClient } from './types.js';
import { MockEmbeddingClient, MockLLMClient } from './providers/mock.js';
import { AnthropicLLMClient } from './providers/anthropic.js';
import { OpenAIEmbeddingClient, OpenAILLMClient } from './providers/openai.js';

let llm: LLMClient | null = null;
let embedder: EmbeddingClient | null = null;

export function getLLM(): LLMClient {
  if (!llm) {
    switch (env.AI_CHAT_PROVIDER) {
      case 'anthropic':
        // Key presence is enforced at boot in env.ts.
        llm = new AnthropicLLMClient(env.ANTHROPIC_API_KEY as string, env.AI_CHAT_MODEL);
        break;
      case 'openai':
        llm = new OpenAILLMClient(env.OPENAI_API_KEY as string, env.AI_CHAT_MODEL);
        break;
      default:
        llm = new MockLLMClient();
    }
  }
  return llm;
}

export function getEmbedder(): EmbeddingClient {
  if (!embedder) {
    switch (env.AI_EMBED_PROVIDER) {
      case 'openai':
        embedder = new OpenAIEmbeddingClient(
          env.OPENAI_API_KEY as string,
          env.AI_EMBED_MODEL,
          env.AI_EMBED_DIMENSIONS,
        );
        break;
      default:
        embedder = new MockEmbeddingClient(env.AI_EMBED_DIMENSIONS);
    }
  }
  return embedder;
}

/** Test hook: swap implementations without touching env. */
export function setProvidersForTest(overrides: {
  llm?: LLMClient;
  embedder?: EmbeddingClient;
}): void {
  if (overrides.llm) llm = overrides.llm;
  if (overrides.embedder) embedder = overrides.embedder;
}

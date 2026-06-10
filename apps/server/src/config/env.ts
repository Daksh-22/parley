import dotenv from 'dotenv';
import { z } from 'zod';

// Load the package-local .env first, then the repo root .env as a fallback,
// so "cp .env.example .env" at the repo root just works. dotenv never
// overrides variables that are already set, so real environment wins.
dotenv.config();
dotenv.config({ path: '../../.env' });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGO_URI: z.string().url().startsWith('mongodb', 'MONGO_URI must be a mongodb:// URI'),
  REDIS_URL: z.string().url().startsWith('redis', 'REDIS_URL must be a redis:// URI'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(1209600),
  CORS_ORIGIN: z.string().url(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  // Rate limits: sliding window with a temporary mute on violation.
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  MSG_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  MSG_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  MSG_MUTE_SECONDS: z.coerce.number().int().positive().default(10),
  JOIN_RATE_LIMIT: z.coerce.number().int().positive().default(15),
  JOIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  JOIN_MUTE_SECONDS: z.coerce.number().int().positive().default(5),
  CONN_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  CONN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CONN_MUTE_SECONDS: z.coerce.number().int().positive().default(60),
  // --- AI layer. The chat core never depends on any of these. ---
  AI_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AI_CHAT_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  AI_EMBED_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  AI_CHAT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  AI_EMBED_MODEL: z.string().default('text-embedding-3-small'),
  AI_EMBED_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  QDRANT_URL: z.string().url().default('http://127.0.0.1:6333'),
  QDRANT_COLLECTION: z.string().default('parley-memory'),
  AI_CONTEXT_TOKEN_BUDGET: z.coerce.number().int().positive().default(4000),
  AI_ANSWER_MAX_TOKENS: z.coerce.number().int().positive().default(700),
  AI_DAILY_TOKEN_QUOTA: z.coerce.number().int().positive().default(200_000),
  AI_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AI_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  AI_BREAKER_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AI_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(30_000),
  RERANK_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Logger configuration depends on env, so this one startup failure path
    // writes to stderr directly before exiting.
    process.stderr.write(
      `Fatal: invalid environment configuration.\n${detail}\nSee .env.example for the expected variables.\n`,
    );
    process.exit(1);
  }
  if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
    process.stderr.write('Fatal: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ.\n');
    process.exit(1);
  }
  if (parsed.data.AI_ENABLED) {
    const needsAnthropic =
      parsed.data.AI_CHAT_PROVIDER === 'anthropic' && !parsed.data.ANTHROPIC_API_KEY;
    const needsOpenai =
      (parsed.data.AI_CHAT_PROVIDER === 'openai' || parsed.data.AI_EMBED_PROVIDER === 'openai') &&
      !parsed.data.OPENAI_API_KEY;
    if (needsAnthropic || needsOpenai) {
      process.stderr.write(
        `Fatal: AI_ENABLED=true with provider "${needsAnthropic ? 'anthropic' : 'openai'}" requires ${
          needsAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
        }. Use the mock provider for keyless development.\n`,
      );
      process.exit(1);
    }
  }
  return parsed.data;
}

export const env = loadEnv();

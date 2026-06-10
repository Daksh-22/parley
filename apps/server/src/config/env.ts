import 'dotenv/config';
import { z } from 'zod';

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
  MSG_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  MSG_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  MSG_MUTE_SECONDS: z.coerce.number().int().positive().default(10),
  JOIN_RATE_LIMIT: z.coerce.number().int().positive().default(15),
  JOIN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10_000),
  JOIN_MUTE_SECONDS: z.coerce.number().int().positive().default(5),
  CONN_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  CONN_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  CONN_MUTE_SECONDS: z.coerce.number().int().positive().default(60),
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
  return parsed.data;
}

export const env = loadEnv();

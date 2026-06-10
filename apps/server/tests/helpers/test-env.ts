// Runs before any application module is imported (vitest setupFiles), so the
// zod env validation in src/config/env.ts sees test-safe values. Anything CI
// provides explicitly wins; dotenv never overrides values that are already set.
process.env['NODE_ENV'] = 'test';
process.env['MONGO_URI'] ??= 'mongodb://127.0.0.1:27017/parley-test';
process.env['REDIS_URL'] ??= 'redis://127.0.0.1:6379';
process.env['JWT_ACCESS_SECRET'] ??= 'test-only-access-secret-0123456789abcdef';
process.env['JWT_REFRESH_SECRET'] ??= 'test-only-refresh-secret-0123456789abcde';
process.env['CORS_ORIGIN'] ??= 'http://localhost:5173';
process.env['LOG_LEVEL'] ??= 'error';

// Rate limits stay out of the way unless a test opts into strict values via
// vi.hoisted before its imports run.
process.env['AUTH_RATE_LIMIT'] ??= '10000';
process.env['MSG_RATE_LIMIT'] ??= '10000';
process.env['JOIN_RATE_LIMIT'] ??= '10000';
process.env['CONN_RATE_LIMIT'] ??= '10000';

if (!process.env['MONGO_URI'].includes('test')) {
  throw new Error('Refusing to run tests against a non-test Mongo database');
}

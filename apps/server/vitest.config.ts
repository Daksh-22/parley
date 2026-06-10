import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/test-env.ts'],
    // Integration tests share one Mongo database and one Redis instance.
    // Files run sequentially to keep state isolation simple and reliable.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});

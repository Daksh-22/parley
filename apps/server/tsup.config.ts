import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  // The shared workspace package ships TypeScript source, so it must be
  // bundled into the server build. Published npm deps stay external.
  noExternal: ['@parley/shared'],
});

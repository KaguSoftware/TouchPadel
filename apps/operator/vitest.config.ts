import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Workspace source alias so unit tests run before/without a full install link.
      '@touch/db': new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});

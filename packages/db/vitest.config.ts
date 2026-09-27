import 'dotenv/config'; // loads packages/db/.env (SUPABASE_URL/keys) into the test env
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The insights fallback test feeds the REAL operator payload builders into the
      // edge fallback; those builders import the workspace packages by name.
      // fileURLToPath, not `.pathname`: the repo path contains a space.
      '@touch/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@touch/i18n': fileURLToPath(new URL('../i18n/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // Concurrency cases hammer the local stack with dozens of parallel
    // connections; generous timeouts keep CI honest, not flaky.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One worker per file — the two suites share one database.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});

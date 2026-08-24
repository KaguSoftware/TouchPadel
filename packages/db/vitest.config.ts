import 'dotenv/config'; // loads packages/db/.env (SUPABASE_URL/keys) into the test env
import { defineConfig } from 'vitest/config';

export default defineConfig({
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

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Component testing became possible on 2026-08-28. Until then `include` was
// `src/**/*.test.ts` under `environment: 'node'`, so it was IMPOSSIBLE to test a
// component: 89 .tsx files — including the 1,162-line till — had no unit
// coverage at all, and the only thing exercising them was a Playwright suite
// that CI did not run.
//
// node stays the DEFAULT so the existing pure-logic suites keep their speed;
// jsdom is paid for only by files that actually render (`*.test.tsx`).
// No `@vitejs/plugin-react`: Vite's esbuild transform already reads
// `jsx: "react-jsx"` from tsconfig.json, and adding the plugin pulls in the
// dependency optimizer, which races on its Windows temp cache.
export default defineConfig({
  resolve: {
    alias: {
      // Workspace source alias so unit tests run before/without a full install link.
      // fileURLToPath, NOT `.pathname` — the repo path contains a space and
      // `.pathname` returns it percent-encoded.
      '@touch/db': fileURLToPath(new URL('../../packages/db/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [['src/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
  },
});

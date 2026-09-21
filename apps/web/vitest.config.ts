import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Component testing became possible on 2026-09-21 (Milestone 0 item 11). Until
// then `include` was `src/**/*.test.ts` under `environment: 'node'`, so it was
// IMPOSSIBLE to render anything: this package had ZERO `.test.tsx` files (Q1),
// and every page a guest can reach — the cafe app, the error boundary, the 404,
// download, privacy and support — was covered only by a Playwright suite that
// needs a running Supabase stack and therefore does not run on every push.
//
// node stays the DEFAULT so the existing pure-logic suites (menu folds, basket
// maths, proxy headers) keep their speed; jsdom is paid for only by the files
// that actually render (`*.test.tsx`).
//
// `app/**/*.test.tsx` is in `include` on purpose: the pages live outside `src/`,
// and a page test sits next to its page.
//
// No `@vitejs/plugin-react`: adding it pulls in Vite's dependency optimizer,
// which races on its Windows temp cache. `esbuild.jsx` is set by hand instead —
// this package's tsconfig says `jsx: "preserve"` (Next compiles JSX itself), and
// Vite honours that, so without the override esbuild would emit raw JSX and
// every `.test.tsx` would die on a syntax error.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      // fileURLToPath, NOT `.pathname` — the repo path contains a space and
      // `.pathname` returns it percent-encoded.
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'app/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
    // A page smoke render mounts the whole cafe app — ten hooks, the menu
    // stage and every overlay — twice per case (EN and AR). On CI's 2-vCPU
    // runner, sharing the box with `turbo build` of every other package, that
    // is comfortably slower than vitest's 5 s default.
    testTimeout: 20_000,
  },
});

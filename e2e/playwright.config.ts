import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * TouchPadel e2e — drives the real Next.js web app (guest cafe + public menu)
 * and the Vite operator SPA against the LOCAL Supabase stack (demo keys).
 *
 * Both dev servers are forced onto the local stack via env overrides (real
 * env vars beat .env.local in both Next and Vite), so the staging project in
 * the apps' .env.local files is never touched by these tests.
 *
 * NOTE: the operator app pins port 5174 (vite.config.ts server.strictPort),
 * not the historical 5173 — the webServer entry follows the app config.
 */

const ROOT = path.resolve(__dirname, '..');

// Long-standing `supabase start` demo keys — LOCAL ONLY, no secret value.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const WEB_URL = 'http://localhost:3000';

const localEnv = {
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
  VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
  // The QR admin refuses to render printable cards without a guest site URL
  // (it must never print localhost onto a real table card). For e2e the local
  // web app IS the guest site.
  VITE_GUEST_SITE_URL: WEB_URL,
};
export const OPERATOR_URL = 'http://localhost:5174';

export default defineConfig({
  testDir: './tests',
  // The suites share one database (open day, tabs, waiter-call cooldowns) —
  // keep them strictly serial so state stays deterministic.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // Everything except tests explicitly tagged @ar.
      name: 'chromium-en',
      grepInvert: /@ar/,
      use: { ...devices['Desktop Chrome'], locale: 'en-US' },
    },
    {
      // Arabic variants — the locale lives in the URL prefix (/ar/...); the
      // browser locale only shapes Intl output.
      name: 'chromium-ar',
      grep: /@ar/,
      use: { ...devices['Desktop Chrome'], locale: 'ar-IQ' },
    },
  ],
  webServer: [
    {
      // PRODUCTION BUILD when E2E_PROD_BUILD=1.
      //
      // Two assertions in web-security-headers.spec.ts are production-only
      // properties: that `script-src` carries no 'unsafe-eval', and that every
      // inline <script> carries the CSP nonce. `next dev` needs eval for HMR and
      // does not nonce, so under `dev` those assertions SKIP — and they skipped
      // on every machine and every CI run this project has ever had, which is
      // the same shape of false green as the header constants that were
      // imported and never used (see docs/security/HANDOFF-security.md §2).
      //
      // `reuseExistingServer` is false here on purpose: reusing a dev server
      // already listening on :3000 is exactly how a "prod" run silently measures
      // the dev build instead.
      command:
        process.env.E2E_PROD_BUILD === '1'
          ? 'pnpm --filter @touch/web build && pnpm --filter @touch/web start'
          : 'pnpm --filter @touch/web dev',
      url: `${WEB_URL}/en`,
      cwd: ROOT,
      reuseExistingServer: process.env.E2E_PROD_BUILD !== '1',
      timeout: 600_000, // a cold `next build` is slower than a dev compile
      env: localEnv,
    },
    {
      command: 'pnpm --filter @touch/operator dev',
      url: OPERATOR_URL,
      cwd: ROOT,
      reuseExistingServer: true,
      timeout: 120_000,
      env: localEnv,
    },
  ],
});

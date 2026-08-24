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

const localEnv = {
  NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
  VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
};

export const WEB_URL = 'http://localhost:3000';
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
      command: 'pnpm --filter @touch/web dev',
      url: `${WEB_URL}/en`,
      cwd: ROOT,
      reuseExistingServer: true,
      timeout: 300_000, // Next 16 first compile is slow
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

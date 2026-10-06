#!/usr/bin/env node
/**
 * Click depth, operator target — prepares the LOCAL stack and signs the owner in.
 *
 *   node scripts/click-depth/operator-auth.mjs [outPath]
 *   # default outPath: test-results/click-depth/owner.json (gitignored)
 *
 * The crawl (operator-crawl.mjs) replays every click path in a fresh browser
 * context, so it needs a signed-in session it can clone hundreds of times
 * without touching the login form: Playwright's storageState. The operator
 * keeps its Supabase session in localStorage, which storageState captures, but
 * per ORIGIN — the file only works for the exact `baseUrl` it was made on.
 *
 * Two jobs, in this order:
 *
 *  1. Make the screens show their normal buttons. A closed business day or a
 *     stale till heartbeat turns whole screens into "open the day first" or
 *     "offline" placeholders, and the crawl would then measure the placeholder.
 *     This mirrors e2e/tests/helpers.ts ensureOpenDay + ensureTillFresh in plain
 *     JS (service-role key, LOCAL demo keys only).
 *     The idle lock (venue setting till_idle_lock_seconds, default 300 s) is
 *     deliberately LEFT ALONE: it is a shared venue row other sessions and
 *     suites read, and the crawl never needs it off — every state is replayed
 *     in a fresh context that lives a few seconds, far below the timeout.
 *  2. Sign in as the seeded owner through the real UI (the same steps as
 *     e2e/tests/operator-role-pages.spec.ts), pin the locale to English, and
 *     save storageState with the station-local UI memory stripped (workspace,
 *     open rail group, persisted query cache), so every crawl starts from the
 *     same blank station rather than from whatever this sign-in happened to
 *     open.
 *
 * SAFETY: refuses any SUPABASE_URL that is not 127.0.0.1/localhost — the
 * service-role writes below must never reach the hosted project.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = JSON.parse(readFileSync(resolve(ROOT, 'click-depth.config.json'), 'utf8')).targets.operator;

export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Long-standing `supabase start` demo keys (e2e/tests/helpers.ts) — LOCAL ONLY, no secret value.
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const OWNER = 'owner@dev.touch.local';
const MANAGER = 'manager@dev.touch.local';
const DEV_PASSWORD = 'touch-dev-password';

/** Keys the crawl must not inherit from this one sign-in (see the header, step 2). */
const STRIPPED_STORAGE = ['touch-operator-workspace', 'touch-operator-rail-open', 'touch-operator-query-cache'];

export function assertLocal(url) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`refusing to run against ${url}: the click-depth crawl only ever uses the LOCAL stack`);
  }
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

async function appRpc(client, fn, args = {}) {
  const { data, error } = await client.schema('app').rpc(fn, args);
  if (error) throw new Error(`app.${fn} failed: ${error.message}`);
  return data;
}

/** An open (or closing) business day; cafe and till screens need one (0015). */
async function ensureOpenDay(svc) {
  const { data, error } = await svc.from('day_sessions').select('id').in('status', ['open', 'closing']).limit(1);
  if (error) throw new Error(`ensureOpenDay probe failed: ${error.message}`);
  if (data?.length) return 'already open';

  const manager = createClient(SUPABASE_URL, ANON_KEY, clientOptions);
  const { error: signErr } = await manager.auth.signInWithPassword({ email: MANAGER, password: DEV_PASSWORD });
  if (signErr) throw new Error(`manager sign-in failed: ${signErr.message} (is the local stack seeded?)`);
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      // A unique far-future business_date, as the e2e helper does, so reruns
      // without a db reset never collide with a date closed earlier.
      const days = 20_000 + Math.floor(Math.random() * 2_000_000);
      const date = new Date(days * 86_400_000).toISOString().slice(0, 10);
      const res = await appRpc(manager, 'open_day', { p_opening_float_iqd: 100_000, p_business_date: date });
      if (!res.duplicate || res.status === 'open') return 'opened';
    }
    throw new Error('ensureOpenDay: could not find a free business_date');
  } finally {
    await manager.auth.signOut();
  }
}

/**
 * Every till heartbeat fresh, so the venue does not read as degraded. The
 * filter mirrors app.is_degraded() (is_till OR an id starting TILL); with no
 * till at all, register and beat TILL-E2E, exactly as the e2e helper does.
 */
async function ensureTillFresh(svc) {
  const now = new Date().toISOString();
  const { data, error } = await svc
    .from('device_heartbeats')
    .update({ last_seen_at: now, queue_depth: 0 })
    .or('is_till.eq.true,device_id.like.TILL%')
    .select('device_id');
  if (error) throw new Error(`ensureTillFresh failed: ${error.message}`);
  if (data?.length) return `${data.length} till beat(s) refreshed`;

  const { data: venue, error: vErr } = await svc
    .from('venues')
    .select('id')
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .single();
  if (vErr) throw new Error(`ensureTillFresh venue failed: ${vErr.message}`);
  const { error: stErr } = await svc
    .from('stations')
    .upsert({ id: 'TILL-E2E', venue_id: venue.id, is_till: true, mode: 'till', retired_at: null }, { onConflict: 'id' });
  if (stErr) throw new Error(`ensureTillFresh station failed: ${stErr.message}`);
  const { error: insErr } = await svc
    .from('device_heartbeats')
    .upsert({ device_id: 'TILL-E2E', last_seen_at: now, queue_depth: 0, is_till: true }, { onConflict: 'device_id' });
  if (insErr) throw new Error(`ensureTillFresh seed failed: ${insErr.message}`);
  return 'TILL-E2E registered and beating';
}

/** Step 1 — exported so the crawl can refresh the till beat right before it starts. */
export async function prepareLocalStack() {
  assertLocal(SUPABASE_URL);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
  const day = await ensureOpenDay(svc);
  const till = await ensureTillFresh(svc);
  return `business day ${day}; ${till}`;
}

/**
 * Keep every till beat fresh while a crawl runs (as e2e's startTillHeartbeat
 * does): a till that goes quiet for a minute turns the venue degraded and every
 * screen grows a banner, which would make the second half of a crawl measure a
 * different app from the first. Returns the stop function.
 */
export function startTillHeartbeat(everyMs = 15_000) {
  assertLocal(SUPABASE_URL);
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, clientOptions);
  const beat = () => void ensureTillFresh(svc).catch(() => {});
  const timer = setInterval(beat, everyMs);
  beat();
  return () => clearInterval(timer);
}

/** Step 2 — the owner signed in through the UI, saved as storageState. */
async function signInOwner(baseUrl, outPath) {
  assertLocal(baseUrl);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('touch-operator-locale', 'en');
      } catch {
        /* no storage */
      }
    });
    const page = await context.newPage();
    await page.goto(new URL('/', baseUrl).href);
    const email = page.locator('input[type="email"]');
    await email.waitFor({ timeout: 30_000 });
    await email.fill(OWNER);
    await page.locator('input[type="password"]').fill(DEV_PASSWORD);
    await page.locator('button[type="submit"]').click();
    // Signed in = the form is gone and a session sits in localStorage.
    await page.locator('input[type="password"]').waitFor({ state: 'detached', timeout: 30_000 });
    await page.waitForFunction(
      () => Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token')),
      undefined,
      { timeout: 30_000 },
    );
    const state = await context.storageState();
    for (const origin of state.origins) {
      origin.localStorage = origin.localStorage.filter((e) => !STRIPPED_STORAGE.includes(e.name));
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(state, null, 2));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outPath = resolve(process.argv[2] ?? resolve(ROOT, 'test-results/click-depth/owner.json'));
  console.error(`click-depth auth: ${await prepareLocalStack()}`);
  await signInOwner(CONFIG.baseUrl, outPath);
  console.log(outPath);
}

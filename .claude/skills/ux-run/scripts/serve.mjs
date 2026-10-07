#!/usr/bin/env node
/**
 * ux-run serve — starts apps/web for the UX audit, on the LOCAL Supabase stack only.
 *
 * Why this script and not `pnpm dev`: apps/web/.env.local points at the HOSTED production
 * Supabase project. Next inlines NEXT_PUBLIC_* at compile time and the server reads the
 * menu, venue, coaching and tournaments from Node, where Playwright cannot intercept
 * anything. The only guarantee is the process env: real env beats .env.local, so this
 * script sets NEXT_PUBLIC_SUPABASE_URL to http://127.0.0.1:54321 and the anon key to the
 * `supabase start` demo JWT (read from e2e/playwright.config.ts), then PROVES it took
 * (the response CSP must name 127.0.0.1:54321 and the HTML must not mention supabase.co).
 *
 * It never reuses a server it did not start: if anything listens on the port (3210,
 * strictly) it refuses. Next 16 happily runs a second `next dev` in the same app, so the
 * port is the only guard.
 *
 *   node .claude/skills/ux-run/scripts/serve.mjs start    # spawn, wait for ready, verify, write pid file
 *   node .claude/skills/ux-run/scripts/serve.mjs stop     # kill ONLY the process group in the pid file
 *   node .claude/skills/ux-run/scripts/serve.mjs status
 *
 * Output: PASS/FAIL lines. The pid file and server.log live in test-results/ux-run/.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { isMain, loadConfig, OUT_DIR, REPO_ROOT } from './lib/config.mjs';

const PID_FILE = path.join(OUT_DIR, 'server.json');
const LOG_FILE = path.join(OUT_DIR, 'server.log');

const cfg = loadConfig();
const { host, port, readyPath, readyTimeoutMs, localSupabaseUrl } = cfg.server;
const base = `http://${host}:${port}`;

function fail(msg, code = 1) {
  console.log(`FAIL  ${msg}`);
  process.exit(code);
}

/** True when something accepts connections on host:port. */
function portBusy() {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

/** The `supabase start` demo anon JWT, from the e2e config (one source of truth). */
export function localAnonKey() {
  const src = readFileSync(path.join(REPO_ROOT, 'e2e/playwright.config.ts'), 'utf8');
  const m = /LOCAL_ANON_KEY\s*=\s*['"]([^'"]+)['"]/.exec(src);
  if (!m) fail('could not read LOCAL_ANON_KEY from e2e/playwright.config.ts');
  const payload = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString('utf8'));
  if (payload.iss !== 'supabase-demo' || payload.role !== 'anon') {
    fail(`the e2e anon key is not the local demo key (iss=${payload.iss}, role=${payload.role}); refusing`);
  }
  return m[1];
}

function assertLocalUrl(u) {
  const url = new URL(u);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    fail(`Supabase URL resolves to ${url.host}, which is not the local stack; refusing to serve`);
  }
}

async function preflightStack(anon) {
  try {
    const res = await fetch(`${localSupabaseUrl}/rest/v1/`, { headers: { apikey: anon }, signal: AbortSignal.timeout(5000) });
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    fail(`local Supabase stack is not answering at ${localSupabaseUrl} (${err.message}). Start it (supabase start) first; never point the audit at the hosted project.`);
  }
}

async function start() {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PID_FILE)) {
    const prev = JSON.parse(readFileSync(PID_FILE, 'utf8'));
    if (alive(prev.pid)) fail(`a ux-run server from this skill is already running (pid ${prev.pid}); run "serve.mjs stop" first`);
    rmSync(PID_FILE);
  }
  if (await portBusy()) {
    fail(`something already listens on ${host}:${port}. ux-run never reuses a server it did not start (it could be on the hosted env). Free the port, then retry.`);
  }
  assertLocalUrl(localSupabaseUrl);
  const anon = localAnonKey();
  await preflightStack(anon);

  const env = { ...process.env };
  for (const k of ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST', 'NEXT_PUBLIC_WEB_OAUTH']) delete env[k];
  Object.assign(env, {
    NEXT_PUBLIC_SUPABASE_URL: localSupabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '',
    NEXT_TELEMETRY_DISABLED: '1',
  });
  assertLocalUrl(env.NEXT_PUBLIC_SUPABASE_URL);

  const nextBin = path.join(REPO_ROOT, 'node_modules/.bin/next');
  const webBin = path.join(REPO_ROOT, 'apps/web/node_modules/.bin/next');
  const bin = existsSync(webBin) ? webBin : nextBin;
  if (!existsSync(bin)) fail('next binary not found (pnpm install?)');
  const log = openSync(LOG_FILE, 'w');
  const child = spawn(bin, ['dev', '--port', String(port), '--hostname', host], {
    cwd: path.join(REPO_ROOT, 'apps/web'),
    env,
    detached: true, // own process group, so stop can kill next-server too
    stdio: ['ignore', log, log],
  });
  child.unref();
  writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, port, host, startedAt: new Date().toISOString() }, null, 2));
  console.log(`....  started next dev (pid ${child.pid}, group ${child.pid}) on ${base}; log ${path.relative(REPO_ROOT, LOG_FILE)}`);

  const deadline = Date.now() + readyTimeoutMs;
  let res = null;
  while (Date.now() < deadline) {
    if (!alive(child.pid)) fail(`next dev exited during start-up; see ${path.relative(REPO_ROOT, LOG_FILE)}`);
    try {
      res = await fetch(base + readyPath, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      if (res.status === 200) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!res || res.status !== 200) {
    await stop(true);
    fail(`server not ready on ${base}${readyPath} within ${readyTimeoutMs / 1000}s`);
  }
  const verdict = await verifyLocal(res);
  if (verdict) {
    await stop(true);
    fail(verdict);
  }
  // Compile every crawl root now, so the crawl's page loads do not race a cold `next dev`
  // compile against loadCapMs (each first hit compiles that route).
  const warm = [...new Set([cfg.startPath, ...(cfg.seedPaths ?? []).map((sp) => sp.path)])];
  const slow = [];
  for (const p of warm) {
    try {
      const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      await r.text();
      if (r.status >= 500) slow.push(`${p} answered ${r.status}`);
    } catch (err) {
      slow.push(`${p} (${err.message})`);
    }
  }
  if (slow.length) console.log(`WARN  warm-up: ${slow.join('; ')}; the crawl will retry these roots once and note any that still fail`);
  console.log(`PASS  ${base} is up on the LOCAL stack (CSP connect-src names ${new URL(localSupabaseUrl).host}; no supabase.co in the page); ${warm.length} crawl roots compiled.`);
}

/** Proof the server-side env took: CSP + HTML. Returns an error string or null. */
export async function verifyLocal(res) {
  const csp = res.headers.get('content-security-policy') ?? '';
  const html = await res.text();
  const localHost = new URL(localSupabaseUrl).host;
  const connect = /connect-src([^;]*)/.exec(csp)?.[1] ?? '';
  if (!connect.includes(localHost)) return `CSP connect-src does not name ${localHost} (got "${connect.trim()}"): the server is not on the local stack`;
  if (/supabase\.(co|in)/i.test(csp) || /supabase\.(co|in)/i.test(html)) return 'the page or its CSP mentions a hosted supabase host: refusing';
  return null;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stop(quiet = false) {
  if (!existsSync(PID_FILE)) {
    if (!quiet) console.log('PASS  no ux-run server recorded (nothing to stop).');
    return;
  }
  const { pid } = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  if (alive(pid)) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* group gone */
    }
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      /* already down */
    }
  }
  rmSync(PID_FILE, { force: true });
  for (let i = 0; i < 30 && (await portBusy()); i++) await new Promise((r) => setTimeout(r, 200));
  if (await portBusy()) console.log(`WARN  stopped group ${pid}, but ${host}:${port} is still busy (not ours?)`);
  else if (!quiet) console.log(`PASS  stopped the ux-run server (group ${pid}); ${host}:${port} is free.`);
}

async function status() {
  const rec = existsSync(PID_FILE) ? JSON.parse(readFileSync(PID_FILE, 'utf8')) : null;
  const busy = await portBusy();
  if (rec && alive(rec.pid)) console.log(`PASS  ux-run server pid ${rec.pid} on ${base} (since ${rec.startedAt})`);
  else console.log(`....  no ux-run server; port ${port} ${busy ? 'is BUSY (not ours)' : 'is free'}`);
}

if (isMain(import.meta.url)) {
  const cmd = process.argv[2] ?? 'status';
  if (cmd === 'start') await start();
  else if (cmd === 'stop') await stop();
  else if (cmd === 'status') await status();
  else fail(`unknown command "${cmd}" (start | stop | status)`);
}

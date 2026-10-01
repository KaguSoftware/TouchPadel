/**
 * verify_jwt gate — every edge function, not two of them.
 *
 * WHY. `verify_jwt` decides whether the platform gateway refuses a request that
 * carries no valid Supabase JWT before the function body runs. Eight functions
 * (send-push, telegram-send, deposit-reconcile, protocol-action, release-review,
 * assistant-component, assistant-index, assistant-job) decide "service role
 * only" by reading the token's `role` claim WITHOUT checking its signature
 * (`_shared/supabase.ts` isServiceRoleRequest) — safe only because the gateway
 * verified it first. Deployed with `false`, any forged token passes. The other
 * way round, deposit-webhook or telegram-callback deployed with `true` refuse
 * every real Qi / Telegram call at the gateway, silently.
 *
 * Until 2026-10-01 the only check was a grep of `supabase functions list` for
 * two functions — and that table has no verify_jwt column, so it could never
 * fire. The expected value of every function now lives in
 * fixtures/verify-jwt.json.
 *
 * TWO MODES.
 *   (default)    STATIC. Every directory under supabase/functions (except
 *                `_shared`) must have a `[functions.<name>]` block in
 *                config.toml whose `verify_jwt` equals the fixture, and the
 *                fixture may name no function that does not exist. Runs in
 *                `pnpm security`; no stack, no network.
 *   --deployed   Also asks the Management API what the hosted project actually
 *                runs (SUPABASE_ACCESS_TOKEN, PROJECT_REF) and fails on any
 *                deployed function whose verify_jwt differs from the fixture, or
 *                any fixture function that is not deployed. Run by deploy.yml
 *                straight after `supabase functions deploy`.
 *
 * Usage:  node scripts/check-verify-jwt.mjs [--deployed]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const FUNCTIONS = path.join(PKG, 'supabase', 'functions');
const CONFIG = path.join(PKG, 'supabase', 'config.toml');
const FIXTURE = path.join(PKG, 'fixtures', 'verify-jwt.json');

const deployed = process.argv.slice(2).includes('--deployed');
const errors = [];

const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')).functions;

const dirs = readdirSync(FUNCTIONS).filter(
  (name) =>
    !name.startsWith('_') &&
    !name.startsWith('.') &&
    statSync(path.join(FUNCTIONS, name)).isDirectory() &&
    existsSync(path.join(FUNCTIONS, name, 'index.ts')),
);

/** `[functions.<name>]` blocks → their verify_jwt literal (true/false), or null when absent. */
function configValues(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      const m = /^functions\.([a-z0-9-]+)$/.exec(header[1]);
      current = m ? m[1] : null;
      if (current && !out.has(current)) out.set(current, null);
      continue;
    }
    if (!current) continue;
    const kv = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (kv) out.set(current, kv[1] === 'true');
  }
  return out;
}

const config = configValues(readFileSync(CONFIG, 'utf8'));

for (const fn of dirs) {
  if (!(fn in expected)) {
    errors.push(`${fn}: no entry in fixtures/verify-jwt.json — decide true or false and add it (and the config.toml block).`);
    continue;
  }
  if (!config.has(fn)) {
    errors.push(`${fn}: no [functions.${fn}] block in supabase/config.toml — the CLI would deploy it with the default (true).`);
    continue;
  }
  const value = config.get(fn);
  if (value === null) {
    errors.push(`${fn}: [functions.${fn}] in config.toml has no verify_jwt line.`);
  } else if (value !== expected[fn]) {
    errors.push(`${fn}: config.toml says verify_jwt = ${value}, fixtures/verify-jwt.json says ${expected[fn]}.`);
  }
}
for (const fn of Object.keys(expected)) {
  if (!dirs.includes(fn)) errors.push(`${fn}: in fixtures/verify-jwt.json but there is no supabase/functions/${fn}/index.ts.`);
}

if (deployed) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.PROJECT_REF;
  if (!token || !ref) {
    errors.push('--deployed needs SUPABASE_ACCESS_TOKEN and PROJECT_REF in the environment.');
  } else {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      errors.push(`Management API answered ${res.status} for the functions list; the hosted verify_jwt values are UNVERIFIED.`);
    } else {
      const list = await res.json();
      const live = new Map(list.map((f) => [f.slug, f.verify_jwt]));
      for (const [fn, want] of Object.entries(expected)) {
        if (!live.has(fn)) errors.push(`${fn}: not deployed on the hosted project.`);
        else if (live.get(fn) !== want) errors.push(`${fn}: DEPLOYED with verify_jwt = ${live.get(fn)}, expected ${want}.`);
      }
      console.log(`check-verify-jwt: ${live.size} deployed function(s) read from the hosted project.`);
    }
  }
}

if (errors.length) {
  console.error(`check-verify-jwt: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`check-verify-jwt: ${dirs.length} function(s) match fixtures/verify-jwt.json${deployed ? ' locally and on the hosted project' : ''}.`);

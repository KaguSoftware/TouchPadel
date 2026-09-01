/**
 * One-off: provision an OWNER staff account on the hosted Supabase project so
 * the operator app (apps/operator, http://localhost:5174) can be signed into.
 *
 * seed.sql's dev users (owner@dev.touch.local / touch-dev-password) exist only
 * where `supabase db reset` has run — i.e. a local stack. packages/db/README.md
 * is explicit that hosted projects get staff via the Auth admin API instead,
 * which is what this does:
 *
 *   1. auth.users row      (Auth admin API, email confirmed so there is no
 *                           verification mail to chase)
 *   2. staff row           (id = the auth user's id, role 'owner', active)
 *
 * The `app.handle_new_user` trigger (migration 0004) creates the profile row
 * on insert; nothing here needs to.
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from apps/web/.env.local.
 * Idempotent: re-running finds the existing user and upserts the staff row.
 *
 *   node scripts/create-operator-owner.mjs [email] [password]
 */
import { readFileSync } from 'node:fs';

const EMAIL = process.argv[2] ?? 'owner@touchpadel.local';
const PASSWORD = process.argv[3] ?? 'TouchOwner!2026';
const DISPLAY_NAME = 'Owner';

function envFromFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = envFromFile(new URL('../apps/web/.env.local', import.meta.url));
const URL_ = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error('apps/web/.env.local is missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function call(path, init = {}) {
  const res = await fetch(`${URL_}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}\n${text}`);
  return body;
}

console.log(`Project: ${URL_}\n`);

// ── Who is already there? ───────────────────────────────────────────────────
const { users } = await call('/auth/v1/admin/users?per_page=200');
console.log(`Existing auth users (${users.length}):`);
for (const u of users) console.log(`  ${u.email ?? u.phone ?? '(no email)'}  ${u.id}`);

const staffRows = await call('/rest/v1/staff?select=id,display_name,role,is_active');
console.log(`\nExisting staff rows (${staffRows.length}):`);
for (const s of staffRows) console.log(`  ${s.role.padEnd(10)} ${s.is_active ? 'active  ' : 'INACTIVE'} ${s.display_name}  ${s.id}`);

// ── Create or reuse the auth user ───────────────────────────────────────────
let user = users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase());
if (user) {
  console.log(`\n${EMAIL} already exists — resetting its password.`);
  user = await call(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
  });
} else {
  console.log(`\nCreating ${EMAIL} ...`);
  user = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: DISPLAY_NAME },
    }),
  });
}

// ── Staff row (this is what the operator reads for the role) ────────────────
await call('/rest/v1/staff?on_conflict=id', {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ id: user.id, display_name: DISPLAY_NAME, role: 'owner', is_active: true }),
});

console.log(`\n✅ Owner ready.\n   email:    ${EMAIL}\n   password: ${PASSWORD}\n   staff id: ${user.id}\n\nSign in at http://localhost:5174 and open Desk.`);

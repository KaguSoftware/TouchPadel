/**
 * Authorization sweep: call EVERY client-callable app RPC as a real café guest
 * and fail if a privileged one answers instead of refusing.
 *
 * Why this exists. Guests sign in anonymously, which makes them `authenticated`
 * — the same PostgREST role staff hold. So for the ~86 SECURITY DEFINER RPCs
 * exposed to `authenticated`, the ONLY thing between a guest and a privileged
 * body is the guard on its first line. `rls-matrix.ts` is the sign-off artifact
 * for that, and it covers 49 of them; the rest were asserted by nobody.
 *
 * Why it executes rather than reads the source: a static guard scan over these
 * same functions produced nine false positives, because the whole analytics
 * family guards one call deep inside app.analytics_guard(). Source reading
 * nominates; only a call confirms. It also found a real one — 0046's PIN
 * oracle, where app.verify_manager_pin answered any guest at all.
 *
 * Method: every argument is passed as NULL. A correctly written RPC checks its
 * role BEFORE it validates arguments, so a null payload must still be refused.
 * Anything that gets past the guard and fails on argument validation instead is
 * reported and fails the run.
 *
 * Usage:  node scripts/check-rpc-authz.mjs      (exit 1 on any unrefused RPC)
 */
import { execFileSync } from 'node:child_process';

const URL_BASE = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

/**
 * Reachable by a guest ON PURPOSE. Everything here is either read-only public
 * data the menu needs before any identity exists, or is guarded by SESSION
 * ownership rather than by role. Adding a name here is a security decision:
 * it asserts a café guest may call it.
 */
const PUBLIC_BY_DESIGN = new Set([
  // The guest menu app, pre-identity.
  'open_table_session', 'verify_table_token', 'menu_availability', 'venue_mode',
  'is_degraded', 'price_slot', 'item_active_groups', 'business_date',
  // Tell-me-about-myself helpers; they leak only the caller's own standing.
  'is_staff', 'staff_role', 'is_own_session', 'order_is_callers', 'tab_is_callers',
  'touch_guest_session',
  // Guest ordering surface — guarded by guest_sessions ownership, not by role.
  'create_guest_order', 'raise_waiter_call',
  // Booking surface — any signed-in ACCOUNT, by design. hold_slot is NOT here:
  // since 0048 (C1) it refuses an anonymous session with ACCOUNT_REQUIRED, so the
  // sweep above proves it rather than exempting it. confirm/cancel are ownership-
  // guarded, not role-guarded, so the OWNERSHIP stage below is what covers them.
  'confirm_booking', 'cancel_reservation', 'expire_stale_holds',
  // Device telemetry from the till/guest app.
  'heartbeat', 'log_replay',
  // Trigger function; never usefully callable directly.
  'trg_order_item_line_no',
]);

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c', sql],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

// proargnames carries OUT parameters too, so a `returns table (...)` function
// looked to this sweep like it took its own result columns as arguments —
// PostgREST then 404s with PGRST202 and the function reads as UNGUARDED when it
// is simply un-probed. proargmodes is null when every parameter is IN; when it
// is present, only 'i' and 'b' are inputs.
const fns = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object(
           'name', p.proname,
           'args', coalesce((
             select json_agg(a.name order by a.ord)
               from unnest(p.proargnames) with ordinality as a(name, ord)
              where p.proargmodes is null
                 or p.proargmodes[a.ord] in ('i','b')), '[]'::json))), '[]')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.prosecdef
           -- Trigger functions (rt_* broadcast hooks) are not callable through
           -- PostgREST at all; probing them 404s and reads as unguarded.
           and p.prorettype <> 'trigger'::regtype
           and (has_function_privilege('anon', p.oid, 'EXECUTE')
             or has_function_privilege('authenticated', p.oid, 'EXECUTE'));`).trim(),
);

const res = await fetch(`${URL_BASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: '{}',
});
const token = (await res.json()).access_token;
if (!token) throw new Error('could not obtain an anonymous guest token — is the stack up?');

/** Any of these means a guard turned the call away, which is the pass condition. */
const REFUSED = /FORBIDDEN|AUTH_REQUIRED|ACCOUNT_REQUIRED|permission denied|SESSION_EXPIRED|DEGRADED_LOCKOUT/i;

const unrefused = [];
let refused = 0;

for (const f of fns.sort((a, b) => a.name.localeCompare(b.name))) {
  const body = Object.fromEntries((f.args ?? []).map((a) => [a, null]));
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${f.name}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'app',
      'Accept-Profile': 'app',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (REFUSED.test(text)) refused++;
  else if (!PUBLIC_BY_DESIGN.has(f.name)) {
    unrefused.push({ name: f.name, status: r.status, body: text.slice(0, 200).replace(/\s+/g, ' ') });
  }
}

console.log(`probed ${fns.length} client-callable SECURITY DEFINER RPCs as an anonymous guest`);
console.log(`  refused by an in-function guard : ${refused}`);
console.log(`  public by design               : ${fns.length - refused - unrefused.length}`);

if (unrefused.length) {
  console.error(`\nRPCs REACHABLE BY A GUEST (${unrefused.length}):`);
  for (const u of unrefused) console.error(`  ${u.name.padEnd(28)} HTTP ${u.status}  ${u.body}`);
  console.error(
    '\nA café guest holds `authenticated`, exactly as staff do, so an RPC without\n' +
      'its own guard is open to anyone who scans a table QR. Add the role check as\n' +
      "the function's FIRST statement — or, if this is deliberate, add the name to\n" +
      'PUBLIC_BY_DESIGN in this script and say why.',
  );
  process.exit(1);
}
console.log('\nno unguarded RPCs');

// ---------------------------------------------------------------------------
// STAGE 2 — OWNERSHIP.
//
// Stage 1 proves ROLE. It cannot prove OWNERSHIP, because it calls everything
// with NULL arguments as a single principal — so an RPC that hands principal B
// something belonging to principal A passes it untouched. That is precisely
// where the two worst findings of the 2026-08-27 audit lived, and both were
// invisible to CI:
//
//   C1  hold_slot accepted an anonymous session (no profiles row) and wrote
//       guest_id = NULL. Stage 1 exempted hold_slot outright.
//   H3  hold_slot looked replays up by idempotency key ALONE and returned the
//       found row's id + status -- a read RLS refuses. Two principals are the
//       only way to see it; stage 1 has one.
//
// So: two real accounts, A holds, B probes. Anything B learns about A's
// reservation is a failure.
// ---------------------------------------------------------------------------
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

async function account(tag) {
  const email = `authz-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.touch.local`;
  const password = 'touch-dev-password';
  const mk = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: `AuthZ ${tag}` } }),
  });
  if (!mk.ok) throw new Error(`admin createUser failed: ${await mk.text()}`);
  const si = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await si.json();
  if (!j.access_token) throw new Error(`sign-in failed: ${JSON.stringify(j)}`);
  return j.access_token;
}

const rpc = (token, fn, body) =>
  fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'app',
      'Accept-Profile': 'app',
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, text: await r.text() }));

const ownershipFailures = [];
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok    ${name}`);
  else {
    console.log(`  FAIL  ${name}`);
    ownershipFailures.push({ name, detail });
  }
};

// A bookable slot: an active court, and a weekday 10:00 venue-local far enough
// out that nothing else in the fixtures owns it.
const court = psql(`select id from courts where is_active order by sort_order limit 1;`).trim();
const startAt = psql(`
  select to_char((d + interval '10 hour') at time zone (select timezone from venue_settings),
                 'YYYY-MM-DD"T"HH24:MI:SSOF:00')
    from (select generate_series(date_trunc('day', (now() at time zone (select timezone from venue_settings))) + interval '5 day',
                                 date_trunc('day', (now() at time zone (select timezone from venue_settings))) + interval '12 day',
                                 interval '1 day') d) s
   where extract(dow from d) between 0 and 4 limit 1;`).trim();

if (!court || !startAt) {
  console.error('\nownership stage SKIPPED: no active court (run `pnpm --filter @touch/db db:fixtures`)');
  process.exit(1);
}

console.log('\nownership probes (two distinct real accounts):');

const [tokenA, tokenB] = [await account('a'), await account('b')];
const SHARED_KEY = `AUTHZ:reservation.hold:${Date.now()}`;

// A holds, using an idempotency key B will try to replay.
const held = await rpc(tokenA, 'hold_slot', {
  p_court_id: court, p_start_at: startAt, p_duration_min: 60, p_idempotency_key: SHARED_KEY,
});
if (held.status !== 200) {
  console.error(`\nownership stage could not arrange a hold: HTTP ${held.status} ${held.text}`);
  process.exit(1);
}
const holdId = JSON.parse(held.text).reservation_id;

// C1: an anonymous session must not be able to hold at all.
const anonHold = await rpc(token, 'hold_slot', {
  p_court_id: court, p_start_at: startAt, p_duration_min: 90,
});
check('C1  anonymous session refused by hold_slot', /ACCOUNT_REQUIRED/.test(anonHold.text), anonHold.text);

// H3: B replaying A's key must be refused, and must learn nothing.
const replay = await rpc(tokenB, 'hold_slot', {
  p_court_id: court, p_start_at: startAt, p_duration_min: 120, p_idempotency_key: SHARED_KEY,
});
check('H3  cross-principal idempotency replay refused', /IDEMPOTENCY_CONFLICT/.test(replay.text), replay.text);
check('H3  replay response leaks no reservation id', !replay.text.includes(holdId), replay.text);

// Ownership on the rest of the booking surface.
const bConfirm = await rpc(tokenB, 'confirm_booking', { p_hold_id: holdId });
check('    B cannot confirm A hold', /FORBIDDEN/.test(bConfirm.text), bConfirm.text);
const bCancel = await rpc(tokenB, 'cancel_reservation', { p_reservation_id: holdId });
check('    B cannot cancel A hold', /FORBIDDEN/.test(bCancel.text), bCancel.text);

// And RLS must hide the row from B on a direct read.
const bRead = await fetch(`${URL_BASE}/rest/v1/reservations?id=eq.${holdId}&select=id`, {
  headers: { apikey: ANON, Authorization: `Bearer ${tokenB}` },
}).then((r) => r.text());
check('    B cannot read A reservation', bRead.trim() === '[]', bRead);

// A must still be able to work with its own hold — the guards must not overshoot.
const aCancel = await rpc(tokenA, 'cancel_reservation', { p_reservation_id: holdId });
check('    A CAN cancel its own hold', aCancel.status === 200, aCancel.text);

if (ownershipFailures.length) {
  console.error(`\nOWNERSHIP FAILURES (${ownershipFailures.length}):`);
  for (const f of ownershipFailures) console.error(`  ${f.name}\n    ${f.detail.slice(0, 300)}`);
  console.error(
    '\nRole guards are not enough on the booking surface: these RPCs are callable by\n' +
      'every signed-in customer, so ownership is the only boundary. A failure here is\n' +
      'the C1/H3 class returning.',
  );
  process.exit(1);
}
console.log('\nownership holds across principals');

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
  // Booking surface — any signed-in customer, by design.
  'hold_slot', 'confirm_booking', 'cancel_reservation', 'expire_stale_holds',
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

const fns = JSON.parse(
  psql(`select coalesce(json_agg(json_build_object(
           'name', p.proname,
           'args', coalesce((select json_agg(a) from unnest(p.proargnames) a), '[]'::json))), '[]')
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.prosecdef
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
const REFUSED = /FORBIDDEN|AUTH_REQUIRED|permission denied|SESSION_EXPIRED|DEGRADED_LOCKOUT/i;

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

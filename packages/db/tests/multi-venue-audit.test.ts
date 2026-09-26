/**
 * The multi-venue audit of 2026-09-26 (migrations 0228–0235), proved with two
 * OPEN branches: venue A (the seed) and the probe venue B, opened in beforeAll
 * by ensureVenueBProbeData (which also moves manager_b and cashier_b to B) and
 * put back in afterAll.
 *
 * Two kinds of case:
 *   * through PostgREST, with the headers the operator sends (x-station-id,
 *     x-venue-scope), exactly as a request arrives in production;
 *   * inside one psql transaction that is ROLLED BACK (a closed branch, a
 *     link across branches, a booking to come), so nothing here outlives the
 *     case and no other suite can see it.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  ensureTillFresh,
  ensureStationProbe,
  ensureVenueBProbeData,
  deactivateVenueBProbeData,
  appRpc,
  outcome,
  ANON_KEY,
  DEV_PASSWORD,
  DEV_PINS,
  SEED_STAFF,
  SEED_STAFF_IDS,
  SUPABASE_URL,
  VENUE_A_ID,
  VENUE_B_ID,
  type VenueBProbe,
} from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
const VENUE_C = '00000000-0000-4000-8000-0000000a0d17'; // closed, only inside rolled-back transactions
const STATION_A = 'TILL-PROBE-A'; // ensureStationProbe: a live station at venue A

/** One psql transaction, always rolled back. Returns stdout, or the error text. */
function tx(sql: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
      { input: `begin;\n${sql}\nrollback;\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, out: out.trim() };
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    return { ok: false, out: (err.stderr ?? err.message).trim() };
  }
}
function dockerReachable(): boolean {
  return tx('select 1').out === '1';
}

/** The claims a definer body sees for a signed-in staff member. */
const as = (staffId: string) =>
  `select set_config('request.jwt.claims', '{"sub":"${staffId}","role":"authenticated"}', true);`;
/** A closed branch C for this transaction only. */
const CLOSED_C = `insert into venues (id, slug, name_en, name_ar, status)
  values ('${VENUE_C}', 'audit-closed-c', 'Audit C', 'فرع مغلق', 'closed');`;

/** A signed-in staff client that sends the operator's branch headers. */
async function withHeaders(email: string, headers: Record<string, string>): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: DEV_PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

describe.skipIf(!up)('multi-venue audit (0228-0235): two open branches', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let managerB: SupabaseClient;
  let cashierB: SupabaseClient;
  let venueB: VenueBProbe;
  const signedIn: SupabaseClient[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureStationProbe(svc);
    venueB = await ensureVenueBProbeData(svc);
    manager = await signedInClient(SEED_STAFF.manager);
    managerB = await signedInClient(SEED_STAFF.manager_b);
    cashierB = await signedInClient(SEED_STAFF.cashier_b);
    signedIn.push(manager, managerB, cashierB);
  });

  afterAll(async () => {
    await deactivateVenueBProbeData(svc);
    await ensureTillFresh(svc);
    for (const c of signedIn) await c.auth.signOut();
  });

  it('reads and writes agree on one branch: a registered station outranks the switcher (0228)', async () => {
    // The owner at venue A's till with the switcher still on B.
    const atTill = await withHeaders(SEED_STAFF.owner, { 'x-station-id': STATION_A, 'x-venue-scope': VENUE_B_ID });
    signedIn.push(atTill);
    const reads = await appRpc(atTill, 'visible_venue_ids', {});
    expect(reads.error).toBeNull();
    expect(reads.data).toEqual([VENUE_A_ID]);
    const writes = await appRpc(atTill, 'current_venue', { p_station_id: null });
    expect(writes.error).toBeNull();
    expect(writes.data).toBe(VENUE_A_ID);

    // The same owner on a machine that is not a station: the switcher's branch, both ways.
    const office = await withHeaders(SEED_STAFF.owner, { 'x-venue-scope': VENUE_B_ID });
    signedIn.push(office);
    expect((await appRpc(office, 'visible_venue_ids', {})).data).toEqual([VENUE_B_ID]);
    expect((await appRpc(office, 'current_venue', { p_station_id: null })).data).toBe(VENUE_B_ID);
  });

  it('a scope the caller may not use reads nothing and files nothing, never another branch (0228)', async () => {
    const aManagerAtB = await withHeaders(SEED_STAFF.manager, { 'x-venue-scope': VENUE_B_ID });
    signedIn.push(aManagerAtB);
    expect((await appRpc(aManagerAtB, 'visible_venue_ids', {})).data).toEqual([]);
    const { data: courts, error } = await aManagerAtB.from('courts').select('id, venue_id');
    expect(error).toBeNull();
    expect(courts ?? [], 'no court of A dressed up as B, and none of B').toEqual([]);
    const write = await appRpc(aManagerAtB, 'current_venue', { p_station_id: null }).then(outcome);
    expect(write.errorMessage).toBe('VENUE_REQUIRED');
  });

  it('a body that asserts a closed branch files nowhere, and nobody works there (0228)', () => {
    if (!dockerReachable()) return;
    const r = tx(`${CLOSED_C}
      ${as(SEED_STAFF_IDS.owner)}
      select set_config('app.venue_id', '${VENUE_C}', true);
      select coalesce(app.resolve_venue()::text, 'null') || '|' || app.is_staff_at('${VENUE_C}', 'owner')::text;`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out.split('\n').pop()).toBe('null|false');
  });

  it('staff whose only branch closed work nowhere, not at the only open branch (0228)', () => {
    if (!dockerReachable()) return;
    // Venue A alone open (B switched off inside the transaction); the cashier
    // works only at the closed C.
    const r = tx(`${CLOSED_C}
      update venues set is_active = false where id = '${VENUE_B_ID}';
      delete from staff_venues where staff_id = '${SEED_STAFF_IDS.cashier}';
      insert into staff_venues (staff_id, venue_id, role) values ('${SEED_STAFF_IDS.cashier}', '${VENUE_C}', 'cashier');
      ${as(SEED_STAFF_IDS.cashier)}
      select coalesce(app.resolve_venue()::text, 'null');`);
    expect(r.ok, r.out).toBe(true);
    expect(r.out.split('\n').pop()).toBe('null');
  });

  it('a row never points at another branch\'s row, whoever writes it (0230)', () => {
    if (!dockerReachable()) return;
    // B's ingredient in a recipe of A's menu item: the service role (no caller) too.
    const r = tx(`
      with i as (insert into ingredients (name_en, name_ar, unit, venue_id)
                 values ('audit far', 'بعيد', 'g', '${VENUE_B_ID}') returning id),
           v as (select x.id from menu_item_variants x join menu_items mi on mi.id = x.item_id
                  where mi.venue_id = '${VENUE_A_ID}' limit 1)
      insert into recipe_lines (variant_id, ingredient_id, qty) select v.id, i.id, 1 from v, i;`);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('VENUE_MISMATCH');
    expect(r.out).toContain('recipe_lines');
  });

  it('staff change only their own branch\'s rows, whatever the RPC forgot to check (0230)', async () => {
    // set_table_bell checks the role only; the table guard catches the branch.
    const cross = await appRpc(manager, 'set_table_bell', { p_table_id: venueB.tableIds[0], p_enabled: false }).then(outcome);
    expect(cross.ok).toBe(false);
    expect(cross.errorMessage).toBe('VENUE_MISMATCH');
    const { data: still } = await svc.from('cafe_tables').select('bell_enabled').eq('id', venueB.tableIds[0]).single();
    expect((still as { bell_enabled: boolean }).bell_enabled, "B's bell untouched").toBe(true);
    const own = await appRpc(managerB, 'set_table_bell', { p_table_id: venueB.tableIds[0], p_enabled: true }).then(outcome);
    expect(own.ok, own.errorMessage).toBe(true);
  });

  it('the QR sheet lists the branch in scope only (0231)', async () => {
    const a = await appRpc(manager, 'table_qr_tokens', {});
    expect(a.error).toBeNull();
    const aIds = (a.data as { table_id: string; venue_id: string }[]).map((t) => t.table_id);
    expect(aIds).not.toContain(venueB.tableIds[0]);
    const b = await appRpc(managerB, 'table_qr_tokens', {});
    expect(b.error).toBeNull();
    const bRows = b.data as { table_id: string; venue_id: string }[];
    expect(bRows.map((t) => t.table_id)).toEqual(expect.arrayContaining(venueB.tableIds));
    expect(new Set(bRows.map((t) => t.venue_id))).toEqual(new Set([VENUE_B_ID]));
  });

  it('a manager PIN approves at its own branch only (0231)', async () => {
    const aPinAtB = await appRpc(cashierB, 'verify_manager_pin', { p_pin: DEV_PINS.manager });
    expect(aPinAtB.error).toBeNull();
    expect(aPinAtB.data, "venue A's manager does not approve at B").toBeNull();
    const bPinAtB = await appRpc(cashierB, 'verify_manager_pin', { p_pin: DEV_PINS.manager_b });
    expect(bPinAtB.error).toBeNull();
    expect(bPinAtB.data).toBe(SEED_STAFF_IDS.manager_b);
  });

  it('the owner reads a closed branch\'s history; no one else does (0228, A2)', () => {
    if (!dockerReachable()) return;
    const scope = `select set_config('request.headers', '{"x-venue-scope":"${VENUE_C}"}', true);`;
    const r = tx(`${CLOSED_C}
      ${scope}
      ${as(SEED_STAFF_IDS.owner)}
      select array_to_string(app.visible_venue_ids(), ',');
      ${as(SEED_STAFF_IDS.manager)}
      select 'mgr:' || array_to_string(app.visible_venue_ids(), ',');`);
    expect(r.ok, r.out).toBe(true);
    const lines = r.out.split('\n').filter((l) => l && !l.startsWith('{'));
    expect(lines).toContain(VENUE_C);
    expect(lines).toContain('mgr:');
  });

  it('a branch with bookings to come cannot close, and a closed one opens no day (0233)', () => {
    if (!dockerReachable()) return;
    const start = new Date(Date.now() + 20 * 86_400_000).toISOString();
    const end = new Date(Date.now() + 20 * 86_400_000 + 3_600_000).toISOString();
    const r = tx(`
      insert into reservations (court_id, kind, status, start_at, end_at, source, guest_name, venue_id)
      values ('${venueB.courtIds[0]}', 'booking', 'confirmed', '${start}', '${end}', 'desk', 'Audit guest', '${VENUE_B_ID}');
      ${as(SEED_STAFF_IDS.owner)}
      select app.close_branch('${VENUE_B_ID}');`);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('BRANCH_HAS_BOOKINGS');

    const day = tx(`${CLOSED_C}
      ${as(SEED_STAFF_IDS.owner)}
      select app.open_day(0, null, null, '${VENUE_C}');`);
    expect(day.ok).toBe(false);
    expect(day.out).toContain('VENUE_CLOSED');
  });

  it('a heartbeat names nothing it may not: registers nothing, beats no other branch\'s till (0229)', async () => {
    const fresh = `AUDIT-${Date.now()}`;
    const beat = await appRpc(managerB, 'heartbeat', { p_device_id: fresh, p_queue_depth: 0, p_is_till: true });
    expect(beat.error).toBeNull();
    expect((beat.data as { registered: boolean }).registered).toBe(false);
    const { data: ghost } = await svc.from('stations').select('id').eq('id', fresh);
    expect(ghost ?? []).toHaveLength(0);

    const across = await appRpc(managerB, 'heartbeat', { p_device_id: STATION_A, p_queue_depth: 9, p_is_till: true });
    expect(across.error).toBeNull();
    expect((across.data as { registered: boolean }).registered).toBe(false);
    const { data: hb } = await svc.from('device_heartbeats').select('queue_depth').eq('device_id', STATION_A).single();
    expect((hb as { queue_depth: number }).queue_depth).toBe(0);
  });
});

/**
 * 0092 — `players` (group size) on reservations and reservation_series.
 *
 * The column is analytics input: NULL means "unknown" and is never 0, and a
 * stored value is 1..8. Three RPCs learned a trailing `p_players int default
 * null` by DROP + CREATE (never a second overload), so the cases here prove:
 *
 *   - the desk stores what it was given, and NULL when it was given nothing
 *   - 0 and 9 are refused with INVALID_ARGUMENT before anything is written
 *   - a guest confirming a hold stamps the group size onto the booking
 *   - a series stores it once on reservation_series and on EVERY occurrence
 *   - pg_proc holds exactly ONE row per function (a second overload would
 *     make PostgREST answer PGRST203 to every caller that omits p_players)
 *   - the pre-0092 call shapes (no p_players at all) still work unchanged
 *
 * Venue timezone is Asia/Baghdad (UTC+3, no DST since 2008); opening hours in
 * the seed are 09:00-24:00 (+ a 00:00-02:00 tail), so futureSlot() (06..17 UTC
 * = 09..20 local) and 10:00 local are always bookable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  outcome,
  createTestCourt,
  ensureTestRateRule,
  testIdemKey,
  futureSlot,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

/** Same route to the catalog as scripts/check-safe-update.mjs. */
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';
function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', sql],
    { encoding: 'utf8' },
  ).trim();
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 75 days out: clear of futureSlot() (7..~20 days) and of series.test.ts (60 days). */
const BASE = (() => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 75);
  return d.toISOString().slice(0, 10);
})();

interface Created {
  duplicate: boolean;
  seriesId: string;
  created: string[];
  skipped: string[];
}

describe.skipIf(!up)('0092 players (group size)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;
  let courtId: string;

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await guestClient(svc, 'players');
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'P0092');
  });

  afterAll(async () => {
    await Promise.all([desk, guest].map((c) => c.auth.signOut()));
  });

  async function playersOf(id: string): Promise<number | null> {
    const { data, error } = await svc.from('reservations').select('players').eq('id', id).single();
    if (error) throw new Error(error.message);
    return (data as { players: number | null }).players;
  }

  function deskArgs(extra: Record<string, unknown> = {}) {
    const slot = futureSlot();
    return {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(60).toISOString(),
      p_guest_name: 'Players Guest',
      ...extra,
    };
  }

  async function holdFor(c: SupabaseClient): Promise<string> {
    const slot = futureSlot();
    const res = await appRpc(c, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { reservation_id: string }).reservation_id;
  }

  const weekly = (court: string, extra: Record<string, unknown> = {}) => ({
    p_court_id: court,
    p_pattern: 'weekly',
    p_weekdays: null,
    p_start_time: '10:00',
    p_duration_min: 60,
    p_starts_on: BASE,
    p_ends_on: addDays(BASE, 14),
    p_guest_name: 'Players Series',
    ...extra,
  });

  // ── desk ────────────────────────────────────────────────────────────────

  it('desk: p_players 4 is stored as 4', async () => {
    const res = await appRpc(desk, 'staff_create_reservation', deskArgs({ p_players: 4 })).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await playersOf((res.data as { reservation_id: string }).reservation_id)).toBe(4);
  });

  it('desk: no p_players stores NULL (unknown), never 0', async () => {
    const res = await appRpc(desk, 'staff_create_reservation', deskArgs()).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await playersOf((res.data as { reservation_id: string }).reservation_id)).toBeNull();
  });

  it('desk: an explicit null is stored as NULL', async () => {
    const res = await appRpc(desk, 'staff_create_reservation', deskArgs({ p_players: null })).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await playersOf((res.data as { reservation_id: string }).reservation_id)).toBeNull();
  });

  it('desk: 0 and 9 are refused with INVALID_ARGUMENT and nothing is written', async () => {
    for (const bad of [0, 9]) {
      const args = deskArgs({ p_players: bad });
      const res = await appRpc(desk, 'staff_create_reservation', args).then(outcome);
      expect(res.ok, `p_players=${bad} was accepted`).toBe(false);
      expect(res.errorMessage).toContain('INVALID_ARGUMENT');

      const { data } = await svc
        .from('reservations')
        .select('id')
        .eq('court_id', courtId)
        .eq('start_at', args.p_start_at);
      expect(data ?? []).toHaveLength(0);
    }
  });

  it('desk: a maintenance block never carries a group size', async () => {
    const res = await appRpc(desk, 'staff_create_reservation', deskArgs({
      p_kind: 'maintenance',
      p_guest_name: null,
      p_players: 4,
    })).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await playersOf((res.data as { reservation_id: string }).reservation_id)).toBeNull();
  });

  // ── guest confirm ───────────────────────────────────────────────────────

  it('confirm_booking: p_players stamps the hold on its way to confirmed', async () => {
    const id = await holdFor(guest);
    expect(await playersOf(id)).toBeNull(); // hold_slot is untouched: no group size on a hold

    const res = await appRpc(guest, 'confirm_booking', { p_hold_id: id, p_players: 2 }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(await playersOf(id)).toBe(2);

    const { data } = await svc.from('reservations').select('kind, status').eq('id', id).single();
    expect(data).toEqual({ kind: 'booking', status: 'confirmed' });
  });

  it('confirm_booking: without p_players the booking stays unknown', async () => {
    const id = await holdFor(guest);
    const res = await appRpc(guest, 'confirm_booking', { p_hold_id: id }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(await playersOf(id)).toBeNull();
  });

  it('confirm_booking: 0 and 9 are refused and the hold is left as it was', async () => {
    const id = await holdFor(guest);
    for (const bad of [0, 9]) {
      const res = await appRpc(guest, 'confirm_booking', { p_hold_id: id, p_players: bad }).then(outcome);
      expect(res.ok, `p_players=${bad} was accepted`).toBe(false);
      expect(res.errorMessage).toContain('INVALID_ARGUMENT');
    }
    const { data } = await svc.from('reservations').select('kind, status, players').eq('id', id).single();
    expect(data).toEqual({ kind: 'hold', status: 'pending', players: null });
  });

  // ── series ──────────────────────────────────────────────────────────────

  it('create_series: p_players lands on reservation_series and on every occurrence', async () => {
    const court = await createTestCourt(svc, 'P0092-series');
    const res = await appRpc(desk, 'create_series', weekly(court, {
      p_players: 4,
      p_idempotency_key: testIdemKey('series.create'),
    })).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const c = res.data as Created;
    expect(c.created).toHaveLength(3);

    const { data: series } = await svc
      .from('reservation_series')
      .select('players')
      .eq('id', c.seriesId)
      .single();
    expect(series).toEqual({ players: 4 });

    const { data: rows } = await svc
      .from('reservations')
      .select('players')
      .eq('series_id', c.seriesId);
    expect(rows).toHaveLength(3);
    expect((rows as { players: number | null }[]).every((r) => r.players === 4)).toBe(true);
  });

  it('create_series: without p_players every row is unknown', async () => {
    const court = await createTestCourt(svc, 'P0092-series-null');
    const res = await appRpc(desk, 'create_series', weekly(court)).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const c = res.data as Created;

    const { data: series } = await svc
      .from('reservation_series')
      .select('players')
      .eq('id', c.seriesId)
      .single();
    expect(series).toEqual({ players: null });

    const { data: rows } = await svc.from('reservations').select('players').eq('series_id', c.seriesId);
    expect((rows as { players: number | null }[]).every((r) => r.players === null)).toBe(true);
  });

  it('create_series: 0 and 9 are refused before any row is written', async () => {
    const court = await createTestCourt(svc, 'P0092-series-bad');
    for (const bad of [0, 9]) {
      const res = await appRpc(desk, 'create_series', weekly(court, { p_players: bad })).then(outcome);
      expect(res.ok, `p_players=${bad} was accepted`).toBe(false);
      expect(res.errorMessage).toContain('INVALID_ARGUMENT');
    }
    const { data: series } = await svc.from('reservation_series').select('id').eq('court_id', court);
    expect(series ?? []).toHaveLength(0);
    const { data: rows } = await svc.from('reservations').select('id').eq('court_id', court);
    expect(rows ?? []).toHaveLength(0);
  });

  // ── the column itself ───────────────────────────────────────────────────

  it('the CHECK refuses 0 and 9 even from the service role (analytics can trust the column)', async () => {
    const res = await appRpc(desk, 'staff_create_reservation', deskArgs({ p_players: 4 })).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const id = (res.data as { reservation_id: string }).reservation_id;
    for (const bad of [0, 9]) {
      const { error } = await svc.from('reservations').update({ players: bad }).eq('id', id);
      expect(error?.message ?? '').toContain('reservations_players_range');
    }
    expect(await playersOf(id)).toBe(4);

    const { data: s } = await svc
      .from('reservation_series')
      .insert({
        court_id: courtId, pattern: 'weekly', start_time: '10:00', duration_min: 60,
        starts_on: BASE, ends_on: BASE, guest_name: 'check probe', players: 4,
      })
      .select('id')
      .single();
    const seriesId = (s as { id: string }).id;
    for (const bad of [0, 9]) {
      const { error } = await svc.from('reservation_series').update({ players: bad }).eq('id', seriesId);
      expect(error?.message ?? '').toContain('reservation_series_players_range');
    }
  });

  // ── one signature each ──────────────────────────────────────────────────

  it('pg_proc holds exactly one row per re-created function (no second overload)', () => {
    for (const fn of ['staff_create_reservation', 'create_series', 'confirm_booking']) {
      const n = psql(
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace ` +
          `where n.nspname = 'app' and p.proname = '${fn}'`,
      );
      expect(n, fn).toBe('1');
    }
  });

  it('the re-created functions are not EXECUTE-able by PUBLIC or anon', () => {
    for (const fn of ['staff_create_reservation', 'create_series', 'confirm_booking']) {
      const acl = psql(
        `select coalesce(p.proacl::text, '<default: PUBLIC>') from pg_proc p ` +
          `join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = '${fn}'`,
      );
      expect(acl, fn).not.toContain('<default: PUBLIC>');
      expect(acl, fn).not.toMatch(/(^|,)=X\//); // an empty grantee is PUBLIC
      expect(acl, fn).not.toContain('anon=');
      expect(acl, fn).toContain('authenticated=X');
    }
  });

  // ── old call shapes ─────────────────────────────────────────────────────

  it('pre-0092 call shapes (no p_players anywhere) still work for all three', async () => {
    // staff_create_reservation with the 0048 argument set, including p_price_override_iqd.
    const manager = await signedInClient(SEED_STAFF.manager);
    const slot = futureSlot();
    const desk48 = await appRpc(manager, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(60).toISOString(),
      p_guest_name: 'Old Shape',
      p_guest_phone: '+9647700000002',
      p_notes: 'no players arg',
      p_idempotency_key: testIdemKey('reservation.create'),
      p_client_ref: `old-shape-${crypto.randomUUID()}`,
      p_device_id: 'TEST-DESK',
      p_price_override_iqd: 12_345,
    }).then(outcome);
    expect(desk48.ok, desk48.errorMessage).toBe(true);
    await manager.auth.signOut();

    // confirm_booking with the 0059 argument set.
    const id = await holdFor(guest);
    const confirm59 = await appRpc(guest, 'confirm_booking', {
      p_hold_id: id,
      p_guest_name: 'Old Shape',
      p_guest_phone: '+9647700000000',
    }).then(outcome);
    expect(confirm59.ok, confirm59.errorMessage).toBe(true);

    // create_series with the 0066 argument set, and its idempotent replay.
    const court = await createTestCourt(svc, 'P0092-old-series');
    const key = testIdemKey('series.create');
    const args = weekly(court, {
      p_guest_id: null,
      p_guest_phone: '+9647700000003',
      p_notes: 'old shape',
      p_resolutions: [{ date: addDays(BASE, 7), action: 'skip' }],
      p_idempotency_key: key,
      p_device_id: 'TEST-DESK',
    });
    const series66 = await appRpc(desk, 'create_series', args).then(outcome);
    expect(series66.ok, series66.errorMessage).toBe(true);
    expect((series66.data as Created).created).toHaveLength(2);
    const replay = await appRpc(desk, 'create_series', args).then(outcome);
    expect(replay.ok, replay.errorMessage).toBe(true);
    expect(replay.duplicate).toBe(true);
  });
});

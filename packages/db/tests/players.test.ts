/**
 * 0143 — the group size is gone. 0092 added `players` to reservations and
 * reservation_series and a trailing `p_players int default null` to three
 * RPCs; 0143 drops both columns and keeps the parameter, IGNORED, so a till
 * or phone on an older build that still sends it does not get PGRST202.
 * The cases here prove:
 *
 *   - neither table has a `players` column, and neither CHECK survives
 *   - no app.* function body names `players` except the three deprecated
 *     p_players parameters, and the assistant allowlist does not offer it
 *   - the three RPCs still take p_players — any value, even one 0092 refused
 *     (0, 9) — and succeed without writing anything for it
 *   - pg_proc holds exactly ONE row per function, still not EXECUTE-able by
 *     PUBLIC or anon
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

describe.skipIf(!up)('0143 players dropped (p_players accepted and ignored)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;
  let courtId: string;

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await guestClient(svc, 'players');
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'P0143');
  });

  afterAll(async () => {
    await Promise.all([desk, guest].map((c) => c.auth.signOut()));
  });

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

  // ── the columns ─────────────────────────────────────────────────────────

  it('neither table has a players column, and the 0092 CHECKs are gone', () => {
    expect(
      psql(
        `select count(*) from information_schema.columns ` +
          `where table_schema = 'public' and table_name in ('reservations', 'reservation_series') ` +
          `and column_name = 'players'`,
      ),
    ).toBe('0');
    expect(
      psql(
        `select count(*) from pg_constraint ` +
          `where conname in ('reservations_players_range', 'reservation_series_players_range')`,
      ),
    ).toBe('0');
  });

  it('PostgREST refuses a select of the dropped column', async () => {
    const { error } = await svc.from('reservations').select('players').limit(1);
    expect(error?.message ?? '').toMatch(/players/);
  });

  it('no app or public function body reads or writes players any more', () => {
    // prosrc is the body only; the deprecated p_players parameter lives in the
    // signature. p_players itself may appear nowhere in a body either.
    const names = psql(
      `select string_agg(n.nspname || '.' || p.proname, ',' order by p.proname) from pg_proc p ` +
        `join pg_namespace n on n.oid = p.pronamespace ` +
        `where n.nspname in ('app', 'public') and p.prosrc ~* '\\mp?_?players\\M'`,
    );
    expect(names).toBe('');
  });

  it('the assistant allowlist no longer offers the column', () => {
    expect(
      psql(`select count(*) from app.assistant_readable_columns where column_name = 'players'`),
    ).toBe('0');
  });

  it('the courts_findings built-in no longer asks about players', () => {
    const q = psql(`select question from assistant_components where key = 'courts_findings'`);
    expect(q).not.toBe('');
    expect(q.toLowerCase()).not.toContain('player');
  });

  // ── p_players is accepted and ignored ───────────────────────────────────

  it('staff_create_reservation: any p_players, even 0 or 9, is accepted and ignored', async () => {
    for (const p of [4, 0, 9, null]) {
      const res = await appRpc(desk, 'staff_create_reservation', deskArgs({ p_players: p })).then(outcome);
      expect(res.ok, `p_players=${String(p)}: ${res.errorMessage ?? ''}`).toBe(true);
    }
    const maint = await appRpc(desk, 'staff_create_reservation', deskArgs({
      p_kind: 'maintenance',
      p_guest_name: null,
      p_players: 4,
    })).then(outcome);
    expect(maint.ok, maint.errorMessage).toBe(true);
  });

  it('confirm_booking: p_players is accepted and ignored, even 0 or 9', async () => {
    for (const p of [2, 0, 9]) {
      const id = await holdFor(guest);
      const res = await appRpc(guest, 'confirm_booking', { p_hold_id: id, p_players: p }).then(outcome);
      expect(res.ok, `p_players=${p}: ${res.errorMessage ?? ''}`).toBe(true);
      expect(res.duplicate).toBe(false);
      const { data } = await svc.from('reservations').select('kind, status').eq('id', id).single();
      expect(data).toEqual({ kind: 'booking', status: 'confirmed' });
    }
  });

  it('create_series: p_players is accepted and ignored; every occurrence is created', async () => {
    for (const p of [4, 9]) {
      const court = await createTestCourt(svc, `P0143-series-${p}`);
      const res = await appRpc(desk, 'create_series', weekly(court, {
        p_players: p,
        p_idempotency_key: testIdemKey('series.create'),
      })).then(outcome);
      expect(res.ok, res.errorMessage).toBe(true);
      const c = res.data as Created;
      expect(c.created).toHaveLength(3);
      const { data: rows } = await svc.from('reservations').select('id').eq('series_id', c.seriesId);
      expect(rows).toHaveLength(3);
    }
  });

  // ── one signature each ──────────────────────────────────────────────────

  it('pg_proc holds exactly one row per function, still with p_players last', () => {
    const expected: Record<string, string> = {
      staff_create_reservation: '13',
      create_series: '15',
      confirm_booking: '4',
    };
    for (const [fn, nargs] of Object.entries(expected)) {
      const row = psql(
        `select count(*) || '|' || max(p.pronargs) || '|' || max(p.proargnames[p.pronargs]) from pg_proc p ` +
          `join pg_namespace n on n.oid = p.pronamespace ` +
          `where n.nspname = 'app' and p.proname = '${fn}'`,
      );
      expect(row, fn).toBe(`1|${nargs}|p_players`);
    }
  });

  it('the re-issued functions are not EXECUTE-able by PUBLIC or anon', () => {
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

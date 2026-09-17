/**
 * 0105 — staff breaks with cover.
 *
 * The properties a wrong implementation would still appear to satisfy:
 *
 *   * a cashier can now HOLD a PIN, and that PIN still approves nothing —
 *     verify_manager_pin must go on ignoring it;
 *   * a break needs the person's OWN PIN, a wrong one is reported (not raised)
 *     so the attempt row survives, and the allowance is per business day;
 *   * cover is offered to assigned staff and to any manager/owner, needs the
 *     COVER person's PIN, and is refused for anyone else — even with the right
 *     PIN;
 *   * everything is readable back by the person and by management, and by
 *     nobody else.
 *
 * Principals: cashier (on break), court_desk (assigned cover), manager (cover
 * by role), prep (not eligible). The suite drives NO lockouts and clears its
 * own ':self:' and ':cover:' attempt rows, so it does not collide with
 * hardening.test.ts / idle-lock.test.ts, which own the limiter assertions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  setCafeSetting,
  snapshotCafeSettings,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

const STATION = 'TILL-TEST-05';
const CASHIER_PIN = '592817';
const DESK_PIN = '738164';
const PREP_PIN = '461935';

interface BreakStatus {
  allowance_seconds: number;
  used_seconds: number;
  remaining_seconds: number;
  open: { id: string; station_id: string; cover: { id: string; display_name: string } | null } | null;
  candidates: { id: string; display_name: string; role: string; assigned: boolean }[];
}

describe.skipIf(!up)('0105 staff breaks', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let desk: SupabaseClient;
  let prep: SupabaseClient;
  let restoreSettings: () => Promise<void>;

  const status = async (c: SupabaseClient): Promise<BreakStatus> => {
    const res = await appRpc(c, 'break_status', { p_device_id: STATION });
    expect(res.error).toBeNull();
    return res.data as BreakStatus;
  };

  const wipe = async () => {
    // Test rows only: this station's breaks, this station's assignments, and
    // the attempt rows the PIN checks wrote. Each delete is asserted (the
    // idle-lock lesson: a cleanup that silently fails is worse than none).
    let r = await svc.from('staff_breaks').delete().eq('station_id', STATION);
    expect(r.error).toBeNull();
    r = await svc.from('station_staff').delete().eq('station_id', STATION);
    expect(r.error).toBeNull();
    r = await svc.schema('app').from('pin_attempts').delete().like('device_id', `%:${STATION}`);
    expect(r.error).toBeNull();
    // verify_manager_pin counts EVERY failure under '{caller}:%' (0026), so a
    // wrong self-PIN typed on a dev till within the last five minutes would
    // lock the cashier out of the "approves nothing" probe. Start clean.
    r = await svc.schema('app').from('pin_attempts').delete().like('device_id', `${SEED_STAFF_IDS.cashier}:%`);
    expect(r.error).toBeNull();
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    desk = await signedInClient(SEED_STAFF.court_desk);
    prep = await signedInClient(SEED_STAFF.prep);
    restoreSettings = await snapshotCafeSettings(svc, owner);
    await wipe();
    // The seed gives PINs to the manager and owner only. The whole point of
    // 0105 is that these three can have one too.
    for (const [id, pin] of [
      [SEED_STAFF_IDS.cashier, CASHIER_PIN],
      [SEED_STAFF_IDS.court_desk, DESK_PIN],
      [SEED_STAFF_IDS.prep, PREP_PIN],
    ] as const) {
      const res = await appRpc(owner, 'set_staff_pin', { p_staff_id: id, p_pin: pin });
      expect(res.error, `set_staff_pin for ${id}`).toBeNull();
    }
    // Any open break the cashier may have left elsewhere would block start_break.
    const stale = await svc.from('staff_breaks').delete().eq('staff_id', SEED_STAFF_IDS.cashier).is('ended_at', null);
    expect(stale.error).toBeNull();
  });

  afterAll(async () => {
    await wipe();
    for (const id of [SEED_STAFF_IDS.cashier, SEED_STAFF_IDS.court_desk, SEED_STAFF_IDS.prep]) {
      await appRpc(owner, 'clear_staff_pin', { p_staff_id: id });
    }
    await restoreSettings();
    for (const c of [owner, manager, cashier, desk, prep]) await c.auth.signOut();
  });

  it('a cashier PIN unlocks the idle lock but approves nothing', async () => {
    expect((await appRpc(cashier, 'has_own_pin', {})).data).toBe(true);
    const own = await appRpc(cashier, 'verify_own_pin', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(own.error).toBeNull();
    expect(own.data).toBe(true);
    // The money verifier scans managers and owners only (0086), untouched.
    const mgr = await appRpc(cashier, 'verify_manager_pin', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(mgr.error).toBeNull();
    expect(mgr.data).toBeNull();
  });

  it('demoting a manager keeps their PIN (it is the person’s, not the role’s)', async () => {
    // Only observable through list_staff.has_pin; use the desk account so the
    // seeded manager is never touched.
    let res = await appRpc(owner, 'set_staff_role', { p_staff_id: SEED_STAFF_IDS.court_desk, p_role: 'manager' });
    expect(res.error).toBeNull();
    res = await appRpc(owner, 'set_staff_role', { p_staff_id: SEED_STAFF_IDS.court_desk, p_role: 'court_desk' });
    expect(res.error).toBeNull();
    const list = await appRpc(owner, 'list_staff', {});
    const row = (list.data as { id: string; has_pin: boolean }[]).find((s) => s.id === SEED_STAFF_IDS.court_desk);
    expect(row?.has_pin).toBe(true);
  });

  it('assignments are manager/owner-managed, validated, and audited', async () => {
    const bad = await appRpc(manager, 'set_station_staff', { p_staff_id: SEED_STAFF_IDS.court_desk, p_station_ids: ['till 1'] });
    expect(bad.error?.message).toBe('INVALID_STATION');
    const refused = await appRpc(cashier, 'set_station_staff', { p_staff_id: SEED_STAFF_IDS.court_desk, p_station_ids: [STATION] });
    expect(refused.error?.message).toBe('FORBIDDEN');
    const ok = await appRpc(manager, 'set_station_staff', { p_staff_id: SEED_STAFF_IDS.court_desk, p_station_ids: [STATION, STATION] });
    expect(ok.error).toBeNull();
    expect((ok.data as { station_ids: string[] }).station_ids).toEqual([STATION]);
    const rows = await manager.from('station_staff').select('station_id, staff_id').eq('station_id', STATION);
    expect(rows.data).toEqual([{ station_id: STATION, staff_id: SEED_STAFF_IDS.court_desk }]);
    // A cashier learns the list only through break_status, never the table.
    const hidden = await cashier.from('station_staff').select('station_id').eq('station_id', STATION);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it('break_status lists assigned staff first, then managers and owners, all with a PIN', async () => {
    const s = await status(cashier);
    expect(s.open).toBeNull();
    expect(s.allowance_seconds).toBe(3600);
    const names = s.candidates.map((c) => [c.id, c.assigned]);
    expect(names[0]).toEqual([SEED_STAFF_IDS.court_desk, true]);
    const ids = s.candidates.map((c) => c.id);
    expect(ids).toContain(SEED_STAFF_IDS.manager);
    expect(ids).toContain(SEED_STAFF_IDS.owner);
    expect(ids).not.toContain(SEED_STAFF_IDS.prep); // has a PIN, not assigned, not management
    expect(ids).not.toContain(SEED_STAFF_IDS.cashier); // never yourself
  });

  it('a wrong PIN is reported, not raised, and starts nothing', async () => {
    const res = await appRpc(cashier, 'start_break', { p_pin: '000000', p_device_id: STATION });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ ok: false, code: 'PIN_INVALID' });
    expect((await status(cashier)).open).toBeNull();
    // The attempt row survived the call — that is what makes the limiter real.
    const attempts = await svc.schema('app').from('pin_attempts').select('success').eq('device_id', `${SEED_STAFF_IDS.cashier}:self:${STATION}`);
    expect(attempts.data?.some((a) => a.success === false)).toBe(true);
  });

  it('cover is refused before any break is open', async () => {
    const res = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.court_desk, p_pin: DESK_PIN, p_device_id: STATION });
    expect(res.error?.message).toBe('BREAK_NOT_OPEN');
  });

  it('starts a break with the own PIN, once', async () => {
    const res = await appRpc(cashier, 'start_break', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(res.error).toBeNull();
    const d = res.data as { ok: boolean; break: { station_id: string }; remaining_seconds: number };
    expect(d.ok).toBe(true);
    expect(d.break.station_id).toBe(STATION);
    expect(d.remaining_seconds).toBeLessThanOrEqual(3600);
    const again = await appRpc(cashier, 'start_break', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(again.error?.message).toBe('BREAK_ALREADY_OPEN');
    const s = await status(cashier);
    expect(s.open?.station_id).toBe(STATION);
    expect(s.open?.cover).toBeNull();
  });

  it('cover: not for the unassigned, not with the wrong PIN, yes for assigned staff', async () => {
    const prepTry = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.prep, p_pin: PREP_PIN, p_device_id: STATION });
    expect(prepTry.error?.message).toBe('COVER_NOT_ALLOWED');
    const self = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.cashier, p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(self.error?.message).toBe('COVER_NOT_ALLOWED');
    const wrong = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.court_desk, p_pin: '000000', p_device_id: STATION });
    expect(wrong.error).toBeNull();
    expect(wrong.data).toEqual({ ok: false, code: 'PIN_INVALID' });
    expect((await status(cashier)).open?.cover).toBeNull();

    const ok = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.court_desk, p_pin: DESK_PIN, p_device_id: STATION });
    expect(ok.error).toBeNull();
    const d = ok.data as { ok: boolean; break: { cover: { id: string } } };
    expect(d.ok).toBe(true);
    expect(d.break.cover.id).toBe(SEED_STAFF_IDS.court_desk);
    // Re-verifying the same cover (what the idle lock does) is idempotent.
    const twice = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.court_desk, p_pin: DESK_PIN, p_device_id: STATION });
    expect(twice.error).toBeNull();
    const openId = (await status(cashier)).open?.id ?? '';
    const audits = await svc.from('audit_log').select('action, authorizer_id').eq('action', 'staff.break_cover').eq('entity_id', openId);
    expect(audits.data).toHaveLength(1);
    expect(audits.data?.[0]?.authorizer_id).toBe(SEED_STAFF_IDS.court_desk);
  });

  it('a manager can take over by role, replacing the cover', async () => {
    const ok = await appRpc(cashier, 'cover_station', { p_staff_id: SEED_STAFF_IDS.manager, p_pin: DEV_PINS.manager, p_device_id: STATION });
    expect(ok.error).toBeNull();
    expect((await status(cashier)).open?.cover?.id).toBe(SEED_STAFF_IDS.manager);
  });

  it('the break is visible to the person, the cover and management, not to others', async () => {
    const own = await cashier.from('staff_breaks').select('id').eq('station_id', STATION);
    expect(own.data).toHaveLength(1);
    const cover = await manager.from('staff_breaks').select('id').eq('station_id', STATION);
    expect(cover.data).toHaveLength(1);
    const other = await prep.from('staff_breaks').select('id').eq('station_id', STATION);
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);
  });

  it('ends with the own PIN and counts the minutes against today', async () => {
    const wrong = await appRpc(cashier, 'end_break', { p_pin: '000000', p_device_id: STATION });
    expect(wrong.error).toBeNull();
    expect(wrong.data).toEqual({ ok: false, code: 'PIN_INVALID' });
    const res = await appRpc(cashier, 'end_break', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(res.error).toBeNull();
    const d = res.data as { ok: boolean; duration_seconds: number; used_seconds: number; break: { cover: { id: string } } };
    expect(d.ok).toBe(true);
    expect(d.duration_seconds).toBeGreaterThanOrEqual(0);
    expect(d.break.cover.id).toBe(SEED_STAFF_IDS.manager);
    const s = await status(cashier);
    expect(s.open).toBeNull();
    expect(s.used_seconds).toBe(d.used_seconds);
    const again = await appRpc(cashier, 'end_break', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(again.error?.message).toBe('BREAK_NOT_OPEN');
  });

  it('the allowance is the setting, per business day, and refuses when spent', async () => {
    await setCafeSetting(manager, 'break_allowance_minutes', 0);
    const s = await status(cashier);
    expect(s.allowance_seconds).toBe(0);
    expect(s.remaining_seconds).toBe(0);
    const res = await appRpc(cashier, 'start_break', { p_pin: CASHIER_PIN, p_device_id: STATION });
    expect(res.error?.message).toBe('BREAK_ALLOWANCE_USED');
    await setCafeSetting(manager, 'break_allowance_minutes', 60);
    // Yesterday's minutes do not count against today.
    const y = await svc.from('staff_breaks').insert({
      staff_id: SEED_STAFF_IDS.cashier,
      station_id: STATION,
      business_date: '2020-01-01',
      started_at: '2020-01-01T10:00:00Z',
      ended_at: '2020-01-01T11:00:00Z',
    });
    expect(y.error).toBeNull();
    expect((await status(cashier)).remaining_seconds).toBeGreaterThan(3000);
  });

  it('refuses guests and a bad station id', async () => {
    const guest = await anonymousSessionClient();
    try {
      const res = await appRpc(guest, 'break_status', { p_device_id: STATION });
      expect(res.error?.message).toBe('FORBIDDEN');
    } finally {
      await guest.auth.signOut();
    }
    const bad = await appRpc(cashier, 'break_status', { p_device_id: 'till 1' });
    expect(bad.error?.message).toBe('INVALID_STATION');
  });
});

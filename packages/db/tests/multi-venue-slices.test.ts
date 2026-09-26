/**
 * Multi-venue slices 2–3 — the day, the guards, promotions and staff
 * memberships per branch (migrations 0208–0218).
 *
 * Same discipline as multi-venue.test.ts: venue B is made active in beforeAll
 * (ensureVenueBProbeData, which also moves manager_b and cashier_b to B) and
 * deactivated in afterAll (deactivateVenueBProbeData puts them back at A).
 * Everything this file opens at B (a day, a tab, promotions) is closed or
 * switched off before it leaves.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  ensureTillFresh,
  ensureOpenDay,
  ensureVenueBProbeData,
  deactivateVenueBProbeData,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  VENUE_A_ID,
  VENUE_B_ID,
  type VenueBProbe,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('multi-venue slices 2-3: the day, the guards, promotions, memberships', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let managerB: SupabaseClient;
  let venueB: VenueBProbe;
  let bDay: string | null = null;
  let bTab: string | null = null;
  const promoIds: string[] = [];

  beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    venueB = await ensureVenueBProbeData(svc);
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    managerB = await signedInClient(SEED_STAFF.manager_b);
    // Venue A trades today (the suites assume an open day there).
    await ensureOpenDay(manager, svc);
  });

  afterAll(async () => {
    if (bTab) {
      await svc.from('tabs').update({ status: 'voided' }).eq('id', bTab);
    }
    if (bDay) {
      await svc.from('day_sessions').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', bDay);
    }
    if (promoIds.length > 0) {
      await svc.from('promotions').update({ enabled: false }).in('id', promoIds);
    }
    await deactivateVenueBProbeData(svc);
    await ensureTillFresh(svc);
    await owner?.auth.signOut();
    await manager?.auth.signOut();
    await managerB?.auth.signOut();
  });

  it('each branch opens its own day while the other trades (0216)', async () => {
    const { data: openA } = await svc
      .from('day_sessions')
      .select('id')
      .eq('venue_id', VENUE_A_ID)
      .eq('status', 'open')
      .maybeSingle();
    expect(openA, 'venue A has an open day').not.toBeNull();

    // B's manager opens B's day: no PREVIOUS_DAY_OPEN from A's day. A per-run
    // far-future business date: (venue_id, business_date) is unique, and a
    // re-run on the same day would otherwise get the last run's closed day back.
    const days = 30_000 + Math.floor(Math.random() * 1_000_000);
    const businessDate = new Date(days * 86_400_000).toISOString().slice(0, 10);
    const opened = await appRpc(managerB, 'open_day', { p_opening_float_iqd: 0, p_business_date: businessDate });
    expect(opened.error, opened.error?.message).toBeNull();
    bDay = (opened.data as { day_session_id: string }).day_session_id;
    const { data: row } = await svc.from('day_sessions').select('venue_id, status').eq('id', bDay).single();
    expect(row).toMatchObject({ venue_id: VENUE_B_ID, status: 'open' });

    // A's manager cannot open B's day by naming it.
    const cross = await appRpc(manager, 'open_day', { p_opening_float_iqd: 0, p_venue_id: VENUE_B_ID });
    expect(cross.error?.message).toBe('FORBIDDEN');
  });

  it('a tab belongs to its table\'s branch, and another branch\'s staff are refused (0217)', async () => {
    const tab = await appRpc(managerB, 'open_tab', {
      p_table_id: venueB.tableIds[0],
      p_idempotency_key: `mvs-tab-${Date.now()}`,
    });
    expect(tab.error, tab.error?.message).toBeNull();
    bTab = (tab.data as { tab_id: string }).tab_id;
    const { data: t } = await svc.from('tabs').select('venue_id, day_session_id').eq('id', bTab).single();
    expect(t).toMatchObject({ venue_id: VENUE_B_ID, day_session_id: bDay });

    // Venue A's manager acting on B's tab.
    const settle = await appRpc(manager, 'settle_tab', {
      p_tab_id: bTab, p_method: 'cash', p_tendered_iqd: 0, p_amount_iqd: 0,
      p_idempotency_key: `mvs-settle-${Date.now()}`,
    }).then(outcome);
    expect(settle.ok).toBe(false);
    expect(settle.errorMessage).toBe('VENUE_MISMATCH');

    // Nor can A's manager open a tab on B's table.
    const crossTab = await appRpc(manager, 'open_tab', {
      p_table_id: venueB.tableIds[1],
      p_idempotency_key: `mvs-tab-x-${Date.now()}`,
    }).then(outcome);
    expect(crossTab.errorMessage).toBe('VENUE_MISMATCH');
  });

  it('promotions run at their branch, or at every branch only when they name no ids (0212)', async () => {
    const mk = async (name: string, scope: Record<string, unknown>) => {
      const { data, error } = await svc
        .from('promotions')
        .insert({
          venue_id: VENUE_A_ID, name_en: name, name_ar: name, type: 'percent', value: 5,
          scope, auto: true, enabled: true, created_by: SEED_STAFF_IDS.owner,
        })
        .select('id')
        .single();
      expect(error, error?.message).toBeNull();
      const id = (data as { id: string }).id;
      promoIds.push(id);
      return id;
    };
    const plain = await mk(`MVS plain ${Date.now()}`, {});
    const scoped = await mk(`MVS scoped ${Date.now()}`, { courtIds: [venueB.courtIds[0]] });

    // B's manager reads only B's and chain-wide promotions (0212 policy).
    const visibleToB = async (id: string) =>
      ((await managerB.from('promotions').select('id').eq('id', id)).data ?? []).length === 1;
    expect(await visibleToB(plain)).toBe(false);

    // Chain-wide: every branch.
    const chain = await appRpc(owner, 'set_promotion_venue', { p_promotion_id: plain, p_venue_id: null });
    expect(chain.error, chain.error?.message).toBeNull();
    const { data: row } = await svc.from('promotions').select('venue_id').eq('id', plain).single();
    expect((row as { venue_id: string | null }).venue_id).toBeNull();
    expect(await visibleToB(plain)).toBe(true);

    // A promotion that names a court cannot be chain-wide.
    const refused = await appRpc(owner, 'set_promotion_venue', { p_promotion_id: scoped, p_venue_id: null }).then(outcome);
    expect(refused.errorMessage).toBe('PROMOTION_SCOPE_BRANCH');

    // Only the owner switches it.
    const byManager = await appRpc(manager, 'set_promotion_venue', { p_promotion_id: plain, p_venue_id: VENUE_A_ID }).then(outcome);
    expect(byManager.errorMessage).toBe('FORBIDDEN');
  });

  it('a role change keeps a branch-B membership where it is (0218)', async () => {
    const before = await svc.from('staff_venues').select('venue_id').eq('staff_id', SEED_STAFF_IDS.cashier_b);
    expect((before.data ?? []).map((r) => (r as { venue_id: string }).venue_id)).toEqual([VENUE_B_ID]);
    try {
      const toDesk = await appRpc(owner, 'set_staff_role', { p_staff_id: SEED_STAFF_IDS.cashier_b, p_role: 'court_desk' });
      expect(toDesk.error, toDesk.error?.message).toBeNull();
      const after = await svc.from('staff_venues').select('venue_id, role').eq('staff_id', SEED_STAFF_IDS.cashier_b);
      expect(after.data ?? []).toEqual([{ venue_id: VENUE_B_ID, role: 'court_desk' }]);
    } finally {
      await appRpc(owner, 'set_staff_role', { p_staff_id: SEED_STAFF_IDS.cashier_b, p_role: 'cashier' });
    }
  });

  it('closing B\'s day leaves A\'s open (0216)', async () => {
    // The tab has nothing on it: remove it so the day may close.
    const cancel = await appRpc(managerB, 'cancel_tab', {
      p_tab_id: bTab, p_reason_code: 'test', p_idempotency_key: `mvs-cancel-${Date.now()}`,
    });
    expect(cancel.error, cancel.error?.message).toBeNull();
    bTab = null;

    const closed = await appRpc(managerB, 'close_day', { p_cash_counted_iqd: 0 });
    expect(closed.error, closed.error?.message).toBeNull();
    expect((closed.data as { day_session_id: string }).day_session_id).toBe(bDay);
    bDay = null;

    const { data: stillOpen } = await svc
      .from('day_sessions')
      .select('id')
      .eq('venue_id', VENUE_A_ID)
      .eq('status', 'open')
      .maybeSingle();
    expect(stillOpen, 'venue A still trades').not.toBeNull();
  });
});

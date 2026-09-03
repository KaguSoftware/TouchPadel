/**
 * 0053 — charge-to-booking, split by item, and the cash-drawer record.
 *
 * All three are SOW clauses that needed schema, not just a screen:
 *
 *   L131 + L445-446  "Charge a cafe order to a court booking so a group settles
 *                    courts and drinks in ONE payment." `tabs.reservation_id`
 *                    has existed since 0015 and the till has always offered the
 *                    booking picker — `compute_tab_totals` never added the court
 *                    price, so the "one payment" bill was short by the court and
 *                    the group walked having paid for drinks only.
 *   L444             "Split a bill BY ITEM or evenly." Only split_evenly existed.
 *   L449             "a cash drawer opening record" — the change calculation was
 *                    there, the record was not.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  testIdemKey,
  SEED_STAFF,
  DEV_PINS,
  createTestMenuItem,
  createTestCourt,
  ensureOpenDay,
  ensureTillFresh,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0053 till completeness', () => {
  let svc: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let deskClient: SupabaseClient;

  /** Menu item at a known price, on a category with a known (zero) tax group. */
  let itemA: Awaited<ReturnType<typeof createTestMenuItem>>;
  let itemB: Awaited<ReturnType<typeof createTestMenuItem>>;

  async function openTab(label: string): Promise<string> {
    const res = await appRpc(cashier, 'open_tab', {
      p_label: label,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    return (res.data as { tab_id: string }).tab_id;
  }

  async function addItem(tabId: string, item: { variantId: string }, qty = 1) {
    const res = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (res.error) throw new Error(`till_add_items: ${res.error.message}`);
    return res.data;
  }

  async function liveItemIds(tabId: string): Promise<string[]> {
    // Tests index into this positionally (ids[0] = the first addItem call), so
    // the rows must come back in insertion order — without the ORDER BY the
    // planner is free to return the orders either way round, and did (a 2-in-4
    // flake on parts[0]=6000 vs 4000).
    const { data } = await svc
      .from('orders')
      .select('status, placed_at, order_items(id, voided)')
      .eq('tab_id', tabId)
      .order('placed_at', { ascending: true });
    return (data as { status: string; order_items: { id: string; voided: boolean }[] }[])
      .filter((o) => o.status !== 'voided')
      .flatMap((o) => o.order_items.filter((i) => !i.voided).map((i) => i.id));
  }

  async function totals(tabId: string) {
    const { data, error } = await svc.schema('app').rpc('compute_tab_totals', { p_tab_id: tabId });
    if (error) throw new Error(error.message);
    return (data as { subtotal_iqd: number; court_iqd: number; total_iqd: number }[])[0]!;
  }

  beforeAll(async () => {
    svc = serviceClient();
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    deskClient = await signedInClient(SEED_STAFF.court_desk);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    itemA = await createTestMenuItem(svc, 'split-a', 6000);
    itemB = await createTestMenuItem(svc, 'split-b', 4000);
  });

  afterAll(async () => {
    await cashier.auth.signOut();
    await manager.auth.signOut();
    await deskClient.auth.signOut();
  });

  // -------------------------------------------------------------------------
  // Charge to booking
  // -------------------------------------------------------------------------
  describe('court fee on a tab charged to a booking', () => {
    let courtId: string;

    beforeAll(async () => {
      courtId = await createTestCourt(svc, `Court 0053 ${Date.now()}`);
    });

    /** A confirmed booking on the test court at a known price. */
    let slot = 0;
    async function makeBooking(priceIqd: number, status = 'confirmed'): Promise<string> {
      // Its own hour each time: the exclusion constraint refuses two live
      // reservations overlapping on one court, which is the point of it.
      const start = new Date(Date.now() + (3 + slot++) * 86_400_000);
      start.setUTCHours(10, 0, 0, 0);
      const { data, error } = await svc
        .from('reservations')
        .insert({
          court_id: courtId,
          kind: 'booking',
          status,
          source: 'desk',
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
          guest_name: 'Court Fee Test',
          price_iqd: priceIqd,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return (data as { id: string }).id;
    }

    it('adds the court price to the total but NOT to the subtotal', async () => {
      // Subtotal is goods. Folding the court into it would silently let
      // "10% off the drinks" discount the court too.
      const tabId = await openTab('court-basic');
      await addItem(tabId, itemA);
      const before = await totals(tabId);
      expect(before.court_iqd).toBe(0);
      expect(before.total_iqd).toBe(before.subtotal_iqd);

      const reservationId = await makeBooking(40_000);
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);

      const after = await totals(tabId);
      expect(after.subtotal_iqd).toBe(before.subtotal_iqd);
      expect(after.court_iqd).toBe(40_000);
      expect(after.total_iqd).toBe(before.subtotal_iqd + 40_000);
    });

    it('charges nothing for a cancelled booking', async () => {
      // Otherwise cancelling after ordering drinks leaves the court on the bill.
      const tabId = await openTab('court-cancelled');
      await addItem(tabId, itemA);
      const reservationId = await makeBooking(40_000, 'cancelled');
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);
      expect((await totals(tabId)).court_iqd).toBe(0);
    });

    it('charges nothing for a hold', async () => {
      const tabId = await openTab('court-hold');
      await addItem(tabId, itemA);
      const start = new Date(Date.now() + 4 * 86_400_000);
      const { data } = await svc
        .from('reservations')
        .insert({
          court_id: courtId,
          kind: 'hold',
          status: 'pending',
          source: 'desk',
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
          price_iqd: 40_000,
          hold_expires_at: new Date(Date.now() + 600_000).toISOString(),
        })
        .select('id')
        .single();
      await svc.from('tabs').update({ reservation_id: (data as { id: string }).id }).eq('id', tabId);
      expect((await totals(tabId)).court_iqd).toBe(0);
    });

    it('charges nothing for an unpriced booking rather than guessing', async () => {
      const tabId = await openTab('court-unpriced');
      await addItem(tabId, itemA);
      const reservationId = await makeBooking(0);
      await svc.from('reservations').update({ price_iqd: null }).eq('id', reservationId);
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);
      expect((await totals(tabId)).court_iqd).toBe(0);
    });

    it('keeps the court out of the percentage-discount base', async () => {
      // apply_discount computes its percentage against subtotal_iqd (0037).
      const tabId = await openTab('court-discount');
      await addItem(tabId, itemA); // 6,000
      const reservationId = await makeBooking(40_000);
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);

      const res = await appRpc(manager, 'apply_discount', {
        p_tab_id: tabId,
        p_kind: 'discount_percent',
        p_value: 1000, // 10%
        p_pin: DEV_PINS.manager,
        p_reason_code: 'comp',
      });
      expect(res.error).toBeNull();

      const t = await totals(tabId);
      // 10% of the GOODS (600), not of goods + court (4,600).
      expect(t.total_iqd).toBe(6000 - 600 + 40_000);
    });

    it('stamps court_iqd onto the tab at settle, so the breakdown reconciles', async () => {
      const tabId = await openTab('court-settle');
      await addItem(tabId, itemA); // 6,000
      const reservationId = await makeBooking(40_000);
      await svc.from('tabs').update({ reservation_id: reservationId }).eq('id', tabId);

      const res = await appRpc(cashier, 'settle_tab', {
        p_tab_id: tabId,
        p_method: 'cash',
        p_tendered_iqd: 50_000,
        p_idempotency_key: testIdemKey('payment.record'),
      });
      expect(res.error).toBeNull();

      const { data } = await svc
        .from('tabs')
        .select('subtotal_iqd, discount_iqd, tax_iqd, court_iqd, total_iqd, status')
        .eq('id', tabId)
        .single();
      const row = data as unknown as {
        subtotal_iqd: number;
        discount_iqd: number;
        tax_iqd: number;
        court_iqd: number;
        total_iqd: number;
        status: string;
      };
      expect(row.court_iqd).toBe(40_000);
      expect(row.status).toBe('settled');
      // The stamped parts add up to the stamped total — the whole reason the
      // column exists rather than the court being folded into subtotal.
      expect(row.subtotal_iqd - row.discount_iqd + row.tax_iqd + row.court_iqd).toBe(row.total_iqd);
    });
  });

  // -------------------------------------------------------------------------
  // Split by item
  // -------------------------------------------------------------------------
  describe('app.split_by_item', () => {
    it('splits by what each group ordered, and the parts sum to the bill', async () => {
      const tabId = await openTab('split-basic');
      await addItem(tabId, itemA); // 6,000
      await addItem(tabId, itemB); // 4,000
      const ids = await liveItemIds(tabId);

      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [[ids[0]], [ids[1]]],
      });
      expect(res.error).toBeNull();
      const parts = res.data as number[];
      expect(parts).toHaveLength(2);
      expect(parts.reduce((a, b) => a + b, 0)).toBe((await totals(tabId)).total_iqd);
      expect(parts[0]).toBe(6000);
      expect(parts[1]).toBe(4000);
    });

    it('allocates a whole-tab discount pro-rata and still sums exactly', async () => {
      const tabId = await openTab('split-discount');
      await addItem(tabId, itemA); // 6,000
      await addItem(tabId, itemB); // 4,000
      const ids = await liveItemIds(tabId);

      // 3,333 off a 10,000 bill: neither share divides evenly, which is where a
      // naive split loses or invents a dinar.
      await appRpc(manager, 'apply_discount', {
        p_tab_id: tabId,
        p_kind: 'discount_amount',
        p_value: 3333,
        p_pin: DEV_PINS.manager,
        p_reason_code: 'comp',
      });

      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [[ids[0]], [ids[1]]],
      });
      const parts = res.data as number[];
      const t = await totals(tabId);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(t.total_iqd);
      // Largest remainder favours the earliest group, as split_evenly does.
      expect(parts[0]).toBeGreaterThanOrEqual(parts[1]!);
    });

    it('spreads the court fee across the groups too', async () => {
      const courtId = await createTestCourt(svc, `Court split ${Date.now()}`);
      const start = new Date(Date.now() + 5 * 86_400_000);
      const { data: r } = await svc
        .from('reservations')
        .insert({
          court_id: courtId,
          kind: 'booking',
          status: 'confirmed',
          source: 'desk',
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + 3_600_000).toISOString(),
          guest_name: 'Split Court',
          price_iqd: 40_000,
        })
        .select('id')
        .single();

      const tabId = await openTab('split-court');
      await addItem(tabId, itemA);
      await addItem(tabId, itemB);
      await svc.from('tabs').update({ reservation_id: (r as { id: string }).id }).eq('id', tabId);
      const ids = await liveItemIds(tabId);

      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [[ids[0]], [ids[1]]],
      });
      const parts = res.data as number[];
      // "Settles courts and drinks in one payment" — split two ways, both
      // halves still cover the court between them.
      expect(parts.reduce((a, b) => a + b, 0)).toBe((await totals(tabId)).total_iqd);
    });

    it('refuses a partial assignment rather than returning parts that do not add up', async () => {
      const tabId = await openTab('split-partial');
      await addItem(tabId, itemA);
      await addItem(tabId, itemB);
      const ids = await liveItemIds(tabId);
      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [[ids[0]], []],
      });
      expect(res.error?.message).toBe('SPLIT_INCOMPLETE');
    });

    it('refuses the same item in two groups', async () => {
      const tabId = await openTab('split-dupe');
      await addItem(tabId, itemA);
      await addItem(tabId, itemB);
      const ids = await liveItemIds(tabId);
      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [[ids[0], ids[1]], [ids[0]]],
      });
      expect(res.error?.message).toBe('ITEM_ASSIGNED_TWICE');
    });

    it('refuses an item from another tab', async () => {
      const tabA = await openTab('split-other-a');
      await addItem(tabA, itemA);
      const tabB = await openTab('split-other-b');
      await addItem(tabB, itemB);
      const idsA = await liveItemIds(tabA);
      const idsB = await liveItemIds(tabB);
      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabA,
        p_groups: [[idsA[0]], [idsB[0]]],
      });
      expect(res.error?.message).toBe('ITEM_NOT_ON_TAB');
    });

    it('refuses fewer than two groups', async () => {
      const tabId = await openTab('split-one');
      await addItem(tabId, itemA);
      const ids = await liveItemIds(tabId);
      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: [ids],
      });
      expect(res.error?.message).toBe('INVALID_SPLIT_COUNT');
    });

    it('refuses a payload that is not an array of groups', async () => {
      const tabId = await openTab('split-junk');
      await addItem(tabId, itemA);
      const res = await appRpc(cashier, 'split_by_item', {
        p_tab_id: tabId,
        p_groups: { a: 1 },
      });
      expect(res.error?.message).toBe('INVALID_SPLIT');
    });

    it('is refused for an anonymous guest', async () => {
      const tabId = await openTab('split-guest');
      await addItem(tabId, itemA);
      const guest = await anonymousSessionClient();
      const res = await appRpc(guest, 'split_by_item', { p_tab_id: tabId, p_groups: [[], []] });
      expect(res.error?.message).toBe('FORBIDDEN');
    });
  });

  // -------------------------------------------------------------------------
  // Cash drawer record
  // -------------------------------------------------------------------------
  describe('app.record_drawer_open', () => {
    it('writes an audit row with the reason and the device', async () => {
      const res = await appRpc(cashier, 'record_drawer_open', {
        p_reason_code: 'other',
        p_device_id: 'TILL-TEST',
      });
      expect(res.error).toBeNull();

      const { data } = await svc
        .from('audit_log')
        .select('action, reason_code, device_id, actor_id')
        .eq('action', 'drawer.open')
        .order('id', { ascending: false })
        .limit(1)
        .single();
      const row = data as { reason_code: string; device_id: string; actor_id: string | null };
      expect(row.reason_code).toBe('other');
      expect(row.device_id).toBe('TILL-TEST');
      // An unexplained opening between sales is the thing day close exists to
      // surface, so it must name who did it.
      expect(row.actor_id).not.toBeNull();
    });

    it('requires a reason', async () => {
      const res = await appRpc(cashier, 'record_drawer_open', { p_reason_code: '  ' });
      expect(res.error?.message).toBe('REASON_REQUIRED');
    });

    it('is refused for an anonymous guest', async () => {
      const guest = await anonymousSessionClient();
      const res = await appRpc(guest, 'record_drawer_open', { p_reason_code: 'other' });
      expect(res.error?.message).toBe('FORBIDDEN');
    });
  });
});

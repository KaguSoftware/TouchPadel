/**
 * 0068 — reports and overviews (read-only jsonb, DB-D lane).
 *
 * Seeds a known fixture through the real RPCs — one confirmed desk booking on
 * a fresh court (padel revenue) and one till tab settled in cash (cafe
 * revenue) — then asserts the guards, the shapes and the arithmetic against
 * raw rows the service role can read. Every function must refuse a guest and
 * a cashier; the financial surfaces refuse a manager too. Staff activity is
 * activity and exceptions (spec 06.44): ordered by name, no rank anywhere.
 *
 * Runs against the live local stack; skips itself when the stack is down.
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
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  createTestCourt,
  createTestMenuItem,
  ensureTestRateRule,
  ensureOpenDay,
  ensureTillFresh,
  futureSlot,
} from './helpers';

const up = await stackAvailable();

type Figure = { key: string; value: number; previous: number | null; changeAbs: number | null; changePct: number | null };
type RevenueRow = {
  period: string; padelIqd: number; cafeIqd: number; totalIqd: number; cashIqd: number; cardIqd: number;
  discountsIqd: number; voidsIqd: number; refundsIqd: number; taxIqd: number; orders: number; bookings: number;
};
type Column = { key: string; labelEn: string; labelAr: string; kind: string };
type Drill = { id: string; at: string; kind: string; label: string; amountIqd: number; staffName: string | null; reference: string };

describe.skipIf(!up)('0068 reports and overviews', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient;

  let courtId: string;
  let item: Awaited<ReturnType<typeof createTestMenuItem>>;
  let reservationId: string;
  let reservationPrice: number;
  let tabId: string;
  let tabTotal: number;
  let today: string; // business date of the settled tab
  let bookingDay: string; // business date of the booking's slot
  let from: string;
  let to: string;
  let window: { ts_from: string; ts_to: string };

  const ITEM_PRICE = 7_000;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return iso(d);
  };
  const businessDate = async (at: Date) => {
    const { data, error } = await svc.schema('app').rpc('business_date', { p_at: at.toISOString() });
    if (error) throw new Error(error.message);
    return data as string;
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await anonymousSessionClient();

    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    await ensureTestRateRule(svc);

    // Padel side: a confirmed desk booking on its own court (its own hour, so
    // the exclusion constraint never bites).
    courtId = await createTestCourt(svc, `Reports ${Date.now()}`);
    const slot = futureSlot();
    const booked = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(60).toISOString(),
      p_guest_name: 'Reports Guest',
      p_idempotency_key: testIdemKey('reservation.create'),
    }).then(outcome);
    if (!booked.ok) throw new Error(`seed booking failed: ${booked.errorMessage}`);
    reservationId = (booked.data as { reservation_id: string }).reservation_id;
    const { data: r } = await svc.from('reservations').select('price_iqd, status').eq('id', reservationId).single();
    reservationPrice = Number((r as { price_iqd: number }).price_iqd);
    if ((r as { status: string }).status !== 'confirmed') throw new Error('seed booking is not confirmed');
    bookingDay = await businessDate(slot.start);

    // Cafe side: a till tab with one item, settled in cash.
    item = await createTestMenuItem(svc, 'reports', ITEM_PRICE);
    const opened = await appRpc(cashier, 'open_tab', {
      p_label: 'reports-tab',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    if (!opened.ok) throw new Error(`seed open_tab failed: ${opened.errorMessage}`);
    tabId = (opened.data as { tab_id: string }).tab_id;
    const added = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    if (!added.ok) throw new Error(`seed till_add_items failed: ${added.errorMessage}`);
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 10_000,
      p_idempotency_key: testIdemKey('payment.record'),
    }).then(outcome);
    if (!settled.ok) throw new Error(`seed settle_tab failed: ${settled.errorMessage}`);
    const { data: t } = await svc.from('tabs').select('total_iqd, court_iqd, settled_at').eq('id', tabId).single();
    const tab = t as { total_iqd: number; court_iqd: number; settled_at: string };
    tabTotal = Number(tab.total_iqd) - Number(tab.court_iqd);
    today = await businessDate(new Date(tab.settled_at));

    // One range that holds both the tab (today) and the booking (a week out).
    from = shift(today < bookingDay ? today : bookingDay, -1);
    to = shift(today > bookingDay ? today : bookingDay, 1);
    const bounds = await svc.schema('app').rpc('analytics_bounds', { p_from: from, p_to: to });
    if (bounds.error) throw new Error(bounds.error.message);
    const b = (Array.isArray(bounds.data) ? bounds.data[0] : bounds.data) as { ts_from: string; ts_to: string };
    window = { ts_from: b.ts_from, ts_to: b.ts_to };
  });

  afterAll(async () => {
    await Promise.all([owner, manager, cashier, desk, guest].map((c) => c?.auth.signOut()));
  });

  // -------------------------------------------------------------------------
  // Guards — the role check is the first statement of every function.
  // -------------------------------------------------------------------------
  const surfaces = (): [string, Record<string, unknown>, 'manager' | 'owner'][] => [
    ['ops_overview', {}, 'manager'],
    ['panel_headline', { p_from: from, p_to: to, p_compare: 'none' }, 'owner'],
    ['report_revenue', { p_from: from, p_to: to, p_group: 'day', p_filters: {} }, 'owner'],
    ['report_courts', { p_from: from, p_to: to, p_filters: {} }, 'manager'],
    ['report_cafe', { p_from: from, p_to: to, p_filters: {} }, 'manager'],
    ['report_stock', { p_from: from, p_to: to, p_filters: {} }, 'manager'],
    ['report_staff_activity', { p_from: from, p_to: to, p_staff_id: null }, 'manager'],
    ['report_drill', { p_figure: 'discounts', p_key: null, p_from: from, p_to: to }, 'manager'],
    ['audit_log_page', { p_from: null, p_to: null, p_actor_id: null, p_action_prefix: null, p_limit: 5, p_offset: 0 }, 'manager'],
  ];

  it('refuses a guest and a cashier on every surface, with NULL arguments too', async () => {
    for (const [fn, args] of surfaces()) {
      const g = await appRpc(guest, fn, args).then(outcome);
      expect(g.errorMessage, `${fn} as guest`).toContain('FORBIDDEN');
      const c = await appRpc(cashier, fn, args).then(outcome);
      expect(c.errorMessage, `${fn} as cashier`).toContain('FORBIDDEN');
      // Guard before argument validation: nulls must still be refused.
      const nulls = Object.fromEntries(Object.keys(args).map((k) => [k, null]));
      const gn = await appRpc(guest, fn, nulls).then(outcome);
      expect(gn.errorMessage, `${fn} as guest with nulls`).toContain('FORBIDDEN');
    }
  });

  it('owner-only surfaces refuse a manager; the rest admit manager and owner', async () => {
    for (const [fn, args, minRole] of surfaces()) {
      const m = await appRpc(manager, fn, args).then(outcome);
      if (minRole === 'owner') {
        expect(m.errorMessage, `${fn} as manager`).toContain('FORBIDDEN');
      } else {
        expect(m.ok, `${fn} as manager: ${m.errorMessage}`).toBe(true);
      }
      const o = await appRpc(owner, fn, args).then(outcome);
      expect(o.ok, `${fn} as owner: ${o.errorMessage}`).toBe(true);
    }
  });

  it('internal helpers are not client-callable', async () => {
    for (const [fn, args] of [
      ['reports_guard', { p_owner_only: false }],
      ['reports_figures', { p_from: from, p_to: to }],
      ['reports_available_minutes', { p_from: from, p_to: to }],
      ['reports_bucket', { p_d: from, p_group: 'day' }],
      ['reports_parse_scope', { p_text: 'x' }],
    ] as [string, Record<string, unknown>][]) {
      const res = await appRpc(owner, fn, args);
      expect(res.error?.message, fn).toMatch(/permission denied|not find/i);
    }
  });

  // -------------------------------------------------------------------------
  // ops_overview
  // -------------------------------------------------------------------------
  it('ops_overview carries every contracted key and the seeded tab shows on the open day', async () => {
    const res = await appRpc(manager, 'ops_overview', {}).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const o = res.data as Record<string, Record<string, unknown>> & { staffActivity: Record<string, unknown>[] };

    expect(Object.keys(o.bookings!).sort()).toEqual(
      ['arrived', 'cancelledToday', 'nextArrival', 'noShows', 'today', 'upcoming'].sort(),
    );
    expect(Object.keys(o.cafe!).sort()).toEqual(
      ['openTabs', 'ordersToday', 'ticketsLate', 'ticketsPreparing', 'ticketsQueued', 'waiterCallsOpen'].sort(),
    );
    expect(Object.keys(o.stock!).sort()).toEqual(
      ['belowPar', 'expired', 'expiringSoon', 'lastCountAt', 'low', 'openAlerts'].sort(),
    );
    expect(Object.keys(o.exceptions!).sort()).toEqual(['discounts', 'refunds', 'voids', 'waste']);
    for (const k of ['discounts', 'refunds', 'voids'] as const) {
      expect(Object.keys((o.exceptions as Record<string, object>)[k]!).sort()).toEqual(['amountIqd', 'count']);
    }
    expect(Object.keys((o.exceptions as Record<string, object>).waste!).sort()).toEqual(['costIqd', 'count']);
    expect(Object.keys(o.dayClose!).sort()).toEqual(
      ['blockingTabs', 'businessDate', 'expectedCashIqd', 'open', 'openedAt', 'openingFloatIqd'].sort(),
    );
    expect(Array.isArray(o.staffActivity)).toBe(true);
    for (const row of o.staffActivity) {
      expect(Object.keys(row).sort()).toEqual(
        ['bookingsCreated', 'name', 'ordersTaken', 'paymentsTaken', 'role', 'staffId'].sort(),
      );
    }
    // Ordered by name, never by volume.
    const names = o.staffActivity.map((r) => r.name as string);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // A day is open (ensureOpenDay) and its expected cash is float + cash in - cash refunds.
    expect(o.dayClose!.open).toBe(true);
    expect(typeof o.dayClose!.expectedCashIqd).toBe('number');
    expect(Number.isInteger(o.dayClose!.expectedCashIqd)).toBe(true);
    expect(Array.isArray(o.dayClose!.blockingTabs)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // panel_headline
  // -------------------------------------------------------------------------
  it('panel_headline: revenue = padel + cafe, both include the fixture, cash reconciles with payments - refunds', async () => {
    const res = await appRpc(owner, 'panel_headline', { p_from: from, p_to: to, p_compare: 'none' }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { period: { from: string; to: string }; comparison: null; figures: Figure[] };
    expect(d.period).toEqual({ from, to });
    expect(d.comparison).toBeNull();

    const byKey = Object.fromEntries(d.figures.map((f) => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(
      ['avgOrderValue', 'bookings', 'cafeRevenue', 'card', 'cash', 'discounts', 'noShows', 'orders', 'padelRevenue', 'refunds', 'revenue', 'waste'].sort(),
    );
    for (const f of d.figures) {
      expect(Number.isInteger(f.value), f.key).toBe(true);
      expect(f.previous, f.key).toBeNull();
      expect(f.changeAbs, f.key).toBeNull();
      expect(f.changePct, f.key).toBeNull();
    }

    expect(byKey.revenue!.value).toBe(byKey.padelRevenue!.value + byKey.cafeRevenue!.value);
    expect(byKey.padelRevenue!.value).toBeGreaterThanOrEqual(reservationPrice);
    expect(byKey.cafeRevenue!.value).toBeGreaterThanOrEqual(tabTotal);
    expect(byKey.bookings!.value).toBeGreaterThanOrEqual(1);
    expect(byKey.orders!.value).toBeGreaterThanOrEqual(1);
    expect(byKey.avgOrderValue!.value).toBe(Math.round(byKey.cafeRevenue!.value / byKey.orders!.value));

    // Raw truth for the same window (service role): every payment / refund.
    const { data: pays } = await svc
      .from('payments').select('id, amount_iqd, method')
      .gte('created_at', window.ts_from).lt('created_at', window.ts_to);
    const payRows = (pays ?? []) as { id: string; amount_iqd: number; method: string }[];
    const { data: refs } = await svc
      .from('refunds').select('amount_iqd, payment_id')
      .gte('created_at', window.ts_from).lt('created_at', window.ts_to);
    const refRows = (refs ?? []) as { amount_iqd: number; payment_id: string }[];
    const paid = (m: string) => payRows.filter((p) => p.method === m).reduce((s, p) => s + Number(p.amount_iqd), 0);
    const refunded = (m: string) =>
      refRows.filter((r) => payRows.find((p) => p.id === r.payment_id)?.method === m).reduce((s, r) => s + Number(r.amount_iqd), 0);
    expect(byKey.cash!.value).toBe(paid('cash') - refunded('cash'));
    expect(byKey.card!.value).toBe(paid('card') - refunded('card'));
    expect(byKey.cash!.value).toBeGreaterThanOrEqual(tabTotal);
  });

  it('panel_headline comparison: previousPeriod / sameLastYear windows, changeAbs arithmetic, changePct null on zero', async () => {
    const len = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
    const prev = await appRpc(owner, 'panel_headline', { p_from: from, p_to: to, p_compare: 'previousPeriod' }).then(outcome);
    expect(prev.ok, prev.errorMessage).toBe(true);
    const p = prev.data as { comparison: { from: string; to: string }; figures: Figure[] };
    expect(p.comparison).toEqual({ from: shift(from, -len), to: shift(from, -1) });
    for (const f of p.figures) {
      expect(typeof f.previous, f.key).toBe('number');
      expect(f.changeAbs, f.key).toBe(f.value - (f.previous as number));
      if ((f.previous as number) === 0) expect(f.changePct, f.key).toBeNull();
      else expect(Number(f.changePct)).toBeCloseTo(((f.value - (f.previous as number)) * 100) / (f.previous as number), 0);
    }

    const ly = await appRpc(owner, 'panel_headline', { p_from: from, p_to: to, p_compare: 'sameLastYear' }).then(outcome);
    expect(ly.ok, ly.errorMessage).toBe(true);
    const c = (ly.data as { comparison: { from: string; to: string } }).comparison;
    expect(c.from.slice(5)).toBe(from.slice(5));
    expect(Number(c.from.slice(0, 4))).toBe(Number(from.slice(0, 4)) - 1);

    const bad = await appRpc(owner, 'panel_headline', { p_from: from, p_to: to, p_compare: 'lastWeek' }).then(outcome);
    expect(bad.errorMessage).toContain('INVALID_ARGUMENT');
    const inverted = await appRpc(owner, 'panel_headline', { p_from: to, p_to: from, p_compare: 'none' }).then(outcome);
    expect(inverted.errorMessage).toContain('INVALID_RANGE');
  });

  // -------------------------------------------------------------------------
  // report_revenue
  // -------------------------------------------------------------------------
  it('report_revenue groups by day; totals equal the sum of the rows; the fixture lands on its days', async () => {
    const res = await appRpc(owner, 'report_revenue', { p_from: from, p_to: to, p_group: 'day', p_filters: {} }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { columns: Column[]; rows: RevenueRow[]; totals: Record<string, number>; comparison: null };

    expect(d.comparison).toBeNull();
    expect(d.columns.map((c) => c.key)).toEqual([
      'period', 'padelIqd', 'cafeIqd', 'totalIqd', 'cashIqd', 'cardIqd',
      'discountsIqd', 'voidsIqd', 'refundsIqd', 'taxIqd', 'orders', 'bookings',
    ]);
    for (const c of d.columns) {
      expect(['date', 'money', 'count', 'text', 'pct']).toContain(c.kind);
      expect(c.labelAr.length).toBeGreaterThan(0);
    }

    const numeric = d.columns.map((c) => c.key).filter((k) => k !== 'period') as (keyof RevenueRow)[];
    for (const k of numeric) {
      const sum = d.rows.reduce((s, r) => s + Number(r[k]), 0);
      expect(Number(d.totals[k]), k).toBe(sum);
    }
    for (const r of d.rows) {
      expect(r.period >= from && r.period <= to, r.period).toBe(true);
      expect(Number(r.totalIqd)).toBe(Number(r.padelIqd) + Number(r.cafeIqd));
    }
    expect(d.rows.map((r) => r.period)).toEqual([...d.rows.map((r) => r.period)].sort());

    const tabDay = d.rows.find((r) => r.period === today)!;
    expect(tabDay, `no row for ${today}`).toBeDefined();
    expect(Number(tabDay.cafeIqd)).toBeGreaterThanOrEqual(tabTotal);
    expect(Number(tabDay.cashIqd)).toBeGreaterThanOrEqual(tabTotal);
    expect(Number(tabDay.orders)).toBeGreaterThanOrEqual(1);
    const bookDay = d.rows.find((r) => r.period === bookingDay)!;
    expect(bookDay, `no row for ${bookingDay}`).toBeDefined();
    expect(Number(bookDay.padelIqd)).toBeGreaterThanOrEqual(reservationPrice);
    expect(Number(bookDay.bookings)).toBeGreaterThanOrEqual(1);
  });

  it('report_revenue: week / month buckets keep the same totals; filters narrow; bad arguments refused', async () => {
    const day = await appRpc(owner, 'report_revenue', { p_from: from, p_to: to, p_group: 'day', p_filters: {} }).then(outcome);
    const week = await appRpc(owner, 'report_revenue', { p_from: from, p_to: to, p_group: 'week', p_filters: {} }).then(outcome);
    const month = await appRpc(owner, 'report_revenue', { p_from: from, p_to: to, p_group: 'month', p_filters: {} }).then(outcome);
    const totals = (r: typeof day) => (r.data as { totals: Record<string, number> }).totals;
    expect(totals(week)).toEqual(totals(day));
    expect(totals(month)).toEqual(totals(day));
    const monthRows = (month.data as { rows: RevenueRow[] }).rows;
    for (const r of monthRows) expect(r.period.endsWith('-01')).toBe(true);

    const card = await appRpc(owner, 'report_revenue', {
      p_from: from, p_to: to, p_group: 'day', p_filters: { paymentMethod: 'card' },
    }).then(outcome);
    expect(card.ok, card.errorMessage).toBe(true);
    expect(Number(totals(card).cashIqd)).toBe(0);

    const byCashier = await appRpc(owner, 'report_revenue', {
      p_from: from, p_to: to, p_group: 'day', p_filters: { staffId: SEED_STAFF_IDS.cashier },
    }).then(outcome);
    expect(byCashier.ok, byCashier.errorMessage).toBe(true);
    expect(Number(totals(byCashier).cafeIqd)).toBeGreaterThanOrEqual(tabTotal);
    expect(Number(totals(byCashier).cafeIqd)).toBeLessThanOrEqual(Number(totals(day).cafeIqd));

    const badGroup = await appRpc(owner, 'report_revenue', { p_from: from, p_to: to, p_group: 'year', p_filters: {} }).then(outcome);
    expect(badGroup.errorMessage).toContain('INVALID_ARGUMENT');
    const badMethod = await appRpc(owner, 'report_revenue', {
      p_from: from, p_to: to, p_group: 'day', p_filters: { paymentMethod: 'gold' },
    }).then(outcome);
    expect(badMethod.errorMessage).toContain('INVALID_ARGUMENT');
  });

  // -------------------------------------------------------------------------
  // report_courts / report_cafe / report_stock
  // -------------------------------------------------------------------------
  it('report_courts: the fixture court shows its booking, available minutes come from opening hours, byHour has 24 buckets', async () => {
    const res = await appRpc(manager, 'report_courts', { p_from: from, p_to: to, p_filters: { courtId } }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type CourtRow = Record<string, number | string | null>;
    const d = res.data as { rows: CourtRow[]; totals: CourtRow; byHour: { hour: number; bookings: number }[]; trend: { date: string; bookings: number; revenueIqd: number }[] };
    expect(d.rows).toHaveLength(1);
    const row = d.rows[0]!;
    expect(row.courtId).toBe(courtId);
    expect(Number(row.bookings)).toBe(1);
    expect(Number(row.bookedMinutes)).toBe(60);
    expect(Number(row.revenueIqd)).toBe(reservationPrice);
    expect(Number(row.availableMinutes)).toBeGreaterThan(0);
    expect(Number(row.occupancyPct)).toBeCloseTo((60 * 100) / Number(row.availableMinutes), 1);
    expect(Number(row.peakBookings) + Number(row.offPeakBookings)).toBe(1);
    expect(Number(row.cancellations)).toBe(0);
    expect(Number(row.noShows)).toBe(0);
    expect(Number(row.cancellationRatePct)).toBe(0);
    expect(d.byHour).toHaveLength(24);
    expect(d.byHour.reduce((s, h) => s + h.bookings, 0)).toBe(1);
    expect(d.trend.find((t) => t.date === bookingDay)?.bookings).toBe(1);
  });

  it('report_cafe: the settled item is a row with qty, revenue and null (never 0) cogs when it has no recipe', async () => {
    const res = await appRpc(manager, 'report_cafe', { p_from: from, p_to: to, p_filters: { categoryId: item.categoryId } }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type CafeRow = { itemId: string; qty: number; revenueIqd: number; cogsIqd: number | null; grossProfitIqd: number | null; marginPct: number | null; categoryNameAr: string };
    const d = res.data as {
      rows: CafeRow[];
      summary: { orders: number; avgOrderValueIqd: number; revenueIqd: number; cogsIqd: number; grossProfitIqd: number; marginPct: number | null };
      byCategory: { categoryId: string; revenueIqd: number }[];
      wasteByReason: { reason: string; qty: number; costIqd: number }[];
      prepTimes: { avgSeconds: number | null; p90Seconds: number | null; count: number };
    };
    const mine = d.rows.find((r) => r.itemId === item.itemId)!;
    expect(mine).toBeDefined();
    expect(Number(mine.qty)).toBe(1);
    expect(Number(mine.revenueIqd)).toBe(ITEM_PRICE);
    expect(mine.cogsIqd).toBeNull();
    expect(mine.grossProfitIqd).toBeNull();
    expect(mine.marginPct).toBeNull();
    expect(mine.categoryNameAr.length).toBeGreaterThan(0);
    expect(d.summary.revenueIqd).toBe(ITEM_PRICE);
    expect(d.byCategory.find((c) => c.categoryId === item.categoryId)?.revenueIqd).toBe(ITEM_PRICE);
    expect(Array.isArray(d.wasteByReason)).toBe(true);
    expect(Object.keys(d.prepTimes).sort()).toEqual(['avgSeconds', 'count', 'p90Seconds']);
  });

  it('report_stock: value on hand, the five lists and the ranged sections are present', async () => {
    const res = await appRpc(manager, 'report_stock', { p_from: from, p_to: to, p_filters: {} }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as Record<string, unknown>;
    expect(Object.keys(d).sort()).toEqual(
      ['belowPar', 'comparison', 'consumption', 'expired', 'expiringSoon', 'lowStock', 'period', 'stockValueIqd', 'variance'].sort(),
    );
    expect(Number.isInteger(d.stockValueIqd)).toBe(true);
    for (const k of ['lowStock', 'belowPar', 'expiringSoon', 'expired', 'consumption', 'variance']) {
      expect(Array.isArray(d[k]), k).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // report_staff_activity — activity and exceptions, no ranking
  // -------------------------------------------------------------------------
  it('report_staff_activity: rows ordered by name, no rank/score field, the fixture actions attributed', async () => {
    const res = await appRpc(manager, 'report_staff_activity', { p_from: from, p_to: to, p_staff_id: null }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    type StaffRow = {
      staffId: string; name: string; role: string; ordersTaken: number; bookingsCreated: number; paymentsTaken: number;
      discounts: { count: number; amountIqd: number }; voids: { count: number; amountIqd: number };
      refunds: { count: number; amountIqd: number }; waiterCallResponse: { count: number; avgSeconds: number | null };
      dayCloses: { businessDate: string; cashVarianceIqd: number }[]; shiftContext: { daysWorked: number; busiestDayOrders: number };
    };
    const rows = (res.data as { rows: StaffRow[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const names = rows.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const banned = /rank|score|leaderboard|position/i;
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { expect(k).not.toMatch(banned); walk(x); }
    };
    walk(res.data);

    const cashierRow = rows.find((r) => r.staffId === SEED_STAFF_IDS.cashier)!;
    expect(cashierRow).toBeDefined();
    expect(cashierRow.paymentsTaken).toBeGreaterThanOrEqual(1);
    expect(cashierRow.ordersTaken).toBeGreaterThanOrEqual(1);
    expect(cashierRow.shiftContext.daysWorked).toBeGreaterThanOrEqual(1);
    expect(cashierRow.shiftContext.busiestDayOrders).toBeGreaterThanOrEqual(1);
    const deskRow = rows.find((r) => r.staffId === SEED_STAFF_IDS.court_desk)!;
    expect(deskRow.bookingsCreated).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(Object.keys(r.discounts).sort()).toEqual(['amountIqd', 'count']);
      expect(Object.keys(r.waiterCallResponse).sort()).toEqual(['avgSeconds', 'count']);
      expect(Array.isArray(r.dayCloses)).toBe(true);
    }

    const one = await appRpc(manager, 'report_staff_activity', { p_from: from, p_to: to, p_staff_id: SEED_STAFF_IDS.cashier }).then(outcome);
    expect((one.data as { rows: StaffRow[] }).rows.map((r) => r.staffId)).toEqual([SEED_STAFF_IDS.cashier]);
  });

  // -------------------------------------------------------------------------
  // report_drill
  // -------------------------------------------------------------------------
  it('report_drill: cafeRevenue returns the settled tab; padelRevenue the booking; scopes narrow; owner-only for money', async () => {
    const cafe = await appRpc(owner, 'report_drill', { p_figure: 'cafeRevenue', p_key: null, p_from: from, p_to: to }).then(outcome);
    expect(cafe.ok, cafe.errorMessage).toBe(true);
    const tx = (cafe.data as { transactions: Drill[] }).transactions;
    const mine = tx.find((t) => t.id === tabId)!;
    expect(mine, 'settled tab missing from cafeRevenue drill').toBeDefined();
    expect(mine.kind).toBe('tab');
    expect(Number(mine.amountIqd)).toBe(tabTotal);
    expect(mine.staffName).toBe('Dev Cashier');
    for (const t of tx) expect(Object.keys(t).sort()).toEqual(['amountIqd', 'at', 'id', 'kind', 'label', 'reference', 'staffId', 'staffName']);
    expect(tx.length).toBeLessThanOrEqual(500);
    // Newest first.
    for (let i = 1; i < tx.length; i++) expect(tx[i - 1]!.at >= tx[i]!.at).toBe(true);

    const padel = await appRpc(owner, 'report_drill', { p_figure: 'padelRevenue', p_key: `court:${courtId}`, p_from: from, p_to: to }).then(outcome);
    expect(padel.ok, padel.errorMessage).toBe(true);
    const ptx = (padel.data as { transactions: Drill[] }).transactions;
    expect(ptx.map((t) => t.id)).toEqual([reservationId]);
    expect(ptx[0]!.kind).toBe('reservation');
    expect(Number(ptx[0]!.amountIqd)).toBe(reservationPrice);

    const cash = await appRpc(owner, 'report_drill', { p_figure: 'cash', p_key: `staff:${SEED_STAFF_IDS.cashier}`, p_from: from, p_to: to }).then(outcome);
    expect(cash.ok, cash.errorMessage).toBe(true);
    const ctx = (cash.data as { transactions: Drill[] }).transactions;
    expect(ctx.some((t) => t.kind === 'payment' && t.reference === tabId && Number(t.amountIqd) === tabTotal)).toBe(true);

    const byItem = await appRpc(manager, 'report_drill', { p_figure: `item:${item.itemId}`, p_key: null, p_from: from, p_to: to }).then(outcome);
    expect(byItem.ok, byItem.errorMessage).toBe(true);
    const itx = (byItem.data as { transactions: Drill[] }).transactions;
    expect(itx.some((t) => t.reference === tabId && Number(t.amountIqd) === ITEM_PRICE)).toBe(true);

    const byCourt = await appRpc(manager, 'report_drill', { p_figure: `court:${courtId}`, p_key: null, p_from: from, p_to: to }).then(outcome);
    expect((byCourt.data as { transactions: Drill[] }).transactions.map((t) => t.id)).toEqual([reservationId]);

    for (const fig of ['revenue', 'padelRevenue', 'cafeRevenue', 'cash', 'card']) {
      const m = await appRpc(manager, 'report_drill', { p_figure: fig, p_key: null, p_from: from, p_to: to }).then(outcome);
      expect(m.errorMessage, `${fig} as manager`).toContain('FORBIDDEN');
    }
    for (const fig of ['discounts', 'refunds', 'voids', 'waste', 'noShows', 'bookings', 'orders']) {
      const m = await appRpc(manager, 'report_drill', { p_figure: fig, p_key: null, p_from: from, p_to: to }).then(outcome);
      expect(m.ok, `${fig} as manager: ${m.errorMessage}`).toBe(true);
    }
    const bad = await appRpc(owner, 'report_drill', { p_figure: 'profit', p_key: null, p_from: from, p_to: to }).then(outcome);
    expect(bad.errorMessage).toContain('INVALID_ARGUMENT');
    const badKey = await appRpc(owner, 'report_drill', { p_figure: 'bookings', p_key: 'table:1', p_from: from, p_to: to }).then(outcome);
    expect(badKey.errorMessage).toContain('INVALID_ARGUMENT');
  });

  // -------------------------------------------------------------------------
  // audit_log_page
  // -------------------------------------------------------------------------
  it('audit_log_page: filters by actor and action prefix server-side, names the actor, pages with a total', async () => {
    const all = await appRpc(manager, 'audit_log_page', {
      p_from: window.ts_from, p_to: window.ts_to, p_actor_id: null, p_action_prefix: 'tab.', p_limit: 50, p_offset: 0,
    }).then(outcome);
    expect(all.ok, all.errorMessage).toBe(true);
    type AuditRow = { id: number; at: string; actorId: string | null; actorName: string | null; authorizerName: string | null; action: string; entityId: string };
    const d = all.data as { rows: AuditRow[]; total: number };
    expect(d.total).toBeGreaterThanOrEqual(d.rows.length);
    expect(d.rows.length).toBeGreaterThanOrEqual(1);
    for (const r of d.rows) expect(r.action.startsWith('tab.')).toBe(true);
    const settle = d.rows.find((r) => r.entityId === tabId && r.action === 'tab.settle');
    expect(settle, 'tab.settle audit row for the fixture tab').toBeDefined();
    expect(settle!.actorName).toBe('Dev Cashier');
    for (let i = 1; i < d.rows.length; i++) expect(d.rows[i - 1]!.at >= d.rows[i]!.at).toBe(true);

    const byActor = await appRpc(manager, 'audit_log_page', {
      p_from: null, p_to: null, p_actor_id: SEED_STAFF_IDS.cashier, p_action_prefix: null, p_limit: 20, p_offset: 0,
    }).then(outcome);
    expect(byActor.ok, byActor.errorMessage).toBe(true);
    expect((byActor.data as { rows: AuditRow[] }).rows.every((r) => r.actorName === 'Dev Cashier' || r.authorizerName === 'Dev Cashier')).toBe(true);

    const page1 = await appRpc(manager, 'audit_log_page', { p_from: null, p_to: null, p_limit: 1, p_offset: 0 }).then(outcome);
    const page2 = await appRpc(manager, 'audit_log_page', { p_from: null, p_to: null, p_limit: 1, p_offset: 1 }).then(outcome);
    const r1 = (page1.data as { rows: AuditRow[]; total: number });
    const r2 = (page2.data as { rows: AuditRow[]; total: number });
    expect(r1.rows).toHaveLength(1);
    expect(r2.rows).toHaveLength(1);
    expect(r1.rows[0]!.id).not.toBe(r2.rows[0]!.id);
    expect(r1.total).toBe(r2.total);

    const bad = await appRpc(manager, 'audit_log_page', { p_from: null, p_to: null, p_limit: 0, p_offset: 0 }).then(outcome);
    expect(bad.errorMessage).toContain('INVALID_ARGUMENT');
  });
});

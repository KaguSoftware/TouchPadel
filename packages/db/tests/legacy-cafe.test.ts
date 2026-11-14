/**
 * 0412/0413 legacy café history on the stack: the rows migration 0413 loaded
 * are the files' rows; the view gives one figure per day by its rule; the
 * owner reads them and nobody else does; and the old till's days count once in
 * analytics_daily_sales, analytics_hourly and the management panel, with the
 * history named. The source side is tests/legacy-cafe-source.test.ts.
 *
 * Other tests settle café tabs on the stack, so a figure that mixes the old
 * till with the system is asserted as "at least the old till's", and the old
 * till's own part (old_till_iqd, history.period.cafe) exactly.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayFigures, readHistory } from '../scripts/lib/legacy-cafe.mjs';
import {
  anonClient, appRpc, outcome, SEED_STAFF, serviceClient, signedInClient, stackAvailable, VENUE_A_ID,
} from './helpers';

const up = await stackAvailable();
const { hours, items, products } = readHistory();
const days = dayFigures(hours);
const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
const between = (from: string, to: string) => days.filter((d) => d.day >= from && d.day <= to);

type Row = Record<string, unknown>;

describe.skipIf(!up)('0412 legacy café history', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
  });

  afterAll(async () => {
    await owner?.auth.signOut();
    await manager?.auth.signOut();
  });

  const rpc = async (name: string, args: Row) => {
    const res = await appRpc(owner, name, args).then(outcome);
    expect(res.ok, `${name}: ${res.errorMessage}`).toBe(true);
    return res.data as unknown;
  };
  const daily = async (from: string, to: string) => (await rpc('analytics_daily_sales', { p_from: from, p_to: to })) as Row[];

  it('migration 0413 loaded every row of the three files, and no other', async () => {
    for (const [table, want] of [['legacy_cafe_hours', hours.length], ['legacy_cafe_item_days', items.length], ['legacy_cafe_products', products.length]] as const) {
      const { count, error } = await svc.from(table).select('*', { count: 'exact', head: true }).eq('venue_id', VENUE_A_ID);
      expect(error).toBeNull();
      expect(count, table).toBe(want);
    }
    const { data } = await svc.from('legacy_cafe_hours').select('*').eq('venue_id', VENUE_A_ID).eq('day', '2026-06-28').order('hour');
    const want = hours.filter((h) => h.day === '2026-06-28').map((h) => ({ venue_id: VENUE_A_ID, ...h }));
    expect(data).toEqual(want);
  });

  it('the view gives each day by its rule: the fuller gross, received plus what the orders report lacks', async () => {
    const { data, error } = await svc.from('legacy_cafe_days').select('*').eq('venue_id', VENUE_A_ID).order('day');
    expect(error).toBeNull();
    expect(data).toEqual(days.map((d) => ({ venue_id: VENUE_A_ID, ...d })));
    const of = (day: string) => data!.find((d) => d.day === day)!;
    // 3 June: the items report misses lines, the orders report is the fuller one.
    expect(of('2026-06-03')).toMatchObject({ gross_iqd: 1_043_000, has_orders_export: true });
    // 30 August: the monthly orders report was cut before the day's last orders.
    expect(of('2026-08-30')).toMatchObject({ gross_iqd: 796_250, orders: 220, has_orders_export: true });
    // October: no orders report, so the discounts are unknown and net is the gross.
    expect(of('2026-10-01')).toMatchObject({ gross_iqd: 1_129_250, net_iqd: 1_129_250, discount_iqd: null, has_orders_export: false });
  });

  it('only the owner reads them; nobody writes them', async () => {
    for (const table of ['legacy_cafe_hours', 'legacy_cafe_item_days', 'legacy_cafe_products', 'legacy_cafe_days']) {
      const own = await owner.from(table).select('venue_id').limit(1);
      expect(own.error, table).toBeNull();
      expect(own.data, table).toHaveLength(1);
      const mgr = await manager.from(table).select('venue_id').limit(1);
      expect(mgr.data ?? [], table).toEqual([]);
      const anon = await anonClient().from(table).select('venue_id').limit(1);
      expect(anon.data ?? [], table).toEqual([]);
    }
    const w = await owner.from('legacy_cafe_hours').insert({
      venue_id: VENUE_A_ID, day: '2001-01-01', hour: 1, item_lines: 0, units: 0, items_gross_iqd: 0, tickets: 0,
    });
    expect(w.error).not.toBeNull();
  });

  it('the orders columns are all known or all unknown', async () => {
    const r = await svc.from('legacy_cafe_hours').insert({
      venue_id: VENUE_A_ID, day: '2001-01-01', hour: 1, item_lines: 0, units: 0, items_gross_iqd: 0, tickets: 0, orders: 1,
    });
    expect(r.error?.message ?? '').toContain('legacy_cafe_hours_orders_chk');
  });

  it('analytics_daily_sales: an old-till day is a row, its part named, cash and card untouched', async () => {
    const rows = await daily('2026-09-28', '2026-10-02');
    const by = new Map(rows.map((r) => [r.business_date as string, r]));
    for (const d of between('2026-09-28', '2026-10-02')) {
      const r = by.get(d.day)!;
      expect(r, d.day).toBeDefined();
      expect(r.old_till_iqd, d.day).toBe(d.net_iqd);
      expect(r.old_till_discount_known, d.day).toBe(d.has_orders_export);
      expect(r.revenue_iqd as number).toBeGreaterThanOrEqual(d.net_iqd);
      expect(r.cafe_gross_iqd as number).toBeGreaterThanOrEqual(d.gross_iqd);
      expect(r.orders as number).toBeGreaterThanOrEqual(d.orders);
      expect(r.tabs_settled as number).toBeGreaterThanOrEqual(d.orders);
      expect(r.items_qty as number).toBeGreaterThanOrEqual(d.units);
      expect(r.discount_iqd as number).toBeGreaterThanOrEqual(d.discount_iqd ?? 0);
    }
    // A whole month: the old till's part is exact.
    const july = await daily('2026-07-01', '2026-07-31');
    expect(sum(july, (r) => r.old_till_iqd as number)).toBe(sum(between('2026-07-01', '2026-07-31'), (d) => d.net_iqd));
    expect(sum(july, (r) => r.old_till_iqd as number)).toBe(26_997_618);
  });

  it('analytics_daily_sales: a day after the old till carries no old-till money', async () => {
    const rows = await daily('2026-11-01', '2026-11-07');
    for (const r of rows) {
      expect(r.old_till_iqd).toBe(0);
      expect(r.old_till_discount_known).toBeNull();
    }
  });

  it('analytics_hourly: the old till\'s hours are in the weekday-by-hour cells', async () => {
    const cells = (await rpc('analytics_hourly', { p_from: '2026-10-01', p_to: '2026-10-31' })) as Row[];
    const oct = hours.filter((h) => h.day.startsWith('2026-10'));
    expect(sum(cells, (c) => c.revenue_iqd as number)).toBeGreaterThanOrEqual(sum(oct, (h) => h.items_gross_iqd));
    expect(sum(cells, (c) => c.qty as number)).toBeGreaterThanOrEqual(sum(oct, (h) => h.units));
    // Thursday 1 October 2026, 18:00: dow 4.
    const want = oct.filter((h) => new Date(`${h.day}T12:00:00Z`).getUTCDay() === 4 && h.hour === 18);
    const cell = cells.find((c) => c.dow === 4 && c.hour === 18)!;
    expect(cell.revenue_iqd as number).toBeGreaterThanOrEqual(sum(want, (h) => h.items_gross_iqd));
  });

  it('panel_headline: café figures include the old till day by day, and history says how much', async () => {
    const d = (await rpc('panel_headline', { p_from: '2026-08-01', p_to: '2026-08-31', p_compare: 'previousPeriod' })) as {
      figures: { key: string; value: number; previous: number | null }[];
      history: { period: Row & { cafe: Row }; comparison: Row & { cafe: Row } };
    };
    const aug = between('2026-08-01', '2026-08-31');
    expect(d.history.period.cafe).toEqual({
      days: 29, from: '2026-08-01', to: '2026-08-31', gross: 20_813_500, discounts: 387_614, net: 20_425_889,
      orders: sum(aug, (x) => x.orders), units: sum(aug, (x) => x.units), discountUnknownDays: 1,
    });
    // previousPeriod of 1-31 August is 1-31 July.
    expect(d.history.comparison.cafe).toMatchObject({ days: 31, gross: 27_401_500, net: 26_997_618 });
    // The padel reports' part is untouched.
    expect(d.history.period.included).toEqual([expect.objectContaining({ from: '2026-08-01', revenue: 5_087_250 })]);
    const fig = (k: string) => d.figures.find((f) => f.key === k)!;
    expect(fig('cafeRevenue').value).toBeGreaterThanOrEqual(20_813_500);
    expect(fig('cafeNet').value).toBeGreaterThanOrEqual(20_425_889);
    expect(fig('revenue').value).toBeGreaterThanOrEqual(20_425_889 + 5_087_250);
    expect(fig('discounts').value).toBeGreaterThanOrEqual(387_614);
    expect(fig('orders').value).toBeGreaterThanOrEqual(sum(aug, (x) => x.orders));
    expect(fig('avgOrderValue').value).toBe(Math.round(fig('cafeRevenue').value / fig('orders').value));
    expect(fig('cafeRevenue').previous).toBeGreaterThanOrEqual(27_401_500);
  });

  it('panel_headline: a range that cuts a month counts only its days; a range after the till counts none', async () => {
    const cut = (await rpc('panel_headline', { p_from: '2026-10-25', p_to: '2026-11-07', p_compare: 'none' })) as { history: { period: { cafe: Row } } };
    const want = between('2026-10-25', '2026-10-31');
    expect(cut.history.period.cafe).toMatchObject({ days: 7, from: '2026-10-25', to: '2026-10-31', net: sum(want, (d) => d.net_iqd), discountUnknownDays: 7 });
    const after = (await rpc('panel_headline', { p_from: '2026-11-01', p_to: '2026-11-07', p_compare: 'none' })) as { history: { period: { cafe: Row } } };
    expect(after.history.period.cafe).toMatchObject({ days: 0, from: null, to: null, gross: 0, net: 0 });
  });

  it('analytics_cafe_history: months, groups and products of the old till, with the owner\'s costs', async () => {
    const h = (await rpc('analytics_cafe_history', { p_from: '2026-06-01', p_to: '2026-10-31' })) as {
      totals: Row; months: Row[]; groups: Row[]; products: Row[]; items: Row;
    };
    expect(h.totals).toMatchObject({ days: 147, from: '2026-06-02', to: '2026-10-31', gross: 118_855_000, discounts: 1_971_893, orders: 28_847, discountUnknownDays: 34 });
    expect(h.months.map((m) => [m.month, m.days, m.gross_iqd, m.discount_unknown_days])).toEqual([
      ['2026-06-01', 26, 20_946_500, 0],
      ['2026-07-01', 31, 27_401_500, 1],
      ['2026-08-01', 29, 20_813_500, 1],
      ['2026-09-01', 30, 26_307_000, 1],
      ['2026-10-01', 31, 23_386_500, 31],
    ]);
    expect(h.items).toEqual({ gross_iqd: 118_014_500, cost_known_gross_iqd: sum(h.groups, (g) => g.cost_known_gross_iqd as number), cost_iqd: sum(h.groups, (g) => g.cost_iqd as number) });
    expect(sum(h.groups, (g) => g.gross_iqd as number)).toBe(118_014_500);
    expect(h.groups[0]).toMatchObject({ key: 'dessert_food' });
    expect(h.groups.find((g) => g.key === 'mojito')).toMatchObject({ units: 3415, gross_iqd: 13_383_000, cost_known_gross_iqd: 13_383_000, cost_iqd: 3415 * 1250 });
    expect(h.products).toHaveLength(products.length);
    expect(h.products[0]).toEqual({ product: 'ماء', unit_price_iqd: 250, group: 'water_ice', units: 30_354, gross_iqd: 7_588_500, unit_cost_iqd: null, cost_iqd: null });
    expect(h.products.find((p) => p.product === 'دونات' && p.unit_price_iqd === 1750)).toMatchObject({ unit_cost_iqd: 600 });
    // One month only.
    const oct = (await rpc('analytics_cafe_history', { p_from: '2026-10-01', p_to: '2026-10-31' })) as { totals: Row; months: Row[] };
    expect(oct.months).toHaveLength(1);
    expect(oct.totals).toMatchObject({ days: 31, gross: 23_386_500, net: 23_386_500, discounts: 0, discountUnknownDays: 31 });
  });

  it('analytics_cafe_history is the owner\'s: a manager is refused', async () => {
    const res = await appRpc(manager, 'analytics_cafe_history', { p_from: '2026-10-01', p_to: '2026-10-07' }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');
  });

  it('the owner assistant reads all four through table_read', async () => {
    for (const table of ['legacy_cafe_hours', 'legacy_cafe_item_days', 'legacy_cafe_products', 'legacy_cafe_days']) {
      const res = await appRpc(owner, 'assistant_run_tool', {
        p_tool: 'assistant_table_read', p_args: { p_table: table, p_limit: 5 },
      }).then(outcome);
      expect(res.ok, `${table}: ${res.errorMessage}`).toBe(true);
      expect(JSON.stringify(res.data)).toContain(VENUE_A_ID);
    }
  });
});

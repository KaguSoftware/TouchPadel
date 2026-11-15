/**
 * 0424 assistant_cafe_history: the owner assistant follows 0412, which put
 * the old café till's days (legacy_cafe_days, 2 June to 31 October 2026, the
 * data 0413 loads) into panel_headline.
 *
 *   * history_figures: totals equal panel_headline for a range inside the
 *     old-till months, a range that cuts a month and a range spanning old-till
 *     and system days; history.cafe is legacy_cafe_days' own sum for the
 *     range; month, week and day rows add up to the totals (revenue misses
 *     only a padel monthly report the rows do not carry, history.inRows);
 *     a system-only range has no history.
 *   * costs_summary: no cash result over old-till days (old_till_revenue_iqd
 *     says how much), one over a November range with a cost planted.
 *   * cafe_history: the old till's page RPC through the dispatcher, owner only.
 *
 * ONE rolled-back psql transaction (tests/psql-scenario.ts). Each history and
 * panel pair is read in ONE statement, so both see the same snapshot while
 * other files write. The figures are the real old-till rows of branch A
 * (0413), so the expected values are computed from legacy_cafe_days in the
 * same transaction, never written down. Needs 0412, 0413 and 0424 applied.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stackAvailable } from './helpers';
import { docker, scenario, T, Q, FX, type Results } from './psql-scenario';

const up = await stackAvailable();

const RANGES = {
  july: ['2026-07-01', '2026-07-31'],
  cut: ['2026-08-10', '2026-08-20'],
  span: ['2026-10-20', '2026-11-10'],
  nov: ['2026-11-01', '2026-11-10'],
  oct: ['2026-10-01', '2026-10-31'],
} as const;
type RangeKey = keyof typeof RANGES;

const args = (k: RangeKey, extra = '') => `jsonb_build_object('p_from', '${RANGES[k][0]}', 'p_to', '${RANGES[k][1]}'${extra})`;
/** history_figures and panel_headline for one range, in one statement (one snapshot). */
const pair = (label: string, k: RangeKey, group: string) =>
  T(
    label,
    'owner',
    `select jsonb_build_object(
       'h', app.assistant_run_tool('assistant_history_figures', ${args(k, `, 'p_group', '${group}'`)}) -> 'data',
       'p', app.assistant_run_tool('panel_headline', ${args(k)}) -> 'data')`,
  );
/** legacy_cafe_days' own sum at branch A, the truth history.cafe must match. */
const truth = (label: string, k: RangeKey) =>
  Q(
    label,
    `select jsonb_build_object('days', count(*), 'net', coalesce(sum(net_iqd), 0), 'gross', coalesce(sum(gross_iqd), 0))
       from legacy_cafe_days where venue_id = {{venue}}::uuid and day between '${RANGES[k][0]}' and '${RANGES[k][1]}'`,
  );

const PLANT = [
  FX(`update assistant_cache_config set enabled = false where id`),
  // A cost from the safe at branch A inside the November range.
  FX(`insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, paid_from, category, payee, note, source, occurred_on, logged_by)
      values ({{venue}}::uuid, 'payment', 123000, -123000, 'safe', 'other', 'CH payee', 'CH cost', 'manual', '2026-11-02', {{owner}}::uuid)`),
  FX(`select set_config('request.headers', json_build_object('x-venue-scope', {{venue}})::text, true)`),
];

const CALLS = [
  truth('t_july', 'july'),
  truth('t_cut', 'cut'),
  truth('t_span', 'span'),
  truth('t_oct', 'oct'),
  pair('july_month', 'july', 'month'),
  pair('july_week', 'july', 'week'),
  pair('july_day', 'july', 'day'),
  pair('cut_day', 'cut', 'day'),
  pair('span_week', 'span', 'week'),
  pair('span_day', 'span', 'day'),
  pair('span_month', 'span', 'month'),
  pair('nov_day', 'nov', 'day'),
  T('cs_old', 'owner', `select app.assistant_run_tool('assistant_costs_summary', ${args('oct')}) -> 'data'`),
  T('cs_nov', 'owner', `select app.assistant_run_tool('assistant_costs_summary', ${args('nov')}) -> 'data'`),
  T('ch_owner', 'owner', `select app.assistant_run_tool('analytics_cafe_history', ${args('july')})`),
  T('ch_mgr', 'manager', `select app.assistant_run_tool('analytics_cafe_history', ${args('july')})`),
];

type Fig = Record<string, number>;
interface Cafe {
  days: number;
  net: number;
  gross: number;
  orders: number;
  discountUnknownDays: number;
  inRows: boolean;
}
interface Hist {
  rows: Array<Fig & { period: string }>;
  totals: Fig;
  history: { inRows: boolean; revenue: number | null; cafe: Cafe | null } | null;
}
interface Costs {
  totals: { total_iqd: number; revenue_iqd: number | null; cash_result_iqd: number | null; old_till_revenue_iqd: number };
  by_category: Array<{ category: string }>;
  note?: string;
}

describe.skipIf(!up || !docker)('0424 assistant figures and the old café till', () => {
  let r: Results = {};

  const ok = <D>(label: string): D => {
    const o = r[label];
    expect(o, `no result for ${label}`).toBeDefined();
    expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
    return o!.data as D;
  };
  const both = (label: string) => {
    const d = ok<{ h: Hist; p: { figures: Array<{ key: string; value: number }> } }>(label);
    return { h: d.h, p: Object.fromEntries(d.p.figures.map((f) => [f.key, Number(f.value)])) as Fig };
  };
  const sum = (h: Hist, k: string) => h.rows.reduce((s, x) => s + Number(x[k]), 0);

  beforeAll(() => {
    r = scenario([...PLANT, ...CALLS]);
  });

  it('history_figures totals equal panel_headline: inside the old-till months, a range that cuts a month, old till + system days', () => {
    for (const label of ['july_month', 'july_week', 'july_day', 'cut_day', 'span_week', 'span_day', 'span_month', 'nov_day']) {
      const { h, p } = both(label);
      for (const k of Object.keys(h.totals)) {
        if (k in p) expect(Number(h.totals[k]), `${label}.${k}`).toBe(p[k]);
      }
    }
  });

  it('history.cafe is the old till\'s own sum for the range, and the rows carry it', () => {
    for (const [label, t] of [['july_month', 't_july'], ['cut_day', 't_cut'], ['span_week', 't_span']] as const) {
      const cafe = both(label).h.history?.cafe;
      const want = ok<{ days: number; net: number; gross: number }>(t);
      expect(Number(want.days), `${t}: 0413's rows must be loaded`).toBeGreaterThan(0);
      expect(cafe, label).toBeTruthy();
      expect([Number(cafe!.days), Number(cafe!.net), Number(cafe!.gross)], label).toEqual([Number(want.days), Number(want.net), Number(want.gross)]);
      expect(cafe!.inRows, label).toBe(true);
    }
    // The span stops at the till's last day; November is the system's own.
    expect(both('span_day').h.history?.cafe?.days).toBe(12);
    expect(both('nov_day').h.history).toBeNull();
  });

  it('month, week and day rows add up to the totals (revenue misses only a padel report the rows leave out)', () => {
    for (const label of ['july_month', 'july_week', 'july_day', 'cut_day', 'span_week', 'span_day', 'span_month']) {
      const h = both(label).h;
      for (const k of ['cafeRevenue', 'cafeNet', 'orders', 'discounts']) expect(sum(h, k), `${label}.${k}`).toBe(Number(h.totals[k]));
      const padelOut = h.history && !h.history.inRows ? Number(h.history.revenue ?? 0) : 0;
      expect(sum(h, 'revenue') + padelOut, `${label}.revenue`).toBe(Number(h.totals.revenue));
    }
    // July holds a whole padel report month: the month row carries it, week and day rows do not.
    expect(both('july_month').h.history?.inRows).toBe(true);
  });

  it('costs_summary: no cash result over old-till days, one over November with a cost planted', () => {
    const old = ok<Costs>('cs_old');
    expect(old.totals.cash_result_iqd).toBeNull();
    expect(Number(old.totals.old_till_revenue_iqd)).toBe(Number(ok<{ net: number }>('t_oct').net));
    expect(Number(old.totals.old_till_revenue_iqd)).toBeGreaterThan(0);
    expect(old.note).toMatch(/old café till/);

    const nov = ok<Costs>('cs_nov');
    expect(Number(nov.totals.old_till_revenue_iqd)).toBe(0);
    expect(Number(nov.totals.total_iqd)).toBeGreaterThanOrEqual(123000);
    expect(nov.by_category.map((c) => c.category)).toContain('other');
    expect(nov.totals.cash_result_iqd).not.toBeNull();
    expect(Number(nov.totals.cash_result_iqd)).toBe(Number(nov.totals.revenue_iqd) - Number(nov.totals.total_iqd));
    expect(nov.note ?? '').not.toMatch(/old café till/);
  });

  it('cafe_history: the old till\'s products through the dispatcher, owner only', () => {
    const res = ok<{ data: { totals: { days: number; net: number }; months: unknown[]; products: unknown[] }; row_count: number }>('ch_owner');
    expect(Number(res.data.totals.net)).toBe(Number(ok<{ net: number }>('t_july').net));
    expect(res.data.months).toHaveLength(1);
    expect(res.row_count).toBe(res.data.products.length);
    expect(res.row_count).toBeGreaterThan(0);
    expect(r.ch_mgr?.ok).toBe(false);
    expect(r.ch_mgr?.code).toMatch(/FORBIDDEN/);
  });
});

/**
 * 0331 legacy_reports + legacy_report_figures on the stack: the rows the JSON
 * makes (scripts/lib/legacy-reports.mjs, the loader's own mapping) go in and
 * come back unchanged; the owner reads them, nobody else does; no client
 * writes; a figure cannot sit on another branch than its report; a summary or
 * chart figure always has a number; and the owner assistant can read both.
 * The source side (JSON = the Word files) is tests/legacy-reports-source.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allRows } from '../scripts/lib/legacy-reports.mjs';
import {
  anonClient, appRpc, outcome, SEED_STAFF, serviceClient, signedInClient, stackAvailable, VENUE_A_ID, VENUE_B_ID,
} from './helpers';

const up = await stackAvailable();
const { reports, figures } = allRows(VENUE_A_ID);
const ids = reports.map((r) => r.id as string);

describe.skipIf(!up)('0331 legacy reports', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    const r = await svc.from('legacy_reports').upsert(reports, { onConflict: 'id' });
    expect(r.error).toBeNull();
    const f = await svc.from('legacy_report_figures').upsert(figures, { onConflict: 'report_id,source,position' });
    expect(f.error).toBeNull();
  });

  afterAll(async () => {
    await owner?.auth.signOut();
    await manager?.auth.signOut();
  });

  it('stores every report field exactly as the JSON gives it', async () => {
    const { data, error } = await svc.from('legacy_reports').select('*').in('id', ids);
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
    for (const want of reports) {
      const got = data!.find((r) => r.id === want.id)!;
      for (const [k, v] of Object.entries(want)) {
        if (k === 'source_created_at') expect(new Date(got[k]).getTime(), k).toBe(new Date(v as string).getTime());
        else expect(got[k], `${want.id} ${k}`).toEqual(v);
      }
    }
  });

  it('stores every figure exactly as the JSON gives it, and no other', async () => {
    const { data, error } = await svc.from('legacy_report_figures').select('*').in('report_id', ids);
    expect(error).toBeNull();
    expect(data).toHaveLength(figures.length);
    const key = (f: Record<string, unknown>) => `${f.report_id}/${f.source}/${f.position}`;
    const byKey = new Map(data!.map((f) => [key(f), f]));
    for (const want of figures) expect(byKey.get(key(want)), key(want)).toEqual(want);
  });

  it('keeps a blank table cell as no number, never zero (June: cancelled, free)', async () => {
    const { data } = await svc.from('legacy_report_figures')
      .select('category, count, count_stated')
      .eq('report_id', '70c40000-0000-4000-8000-0000aa202606').eq('source', 'table').is('count', null);
    expect(data!.map((f) => f.category).sort()).toEqual(['cancelled', 'free']);
  });

  it('keeps both sides of August\'s disagreement under their own labels', async () => {
    const { data } = await svc.from('legacy_report_figures')
      .select('source, category, count')
      .eq('report_id', '70c40000-0000-4000-8000-0000aa202608').in('category', ['cancelled', 'not_completed', 'not_booked']);
    const pick = (s: string) => Object.fromEntries(data!.filter((f) => f.source === s).map((f) => [f.category, f.count]));
    expect(pick('table')).toEqual({ cancelled: 207, not_booked: 105 });
    expect(pick('summary')).toEqual({ not_completed: 207, cancelled: 105 });
    expect(pick('chart')).toEqual({ not_completed: 207, cancelled: 105 });
  });

  it('the owner reads them; the manager reads nothing; anon is refused', async () => {
    const o = await owner.from('legacy_reports').select('id').in('id', ids);
    expect(o.error).toBeNull();
    expect(o.data).toHaveLength(4);
    const of = await owner.from('legacy_report_figures').select('report_id').in('report_id', ids);
    expect(of.data).toHaveLength(figures.length);
    const m = await manager.from('legacy_reports').select('id').in('id', ids);
    expect(m.error).toBeNull();
    expect(m.data).toEqual([]);
    const a = await anonClient().from('legacy_reports').select('id').limit(1);
    expect(a.error?.message).toMatch(/permission denied/i);
  });

  it('no client writes, the owner included', async () => {
    const ins = await owner.from('legacy_reports').insert({ ...reports[0], id: '70c40000-0000-4000-8000-0000000000ff' });
    expect(ins.error?.message).toMatch(/permission denied/i);
    const upd = await owner.from('legacy_report_figures').update({ count: 1 }).eq('report_id', ids[0]);
    expect(upd.error?.message).toMatch(/permission denied/i);
  });

  it('a figure cannot be filed under another branch than its report', async () => {
    const res = await svc.from('legacy_report_figures').insert({
      ...figures[0], position: 99, venue_id: VENUE_B_ID,
    });
    expect(res.error?.message).toMatch(/VENUE_MISMATCH/);
  });

  it('a summary or chart figure always carries a number; only a table cell may be blank', async () => {
    const res = await svc.from('legacy_report_figures').insert({
      report_id: ids[0], venue_id: VENUE_A_ID, source: 'summary', position: 99,
      category: 'completed', label_stated: 'x', count: null,
    });
    expect(res.error?.message).toMatch(/legacy_report_figures_count_chk/);
  });

  // ── 0349: the reports in the figures the owner already reads ──
  const panel = async (from: string, to: string) => {
    const res = await appRpc(owner, 'panel_headline', { p_from: from, p_to: to, p_compare: 'previousPeriod' }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { figures: { key: string; value: number; previous: number | null }[]; history: { period: { included: unknown[]; partial: unknown[] } } };
    const fig = (k: string) => d.figures.find((x) => x.key === k)!;
    return { d, fig };
  };
  const courts = async (from: string, to: string, courtId: string | null = null) => {
    const res = await appRpc(owner, 'analytics_courts_summary', { p_from: from, p_to: to, p_court_id: courtId }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return res.data as { kpis: Record<string, number | null>; history: { included: unknown[]; partial: unknown[] } };
  };

  it('0349 panel: a whole report month adds its completed, no-shows and money; the comparison its own month', async () => {
    // Everything live in these months is test noise on a shared stack, so
    // compare a month with the report against the same month without it.
    const live = (await panel('2026-08-01', '2026-08-30')).fig; // cuts August: no report
    const { d, fig } = await panel('2026-08-01', '2026-08-31');
    expect(d.history.period.included).toHaveLength(1);
    expect(fig('bookings').value - live('bookings').value).toBeGreaterThanOrEqual(203);
    expect(fig('padelRevenue').value - live('padelRevenue').value).toBeGreaterThanOrEqual(5087250);
    // previous = 1..31 July, which holds the July report (1..30 July).
    expect(fig('padelRevenue').previous).toBeGreaterThanOrEqual(9180500);
    expect(fig('bookings').previous).toBeGreaterThanOrEqual(263);
  });

  it('0349 panel: a range that cuts a report month leaves it out and says so', async () => {
    const { d } = await panel('2026-08-01', '2026-08-30');
    expect(d.history.period.included).toEqual([]);
    expect(d.history.period.partial).toEqual([expect.objectContaining({ from: '2026-08-01', to: '2026-08-31' })]);
  });

  it('0349 courts: summary figures in kpis (August: cancelled 105, September: 61 no-shows); hours unknown', async () => {
    const cut = await courts('2026-06-02', '2026-09-29'); // cuts June and September, holds July and August
    const all = await courts('2026-06-01', '2026-09-30');
    expect(all.history.included).toHaveLength(4);
    expect(cut.history.included).toHaveLength(2);
    expect(cut.history.partial).toHaveLength(2);
    // June + September add: completed 285 + 242, no cancellations, 61 no-shows, training 64 + 81, no money.
    expect((all.kpis.bookings as number) - (cut.kpis.bookings as number)).toBeGreaterThanOrEqual(527);
    expect((all.kpis.no_shows as number) - (cut.kpis.no_shows as number)).toBeGreaterThanOrEqual(61);
    expect(all.kpis.occupancy_pct).toBeNull();
    expect(all.kpis.price_per_booked_hour_iqd).toBeNull();
    // July + August: cancelled 45 + 105, revenue 9,180,500 + 5,087,250.
    expect(cut.kpis.cancellations as number).toBeGreaterThanOrEqual(150);
    expect(cut.kpis.revenue_iqd as number).toBeGreaterThanOrEqual(14267750);
  });

  it('0357: each counted report carries its own summary figures, null where it has none', async () => {
    const all = await courts('2026-06-01', '2026-09-30');
    const months = all.history.included as { from: string; bookings: number | null; cancellations: number | null; noShows: number | null; lessons: number | null; revenue: number | null }[];
    expect(months.map((m) => [m.from, m.bookings, m.cancellations, m.noShows, m.lessons, m.revenue])).toEqual([
      ['2026-06-01', 285, null, null, 64, null],
      ['2026-07-01', 263, 45, null, 82, 9180500],
      ['2026-08-01', 203, 105, null, 85, 5087250],
      ['2026-09-01', 242, null, 61, 81, null],
    ]);
    // The panel passes the same object through.
    const { d } = await panel('2026-08-01', '2026-08-31');
    expect(d.history.period.included).toEqual([expect.objectContaining({ from: '2026-08-01', bookings: 203, cancellations: 105 })]);
  });

  it('0349 courts: one court picked, the reports (which name no court) stay out', async () => {
    const { data } = await svc.from('courts').select('id').eq('venue_id', VENUE_A_ID).limit(1);
    const one = await courts('2026-08-01', '2026-08-31', data![0]!.id as string);
    expect(one.history.included).toEqual([]);
  });

  it('the owner assistant reads both through table_read', async () => {
    for (const table of ['legacy_reports', 'legacy_report_figures']) {
      const res = await appRpc(owner, 'assistant_run_tool', {
        p_tool: 'assistant_table_read', p_args: { p_table: table, p_limit: 100 },
      }).then(outcome);
      expect(res.ok, `${table}: ${res.errorMessage}`).toBe(true);
      expect(JSON.stringify(res.data)).toContain('70c40000-0000-4000-8000-0000aa202607');
    }
  });
});

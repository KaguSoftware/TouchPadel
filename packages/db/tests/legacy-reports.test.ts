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

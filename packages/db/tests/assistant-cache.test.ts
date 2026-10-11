/**
 * 0330 — the assistant's stored-days cache (tool history_figures).
 *
 * What each case proves, and why a wrong implementation would still look fine
 * from the chat:
 *
 *   * it ships EMPTY and OFF: nothing writes it until app.assistant_cache_init
 *     runs (owner call: fill it only when told), and while it is off every day
 *     is read live;
 *   * kept days and live days give the SAME rows and totals — the stored copy
 *     is only worth anything if it never disagrees with the panel's own
 *     figures (reports_figures), so this compares a cached read to an
 *     all-live read of the same range, and to panel_headline;
 *   * the top-up is incremental: a second init stores nothing already kept,
 *     and an invalidated range is recomputed and nothing else;
 *   * only the service role reaches the cache RPCs, and the read function is
 *     reachable only through the dispatcher.
 *
 * The equality cases run in one rolled-back psql transaction through the
 * stack's container (the fill sets the owner stand-in and branch header for
 * its own transaction, so it cannot be driven through PostgREST), which also
 * leaves the cache exactly as it found it. Without docker those skip.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

// Relative to today so the stored copy always has days to serve whenever the suite runs.
const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const FROM = day(29);
const TO = day(0);

/** The owner's session inside a transaction, the branch switcher on "all branches". */
const AS_OWNER = `
  select id from staff where role = 'owner' and is_active order by created_at limit 1 \\gset
  select set_config('request.jwt.claim.sub', :'id', true) \\gset
  select set_config('request.jwt.claims', json_build_object('sub', :'id', 'role', 'authenticated')::text, true) \\gset
  select set_config('request.headers', '{"x-venue-scope":"all"}', true) \\gset
`;

/** Runs `body` in a transaction that is rolled back, and returns the last line it printed. */
function inTx(body: string): string {
  // Repeatable read: the live read and the kept read must see the same rows even while other test files write.
  const out = psql(`begin isolation level repeatable read;\n${AS_OWNER}\n${body}\nrollback;`)
    .split('\n')
    .filter((l) => l && l !== 'BEGIN' && l !== 'ROLLBACK');
  return out[out.length - 1] ?? '';
}

describe.skipIf(!up)('0330 assistant stored-days cache', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
  });
  afterAll(async () => {
    await owner.auth.signOut();
  });

  it('only the service role reaches the cache RPCs; the read function only through the dispatcher', async () => {
    for (const [fn, args] of [
      ['assistant_cache_init', { p_max_days: 1 }],
      ['assistant_cache_fill', { p_max_days: 1 }],
      ['assistant_cache_clear', {}],
      ['assistant_cache_status', {}],
      ['assistant_cache_invalidate', { p_from: FROM, p_to: TO }],
      ['assistant_history_figures', { p_from: FROM, p_to: TO }],
    ] as const) {
      const res = await appRpc(owner, fn, args).then(outcome);
      expect(res.ok, `${fn} must not be callable by the owner's session`).toBe(false);
      expect(res.errorMessage).toMatch(/permission denied|not found|could not find/i);
    }
  });

  it('the dispatcher answers history_figures for the owner and refuses others', async () => {
    const res = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_history_figures', p_args: { p_from: FROM, p_to: TO, p_group: 'week' } }).then(outcome);
    expect(res.ok).toBe(true);
    const d = (res.data as { data: { rows: unknown[]; totals: Record<string, number>; cache: { on: boolean } } }).data;
    expect(Array.isArray(d.rows)).toBe(true);
    expect(d.totals).toHaveProperty('revenue');
    const manager = await signedInClient(SEED_STAFF.manager);
    const denied = await appRpc(manager, 'assistant_run_tool', { p_tool: 'assistant_history_figures', p_args: { p_from: FROM, p_to: TO } }).then(outcome);
    expect(denied.ok).toBe(false);
    expect(denied.errorMessage).toMatch(/FORBIDDEN/);
    await manager.auth.signOut();
  });

  it('refuses a range with more than 31 buckets and an unknown group', async () => {
    const wide = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_history_figures', p_args: { p_from: '2026-01-01', p_to: '2026-10-09', p_group: 'day' } }).then(outcome);
    expect(wide.ok).toBe(false);
    expect(wide.errorMessage).toMatch(/INVALID_RANGE/);
    const bad = await appRpc(owner, 'assistant_run_tool', { p_tool: 'assistant_history_figures', p_args: { p_from: FROM, p_to: TO, p_group: 'year' } }).then(outcome);
    expect(bad.ok).toBe(false);
    expect(bad.errorMessage).toMatch(/INVALID_ARGUMENT/);
  });

  it('ships empty and off: a fill stores nothing until init runs', async () => {
    const { data: st } = await svc.schema('app').rpc('assistant_cache_status');
    const s = st as { enabled: boolean; scopes: unknown[] };
    // A developer who ran init locally has a filled cache: the shipping state is what the migration gives a fresh stack.
    if (!s.enabled) expect(s.scopes).toEqual([]);
    const { data: fill } = await svc.schema('app').rpc('assistant_cache_fill', { p_max_days: 5 });
    if (!s.enabled) expect(fill).toMatchObject({ enabled: false, filled: 0, done: true });
  });

  describe.skipIf(!docker)('kept days equal live days (rolled-back transaction, needs docker)', () => {
    it('off: every day is read live', () => {
      const line = inTx(`select app.assistant_cache_clear() \\gset
        select (app.assistant_history_figures('${FROM}','${TO}','day',false)->'cache')::text;`);
      const cache = JSON.parse(line) as { on: boolean; days_from_cache: number; days_read_live: number };
      expect(cache.on).toBe(false);
      expect(cache.days_from_cache).toBe(0);
      expect(cache.days_read_live).toBe(30);
    });

    it('on: rows and totals are identical to the all-live read, part of the range comes from the copy, and the totals equal the panel', () => {
      const line = inTx(`
        select app.assistant_cache_clear() \\gset
        create temp table live as select app.assistant_history_figures('${FROM}','${TO}','day',true) as r;
        select app.assistant_cache_init(100) \\gset
        create temp table kept as select app.assistant_history_figures('${FROM}','${TO}','day',true) as r;
        select json_build_object(
          'sameRows',   (select r->'rows' from kept) = (select r->'rows' from live),
          'sameTotals', (select r->'totals' from kept) = (select r->'totals' from live),
          'fromCache',  (select (r->'cache'->>'days_from_cache')::int from kept),
          'live',       (select (r->'cache'->>'days_read_live')::int from kept),
          'panel',      (select (e->>'value')::bigint from jsonb_array_elements(app.panel_headline('${FROM}','${TO}','none')->'figures') e where e->>'key' = 'revenue'),
          'revenue',    (select (r->'totals'->>'revenue')::bigint from kept))::text;`);
      const r = JSON.parse(line) as { sameRows: boolean; sameTotals: boolean; fromCache: number; live: number; panel: number; revenue: number };
      expect(r.sameRows).toBe(true);
      expect(r.sameTotals).toBe(true);
      expect(r.fromCache).toBeGreaterThan(0);
      // The newest days (inside the freeze lag) are always live.
      expect(r.live).toBeGreaterThanOrEqual(3);
      expect(r.revenue).toBe(r.panel);
    });

    it('items, courts and staff: kept days give the same answer as all-live', () => {
      const line = inTx(`
        select app.assistant_cache_clear() \\gset
        create temp table live as select
          app.assistant_history_items('${FROM}'::date, '${TO}'::date, 10, 'revenue') - 'cache' as items,
          app.assistant_history_courts('${FROM}'::date, '${TO}'::date, 'week', true) - 'cache' as courts,
          app.assistant_history_staff('${FROM}'::date, '${TO}'::date) - 'cache' as staff;
        select app.assistant_cache_init(100) \\gset
        select json_build_object(
          'items',  (app.assistant_history_items('${FROM}'::date, '${TO}'::date, 10, 'revenue') - 'cache') = (select items from live),
          'courts', (app.assistant_history_courts('${FROM}'::date, '${TO}'::date, 'week', true) - 'cache') = (select courts from live),
          'staff',  (app.assistant_history_staff('${FROM}'::date, '${TO}'::date) - 'cache') = (select staff from live),
          'fromCache', (app.assistant_history_items('${FROM}'::date, '${TO}'::date, 10, 'revenue') -> 'cache' ->> 'days_from_cache')::int,
          'detailRows', (select count(*) from assistant_day_detail))::text;`);
      const r = JSON.parse(line) as { items: boolean; courts: boolean; staff: boolean; fromCache: number; detailRows: number };
      expect(r).toMatchObject({ items: true, courts: true, staff: true });
      expect(r.fromCache).toBeGreaterThan(0);
      expect(r.detailRows).toBeGreaterThan(0);
    });

    it('the top-up is incremental: a second init stores nothing kept already, an invalidated range is recomputed alone', () => {
      const line = inTx(`
        select app.assistant_cache_clear() \\gset
        select app.assistant_cache_init(100) \\gset
        select count(*) as n1 from assistant_day_facts where scope like 'all:%' \\gset
        select app.assistant_cache_init(100) \\gset
        select count(*) as n2 from assistant_day_facts where scope like 'all:%' \\gset
        select count(*) as inrange from assistant_day_facts where scope like 'all:%' and business_date = '${FROM}' \\gset
        select app.assistant_cache_invalidate('${FROM}', '${FROM}') as dropped \\gset
        select count(*) as n3 from assistant_day_facts where scope like 'all:%' \\gset
        select max(computed_at) as stamp from assistant_day_facts where scope like 'all:%' \\gset
        select app.assistant_cache_fill(100) \\gset
        select json_build_object('n1', :n1, 'n2', :n2, 'inrange', :inrange, 'dropped', :dropped, 'n3', :n3,
                                 'n4', (select count(*) from assistant_day_facts where scope like 'all:%'))::text;`);
      const r = JSON.parse(line) as { n1: number; n2: number; inrange: number; dropped: number; n3: number; n4: number };
      expect(r.n1).toBeGreaterThan(0);
      expect(r.n2).toBe(r.n1);
      // invalidate drops the date in every scope; the "all" scope loses exactly its one row for it.
      expect(r.dropped).toBeGreaterThanOrEqual(r.inrange);
      expect(r.n3).toBe(r.n2 - r.inrange);
      expect(r.n4).toBe(r.n2);
    });

    it('clear empties the copy and switches it off', () => {
      const line = inTx(`
        select app.assistant_cache_init(10) \\gset
        select app.assistant_cache_clear() as removed \\gset
        select json_build_object('removed', :removed, 'left', (select count(*) from assistant_day_facts) + (select count(*) from assistant_day_detail),
                                 'enabled', (select enabled from assistant_cache_config))::text;`);
      const r = JSON.parse(line) as { removed: number; left: number; enabled: boolean };
      expect(r.removed).toBeGreaterThan(0);
      expect(r.left).toBe(0);
      expect(r.enabled).toBe(false);
    });
  });
});

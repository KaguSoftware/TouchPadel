/**
 * The owner-assistant eval set, everything that does not need a model
 * (plan §8 "Eval set"). The scored run is `pnpm --filter @touch/db
 * assistant:eval` (scripts/assistant-eval.mjs) with a real key; this suite
 * keeps the set itself honest so that run measures the model and not a typo:
 *
 *   (a) every case names real scopes and real catalog tools, and each expected
 *       tool is reachable under the case's scopes;
 *   (b) every "where is" route is a page docs/design/assistant/pages.md knows;
 *   (c) the fixture plants, every numeric truth is one finite number, the
 *       fixture-derived truths equal the pinned values, and the list tools the
 *       cases point at return the same totals through app.assistant_run_tool as
 *       the owner; the audit rows name the expected actor;
 *   (d) the set is 20/10/10 with both languages in every kind;
 *   (e) the cleanup section leaves no eval row behind.
 *
 * The fixture goes in through the stack's own container (audit_log, payments
 * and refunds are append-only, so no client path could remove them); without
 * docker on PATH the stack cases skip themselves like assistant-wall.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, signedInClient, appRpc, outcome, SEED_STAFF, SUPABASE_URL, ANON_KEY } from './helpers';
import { ASSISTANT_SCOPES, ASSISTANT_TOOLS, isToolAllowed, type AssistantScope } from '../../core/src/assistant/tools';

interface EvalCase {
  id: string;
  kind: 'numeric' | 'where' | 'audit';
  lang: 'en' | 'ar';
  question: string;
  scopes: AssistantScope[];
  range?: { from: string; to: string };
  expect: {
    tools_any_of?: string[];
    route?: string;
    sql?: string;
    value?: number;
    contains_any?: string[];
    actor_any?: string[];
    run?: { rpc: string; args: Record<string, unknown>; counts_rows?: boolean; actor?: string };
  };
}

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/%20/g, ' '));
const CASES = (JSON.parse(readFileSync(path.join(HERE, 'assistant-eval/cases.json'), 'utf8')) as { cases: EvalCase[] }).cases;
const FIXTURE = readFileSync(path.join(HERE, 'assistant-eval/fixture.sql'), 'utf8');
const PAGES = readFileSync(path.resolve(HERE, '../../../docs/design/assistant/pages.md'), 'utf8');
const EVAL_PREFIX = 'ee570000-0000-4000-8000-0000e7a1';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

function sections(text: string): { cleanup: string; plant: string } {
  const cleanup = text.match(/^-- @section cleanup\s*\n([\s\S]*?)^-- @section plant/m)?.[1] ?? '';
  const plant = text.match(/^-- @section plant\s*\n([\s\S]*)$/m)?.[1] ?? '';
  return { cleanup, plant };
}
function applyFixture(mode: 'plant' | 'cleanup'): void {
  const s = sections(FIXTURE);
  const body = mode === 'plant' ? `${s.cleanup}\n${s.plant}` : s.cleanup;
  psql(`begin;\nset local session_replication_role = replica;\n${body}\ncommit;`);
}

/** Every table the fixture writes, with the predicate that finds its rows. */
const EVAL_TABLES: readonly [table: string, where: string][] = [
  ['audit_log', `device_id = 'ee57-eval' or entity_id like '${EVAL_PREFIX}%'`],
  ['refunds', `id::text like '${EVAL_PREFIX}%'`],
  ['payments', `id::text like '${EVAL_PREFIX}%'`],
  ['order_items', `id::text like '${EVAL_PREFIX}%'`],
  ['orders', `id::text like '${EVAL_PREFIX}%'`],
  ['tabs', `id::text like '${EVAL_PREFIX}%'`],
  ['reservations', `id::text like '${EVAL_PREFIX}%'`],
  ['day_sessions', `id::text like '${EVAL_PREFIX}%'`],
  ['staff_breaks', `id::text like '${EVAL_PREFIX}%'`],
  ['staff_requests', `id::text like '${EVAL_PREFIX}%'`],
  ['menu_item_variants', `id::text like '${EVAL_PREFIX}%'`],
  ['menu_items', `id::text like '${EVAL_PREFIX}%'`],
  ['menu_categories', `id::text like '${EVAL_PREFIX}%'`],
  ['courts', `id::text like '${EVAL_PREFIX}%'`],
  ['assistant_index_queue', `ref like '${EVAL_PREFIX}%'`],
];
function evalRowCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  const line = psql(`select ${EVAL_TABLES.map(([t, w]) => `(select count(*) from ${t} where ${w})`).join(" || ',' || ")}`);
  line.split(',').forEach((n, i) => {
    out[EVAL_TABLES[i]![0]] = Number(n);
  });
  return out;
}

// ── pure: the set itself ─────────────────────────────────────────────────────

describe('assistant eval set — shape', () => {
  it('has 40 cases split 20 numeric / 10 where / 10 audit', () => {
    expect(CASES).toHaveLength(40);
    const by = (k: EvalCase['kind']) => CASES.filter((c) => c.kind === k);
    expect(by('numeric')).toHaveLength(20);
    expect(by('where')).toHaveLength(10);
    expect(by('audit')).toHaveLength(10);
  });

  it('asks in both languages within every kind, and ids are unique', () => {
    for (const kind of ['numeric', 'where', 'audit'] as const) {
      const langs = new Set(CASES.filter((c) => c.kind === kind).map((c) => c.lang));
      expect(langs, kind).toEqual(new Set(['en', 'ar']));
    }
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
    for (const c of CASES) expect(c.question.trim().length, c.id).toBeGreaterThan(8);
  });

  it('(a) every scope is real and every expected tool is in the catalog and reachable under the case scopes', () => {
    const scopes = new Set<string>(ASSISTANT_SCOPES);
    const names = new Set(ASSISTANT_TOOLS.map((t) => t.name));
    for (const c of CASES) {
      expect(c.scopes.length, c.id).toBeGreaterThan(0);
      for (const s of c.scopes) expect(scopes.has(s), `${c.id}: scope ${s}`).toBe(true);
      expect(c.expect.tools_any_of?.length, `${c.id}: tools_any_of`).toBeGreaterThan(0);
      for (const t of c.expect.tools_any_of ?? []) {
        expect(names.has(t), `${c.id}: tool ${t}`).toBe(true);
        expect(isToolAllowed(t, c.scopes), `${c.id}: ${t} is off under ${c.scopes.join(',')}`).toBe(true);
      }
      if (c.range) {
        expect(c.range.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.range.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.range.from <= c.range.to, c.id).toBe(true);
      }
    }
  });

  it('numeric cases carry one SELECT each; where cases a route and fragments; audit cases actors and fragments', () => {
    for (const c of CASES) {
      if (c.kind === 'numeric') {
        expect(c.expect.sql, c.id).toMatch(/^\s*(with|select)\b/i);
        expect(c.expect.sql, `${c.id}: one statement`).not.toMatch(/;\s*\S/);
        expect(c.expect.sql, `${c.id}: read-only`).not.toMatch(/\b(insert|update|delete|drop|alter|create|truncate)\b/i);
      } else if (c.kind === 'where') {
        expect(c.expect.route, c.id).toMatch(/^\//);
        expect(c.expect.contains_any, c.id).toContain(c.expect.route);
        expect(c.expect.contains_any!.length, c.id).toBeGreaterThanOrEqual(2);
      } else {
        expect(c.expect.actor_any?.length, c.id).toBeGreaterThan(0);
        expect(c.expect.contains_any?.length, c.id).toBeGreaterThan(0);
        expect(c.expect.run?.actor, c.id).toBeTruthy();
        expect(c.expect.actor_any, c.id).toContain(c.expect.run!.actor);
      }
    }
  });

  it('(b) every "where is" route is a page pages.md describes', () => {
    const routes = new Set([...PAGES.matchAll(/^- (\/\S*) —/gm)].map((m) => m[1]));
    expect(routes.size).toBeGreaterThan(40);
    for (const c of CASES.filter((x) => x.kind === 'where')) {
      expect(routes.has(c.expect.route!), `${c.id}: ${c.expect.route} not in pages.md`).toBe(true);
    }
  });

  it('every `run` names a dispatched rpc of an expected tool', () => {
    for (const c of CASES) {
      if (!c.expect.run) continue;
      const spec = ASSISTANT_TOOLS.find((t) => t.rpc === c.expect.run!.rpc);
      expect(spec, `${c.id}: rpc ${c.expect.run.rpc}`).toBeDefined();
      expect(c.expect.tools_any_of, `${c.id}: run.rpc must belong to an expected tool`).toContain(spec!.name);
    }
  });

  it('fixture.sql has both sections, only eval-prefixed ids, and a delete for every table it inserts into', () => {
    const s = sections(FIXTURE);
    expect(s.cleanup.length).toBeGreaterThan(100);
    expect(s.plant.length).toBeGreaterThan(1000);
    const ids = [...FIXTURE.matchAll(/'(ee57[0-9a-f-]{32})'/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(id.startsWith(EVAL_PREFIX), id).toBe(true);
    const inserted = new Set([...s.plant.matchAll(/^insert into (\w+)/gm)].map((m) => m[1]!));
    const deleted = new Set([...s.cleanup.matchAll(/^delete from (\w+)/gm)].map((m) => m[1]!));
    for (const t of inserted) expect(deleted.has(t), `cleanup misses ${t}`).toBe(true);
    for (const [t] of EVAL_TABLES) if (t !== 'assistant_index_queue') expect(inserted.has(t), `EVAL_TABLES lists ${t} but the fixture does not insert into it`).toBe(true);
  });
});

// ── local stack: the fixture and the truths ──────────────────────────────────

describe.skipIf(!docker)('assistant eval set — fixture and truths (local stack)', () => {
  let owner: SupabaseClient;

  beforeAll(async () => {
    applyFixture('plant');
    owner = await signedInClient(SEED_STAFF.owner);
  });

  afterAll(async () => {
    applyFixture('cleanup');
    await owner.auth.signOut();
  });

  const run = (rpc: string, args: Record<string, unknown>) =>
    appRpc(owner, 'assistant_run_tool', { p_tool: rpc, p_args: args }).then(outcome);

  it('planted the eval rows', () => {
    const counts = evalRowCounts();
    expect(counts.audit_log).toBe(11);
    expect(counts.reservations).toBe(6);
    expect(counts.tabs).toBe(5);
    expect(counts.payments).toBe(5);
    expect(counts.day_sessions).toBe(3);
  });

  it('(c) every numeric sql returns exactly one finite number, equal to the pinned value where there is one', () => {
    for (const c of CASES.filter((x) => x.kind === 'numeric')) {
      const raw = psql(c.expect.sql!);
      expect(raw.split('\n'), `${c.id}: one row`).toHaveLength(1);
      const n = Number(raw);
      expect(Number.isFinite(n), `${c.id}: ${JSON.stringify(raw)}`).toBe(true);
      if (c.expect.value !== undefined) expect(n, `${c.id}: fixture drifted`).toBe(c.expect.value);
    }
  });

  it('(c) the list tools the numeric cases point at return the same total through the wall, as the owner', async () => {
    for (const c of CASES.filter((x) => x.kind === 'numeric' && x.expect.run)) {
      const truth = Number(psql(c.expect.sql!));
      const res = await run(c.expect.run!.rpc, c.expect.run!.args);
      expect(res.ok, `${c.id}: ${res.errorMessage}`).toBe(true);
      const d = res.data as { data: Record<string, unknown> | unknown[]; row_count: number | null };
      const spec = ASSISTANT_TOOLS.find((t) => t.rpc === c.expect.run!.rpc)!;
      const rows = spec.result.rows_path === '$' ? (d.data as unknown[]) : ((d.data as Record<string, unknown>)[spec.result.rows_path!] as unknown[]);
      expect(Array.isArray(rows), `${c.id}: rows at ${spec.result.rows_path}`).toBe(true);
      const total = Array.isArray(d.data) ? rows.length : Number((d.data as Record<string, unknown>).total ?? rows.length);
      if (c.expect.run!.counts_rows) expect(total, `${c.id}: tool total vs sql`).toBe(truth);
      if (d.row_count !== null) expect(d.row_count, `${c.id}: row_count vs rows`).toBe(rows.length);
    }
  });

  it('(c) the panel headline and the courts summary agree with the numeric truths for the eval week', async () => {
    const byId = new Map(CASES.map((c) => [c.id, c]));
    const truth = (id: string) => Number(psql(byId.get(id)!.expect.sql!));
    const panel = await run('panel_headline', { p_from: '2024-03-04', p_to: '2024-03-10' });
    expect(panel.ok, panel.errorMessage).toBe(true);
    const figures = Object.fromEntries(
      ((panel.data as { data: { figures: { key: string; value: number }[] } }).data.figures).map((f) => [f.key, f.value]),
    );
    expect(figures.revenue).toBe(truth('n01-revenue-en'));
    expect(figures.cash).toBe(truth('n02-cash-en'));
    expect(figures.card).toBe(truth('n03-card-ar'));
    expect(figures.bookings).toBe(truth('n04-bookings-en'));
    expect(figures.padelRevenue).toBe(truth('n05-padel-revenue-ar'));
    expect(figures.noShows).toBe(truth('n06-no-shows-en'));
    expect(figures.cafeNet).toBe(truth('n08-cafe-net-en'));
    expect(figures.orders).toBe(truth('n09-orders-en'));
    expect(figures.discounts).toBe(truth('n10-discounts-ar'));
    expect(figures.refunds).toBe(truth('n14-refunds-ar'));
    expect(figures.avgOrderValue).toBe(truth('n20-avg-order-value-ar'));

    const courts = await run('analytics_courts_summary', { p_from: '2024-03-04', p_to: '2024-03-10' });
    expect(courts.ok, courts.errorMessage).toBe(true);
    const kpis = (courts.data as { data: { kpis: Record<string, number> } }).data.kpis;
    expect(kpis.booked_minutes).toBe(truth('n07-booked-minutes-ar'));

    const best = await run('analytics_best_sellers', { p_from: '2024-03-04', p_to: '2024-03-10', p_limit: 1 });
    expect(best.ok, best.errorMessage).toBe(true);
    const top = (best.data as { data: { qty: number; name_en: string }[] }).data[0];
    expect(top?.qty).toBe(truth('n11-best-seller-qty-en'));
  });

  it('(c) every audit case finds a row by the expected actor through audit_page as the owner', async () => {
    for (const c of CASES.filter((x) => x.kind === 'audit')) {
      const res = await run(c.expect.run!.rpc, c.expect.run!.args);
      expect(res.ok, `${c.id}: ${res.errorMessage}`).toBe(true);
      const rows = (res.data as { data: { rows: { actorName: string; action: string }[] } }).data.rows;
      expect(rows.length, `${c.id}: no audit rows`).toBeGreaterThan(0);
      expect(rows.some((r) => r.actorName === c.expect.run!.actor), `${c.id}: actors ${rows.map((r) => r.actorName).join(',')}`).toBe(true);
    }
  });

  it('the chat function accepts the eval request shape (dry run, no model)', async () => {
    const { data } = await owner.auth.getSession();
    const token = data.session?.access_token;
    expect(token).toBeTruthy();
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/assistant-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversation_id: null, text: '', lang: 'en', scopes: ['money', 'howto'], range: { from: '2024-03-04', to: '2024-03-10' }, dry_run: true }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      console.warn('assistant-chat is not served locally; skipping the dry-run check');
      return;
    }
    if (res.status === 404 || res.status === 502 || res.status === 503) {
      console.warn(`assistant-chat answered ${res.status}; skipping the dry-run check`);
      return;
    }
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as { packs: { scope: string; tokens_est: number }[]; scopes: string[] };
    expect(Array.isArray(json.packs)).toBe(true);
    expect(json.scopes).toContain('money');
  });

  it('(e) the cleanup section leaves no eval row behind', () => {
    applyFixture('cleanup');
    const counts = evalRowCounts();
    for (const [t, n] of Object.entries(counts)) expect(n, `${t} still holds eval rows`).toBe(0);
    // Plant again so afterAll's cleanup is exercised on real rows too.
    applyFixture('plant');
    expect(evalRowCounts().tabs).toBe(5);
  });
});

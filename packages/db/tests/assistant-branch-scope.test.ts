/**
 * 0406 assistant_branch_scope — the assistant's list tools read the branches in
 * scope, by the rule the report tools use (app.report_venues()).
 *
 * The assistant-chat edge function sends the operator rail's branch as
 * x-venue-scope. The report tools honoured it; six SECURITY DEFINER list tools
 * (bookings, tabs, payments, breaks, audit, table_read) did not, so one answer
 * could mix branch A's report figures with branch B's rows. Each case plants one
 * row per tool at venue A and one at a branch B of the case's own, then calls
 * every tool through app.assistant_run_tool as the owner with x-venue-scope = A,
 * = B and absent, and checks which planted rows come back:
 *
 *   * A: A's rows only; B: B's rows only; absent: both (two open branches, so
 *     report_venues() is every branch not closed), and report_venues() itself
 *     says the same in each case;
 *   * app.assistant_count (the job estimate) gives each list tool's own total;
 *   * table_read filters a relation with venue_id (courts; promotions, whose
 *     NULL venue means every branch and stays in) and leaves a relation without
 *     one (staff) as it was.
 *
 * Everything runs in ONE rolled-back psql transaction (tests/psql-scenario.ts),
 * so branch B is never committed: no second open venue outlives the case, not
 * even on a failure (the reason tests/multi-venue.test.ts deactivates its own
 * venue B in afterAll). The fixture writes go first, as postgres with the JWT
 * claims cleared (0230): the first assistant_run_tool turns the transaction
 * read-only, and only temp tables and settings are written after it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stackAvailable } from './helpers';
import { docker, scenario, T, FX, LET, type Results } from './psql-scenario';

const up = await stackAvailable();

/** A business date of the case's own, far from any real day, and the plants at A ({{venue}}) and B ({{vb}}). */
const PLANT = [
  LET('tag', `select substr(md5(random()::text), 1, 10)`),
  LET('d', `select (date '1950-01-01' + (random() * 15000)::int)::text`),
  LET(
    'vb',
    `insert into venues (slug, name_en, name_ar, status)
     values ('bsc-' || {{tag}}, 'BSC branch B', 'فرع ب', 'open') returning id`,
  ),
  // Day sessions and tabs.
  ...(['a', 'b'] as const).flatMap((s) => {
    const v = s === 'a' ? '{{venue}}' : '{{vb}}';
    return [
      LET(
        `ds_${s}`,
        `insert into day_sessions (business_date, status, opened_by, opening_float_iqd, venue_id, closed_at)
         values ({{d}}::date, 'closed', {{owner}}::uuid, 0, ${v}::uuid, now()) returning id`,
      ),
      LET(
        `tab_${s}`,
        `insert into tabs (day_session_id, venue_id, label)
         values ({{ds_${s}}}::uuid, ${v}::uuid, 'BSC tab ${s}') returning id`,
      ),
      LET(
        `pay_${s}`,
        `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by)
         values (${v}::uuid, {{tab_${s}}}::uuid, {{ds_${s}}}::uuid, 'cash', 1000, {{owner}}::uuid) returning id`,
      ),
      LET(
        `court_${s}`,
        `insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
         values (${v}::uuid, 'BSC court ${s} ' || {{tag}}, 'ملعب ${s}', '{60,90,120}', 993, true) returning id`,
      ),
      LET(
        `bk_${s}`,
        `insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name)
         values ({{court_${s}}}::uuid, ${v}::uuid, 'booking', 'confirmed',
                 ({{d}}::date + time '12:00') at time zone 'Asia/Baghdad',
                 ({{d}}::date + time '13:00') at time zone 'Asia/Baghdad', 'desk', 'BSC guest ${s}') returning id`,
      ),
      LET(
        `br_${s}`,
        `insert into staff_breaks (staff_id, station_id, business_date, started_at, ended_at, venue_id)
         values ({{cashier}}::uuid, 'BSC-${s}', {{d}}::date,
                 ({{d}}::date + time '10:00') at time zone 'Asia/Baghdad',
                 ({{d}}::date + time '10:15') at time zone 'Asia/Baghdad', ${v}::uuid) returning id`,
      ),
      LET(
        `au_${s}`,
        `insert into audit_log (actor_id, actor_role, action, entity, entity_id, venue_id)
         values ({{owner}}::uuid, 'owner', 'test.bsc.' || {{tag}}, 'bsc', '${s}', ${v}::uuid) returning id`,
      ),
      LET(
        `promo_${s}`,
        `insert into promotions (name_en, name_ar, type, value, created_by, enabled, venue_id)
         values ('BSC promo ${s} ' || {{tag}}, 'عرض ${s}', 'percent', 5, {{owner}}::uuid, false, ${v}::uuid) returning id`,
      ),
    ];
  }),
  // NULL venue: a chain-wide promotion (0212), every branch's.
  LET(
    'promo_all',
    `insert into promotions (name_en, name_ar, type, value, created_by, enabled, venue_id)
     values ('BSC promo all ' || {{tag}}, 'عرض الكل', 'percent', 5, {{owner}}::uuid, false, null) returning id`,
  ),
];

type Scope = 'a' | 'b' | 'none';
const SCOPES: Scope[] = ['a', 'b', 'none'];
const HEADER: Record<Scope, string> = {
  a: `select set_config('request.headers', json_build_object('x-venue-scope', {{venue}})::text, true)`,
  b: `select set_config('request.headers', json_build_object('x-venue-scope', {{vb}})::text, true)`,
  none: `select set_config('request.headers', '{}', true)`,
};

const DAY = `'p_from', {{d}}, 'p_to', {{d}}`;

/** Each list tool: the dispatcher name, its args, the planted ids it should list, and its countable name. */
const TOOLS = [
  { key: 'bookings', rpc: 'assistant_bookings_list', args: `jsonb_build_object(${DAY})`, plant: 'bk', count: 'bookings_list' },
  { key: 'tabs', rpc: 'assistant_tabs_list', args: `jsonb_build_object(${DAY})`, plant: 'tab', count: 'tabs_list' },
  { key: 'payments', rpc: 'assistant_payments_list', args: `jsonb_build_object(${DAY})`, plant: 'pay', count: 'payments_list' },
  { key: 'breaks', rpc: 'assistant_break_history', args: `jsonb_build_object(${DAY})`, plant: 'br', count: 'break_history' },
  {
    key: 'audit',
    rpc: 'assistant_audit_page',
    args: `jsonb_build_object('p_action_prefix', 'test.bsc.' || {{tag}})`,
    plant: 'au',
    count: 'audit_page',
  },
  {
    key: 'courts',
    rpc: 'assistant_table_read',
    args: `jsonb_build_object('p_table', 'courts', 'p_columns', jsonb_build_array('id', 'name_en', 'venue_id'),
                              'p_filters', jsonb_build_object('id', jsonb_build_array({{court_a}}, {{court_b}})))`,
    plant: 'court',
    count: 'table_read',
  },
] as const;

/** Every call of one scope: report_venues as the owner, each tool, each count, and the two extra table reads. */
function calls(s: Scope): string[] {
  return [
    FX(HEADER[s]),
    // report_venues() is revoked from authenticated: read it as postgres with the owner's claims.
    `select pg_temp.run('rv_${s}', 'owner', $q$select to_jsonb(app.report_venues())$q$, null);`,
    ...TOOLS.flatMap((t) => [
      T(`${t.key}_${s}`, 'owner', `select app.assistant_run_tool('${t.rpc}', ${t.args})`),
      T(`cnt_${t.key}_${s}`, 'owner', `select to_jsonb(app.assistant_count('${t.count}', ${t.args}))`),
    ]),
    T(
      `promos_${s}`,
      'owner',
      `select app.assistant_run_tool('assistant_table_read', jsonb_build_object('p_table', 'promotions',
         'p_columns', jsonb_build_array('id', 'name_en'),
         'p_filters', jsonb_build_object('id', jsonb_build_array({{promo_a}}, {{promo_b}}, {{promo_all}}))))`,
    ),
    T(
      `staff_${s}`,
      'owner',
      `select app.assistant_run_tool('assistant_table_read', jsonb_build_object('p_table', 'staff',
         'p_columns', jsonb_build_array('id', 'display_name'),
         'p_filters', jsonb_build_object('id', jsonb_build_array({{owner}}, {{cashier}}))))`,
    ),
  ];
}

/** The planted ids, read back out of the transaction alongside the results. */
const IDS = `select pg_temp.q('ids', $q$select jsonb_object_agg(name, val) from pg_temp.vars$q$);`;

function data(r: Results, label: string): { rows: Array<Record<string, unknown>>; total: number } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return (o!.data as { data: { rows: Array<Record<string, unknown>>; total: number } }).data;
}

describe.skipIf(!up || !docker)('0406 assistant list tools follow the branch scope', () => {
  let r: Results = {};
  let ids: Record<string, string> = {};
  let A = '';
  let B = '';

  beforeAll(() => {
    // One transaction for every case: plants, then 3 scopes x (1 + 6 x 2 + 2) calls.
    r = scenario([...PLANT, IDS, ...SCOPES.flatMap(calls)]);
    const o = r.ids;
    expect(o?.ok, `fixture: ${o?.code ?? 'no ids'}`).toBe(true);
    ids = o!.data as Record<string, string>;
    A = ids.venue!;
    B = ids.vb!;
  });

  it('report_venues() is A, B, and both open branches with no header', () => {
    const rv = (s: Scope) => {
      const o = r[`rv_${s}`];
      expect(o?.ok, `rv_${s}: ${o?.code ?? ''}`).toBe(true);
      return o!.data as string[];
    };
    expect(rv('a')).toEqual([A]);
    expect(rv('b')).toEqual([B]);
    expect(rv('none')).toEqual(expect.arrayContaining([A, B]));
  });

  for (const t of TOOLS) {
    it(`${t.rpc}: rows of the branch in scope only, every open branch with no header`, () => {
      const mine = (s: Scope) => {
        const got = data(r, `${t.key}_${s}`).rows.map((x) => String(x.id));
        return { a: got.includes(ids[`${t.plant}_a`]!), b: got.includes(ids[`${t.plant}_b`]!) };
      };
      expect(mine('a'), 'x-venue-scope = A').toEqual({ a: true, b: false });
      expect(mine('b'), 'x-venue-scope = B').toEqual({ a: false, b: true });
      expect(mine('none'), 'no x-venue-scope').toEqual({ a: true, b: true });
    });

    it(`assistant_count('${t.count}') counts what ${t.rpc} lists, in each scope`, () => {
      for (const s of SCOPES) {
        const o = r[`cnt_${t.key}_${s}`];
        expect(o?.ok, `cnt_${t.key}_${s}: ${o?.code ?? ''}`).toBe(true);
        expect(Number(o!.data), `${t.key} ${s}`).toBe(data(r, `${t.key}_${s}`).total);
      }
    });
  }

  it('table_read keeps a NULL venue (every branch) in every scope', () => {
    const got = (s: Scope) => data(r, `promos_${s}`).rows.map((x) => String(x.id)).sort();
    expect(got('a')).toEqual([ids.promo_a!, ids.promo_all!].sort());
    expect(got('b')).toEqual([ids.promo_b!, ids.promo_all!].sort());
    expect(got('none')).toEqual([ids.promo_a!, ids.promo_b!, ids.promo_all!].sort());
  });

  it('table_read leaves a table without venue_id unfiltered', () => {
    for (const s of SCOPES) {
      const got = data(r, `staff_${s}`).rows.map((x) => String(x.id)).sort();
      expect(got, s).toEqual([ids.owner!, ids.cashier!].sort());
    }
  });
});

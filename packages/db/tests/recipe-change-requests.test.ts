/**
 * recipe_change_requests (build-contracts-2026-09-23 §2.24.7, §2.21, §2.22,
 * §3, §8.2): the head barista and the head chef ask for a recipe change, and
 * the owner approves or declines it.
 *
 *   * a head asks for a change to a size and to a prepared item; the server
 *     keeps the lines as they were (before) and what an approval writes
 *     (after); bad ops are RECORD_INVALID with the op's field, an unknown
 *     add INGREDIENT_NOT_FOUND, a shop product or an unknown target
 *     REF_NOT_FOUND; the owners get recipe_change_submitted;
 *   * the owner's approve sets recipe_lines exactly to after, through
 *     set_recipe (stock.recipe.set is audited), and tells the head; a decline
 *     needs a reason and tells the head;
 *   * a request made stale by a manager's set_recipe shows stale and its
 *     approve is RECIPE_CHANGED; an add that closes a cycle surfaces
 *     RECIPE_CYCLE; a withdrawn request cannot be decided; the owner cannot
 *     decide their own;
 *   * the manager reads every request and cannot decide; barista, chef,
 *     cashier, driver and marketing are refused the request and the reads;
 *   * my_recipe_changes carries the head's own numbers and no current
 *     quantity, no before and no after (#72).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, items, ingredients and
 * recipes are created inside it and each call runs as `authenticated` with
 * the caller's JWT claims. Nothing is committed. Without docker on PATH the
 * suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// t() runs one statement as a staff member (as `authenticated`); as() runs it
// as the definer's caller (postgres, with the JWT claims set) for internal
// functions; q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text, p_role text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_role is not null then execute 'set local role ' || p_role; end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'rc-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'RC ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const TAX = 'b0000000-0000-4000-8000-000000000001';
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c4c4';

/** A cafe latte (one size, two lines), a shop product, a prepared syrup (two lines) and spare ingredients. */
const SETUP = [
  `insert into venues (id, slug, name_en, name_ar, is_active)
   values ('${OTHER_VENUE}', 'rc-other-venue', 'RC other', 'مكان آخر', false);`,
  KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
               values ('RC drinks', 'مشروبات', '${TAX}', {{venue}}) returning id::text`),
  KEEP('shop_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
                    values ('RC shop', 'متجر', '${TAX}', {{venue}}, 'shop') returning id::text`),
  KEEP('latte', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                 values ({{cat}}::uuid, 'RC Rose latte', 'لاتيه الورد', {{venue}}) returning id::text`),
  KEEP('size', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                values ({{latte}}::uuid, 'Large', 'كبير', 5000, true) returning id::text`),
  KEEP('ball', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                values ({{shop_cat}}::uuid, 'RC Ball', 'كرة', {{venue}}) returning id::text`),
  KEEP('ball_size', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                     values ({{ball}}::uuid, 'One', 'واحدة', 9000, true) returning id::text`),
  ...(['espresso:purchased:g', 'milk:purchased:ml', 'rose:purchased:ml', 'sugar:purchased:g',
       'syrup:prepared:ml', 'base:prepared:ml', 'cup:retail:pc'] as const).map((spec) => {
    const [n, kind, unit] = spec.split(':');
    return KEEP(n!, `insert into ingredients (kind, name_en, name_ar, unit, venue_id)
                     values ('${kind}', 'RC ${n}', 'مادة ${n}', '${unit}', {{venue}}) returning id::text`);
  }),
  KEEP('old', `insert into ingredients (kind, name_en, name_ar, unit, venue_id, is_active)
               values ('purchased', 'RC old', 'قديم', 'g', {{venue}}, false) returning id::text`),
  KEEP('far', `insert into ingredients (kind, name_en, name_ar, unit, venue_id)
               values ('purchased', 'RC far', 'بعيد', 'g', '${OTHER_VENUE}') returning id::text`),
  KEEP('l_espresso', `insert into recipe_lines (variant_id, ingredient_id, qty)
                      values ({{size}}::uuid, {{espresso}}::uuid, 18) returning id::text`),
  KEEP('l_milk', `insert into recipe_lines (variant_id, ingredient_id, qty)
                  values ({{size}}::uuid, {{milk}}::uuid, 200) returning id::text`),
  KEEP('l_sugar', `insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
                   values ({{syrup}}::uuid, {{sugar}}::uuid, 500) returning id::text`),
  KEEP('l_rose', `insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
                  values ({{syrup}}::uuid, {{rose}}::uuid, 50) returning id::text`),
  // base contains syrup: adding base to syrup would close a cycle.
  `insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
   select b.val::uuid, s.val::uuid, 100 from pg_temp.vars b, pg_temp.vars s where b.name = 'base' and s.name = 'syrup';`,
];

const req = (who: string, label: string, target: string, id: string, ops: string, extra = '') =>
  T(label, who, `select app.request_recipe_change('${target}', {{${id}}}::uuid, ${ops}::jsonb${extra})`);
const ops = (...o: string[]) => `jsonb_build_array(${o.join(', ')})`;
const setOp = (line: string, qty: number | string) =>
  `jsonb_build_object('op', 'set', 'recipe_line_id', {{${line}}}, 'qty', ${qty})`;
const removeOp = (line: string) => `jsonb_build_object('op', 'remove', 'recipe_line_id', {{${line}}})`;
const addOp = (ing: string, qty: number | string) => `jsonb_build_object('op', 'add', 'ingredient_id', {{${ing}}}, 'qty', ${qty})`;
const decide = (who: string, label: string, id: string, approve: string, reason = 'null') =>
  T(label, who, `select app.decide_recipe_change({{${id}}}, ${approve}, ${reason})`);
const LINES = (label: string, target: 'variant' | 'output', id: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('ing', rl.ingredient_id, 'qty', rl.qty) order by rl.qty), '[]')
              from recipe_lines rl where rl.${target === 'variant' ? 'variant_id' : 'output_ingredient_id'} = {{${id}}}::uuid`);

/** Every key at every depth. */
function keys(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keys);
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keys(x)]);
  return [];
}

describe.skipIf(!docker)('recipe_change_requests (rolled-back transactions)', () => {
  it('a head asks; the owner approves through set_recipe; the head hears; the head reads no current quantity', () => {
    const r = scenario([
      ...SETUP,
      MK('hb', 'head_barista'), MK('hc', 'head_chef'),
      req('hb', 'size', 'variant', 'size', ops(setOp('l_espresso', 20.5), removeOp('l_milk'), addOp('rose', 15)),
          `, '  a little stronger  ', {{venue}}, 'RC-KEY-1'`),
      req('hb', 'size_replay', 'variant', 'size', ops(setOp('l_espresso', 20.5), removeOp('l_milk'), addOp('rose', 15)),
          `, null, {{venue}}, 'RC-KEY-1'`),
      RES('q_size', 'size', 'id'),
      req('hc', 'syrup', 'output', 'syrup', ops(setOp('l_sugar', 450), addOp('milk', 100))),
      RES('q_syrup', 'syrup', 'id'),
      Q('stored', `select jsonb_build_object('before', before, 'after', after, 'ops', ops, 'note', note, 'status', status)
                     from recipe_change_requests where id = {{q_size}}::uuid`),
      Q('submitted_push', `select jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                             order by o.payload->>'id')
                             from notification_outbox o
                            where o.created_at = now() and o.payload->>'title_key' = 'recipe_change_submitted'
                              and o.profile_id = {{owner}}::uuid`),
      T('mine_hb', 'hb', `select app.my_recipe_changes({{venue}})`),
      T('page_mgr', 'manager', `select app.recipe_changes_page({{venue}})`),
      decide('manager', 'mgr_decides', 'q_size', 'true'),
      decide('owner', 'approve', 'q_size', 'true'),
      LINES('latte_after', 'variant', 'size'),
      Q('recipe_audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                          where a.at = now() and (a.entity_id = 'variant:' || {{size}} or a.entity_id = {{q_size}})`),
      decide('owner', 'approve_again', 'q_size', 'true'),
      decide('owner', 'no_reason', 'q_syrup', 'false'),
      decide('owner', 'long_reason', 'q_syrup', 'false', `repeat('r', 1001)`),
      decide('owner', 'null_approve', 'q_syrup', 'null'),
      decide('owner', 'decline', 'q_syrup', 'false', `'  Not before the weekend.  '`),
      LINES('syrup_after', 'output', 'syrup'),
      Q('decided_push', `select jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                           order by o.payload->>'title_key')
                           from notification_outbox o
                          where o.created_at = now()
                            and o.payload->>'title_key' in ('recipe_change_approved', 'recipe_change_declined')`),
      T('mine_hc', 'hc', `select app.my_recipe_changes({{venue}})`),
      T('page_decided', 'owner', `select app.recipe_changes_page({{venue}}, 'decided')`),
    ]);
    const qSize = ok<{ id: string }>(r, 'size').id;
    expect(ok(r, 'size_replay')).toEqual({ id: qSize, duplicate: true });
    type Stored = { before: Array<Record<string, unknown>>; after: Array<{ ingredient_id: string; qty: number }>;
                    ops: Array<Record<string, unknown>>; note: string; status: string };
    const stored = ok<Stored>(r, 'stored');
    expect(stored.status).toBe('waiting');
    expect(stored.note).toBe('a little stronger');
    expect(stored.before.map((b) => b.qty).sort()).toEqual([18, 200]);
    expect(stored.after.map((a) => a.qty)).toEqual([20.5, 15]);
    expect(stored.ops.map((o) => o.op)).toEqual(['set', 'remove', 'add']);
    expect(stored.ops[1]).toHaveProperty('ingredient_id');
    const sub = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'submitted_push');
    expect(sub.map((p) => p.payload.id).sort()).toEqual([qSize, ok<{ id: string }>(r, 'syrup').id].sort());
    expect(sub.find((p) => p.payload.id === qSize)!.payload).toEqual({
      route: 'staff', id: qSize, title_key: 'recipe_change_submitted',
      params: { name: 'RC hb', step: { en: 'RC Rose latte', ar: 'لاتيه الورد' } },
    });
    expect(sub.every((p) => p.kind === 'staff_decide')).toBe(true);

    // The head's own numbers only: no before, no after, no current quantity.
    const mine = ok<{ requests: Array<Record<string, unknown>> }>(r, 'mine_hb').requests;
    expect(mine).toHaveLength(1);
    expect(keys(mine)).not.toContain('before');
    expect(keys(mine)).not.toContain('after');
    expect(mine[0]).toMatchObject({ target: 'variant', item_name_en: 'RC Rose latte', size_name_en: 'Large',
                                    status: 'waiting', note: 'a little stronger' });
    expect((mine[0]!.ops as Array<Record<string, unknown>>).map((o) => [o.op, o.name_en, o.qty, o.unit])).toEqual([
      ['set', 'RC espresso', 20.5, 'g'], ['remove', 'RC milk', null, 'ml'], ['add', 'RC rose', 15, 'ml'],
    ]);
    expect(JSON.stringify(mine)).not.toMatch(/"qty":\s*(18|200)\b/);

    type Page = { requests: Array<Record<string, unknown>>; waiting_count: number; total: number };
    const page = ok<Page>(r, 'page_mgr');
    const row = page.requests.find((q) => q.id === qSize)!;
    expect(row).toMatchObject({ requested_by_name: 'RC hb', stale: false, item_name_en: 'RC Rose latte',
                                size_name_en: 'Large' });
    expect((row.before as Array<{ qty: number; name_en: string }>).map((b) => [b.name_en, b.qty]).sort())
      .toEqual([['RC espresso', 18], ['RC milk', 200]]);
    expect(page.waiting_count).toBeGreaterThanOrEqual(2);
    expect(refused(r, 'mgr_decides')).toBe('FORBIDDEN');

    expect(ok(r, 'approve')).toEqual({ status: 'approved', lines_written: 2 });
    const latte = ok<Array<{ ing: string; qty: number }>>(r, 'latte_after');
    expect(latte.map((l) => l.qty)).toEqual([15, 20.5]);
    expect(ok<string[]>(r, 'recipe_audit')).toEqual(['stock.recipe.change_approve', 'stock.recipe.change_submit',
                                                     'stock.recipe.set']);
    expect(refused(r, 'approve_again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'long_reason')).toBe('TEXT_TOO_LONG:reason');
    expect(refused(r, 'null_approve')).toBe('INVALID_ARGUMENT:approve');
    expect(ok(r, 'decline')).toEqual({ status: 'declined', lines_written: 0 });
    expect(ok<Array<{ qty: number }>>(r, 'syrup_after').map((l) => l.qty)).toEqual([50, 500]);
    const decided = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'decided_push');
    expect(decided.map((p) => [p.payload.title_key, p.kind])).toEqual([
      ['recipe_change_approved', 'staff_decided'], ['recipe_change_declined', 'staff_decided'],
    ]);
    expect(decided[1]!.payload.params).toEqual({ step: { en: 'RC syrup', ar: 'مادة syrup' } });
    expect(ok<{ requests: Array<{ decline_reason: string; decided_by_name: string }> }>(r, 'mine_hc').requests[0])
      .toMatchObject({ status: 'declined', decline_reason: 'Not before the weekend.', decided_by_name: 'Dev Owner' });
    expect(ok<Page>(r, 'page_decided').requests.map((q) => q.status).sort()).toEqual(
      expect.arrayContaining(['approved', 'declined']));
  });

  it('refuses bad ops, targets and callers', () => {
    const r = scenario([
      ...SETUP,
      MK('hb', 'head_barista'),
      ...(['bar', 'chef', 'drv', 'mkt'] as const).map((w) => MK(w, { bar: 'barista', chef: 'chef', drv: 'driver', mkt: 'marketing' }[w])),
      req('hb', 'empty', 'variant', 'size', `'[]'`),
      req('hb', 'bad_op', 'variant', 'size', ops(`jsonb_build_object('op', 'swap')`)),
      req('hb', 'not_obj', 'variant', 'size', `'[1]'`),
      req('hb', 'other_line', 'variant', 'size', ops(setOp('l_sugar', 1))),
      req('hb', 'twice', 'variant', 'size', ops(setOp('l_milk', 1), removeOp('l_milk'))),
      req('hb', 'on_already', 'variant', 'size', ops(addOp('milk', 1))),
      req('hb', 'add_twice', 'variant', 'size', ops(addOp('rose', 1), addOp('rose', 2))),
      req('hb', 'add_self', 'output', 'syrup', ops(addOp('syrup', 1))),
      req('hb', 'add_old', 'variant', 'size', ops(addOp('old', 1))),
      req('hb', 'add_far', 'variant', 'size', ops(addOp('far', 1))),
      req('hb', 'add_retail', 'variant', 'size', ops(addOp('cup', 1))),
      req('hb', 'qty_zero', 'variant', 'size', ops(setOp('l_milk', 0))),
      req('hb', 'qty_tiny', 'variant', 'size', ops(addOp('rose', 0.0001))),
      req('hb', 'qty_huge', 'variant', 'size', ops(addOp('rose', 1000000000))),
      req('hb', 'qty_text', 'variant', 'size', ops(`jsonb_build_object('op', 'add', 'ingredient_id', {{rose}}, 'qty', '5')`)),
      req('hb', 'no_lines_left', 'variant', 'size', ops(removeOp('l_milk'), removeOp('l_espresso'))),
      req('hb', 'shop', 'variant', 'ball_size', ops(addOp('rose', 1))),
      req('hb', 'unknown', 'variant', 'cat', ops(addOp('rose', 1))),
      req('hb', 'not_prepared', 'output', 'milk', ops(addOp('rose', 1))),
      T('bad_target', 'hb', `select app.request_recipe_change('modifier', gen_random_uuid(), '[]'::jsonb)`),
      req('hb', 'long_note', 'variant', 'size', ops(addOp('rose', 1)), `, repeat('n', 1001)`),
      req('hb', 'too_many', 'variant', 'size',
          `(select jsonb_agg(jsonb_build_object('op', 'add', 'ingredient_id', gen_random_uuid(), 'qty', 1)) from generate_series(1, 31))`),
      ...(['bar', 'chef', 'cashier', 'drv', 'mkt', 'desk', 'manager', 'owner'] as const).map((who) =>
        req(who, `req_${who}`, 'variant', 'size', ops(addOp('rose', 1)))),
      ...(['bar', 'chef', 'cashier', 'drv', 'mkt', 'manager'] as const).map((who) =>
        T(`mine_${who}`, who, `select app.my_recipe_changes({{venue}})`)),
      ...(['hb', 'bar', 'chef', 'cashier', 'drv', 'mkt', 'desk'] as const).map((who) =>
        T(`page_${who}`, who, `select app.recipe_changes_page({{venue}})`)),
      T('page_bad', 'manager', `select app.recipe_changes_page({{venue}}, 'mine')`),
      // §8.2: the table is MGMT's.
      ...(['hb', 'drv', 'mkt'] as const).map((who) => T(`read_${who}`, who, `select to_jsonb(count(*)) from recipe_change_requests`)),
    ]);
    expect(refused(r, 'empty')).toBe('RECORD_INVALID:ops');
    expect(refused(r, 'bad_op')).toBe('RECORD_INVALID:ops.0.op');
    expect(refused(r, 'not_obj')).toBe('RECORD_INVALID:ops.0');
    expect(refused(r, 'other_line')).toBe('RECORD_INVALID:ops.0.recipe_line_id');
    expect(refused(r, 'twice')).toBe('RECORD_INVALID:ops.1.recipe_line_id');
    expect(refused(r, 'on_already')).toBe('RECORD_INVALID:ops.0.ingredient_id');
    expect(refused(r, 'add_twice')).toBe('RECORD_INVALID:ops.1.ingredient_id');
    expect(refused(r, 'add_self')).toBe('RECORD_INVALID:ops.0.ingredient_id');
    expect(refused(r, 'add_old')).toBe('INGREDIENT_NOT_FOUND:ops.0.ingredient_id');
    expect(refused(r, 'add_far')).toBe('INGREDIENT_NOT_FOUND:ops.0.ingredient_id');
    expect(refused(r, 'add_retail')).toBe('INGREDIENT_NOT_FOUND:ops.0.ingredient_id');
    expect(refused(r, 'qty_zero')).toBe('RECORD_INVALID:ops.0.qty');
    expect(refused(r, 'qty_tiny')).toBe('RECORD_INVALID:ops.0.qty');
    expect(refused(r, 'qty_huge')).toBe('RECORD_INVALID:ops.0.qty');
    expect(refused(r, 'qty_text')).toBe('RECORD_INVALID:ops.0.qty');
    expect(refused(r, 'no_lines_left')).toBe('RECORD_INVALID:ops');
    expect(refused(r, 'shop')).toBe('REF_NOT_FOUND:target_id');
    expect(refused(r, 'unknown')).toBe('REF_NOT_FOUND:target_id');
    expect(refused(r, 'not_prepared')).toBe('REF_NOT_FOUND:target_id');
    expect(refused(r, 'bad_target')).toBe('INVALID_ARGUMENT:target');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'too_many')).toBe('RECORD_INVALID:ops');
    for (const who of ['bar', 'chef', 'cashier', 'drv', 'mkt', 'desk', 'manager', 'owner']) {
      expect(refused(r, `req_${who}`), who).toBe('FORBIDDEN');
    }
    for (const who of ['bar', 'chef', 'cashier', 'drv', 'mkt', 'manager']) {
      expect(refused(r, `mine_${who}`), who).toBe('FORBIDDEN');
    }
    for (const who of ['hb', 'bar', 'chef', 'cashier', 'drv', 'mkt', 'desk']) {
      expect(refused(r, `page_${who}`), who).toBe('FORBIDDEN');
    }
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');
    for (const who of ['hb', 'drv', 'mkt']) expect(ok<number>(r, `read_${who}`), who).toBe(0);
  });

  it('a stale request is RECIPE_CHANGED, a cycle is RECIPE_CYCLE, a withdrawn one stays withdrawn, and never your own', () => {
    const r = scenario([
      ...SETUP,
      MK('hb', 'head_barista'), MK('hc', 'head_chef'), MK('drv', 'driver'),
      req('hb', 'stale', 'variant', 'size', ops(setOp('l_milk', 180))),
      RES('q_stale', 'stale', 'id'),
      // The manager edits the latte in Stock ▸ Recipes meanwhile.
      T('mgr_edit', 'manager', `select to_jsonb(app.set_recipe('variant', {{size}}::uuid,
            jsonb_build_array(jsonb_build_object('ingredient_id', {{espresso}}, 'qty', 18),
                              jsonb_build_object('ingredient_id', {{milk}}, 'qty', 220))))`),
      T('page', 'owner', `select app.recipe_changes_page({{venue}})`),
      decide('owner', 'approve_stale', 'q_stale', 'true'),
      LINES('latte_after', 'variant', 'size'),
      // The item goes off sale: a fresh request against it is refused too.
      req('hb', 'fresh', 'variant', 'size', ops(addOp('rose', 5))),
      RES('q_fresh', 'fresh', 'id'),
      `update menu_items set is_active = false where id = (select val::uuid from pg_temp.vars where name = 'latte');`,
      decide('owner', 'approve_inactive', 'q_fresh', 'true'),
      req('hc', 'cycle', 'output', 'syrup', ops(addOp('base', 10))),
      RES('q_cycle', 'cycle', 'id'),
      decide('owner', 'approve_cycle', 'q_cycle', 'true'),
      req('hc', 'wd_req', 'output', 'syrup', ops(setOp('l_rose', 60))),
      RES('q_wd', 'wd_req', 'id'),
      T('wd_other', 'hb', `select app.withdraw_recipe_change({{q_wd}})`),
      T('wd_drv', 'drv', `select app.withdraw_recipe_change({{q_wd}})`),
      T('wd', 'hc', `select app.withdraw_recipe_change({{q_wd}})`),
      T('wd_again', 'hc', `select app.withdraw_recipe_change({{q_wd}})`),
      decide('owner', 'decide_withdrawn', 'q_wd', 'false', `'no'`),
      T('wd_missing', 'hc', `select app.withdraw_recipe_change(gen_random_uuid())`),
      // An owner's own request (written straight to the table: no owner can ask).
      KEEP('q_own', `insert into recipe_change_requests (venue_id, target, variant_id, requested_by, ops, before, after)
                     values ({{venue}}, 'variant', {{size}}::uuid, {{owner}}::uuid, '[]', '[]', '[]') returning id::text`),
      decide('owner', 'own', 'q_own', 'false', `'mine'`),
      Q('audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                   where a.entity = 'recipe_change_request' and a.entity_id = {{q_wd}}`),
    ]);
    const stale = ok<{ requests: Array<{ id: string; stale: boolean }> }>(r, 'page').requests
      .find((q) => q.id === ok<{ id: string }>(r, 'stale').id)!;
    expect(stale.stale).toBe(true);
    expect(refused(r, 'approve_stale')).toBe('RECIPE_CHANGED');
    expect(ok<Array<{ qty: number }>>(r, 'latte_after').map((l) => l.qty)).toEqual([18, 220]);
    expect(refused(r, 'approve_inactive')).toBe('RECIPE_CHANGED');
    expect(refused(r, 'approve_cycle')).toBe('RECIPE_CYCLE');
    expect(refused(r, 'wd_other')).toBe('FORBIDDEN');
    expect(refused(r, 'wd_drv')).toBe('FORBIDDEN');
    expect(ok(r, 'wd')).toEqual({ status: 'withdrawn' });
    expect(refused(r, 'wd_again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'decide_withdrawn')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'wd_missing')).toBe('REF_NOT_FOUND:id');
    expect(refused(r, 'own')).toBe('CANNOT_DECIDE_OWN');
    expect(ok<string[]>(r, 'audit')).toEqual(['stock.recipe.change_submit', 'stock.recipe.change_withdraw']);
  });
});

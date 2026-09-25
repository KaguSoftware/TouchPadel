/**
 * recipe_view (build-contracts-2026-09-23 §2.24.6, §8.2): recipes as
 * ingredient names, with no quantity, for the bar and kitchen family and MGMT
 * (#72, the PARKED-default of §0 P3).
 *
 *   * for every reader, MGMT included, no key at any depth is named qty,
 *     quantity or unit, or ends in _iqd, or starts with cost, supplier,
 *     revenue or discount;
 *   * active cafe items with each size's lines, and prepared ingredients with
 *     an output recipe; shop products, inactive items and add-on lines are
 *     absent; one item by id, whose prepared list is empty;
 *   * the four bar and kitchen roles and MGMT read; the court desk, cashier,
 *     driver, marketing and prep are refused (§8.2); an unknown, shop,
 *     inactive or other-venue item is REF_NOT_FOUND.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, items, ingredients and
 * recipes are created inside it and each call runs as `authenticated` with the
 * caller's JWT claims. Nothing is committed. Without docker on PATH the suite
 * skips itself.
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
  values (v, 'rv-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'RV ' || p_name, p_role, true);
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

const TAX = 'b0000000-0000-4000-8000-000000000001';
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c7c7';
const SETUP = [
  `insert into venues (id, slug, name_en, name_ar, is_active)
   values ('${OTHER_VENUE}', 'rv-other-venue', 'RV other', 'مكان آخر', false);`,
  KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
               values ('RV drinks', 'مشروبات', '${TAX}', {{venue}}) returning id::text`),
  KEEP('shop_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
                    values ('RV shop', 'متجر', '${TAX}', {{venue}}, 'shop') returning id::text`),
  KEEP('far_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                   values ('RV far', 'بعيد', '${TAX}', '${OTHER_VENUE}') returning id::text`),
  ...(['latte:cat:true', 'old:cat:false', 'ball:shop_cat:true', 'far:far_cat:true'] as const).map((spec) => {
    const [n, cat, active] = spec.split(':');
    return KEEP(n!, `insert into menu_items (category_id, name_en, name_ar, venue_id, is_active)
                     select {{${cat}}}::uuid, 'RV ${n}', 'صنف ${n}', c.venue_id, ${active}
                       from menu_categories c where c.id = {{${cat}}}::uuid returning id::text`);
  }),
  ...(['latte', 'old', 'ball', 'far'] as const).map((n) =>
    KEEP(`${n}_size`, `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                       values ({{${n}}}::uuid, 'Large', 'كبير', 5000, true) returning id::text`)),
  ...(['espresso:purchased', 'milk:purchased', 'sugar:purchased', 'syrup:prepared', 'cup:retail'] as const).map((spec) => {
    const [n, kind] = spec.split(':');
    return KEEP(n!, `insert into ingredients (kind, name_en, name_ar, unit, venue_id, pack_cost_iqd, supplier_name)
                     values ('${kind}', 'RV ${n}', 'مادة ${n}', 'g', {{venue}}, 25000, 'RV Mill') returning id::text`);
  }),
  KEEP('grp', `insert into modifier_groups (name_en, name_ar, min_select, max_select)
               values ('RV extras', 'إضافات', 0, 2) returning id::text`),
  KEEP('mod', `insert into modifiers (group_id, name_en, name_ar, price_delta_iqd)
               values ({{grp}}::uuid, 'RV extra shot', 'جرعة إضافية', 1000) returning id::text`),
  `insert into recipe_lines (variant_id, ingredient_id, qty)
   select s.val::uuid, i.val::uuid, q from (values ('latte_size', 'espresso', 18), ('latte_size', 'milk', 200),
     ('old_size', 'milk', 100), ('ball_size', 'cup', 1), ('far_size', 'milk', 5)) x(s, i, q)
   join pg_temp.vars s on s.name = x.s join pg_temp.vars i on i.name = x.i;`,
  `insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
   select (select val::uuid from pg_temp.vars where name = 'syrup'), (select val::uuid from pg_temp.vars where name = 'sugar'), 500;`,
  `insert into recipe_lines (modifier_id, ingredient_id, qty)
   select (select val::uuid from pg_temp.vars where name = 'mod'), (select val::uuid from pg_temp.vars where name = 'espresso'), 18;`,
];

/** Keys a names-only read must never carry, at any depth. */
function forbiddenKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => forbiddenKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/^(qty|quantity|unit)$|_iqd$|^cost|^supplier|^revenue|^discount|price/i.test(k) ? [`${path}.${k}`] : []),
      ...forbiddenKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

type Line = { recipe_line_id: string; ingredient_id: string; name_en: string };
type View = {
  items: Array<{ menu_item_id: string; name_en: string; category_name_en: string;
                 sizes: Array<{ variant_id: string; name_en: string; lines: Line[] }> }>;
  prepared: Array<{ ingredient_id: string; name_en: string; lines: Line[] }>;
};
const READERS = ['hb', 'bar', 'hc', 'chef', 'manager', 'owner'] as const;
const OTHERS = ['desk', 'cashier', 'drv', 'mkt', 'prep'] as const;

describe.skipIf(!docker)('recipe_view (rolled-back transactions)', () => {
  it('reads recipes as names only, for the bar and kitchen family and MGMT, and no one else', () => {
    const r = scenario([
      ...SETUP,
      MK('hb', 'head_barista'), MK('bar', 'barista'), MK('hc', 'head_chef'), MK('chef', 'chef'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      ...READERS.map((who) => T(`view_${who}`, who, `select app.recipe_view({{venue}})`)),
      ...OTHERS.map((who) => T(`view_${who}`, who, `select app.recipe_view({{venue}})`)),
      T('one', 'bar', `select app.recipe_view(null, {{latte}}::uuid)`),
      T('one_shop', 'bar', `select app.recipe_view(null, {{ball}}::uuid)`),
      T('one_old', 'bar', `select app.recipe_view(null, {{old}}::uuid)`),
      T('one_far', 'owner', `select app.recipe_view(null, {{far}}::uuid)`),
      T('one_unknown', 'bar', `select app.recipe_view(null, gen_random_uuid())`),
      T('one_wrong_venue', 'bar', `select app.recipe_view('${OTHER_VENUE}', {{latte}}::uuid)`),
      T('one_drv', 'drv', `select app.recipe_view(null, {{latte}}::uuid)`),
    ]);
    for (const who of READERS) {
      const view = ok<View>(r, `view_${who}`);
      expect(forbiddenKeys(view), who).toEqual([]);
      const names = view.items.map((i) => i.name_en).filter((n) => n.startsWith('RV '));
      expect(names, who).toEqual(['RV latte']);
      const latte = view.items.find((i) => i.name_en === 'RV latte')!;
      expect(latte.category_name_en).toBe('RV drinks');
      expect(latte.sizes.map((s) => [s.name_en, s.lines.map((l) => l.name_en)])).toEqual([
        ['Large', ['RV espresso', 'RV milk']],
      ]);
      expect(latte.sizes[0]!.lines[0]!.recipe_line_id).toMatch(/^[0-9a-f-]{36}$/);
      const syrup = view.prepared.find((p) => p.name_en === 'RV syrup')!;
      expect(syrup.lines.map((l) => l.name_en)).toEqual(['RV sugar']);
      expect(view.prepared.map((p) => p.name_en)).not.toContain('RV espresso');
      expect(JSON.stringify(view), who).not.toMatch(/RV extra shot|RV Mill|RV cup/);
    }
    for (const who of OTHERS) expect(refused(r, `view_${who}`), who).toBe('FORBIDDEN');
    const one = ok<View>(r, 'one');
    expect(one.items.map((i) => i.name_en)).toEqual(['RV latte']);
    expect(one.prepared).toEqual([]);
    for (const l of ['one_shop', 'one_old', 'one_far', 'one_unknown', 'one_wrong_venue']) {
      expect(refused(r, l), l).toBe('REF_NOT_FOUND:menu_item_id');
    }
    expect(refused(r, 'one_drv')).toBe('FORBIDDEN');
  });
});

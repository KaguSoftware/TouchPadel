/**
 * shopping_head_approval (build-contracts-2026-09-23 §2.24.9, §2.15, §2.21,
 * §2.22, §8.2): the chef assistant's shopping lines wait for the head chef's
 * OK before the driver sees them.
 *
 *   * a chef's line is pending: the driver is refused the pending list and
 *     never finds it among the open lines; shopping_to_approve reaches the
 *     head chefs only (the managers when the venue has none), once in 15
 *     minutes;
 *   * the head chef approves it, it is open and the drivers get
 *     shopping_new; a decline needs a reason and reaches the chef with
 *     shopping_declined; a decided line is SUBMISSION_DECIDED;
 *   * a head barista's, a head chef's and a manager's lines go straight to
 *     open; the barista is still refused to add;
 *   * record_purchase refuses a pending line with SHOPPING_ITEM_NOT_OPEN; the
 *     requester or MGMT cancels a pending line;
 *   * head_barista, barista, cashier, driver and marketing are refused
 *     decide_shopping_item (§8.2).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff and lines are created inside
 * it and each call runs as `authenticated` with the caller's JWT claims.
 * Nothing is committed. Without docker on PATH the suite skips itself.
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
  values (v, 'sha-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SHA ' || p_name, p_role, true);
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
const add = (label: string) => `select app.add_shopping_item({{venue}}, null, '${label}', 2, 'pc')`;
const decide = (id: string, approve: string, reason = 'null') =>
  `select app.decide_shopping_item({{${id}}}, ${approve}, ${reason})`;
/** This transaction's pushes of one title key: who got them, by role, and the payload. */
const PUSHED = (label: string, titleKey: string) =>
  Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'role', s.role, 'kind', o.kind,
                                                         'payload', o.payload) order by o.id), '[]')
              from notification_outbox o join staff s on s.id = o.profile_id
             where o.created_at = now() and o.payload->>'title_key' = '${titleKey}'`);

interface Line {
  id: string;
  label: string;
  status: string;
  mine: boolean;
  decline_reason: string | null;
}
type List = { items: Line[]; open_count: number; pending_count: number };
interface Push {
  to: string;
  role: string;
  kind: string;
  payload: Record<string, unknown>;
}

describe.skipIf(!docker)('shopping_head_approval (rolled-back transactions)', () => {
  it('a chef’s line waits for the head chef, hidden from the driver; the OK sends it to the driver', () => {
    const r = scenario([
      MK('chef', 'chef'), MK('chef2', 'chef'), MK('hc', 'head_chef'), MK('hb', 'head_barista'), MK('bar', 'barista'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('chef_add', 'chef', add('Pistachio paste')),
      T('chef_add2', 'chef', add('Vanilla pods')),
      T('chef2_add', 'chef2', add('Cream')),
      RES('l1', 'chef_add', 'id'), RES('l2', 'chef_add2', 'id'), RES('l3', 'chef2_add', 'id'),
      Q('statuses', `select jsonb_object_agg(label, status) from shopping_items
                      where id in ({{l1}}::uuid, {{l2}}::uuid, {{l3}}::uuid)`),
      PUSHED('to_approve', 'shopping_to_approve'),
      PUSHED('new_before', 'shopping_new'),
      T('drv_pending', 'drv', `select app.shopping_list({{venue}}, 'pending')`),
      T('drv_declined', 'drv', `select app.shopping_list({{venue}}, 'declined')`),
      T('drv_open', 'drv', `select app.shopping_list({{venue}})`),
      ...(['chef', 'hc', 'bar', 'hb', 'manager'] as const).map((who) =>
        T(`pending_${who}`, who, `select app.shopping_list({{venue}}, 'pending')`)),
      T('buy_pending', 'drv', `select app.record_purchase({{venue}},
         jsonb_build_array(jsonb_build_object('shopping_item_id', {{l1}}, 'qty', 1, 'price_iqd', 1000)), 1000, null, null)`),
      ...(['hb', 'bar', 'cashier', 'drv', 'mkt', 'chef2', 'desk'] as const).map((who) =>
        T(`decide_${who}`, who, decide('l1', 'true'))),
      T('approve', 'hc', decide('l1', 'true')),
      T('approve_again', 'hc', decide('l1', 'false', `'no'`)),
      PUSHED('new_after', 'shopping_new'),
      T('drv_open_after', 'drv', `select app.shopping_list({{venue}})`),
      T('buy', 'drv', `select app.record_purchase({{venue}},
         jsonb_build_array(jsonb_build_object('shopping_item_id', {{l1}}, 'qty', 2, 'price_iqd', 1000)), 1000, null, null)`),
      T('no_reason', 'hc', decide('l2', 'false')),
      T('long_reason', 'hc', decide('l2', 'false', `repeat('r', 301)`)),
      T('null_approve', 'hc', decide('l2', 'null')),
      T('decline', 'manager', decide('l2', 'false', `'  We still have two jars.  '`)),
      PUSHED('declined_push', 'shopping_declined'),
      T('chef_declined', 'chef', `select app.shopping_list({{venue}}, 'declined')`),
      T('missing', 'hc', `select app.decide_shopping_item(gen_random_uuid(), true)`),
      T('cancel_pending', 'chef2', `select to_jsonb(true) from (select app.cancel_shopping_item({{l3}})) x`),
      T('decide_cancelled', 'hc', decide('l3', 'true')),
      Q('audit', `select jsonb_agg(a.action order by a.action) from audit_log a
                   where a.entity = 'shopping_item' and a.entity_id in ({{l1}}, {{l2}}, {{l3}})`),
    ]);
    expect(ok(r, 'statuses')).toEqual({ 'Pistachio paste': 'pending', 'Vanilla pods': 'pending', Cream: 'pending' });
    const toApprove = ok<Push[]>(r, 'to_approve');
    expect(toApprove.length).toBeGreaterThan(0);
    // Head chefs only, and each once for the burst of three lines.
    expect(new Set(toApprove.map((p) => p.role))).toEqual(new Set(['head_chef']));
    expect(new Set(toApprove.map((p) => p.to)).size).toBe(toApprove.length);
    expect(toApprove[0]).toMatchObject({ kind: 'staff_decide', payload: {
      route: 'staff-shopping', title_key: 'shopping_to_approve', params: { name: 'SHA chef' },
      dedupe: `shopping-approve:${VENUE_A_ID}` } });
    expect(ok<Push[]>(r, 'new_before')).toEqual([]);
    expect(refused(r, 'drv_pending')).toBe('FORBIDDEN:status');
    expect(refused(r, 'drv_declined')).toBe('FORBIDDEN:status');
    const drvOpen = ok<List>(r, 'drv_open');
    expect(drvOpen.items.map((i) => i.label)).not.toContain('Pistachio paste');
    expect(drvOpen.pending_count).toBe(0);
    for (const who of ['chef', 'hc', 'bar', 'hb', 'manager']) {
      const list = ok<List>(r, `pending_${who}`);
      expect(list.items.map((i) => i.label), who).toEqual(expect.arrayContaining(['Pistachio paste', 'Cream']));
      expect(list.pending_count, who).toBeGreaterThanOrEqual(3);
    }
    expect(ok<List>(r, 'pending_chef').items.find((i) => i.label === 'Pistachio paste')!.mine).toBe(true);
    expect(refused(r, 'buy_pending')).toBe('SHOPPING_ITEM_NOT_OPEN');
    for (const who of ['hb', 'bar', 'cashier', 'drv', 'mkt', 'chef2', 'desk']) {
      expect(refused(r, `decide_${who}`), who).toBe('FORBIDDEN');
    }
    expect(ok(r, 'approve')).toEqual({ id: ok<{ id: string }>(r, 'chef_add').id, status: 'open' });
    expect(refused(r, 'approve_again')).toBe('SUBMISSION_DECIDED');
    const newAfter = ok<Push[]>(r, 'new_after');
    expect(newAfter.length).toBeGreaterThan(0);
    expect(new Set(newAfter.map((p) => p.role))).toEqual(new Set(['driver']));
    expect(newAfter[0]!.payload).toEqual({ route: 'staff-shopping', title_key: 'shopping_new', params: {},
                                           dedupe: `shopping:${VENUE_A_ID}` });
    expect(ok<List>(r, 'drv_open_after').items.map((i) => i.label)).toContain('Pistachio paste');
    ok(r, 'buy');
    expect(refused(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'long_reason')).toBe('TEXT_TOO_LONG:reason');
    expect(refused(r, 'null_approve')).toBe('INVALID_ARGUMENT:approve');
    expect(ok(r, 'decline')).toEqual({ id: ok<{ id: string }>(r, 'chef_add2').id, status: 'declined' });
    const declined = ok<Push[]>(r, 'declined_push');
    expect(declined.map((p) => [p.role, p.kind])).toEqual([['chef', 'staff_decided']]);
    expect(declined[0]!.payload).toEqual({ route: 'staff-shopping', title_key: 'shopping_declined', params: {} });
    expect(ok<List>(r, 'chef_declined').items.find((i) => i.label === 'Vanilla pods'))
      .toMatchObject({ status: 'declined', decline_reason: 'We still have two jars.', mine: true });
    expect(refused(r, 'missing')).toBe('SHOPPING_ITEM_NOT_OPEN');
    ok(r, 'cancel_pending');
    expect(refused(r, 'decide_cancelled')).toBe('SUBMISSION_DECIDED');
    expect(ok<string[]>(r, 'audit')).toEqual(['shopping.add', 'shopping.add', 'shopping.add', 'shopping.approve',
                                              'shopping.cancel', 'shopping.decline']);
  });

  it('the heads’ and MGMT’s lines go straight to open; the barista still cannot add', () => {
    const r = scenario([
      MK('hc', 'head_chef'), MK('hb', 'head_barista'), MK('bar', 'barista'), MK('drv', 'driver'),
      T('hb_add', 'hb', add('Oat milk')),
      T('hc_add', 'hc', add('Flour')),
      T('mgr_add', 'manager', add('Bin bags')),
      T('owner_add', 'owner', add('Napkins')),
      T('bar_add', 'bar', add('Ice')),
      Q('statuses', `select jsonb_object_agg(label, status) from shopping_items
                      where label in ('Oat milk', 'Flour', 'Bin bags', 'Napkins') and requested_at = now()`),
      PUSHED('to_approve', 'shopping_to_approve'),
    ]);
    expect(ok(r, 'statuses')).toEqual({ 'Oat milk': 'open', Flour: 'open', 'Bin bags': 'open', Napkins: 'open' });
    expect(refused(r, 'bar_add')).toBe('FORBIDDEN');
    expect(ok<Push[]>(r, 'to_approve')).toEqual([]);
  });

  it('asks the managers when the venue has no head chef', () => {
    const r = scenario([
      MK('chef', 'chef'),
      `update staff set is_active = false where role = 'head_chef' and is_active;`,
      T('chef_add', 'chef', add('Saffron')),
      PUSHED('to_approve', 'shopping_to_approve'),
    ]);
    ok(r, 'chef_add');
    const pushes = ok<Push[]>(r, 'to_approve');
    expect(pushes.length).toBeGreaterThan(0);
    expect(new Set(pushes.map((p) => p.role))).toEqual(new Set(['manager']));
    expect(pushes.map((p) => p.to)).toContain(SEED_STAFF_IDS.manager);
  });
});

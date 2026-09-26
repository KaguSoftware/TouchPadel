/**
 * staff_push_keys (build-contracts-2026-09-23 §2.24.1, §2.21): the role spec's
 * eleven push title keys in app.notify_staff.
 *
 *   * each new key queues a row for an active recipient, on the route its
 *     sender uses (shopping_to_approve and shopping_declined on
 *     staff-shopping, the rest on staff);
 *   * an unknown key is still INVALID_ARGUMENT (hint title_key), and no kind
 *     or route was added;
 *   * the function lists the eleven after purchase_to_receive, in the JSON's
 *     order (tests/staff-push.test.ts holds the whole list to the JSON);
 *   * no client role, the driver and marketing included, may call it (§8.2);
 *   * wave 5 (wave5-addendum-2026-09-25 §2.3): its eleven keys follow the
 *     role spec's, each queues a row on route staff, and a guest's call
 *     reaches the venue's active waiters only, with the table's number and
 *     nothing about the guest, once per call, and never fails the call.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff are created inside it and each
 * call runs with the caller's JWT claims. Nothing is committed: no outbox row
 * stays on the shared stack. Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import staffPush from '../supabase/functions/_shared/staff-push.json';
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
// t() runs one statement as a staff member (as `authenticated`) and records
// its result or error; q() reads as postgres; keep() stores a value; mk()
// makes an auth user + staff row (the 0123 trigger files a non-owner at
// venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'), ('venue', '${VENUE_A_ID}');

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
  values (v, 'spk-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SPK ' || p_name, p_role, true);
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

/** As the definer's own caller (postgres, with the JWT claims set): what an RPC body does. */
const AS = (label: string, who: string, sql: string) => `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, null);`;
/** As `authenticated`, the way PostgREST runs a client's call. */
const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;

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

/** The eleven, the route each one's sender uses, and a params shape it sends (§2.21). */
const KEYS: Array<[string, string, string, Record<string, unknown>]> = [
  ['idea_submitted', 'staff_decide', 'staff', { name: 'Yusuf', title: 'Rose latte' }],
  ['idea_started', 'staff_decided', 'staff', { title: 'Rose latte' }],
  ['idea_declined', 'staff_decided', 'staff', { title: 'Rose latte' }],
  ['teaching_new', 'staff_info', 'staff', { name: 'Bareq', title: 'Milk texture' }],
  ['recipe_change_submitted', 'staff_decide', 'staff', { name: 'Rusul', step: { en: 'Brownie', ar: 'براوني' } }],
  ['recipe_change_approved', 'staff_decided', 'staff', { step: { en: 'Brownie', ar: 'براوني' } }],
  ['recipe_change_declined', 'staff_decided', 'staff', { step: { en: 'Brownie', ar: 'براوني' } }],
  ['shopping_to_approve', 'staff_decide', 'staff-shopping', { name: 'Tiba' }],
  ['shopping_declined', 'staff_decided', 'staff-shopping', {}],
  ['marketing_request_new', 'staff_task', 'staff', { name: 'Hasan', title: 'Poster' }],
  ['marketing_request_answered', 'staff_decided', 'staff', { title: 'Poster' }],
];

/** Wave 5's eleven (wave5-addendum §2.3): every one on route staff, params from {step, title, name}. */
const WAVE5_KEYS: Array<[string, string, string, Record<string, unknown>]> = [
  ['deduction_proposed', 'staff_decide', 'staff', { name: 'Bareq' }],
  ['deduction_approved', 'staff_decided', 'staff', {}],
  ['deduction_declined', 'staff_decided', 'staff', {}],
  ['deduction_recorded', 'staff_info', 'staff', {}],
  ['incident_reported', 'staff_task', 'staff', { name: 'Hussein', step: { en: 'Injury', ar: 'إصابة' } }],
  ['incident_reviewed', 'staff_info', 'staff', { step: { en: 'Injury', ar: 'إصابة' } }],
  ['content_submitted', 'staff_decide', 'staff', { name: 'Hasan', title: 'Friday reel' }],
  ['content_approved', 'staff_decided', 'staff', { title: 'Friday reel' }],
  ['content_changes', 'staff_decided', 'staff', { title: 'Friday reel' }],
  ['content_declined', 'staff_decided', 'staff', { title: 'Friday reel' }],
  ['waiter_call_new', 'staff_task', 'staff', { title: 'T12' }],
];

const notify = (key: string, kind: string, route: string, params: Record<string, unknown>) =>
  `select to_jsonb(app.notify_staff(array[{{bar}}, {{gone}}]::uuid[], '${kind}',
     jsonb_build_object('route', '${route}', 'id', 'spk-${key}', 'title_key', '${key}',
                        'params', '${JSON.stringify(params)}'::jsonb)))`;

describe('staff-push.json and app.notify_staff (the role spec keys)', () => {
  it('lists the eleven keys after purchase_to_receive, adding no kind and no route', () => {
    const keys = staffPush.title_keys;
    expect(keys.indexOf('purchase_to_receive')).toBe(14);
    expect(keys.slice(15, 26)).toEqual(KEYS.map(([k]) => k));
    expect(staffPush.kinds).toEqual(['staff_task', 'staff_decide', 'staff_decided', 'staff_info']);
    expect(staffPush.routes).toHaveLength(7);
  });
});

describe.skipIf(!docker)('staff_push_keys (rolled-back transactions)', () => {
  it('queues each new key for an active recipient and skips an inactive one', () => {
    const r = scenario([
      MK('bar', 'barista'),
      MK('gone', 'barista'),
      `update staff set is_active = false where id = (select val::uuid from pg_temp.vars where name = 'gone');`,
      ...KEYS.map(([key, kind, route, params]) => AS(`n_${key}`, 'manager', notify(key, kind, route, params))),
      Q('rows', `select jsonb_object_agg(o.payload->>'title_key', jsonb_build_object(
                   'to', o.profile_id, 'kind', o.kind, 'route', o.payload->>'route', 'params', o.payload->'params'))
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'id' like 'spk-%'`),
    ]);
    const rows = ok<Record<string, { to: string; kind: string; route: string; params: unknown }>>(r, 'rows');
    for (const [key, kind, route, params] of KEYS) {
      expect(ok<number>(r, `n_${key}`), key).toBe(1);
      expect(rows[key], key).toMatchObject({ kind, route, params });
    }
    expect(Object.keys(rows).sort()).toEqual(KEYS.map(([k]) => k).sort());
  });

  it('still refuses an unknown key, and holds the kind and route lists', () => {
    const r = scenario([
      MK('bar', 'barista'),
      AS('unknown', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_info',
            '{"route":"staff","title_key":"idea_exploded","params":{}}'::jsonb))`),
      AS('kind', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_idea',
            '{"route":"staff","title_key":"idea_submitted","params":{}}'::jsonb))`),
      AS('route', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_decide',
            '{"route":"staff-ideas","title_key":"idea_submitted","params":{}}'::jsonb))`),
      AS('shop_route', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_decide',
            '{"route":"staff-shopping","title_key":"shopping_to_approve","params":{"name":"Tiba"}}'::jsonb))`),
      AS('extra_param', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_decide',
            '{"route":"staff","title_key":"recipe_change_submitted","params":{"qty":250}}'::jsonb))`),
    ]);
    expect(refused(r, 'unknown')).toBe('INVALID_ARGUMENT:title_key');
    expect(refused(r, 'kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'route')).toBe('INVALID_ARGUMENT:route');
    expect(ok<number>(r, 'shop_route')).toBe(1);
    // A quantity cannot ride along on a recipe change's push.
    expect(refused(r, 'extra_param')).toBe('INVALID_ARGUMENT:params');
  });

  it('lists the keys in the function in the JSON order', () => {
    const def = psql(`select pg_get_functiondef('app.notify_staff(uuid[],text,jsonb,text)'::regprocedure)`);
    const m = def.match(/c_title_keys\s+constant text\[\] := array\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const keys = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(keys).toHaveLength(37);
    expect(keys.slice(15, 26)).toEqual(KEYS.map(([k]) => k));
    expect(keys.slice(26)).toEqual(WAVE5_KEYS.map(([k]) => k));
  });

  it('is no client role’s to call: the driver, marketing and the rest are refused', () => {
    const r = scenario([
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      MK('hc', 'head_chef'),
      ...(['drv', 'mkt', 'hc', 'manager', 'owner'] as const).map((who) =>
        T(`call_${who}`, who, `select to_jsonb(app.notify_staff(array[{{manager}}]::uuid[], 'staff_info',
              '{"route":"staff","title_key":"teaching_new","params":{}}'::jsonb))`)),
    ]);
    for (const who of ['drv', 'mkt', 'hc', 'manager', 'owner']) {
      expect(refused(r, `call_${who}`), who).toMatch(/permission denied/);
    }
  });
});

describe('staff-push.json and app.notify_staff (wave 5 keys)', () => {
  it('lists the eleven after the role spec keys, adding no kind and no route', () => {
    expect(staffPush.title_keys.indexOf('marketing_request_answered')).toBe(25);
    expect(staffPush.title_keys.slice(26)).toEqual(WAVE5_KEYS.map(([k]) => k));
    expect(staffPush.routes).toHaveLength(7);
  });
});

describe.skipIf(!docker)('staff_push_keys_wave5 (rolled-back transactions)', () => {
  it('queues each wave-5 key for an active recipient and skips an inactive one', () => {
    const r = scenario([
      MK('bar', 'barista'),
      MK('gone', 'barista'),
      `update staff set is_active = false where id = (select val::uuid from pg_temp.vars where name = 'gone');`,
      ...WAVE5_KEYS.map(([key, kind, route, params]) => AS(`n_${key}`, 'manager', notify(key, kind, route, params))),
      Q('rows', `select jsonb_object_agg(o.payload->>'title_key', jsonb_build_object(
                   'to', o.profile_id, 'kind', o.kind, 'route', o.payload->>'route', 'params', o.payload->'params'))
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'id' like 'spk-%'`),
      // An amount cannot ride along on a deduction's push.
      AS('amount', 'manager', `select to_jsonb(app.notify_staff(array[{{bar}}]::uuid[], 'staff_decide',
            '{"route":"staff","title_key":"deduction_proposed","params":{"name":"Bareq","amount_iqd":50000}}'::jsonb))`),
    ]);
    const rows = ok<Record<string, { to: string; kind: string; route: string; params: unknown }>>(r, 'rows');
    for (const [key, kind, route, params] of WAVE5_KEYS) {
      expect(ok<number>(r, `n_${key}`), key).toBe(1);
      expect(rows[key], key).toMatchObject({ kind, route, params });
    }
    expect(Object.keys(rows).sort()).toEqual(WAVE5_KEYS.map(([k]) => k).sort());
    expect(refused(r, 'amount')).toBe('INVALID_ARGUMENT:params');
  });

  // A table and a guest session at venue A, for a call the guest raises
  // through app.raise_waiter_call as PostgREST runs it. A stale till
  // heartbeat would lock guests out (ensureTillFresh, inside the transaction).
  const TABLE = [
    `update device_heartbeats set last_seen_at = now(), queue_depth = 0
      where venue_id = '${VENUE_A_ID}' and (is_till or device_id like 'TILL%');`,
    KEEP('tbl', `insert into cafe_tables (table_number, venue_id) values ('SPK-' || left(gen_random_uuid()::text, 8), {{venue}})
                 returning id::text`),
    KEEP('guest', `insert into auth.users (id, raw_user_meta_data, aud, role, is_anonymous)
                   values (gen_random_uuid(), '{}', 'authenticated', 'authenticated', true) returning id::text`),
    KEEP('sess', `insert into guest_sessions (table_id, auth_user_id, expires_at, venue_id)
                  values ({{tbl}}::uuid, {{guest}}::uuid, now() + interval '1 hour', {{venue}}) returning id::text`),
  ];
  const pushes = (label: string) =>
    Q(label, `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                                        order by o.profile_id), '[]'::jsonb)
                from notification_outbox o
               where o.created_at = now() and o.payload->>'title_key' = 'waiter_call_new'`);

  it('tells the venue’s active waiters of a guest’s call, with the table’s number only, once per call', () => {
    const r = scenario([
      MK('w1', 'waiter'),
      MK('w2', 'waiter'),
      MK('w_off', 'waiter'),
      `update staff set is_active = false where id = (select val::uuid from pg_temp.vars where name = 'w_off');`,
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      MK('bar', 'barista'),
      MK('ab', 'assistant_barista'),
      ...TABLE,
      T('call', 'guest', `select app.raise_waiter_call('water')`),
      pushes('push'),
      Q('who', `select jsonb_build_object('w1', {{w1}}, 'w2', {{w2}}, 'w_off', {{w_off}}, 'others',
                   jsonb_build_array({{drv}}, {{mkt}}, {{bar}}, {{ab}}))`),
      // Whoever else got it (the dev waiter account, say) is an active waiter too.
      Q('roles', `select jsonb_agg(distinct s.role::text || ':' || s.is_active::text)
                    from notification_outbox o join staff s on s.id = o.profile_id
                   where o.created_at = now() and o.payload->>'title_key' = 'waiter_call_new'`),
      // The same call's id again (a replayed insert) queues nothing more.
      AS('again', 'manager', `select to_jsonb(app.notify_staff(
            app.staff_ids_with_roles({{venue}}, array['waiter']::staff_role[]), 'staff_task',
            jsonb_build_object('route', 'staff', 'id', null, 'title_key', 'waiter_call_new',
                               'params', jsonb_build_object('title', 'x')),
            'waiter_call:' || (select id from waiter_calls where table_id = {{tbl}}::uuid)))`),
    ]);
    const call = ok<{ call_id: string; status: string }>(r, 'call');
    expect(call.status).toBe('raised');
    const push = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'push');
    const who = ok<{ w1: string; w2: string; w_off: string; others: string[] }>(r, 'who');
    const to = push.map((p) => p.to);
    expect(to).toEqual(expect.arrayContaining([who.w1, who.w2]));
    for (const id of [who.w_off, ...who.others]) expect(to).not.toContain(id);
    expect(ok<string[]>(r, 'roles')).toEqual(['waiter:true']);
    for (const p of push) {
      expect(p.kind).toBe('staff_task');
      expect(p.payload).toEqual({
        route: 'staff',
        id: null,
        title_key: 'waiter_call_new',
        params: { title: expect.stringMatching(/^SPK-/) },
        dedupe: `waiter_call:${call.call_id}`,
      });
    }
    expect(ok<number>(r, 'again')).toBe(0);
  });

  it('never fails the guest’s call when its push cannot be queued', () => {
    const r = scenario([
      MK('w1', 'waiter'),
      ...TABLE,
      // notify_staff is gone for the length of this rolled-back transaction.
      `alter function app.notify_staff(uuid[], text, jsonb, text) rename to notify_staff_spk_gone;`,
      T('call', 'guest', `select app.raise_waiter_call('bill')`),
      Q('calls', `select to_jsonb(count(*)) from waiter_calls where table_id = {{tbl}}::uuid`),
      pushes('push'),
    ]);
    expect(ok<{ status: string }>(r, 'call').status).toBe('raised');
    expect(ok<number>(r, 'calls')).toBe(1);
    expect(ok<unknown[]>(r, 'push')).toEqual([]);
  });
});

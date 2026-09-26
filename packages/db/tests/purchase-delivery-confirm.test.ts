/**
 * purchase_delivery_confirm (build-contracts-2026-09-23 §2.24.10, §2.22, §8.2):
 * the driver confirms a purchase was delivered to the venue.
 *
 *   * the buyer confirms once, and a repeat returns the first confirmation;
 *     another driver is FORBIDDEN; a manager can confirm; a purchase received
 *     first can still be confirmed; an unknown purchase is PURCHASE_NOT_FOUND;
 *   * my_purchases carries receipt_path and delivered_at, and
 *     purchases_to_receive delivered_at and delivered_by_name;
 *   * cashier, marketing and the bar and kitchen roles are refused (§8.2);
 *     no push is sent, and purchase.deliver is audited with no text.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, purchases and receipts are
 * created inside it and each call runs as `authenticated` with the caller's
 * JWT claims. Nothing is committed. Without docker on PATH the suite skips
 * itself.
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
  values (v, 'pdc-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'PDC ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A photo: a slot minted by p_who in p_folder, and its storage object.
create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid; v_path text;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_path := app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path';
  insert into storage.objects (bucket_id, name, owner, owner_id) values ('staff-media', v_path, v_uid, v_uid::text);
  insert into pg_temp.vars values (p_name, v_path);
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
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
/** Through the staff_media_read storage policy, as the reader. */
const SEES = (label: string, who: string, photo: string) =>
  T(label, who, `select to_jsonb(count(*) = 1) from storage.objects where bucket_id = 'staff-media' and name = {{${photo}}}`);

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
const buy = (receipt = 'null') =>
  `select app.record_purchase({{venue}}, '[{"label":"PDC ice","qty":2,"price_iqd":1500}]'::jsonb, 1500,
     'Corner shop', ${receipt})`;
const confirm = (id: string) => `select app.confirm_purchase_delivery({{${id}}})`;

type Confirmed = { purchase_id: string; delivered_at: string | null; delivered_by_name: string | null };

describe.skipIf(!docker)('purchase_delivery_confirm (rolled-back transactions)', () => {
  it('the buyer confirms once; another driver cannot; a manager can; receiving never waits for it', () => {
    const r = scenario([
      MK('drv', 'driver'), MK('drv2', 'driver'), MK('mkt', 'marketing'),
      ...(['hb', 'bar', 'hc', 'chef'] as const).map((w) =>
        MK(w, { hb: 'head_barista', bar: 'barista', hc: 'head_chef', chef: 'chef' }[w])),
      PHOTO('receipt', 'drv', 'receipts'),
      T('p1', 'drv', buy('{{receipt}}')),
      T('p2', 'drv', buy()),
      T('p3', 'drv', buy()),
      RES('p1', 'p1', 'purchase_id'), RES('p2', 'p2', 'purchase_id'), RES('p3', 'p3', 'purchase_id'),
      Q('push_before', `select to_jsonb(count(*)) from notification_outbox where created_at = now()`),
      T('first', 'drv', confirm('p1')),
      T('repeat', 'drv', confirm('p1')),
      Q('push_after', `select to_jsonb(count(*)) from notification_outbox where created_at = now()`),
      T('other_driver', 'drv2', confirm('p2')),
      ...(['mkt', 'cashier', 'hb', 'bar', 'hc', 'chef', 'desk', 'prep'] as const).map((who) =>
        T(`confirm_${who}`, who, confirm('p2'))),
      T('by_manager', 'manager', confirm('p2')),
      T('missing', 'drv', `select app.confirm_purchase_delivery(gen_random_uuid())`),
      // Received first (acknowledged: the one line is not stock), then confirmed.
      KEEP('p3_line', `select id::text from purchase_lines where purchase_id = {{p3}}::uuid`),
      T('ack', 'manager', `select to_jsonb(true) from (select app.acknowledge_purchase_line({{p3_line}})) x`),
      T('after_receive', 'drv', confirm('p3')),
      T('mine', 'drv', `select app.my_purchases({{venue}})`),
      T('to_receive', 'manager', `select app.purchases_to_receive({{venue}})`),
      Q('audit', `select jsonb_agg(jsonb_build_object('entity', a.entity_id, 'after', a.after) order by a.entity_id)
                    from audit_log a where a.action = 'purchase.deliver' and a.at = now()`),
      SEES('drv_sees_receipt', 'drv', 'receipt'),
      SEES('drv2_sees_receipt', 'drv2', 'receipt'),
    ]);
    const first = ok<Confirmed>(r, 'first');
    expect(first).toMatchObject({ purchase_id: ok<{ purchase_id: string }>(r, 'p1').purchase_id,
                                  delivered_by_name: 'PDC drv' });
    expect(first.delivered_at).not.toBeNull();
    expect(ok<Confirmed>(r, 'repeat')).toEqual(first);
    // No push (record_purchase already told the managers).
    expect(ok<number>(r, 'push_after')).toBe(ok<number>(r, 'push_before'));
    expect(refused(r, 'other_driver')).toBe('FORBIDDEN');
    for (const who of ['mkt', 'cashier', 'hb', 'bar', 'hc', 'chef', 'desk', 'prep']) {
      expect(refused(r, `confirm_${who}`), who).toBe('FORBIDDEN');
    }
    expect(ok<Confirmed>(r, 'by_manager').delivered_by_name).toBe('Dev Manager');
    expect(refused(r, 'missing')).toBe('PURCHASE_NOT_FOUND');
    ok(r, 'ack');
    expect(ok<Confirmed>(r, 'after_receive').delivered_by_name).toBe('PDC drv');

    type Mine = { purchases: Array<{ id: string; status: string; receipt_path: string | null; delivered_at: string | null }> };
    const mine = Object.fromEntries(ok<Mine>(r, 'mine').purchases.map((p) => [p.id, p]));
    const p1 = ok<{ purchase_id: string }>(r, 'p1').purchase_id;
    const p2 = ok<{ purchase_id: string }>(r, 'p2').purchase_id;
    const p3 = ok<{ purchase_id: string }>(r, 'p3').purchase_id;
    expect(mine[p1]).toMatchObject({ receipt_path: expect.stringMatching(/\/receipts\//), delivered_at: first.delivered_at });
    expect(mine[p2]!.delivered_at).not.toBeNull();
    expect(mine[p3]).toMatchObject({ status: 'done', receipt_path: null });
    type ToReceive = { purchases: Array<{ id: string; delivered_at: string | null; delivered_by_name: string | null }> };
    const tr = Object.fromEntries(ok<ToReceive>(r, 'to_receive').purchases.map((p) => [p.id, p]));
    expect(tr[p1]).toMatchObject({ delivered_by_name: 'PDC drv', delivered_at: first.delivered_at });
    expect(tr[p2]).toMatchObject({ delivered_by_name: 'Dev Manager' });
    expect(tr[p3]).toBeUndefined();
    const audit = ok<Array<{ entity: string; after: Record<string, unknown> }>>(r, 'audit');
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.after.delivered === true)).toBe(true);
    // The buyer reads their own receipt; another driver does not.
    expect(ok<boolean>(r, 'drv_sees_receipt')).toBe(true);
    expect(ok<boolean>(r, 'drv2_sees_receipt')).toBe(false);
  });
});

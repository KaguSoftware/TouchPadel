/**
 * staff_roles_assistant_waiter + assistant_barista_waiter_access
 * (docs/design/protocols/wave5-addendum-2026-09-25.md §2.1, §6.1): the
 * assistant barista (Hussein) and the waiter (Hasan), and exactly the guards
 * each one passes.
 *
 *   * both hold the any-staff baseline 0156 made role-agnostic: breaks, the
 *     own PIN, the heartbeat, leave requests, suggestions, their checklists,
 *     asking marketing, notes on new items and their protocol work;
 *   * the assistant barista works the bar's tickets (BOARD, PROPOSAL §8 Q1):
 *     kitchen_board with no money key, set_ticket_status,
 *     set_order_item_ready and the tickets read; he is in the bar team, so he
 *     reads the bar's teachings (not the kitchen's), gets their push and
 *     their photos, and reads recipe names with no quantity; he writes no
 *     teaching and gets no shopping, stock, ideas, production, protocol
 *     start, till, desk or waiter call;
 *   * the waiter joins no team and no board (§8 Q2, Q3); his cleaning list
 *     needs its photo, which a second waiter and MGMT read and a driver,
 *     marketing or a barista do not;
 *   * the waiter answers guests' calls (§2.1.8, §8 Q3 answered): he gets the
 *     waiter_call_new push, reads the call and its table, acks and resolves
 *     it, and hears the 'floor' topic but not 'kds'; a call at another venue
 *     is missing to him (and to the cashier); driver, marketing and the
 *     assistant barista still get none of it;
 *   * neither reads tabs, orders or order lines;
 *   * both are hireable (a position, an owner-added step) and set_staff_role
 *     moves an account onto each and back;
 *   * driver and marketing are unchanged: no board, no teachings, no recipes.
 *
 * HOW. Two halves. Through PostgREST, the new-roles.test.ts way: one auth
 * user + staff row per new role through the service role (the 0123 trigger
 * files each at venue A), deleted in afterAll with the probe station, its
 * heartbeat row, the requests and the attempt rows the PIN check wrote; the
 * probe tab and ticket stay behind, as kds-item-ready's do. Everything that
 * writes a record is ONE psql transaction that is rolled back (the
 * teachings.test.ts harness), so nothing it creates outlives the scenario.
 * tests/rls-matrix.ts keeps its eight principals; these roles are not in it.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  createTestMenuItem,
  createTestCafeTable,
  ensureOpenDay,
  ensureTillFresh,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PASSWORD,
  VENUE_A_ID,
} from './helpers';

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
// The broadcast policies live on realtime.messages, which a bare Postgres
// lacks (0022 skips them there, and so does the topic case below).
const realtime = docker && psql(`select to_regclass('realtime.messages') is not null`) === 't';

const NEW_ROLES = ['assistant_barista', 'waiter'] as const;
type NewRole = (typeof NEW_ROLES)[number];

// Registered up front by the service role, so app.heartbeat never files it
// itself: a station the caller registered would pin the staff row
// (stations.registered_by) and afterAll could not delete it.
const STATION = 'ABW-PROBE';
const OWN_PIN = '618240';

/** Every key at every depth, so a money column cannot hide in a nested object. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

// ── through PostgREST ─────────────────────────────────────────────────────────
describe.skipIf(!up)('wave 5 roles through PostgREST', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let cashier: SupabaseClient;

  const ids = {} as Record<NewRole, string>;
  const as = {} as Record<NewRole, SupabaseClient>;
  const requestIds: string[] = [];

  let ticketId: string;
  let orderItemId: string;
  let orderId: string;
  let tabId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    cashier = await signedInClient(SEED_STAFF.cashier);

    const reg = await svc
      .from('stations')
      .upsert({ id: STATION, venue_id: VENUE_A_ID, is_till: false, retired_at: null }, { onConflict: 'id' });
    expect(reg.error).toBeNull();

    for (const role of NEW_ROLES) {
      const email = `abw-${role}-${Date.now()}@test.touch.local`;
      const { data, error } = await svc.auth.admin.createUser({
        email,
        password: DEV_PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${role} failed: ${error?.message}`);
      ids[role] = data.user.id;
      const ins = await svc
        .from('staff')
        .insert({ id: data.user.id, display_name: `Test ${role}`, role, is_active: true });
      if (ins.error) throw new Error(`staff insert ${role} failed: ${ins.error.message}`);
      const pin = await appRpc(owner, 'set_staff_pin', { p_staff_id: data.user.id, p_pin: OWN_PIN });
      expect(pin.error, `set_staff_pin ${role}`).toBeNull();
      as[role] = await signedInClient(email);
    }

    // A real ticket on the board, placed the way the till places one.
    await ensureTillFresh(svc);
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await ensureOpenDay(manager, svc);
    } finally {
      await manager.auth.signOut();
    }
    const item = await createTestMenuItem(svc, 'abw', 3000);
    const tab = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'abw'),
      p_label: `abw-${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (tab.error) throw new Error(tab.error.message);
    tabId = (tab.data as { tab_id: string }).tab_id;
    const order = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (order.error) throw new Error(order.error.message);
    ticketId = (order.data as { ticket_id: string }).ticket_id;
    orderId = (order.data as { order_id: string }).order_id;
    const { data: line, error: lineErr } = await svc.from('order_items').select('id').eq('order_id', orderId).single();
    if (lineErr) throw new Error(lineErr.message);
    orderItemId = (line as { id: string }).id;
  });

  afterAll(async () => {
    const staffIds = Object.values(ids);
    // Each delete is asserted: a cleanup that silently fails leaves a staff
    // row the next run trips over.
    let r = await svc.from('staff_requests').delete().in('staff_id', staffIds);
    expect(r.error).toBeNull();
    // The requests' insert and delete both enqueued an index row (0110);
    // the source rows are gone, so the queue rows are noise.
    r = await svc.from('assistant_index_queue').delete().eq('kind', 'request').in('ref', requestIds);
    expect(r.error).toBeNull();
    r = await svc.from('device_heartbeats').delete().eq('device_id', STATION);
    expect(r.error).toBeNull();
    r = await svc.from('stations').delete().eq('id', STATION);
    expect(r.error).toBeNull();
    for (const id of staffIds) {
      r = await svc.schema('app').from('pin_attempts').delete().like('device_id', `${id}:%`);
      expect(r.error).toBeNull();
    }
    for (const role of NEW_ROLES) await as[role]?.auth.signOut();
    for (const id of staffIds) {
      r = await svc.from('staff').delete().eq('id', id);
      expect(r.error, `staff delete ${id}`).toBeNull();
      await svc.auth.admin.deleteUser(id).catch(() => undefined);
    }
    for (const c of [owner, cashier]) await c?.auth.signOut();
  });

  it('both hold the any-staff baseline', async () => {
    for (const role of NEW_ROLES) {
      const c = as[role];

      const brk = await appRpc(c, 'break_status', { p_device_id: STATION });
      expect(brk.error, `${role} break_status`).toBeNull();
      expect(typeof (brk.data as { allowance_seconds: number }).allowance_seconds).toBe('number');

      const own = await appRpc(c, 'verify_own_pin', { p_pin: OWN_PIN, p_device_id: STATION });
      expect(own.error, `${role} verify_own_pin`).toBeNull();
      expect(own.data, `${role} verify_own_pin`).toBe(true);

      const beat = await appRpc(c, 'heartbeat', {
        p_device_id: STATION,
        p_queue_depth: 0,
        p_app_version: 'test',
        p_is_till: false,
      });
      expect(beat.error, `${role} heartbeat`).toBeNull();
      expect((beat.data as { server_time: string }).server_time).toBeTruthy();

      const ask = await appRpc(c, 'submit_staff_request', {
        p_kind: 'leave',
        p_from: '2026-11-01',
        p_to: '2026-11-02',
        p_note: `abw ${role}`,
      });
      expect(ask.error, `${role} submit_staff_request`).toBeNull();
      requestIds.push(ask.data as string);

      for (const fn of ['my_checklists_today', 'my_protocol_work', 'my_suggestions']) {
        const read = await appRpc(c, fn, { p_venue_id: VENUE_A_ID });
        expect(read.error, `${role} ${fn}`).toBeNull();
      }
    }
  });

  it('the assistant barista works the bar’s tickets, with no money anywhere', async () => {
    const c = as.assistant_barista;

    const board = await appRpc(c, 'kitchen_board', {});
    expect(board.error).toBeNull();
    const tickets = (board.data as { tickets: { id: string }[] }).tickets;
    expect(tickets.map((t) => t.id)).toContain(ticketId);
    const money = keysDeep(board.data).filter((k) => k.endsWith('_iqd') || k.startsWith('cost'));
    expect(money).toEqual([]);

    const seen = await c.from('tickets').select('id').eq('id', ticketId);
    expect(seen.error).toBeNull();
    expect(seen.data).toHaveLength(1);

    const bump = await appRpc(c, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
    expect(bump.error).toBeNull();
    expect((bump.data as { status: string }).status).toBe('preparing');

    const mark = await appRpc(c, 'set_order_item_ready', { p_order_item_id: orderItemId, p_ready: true });
    expect(mark.error).toBeNull();
  });

  it('the waiter holds no board', async () => {
    const c = as.waiter;

    const seen = await c.from('tickets').select('id').eq('id', ticketId);
    expect(seen.error).toBeNull();
    expect(seen.data).toHaveLength(0);

    const board = await appRpc(c, 'kitchen_board', {});
    expect(board.error?.message).toBe('FORBIDDEN');
    const bump = await appRpc(c, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
    expect(bump.error?.message).toBe('FORBIDDEN');
    const mark = await appRpc(c, 'set_order_item_ready', { p_order_item_id: orderItemId, p_ready: false });
    expect(mark.error?.message).toBe('FORBIDDEN');
  });

  it('neither reads tabs, orders or order lines', async () => {
    for (const role of NEW_ROLES) {
      for (const [table, column, id] of [
        ['tabs', 'id', tabId],
        ['orders', 'id', orderId],
        ['order_items', 'id', orderItemId],
        ['order_item_modifiers', 'order_item_id', orderItemId],
      ] as const) {
        const rows = await as[role].from(table).select(column).eq(column, id);
        expect(rows.error).toBeNull();
        expect(rows.data, `${role} reads no ${table}`).toHaveLength(0);
      }
    }
    // The till still reads them.
    const own = await cashier.from('orders').select('id').eq('id', orderId);
    expect(own.data).toHaveLength(1);
  });
});

// ── in rolled-back transactions ───────────────────────────────────────────────
// run() executes one statement as a staff member (as `authenticated`, with the
// caller's JWT claims); q() reads or writes as postgres; keep() stores a value;
// mk() makes an auth user + staff row (the 0123 trigger files a non-owner at
// venue A); photo() mints a slot and its storage object (teachings.test.ts).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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
  values (v, 'abw-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'ABW ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

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

const T = (label: string, who: string, sql: string) => `select pg_temp.run('${label}', '${who}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
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

const WHO = ['abar', 'wtr'] as const;
const NEW = [MK('abar', 'assistant_barista'), MK('wtr', 'waiter')];
const NIL = `'00000000-0000-4000-8000-000000000000'::uuid`;
/** Inserted inactive inside a scenario, so it never joins the owner's venues. */
const OTHER_VENUE = '00000000-0000-4000-8000-00000000abce';

describe.skipIf(!docker)('wave 5 roles (rolled-back transactions)', () => {
  it('both write what any staff member writes', () => {
    const r = scenario([
      ...NEW,
      ...WHO.flatMap((who) => [
        T(`sug_${who}`, who, `select app.add_suggestion('More shade on court 2', {{venue}})`),
        T(`mine_${who}`, who, `select app.my_suggestions({{venue}})`),
        T(`ask_${who}`, who, `select app.add_marketing_request('Poster', 'For the weekend', p_venue_id => {{venue}})`),
        // Past the any-staff guard: an item not in release answers as missing.
        T(`note_${who}`, who, `select app.add_release_note(${NIL}, 'Tastes right')`),
        T(`work_${who}`, who, `select app.my_protocol_work({{venue}})`),
      ]),
    ]);
    for (const who of WHO) {
      ok(r, `sug_${who}`);
      const mine = ok<{ suggestions: { body: string }[] }>(r, `mine_${who}`).suggestions;
      expect(mine.map((s) => s.body), who).toEqual(['More shade on court 2']);
      ok(r, `ask_${who}`);
      expect(refused(r, `note_${who}`), who).toBe('ITEM_NOT_FOUND');
      ok(r, `work_${who}`);
    }
  });

  it('the assistant barista is in the bar: its teachings, their push and photos, recipe names; he writes none', () => {
    const r = scenario([
      ...NEW,
      MK('hb', 'head_barista'), MK('hc', 'head_chef'), MK('drv', 'driver'), MK('mkt', 'marketing'),
      PHOTO('p1', 'hb', 'teachings'),
      T('bar_t', 'hb', `select app.save_teaching('Milk texture', '60 degrees.', p_photos => array[{{p1}}], p_venue_id => {{venue}})`),
      RES('t', 'bar_t', 'id'),
      T('kitchen_t', 'hc', `select app.save_teaching('Brownie bake', '22 minutes.', p_venue_id => {{venue}})`),
      Q('pushed', `select jsonb_object_agg(v.name, exists (select 1 from notification_outbox o
                     where o.created_at = now() and o.payload->>'title_key' = 'teaching_new'
                       and o.payload->>'id' = {{t}} and o.profile_id = v.val::uuid))
                    from pg_temp.vars v where v.name in ('abar','wtr','drv','mkt')`),
      T('list', 'abar', `select app.teachings_for_me({{venue}})`),
      T('list_kitchen', 'abar', `select app.teachings_for_me({{venue}}, 'kitchen')`),
      T('write', 'abar', `select app.save_teaching('x', 'y', p_venue_id => {{venue}})`),
      T('write_bar', 'abar', `select app.save_teaching('x', 'y', p_team => 'bar', p_venue_id => {{venue}})`),
      T('edit', 'abar', `select app.save_teaching('x', 'y', p_id => {{t}})`),
      ...(['abar', 'wtr', 'drv', 'mkt'] as const).map((who) => SEES(`sees_${who}`, who, 'p1')),

      // A cafe item with a recipe line, to read by name.
      KEEP('cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
                   values ('ABW drinks', 'مشروبات', 'b0000000-0000-4000-8000-000000000001', {{venue}}) returning id::text`),
      KEEP('latte', `insert into menu_items (category_id, name_en, name_ar, venue_id, is_active)
                     values ({{cat}}::uuid, 'ABW latte', 'لاتيه', {{venue}}, true) returning id::text`),
      KEEP('size', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                    values ({{latte}}::uuid, 'Large', 'كبير', 5000, true) returning id::text`),
      KEEP('bean', `insert into ingredients (kind, name_en, name_ar, unit, venue_id, pack_cost_iqd)
                    values ('purchased', 'ABW espresso', 'إسبريسو', 'g', {{venue}}, 25000) returning id::text`),
      `insert into recipe_lines (variant_id, ingredient_id, qty)
       select (select val::uuid from pg_temp.vars where name = 'size'), (select val::uuid from pg_temp.vars where name = 'bean'), 18;`,
      T('recipes', 'abar', `select app.recipe_view({{venue}})`),
    ]);

    expect(ok(r, 'pushed')).toEqual({ abar: true, wtr: false, drv: false, mkt: false });
    const list = ok<{ teachings: { id: string; team: string; title: string; editable: boolean }[] }>(r, 'list').teachings;
    expect(list.map((t) => t.title)).toContain('Milk texture');
    expect(list.map((t) => t.title)).not.toContain('Brownie bake');
    expect(list.every((t) => t.team === 'bar')).toBe(true);
    expect(list.find((t) => t.title === 'Milk texture')).toMatchObject({ editable: false });
    expect(refused(r, 'list_kitchen')).toBe('FORBIDDEN');
    expect(refused(r, 'write')).toBe('FORBIDDEN');
    expect(refused(r, 'write_bar')).toBe('FORBIDDEN');
    expect(refused(r, 'edit')).toBe('FORBIDDEN');
    expect(ok<boolean>(r, 'sees_abar')).toBe(true);
    for (const who of ['wtr', 'drv', 'mkt']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);

    const recipes = ok<{ items: { name_en: string; sizes: { lines: { name_en: string }[] }[] }[] }>(r, 'recipes');
    const latte = recipes.items.find((i) => i.name_en === 'ABW latte');
    expect(latte?.sizes[0]?.lines.map((l) => l.name_en)).toEqual(['ABW espresso']);
    expect(keysDeep(recipes).filter((k) => /^(qty|quantity|unit)$/.test(k))).toEqual([]);
  });

  it('the assistant barista stops at the bar’s tickets and pages; the waiter at the baseline', () => {
    const calls: Record<string, string> = {
      shopping_list: `select app.shopping_list({{venue}})`,
      add_shopping_item: `select app.add_shopping_item({{venue}}, null, 'Oat milk', 2, 'l')`,
      staff_ingredient_options: `select app.staff_ingredient_options({{venue}})`,
      staff_stock_view: `select app.staff_stock_view({{venue}})`,
      submit_release_idea: `select app.submit_release_idea('{"name_en":"x"}', p_venue_id => {{venue}})`,
      request_recipe_change: `select app.request_recipe_change('variant', ${NIL}, '[]', p_venue_id => {{venue}})`,
      record_batch: `select app.record_batch(${NIL}, 1, p_venue_id => {{venue}})`,
      production_today: `select app.production_today({{venue}})`,
      start_release: `select app.start_protocol('product_release', p_venue_id => {{venue}})`,
      start_price: `select app.start_protocol('price_promo', p_venue_id => {{venue}})`,
      marketing_requests_page: `select app.marketing_requests_page({{venue}})`,
      open_tab: `select app.open_tab(p_label => 'abw')`,
      staff_create_reservation: `select app.staff_create_reservation(${NIL}, 'booking', now() + interval '1 day', now() + interval '1 day 1 hour')`,
      ack_waiter_call: `select app.ack_waiter_call(${NIL})`,
    };
    const waiterCalls: Record<string, string> = {
      kitchen_board: `select app.kitchen_board()`,
      set_ticket_status: `select app.set_ticket_status(${NIL}, 'preparing')`,
      set_order_item_ready: `select app.set_order_item_ready(${NIL}, true)`,
      teachings_for_me: `select app.teachings_for_me({{venue}})`,
      recipe_view: `select app.recipe_view({{venue}})`,
      shopping_list: calls.shopping_list!,
      // ack_waiter_call is his since §2.1.8 (the waiter-call case below), and
      // staff_stock_view is lane S's to pin: he joins STOCK_VIEW in
      // stock_store_reads (§2.8.5, staff-stock-view.test.ts).
      open_tab: calls.open_tab!,
      submit_release_idea: calls.submit_release_idea!,
      start_release: calls.start_release!,
    };
    const unchanged: Record<string, string> = {
      kitchen_board: waiterCalls.kitchen_board!,
      teachings_for_me: waiterCalls.teachings_for_me!,
      recipe_view: waiterCalls.recipe_view!,
    };
    const r = scenario([
      ...NEW,
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      ...Object.entries(calls).map(([name, sql]) => T(`abar_${name}`, 'abar', sql)),
      ...Object.entries(waiterCalls).map(([name, sql]) => T(`wtr_${name}`, 'wtr', sql)),
      ...(['drv', 'mkt'] as const).flatMap((who) =>
        Object.entries(unchanged).map(([name, sql]) => T(`${who}_${name}`, who, sql))),
      // Neither reads the order side or a ticket through the tables.
      ...WHO.flatMap((who) =>
        ['tabs', 'orders', 'order_items', 'order_item_modifiers', 'payments'].map((table) =>
          T(`${who}_read_${table}`, who, `select to_jsonb(count(*)) from ${table}`))),
      T('wtr_read_tickets', 'wtr', `select to_jsonb(count(*)) from tickets`),
      Q('tickets_exist', `select to_jsonb(count(*) > 0) from tickets`),
    ]);
    for (const name of Object.keys(calls)) expect(refused(r, `abar_${name}`), `assistant_barista ${name}`).toBe('FORBIDDEN');
    for (const name of Object.keys(waiterCalls)) expect(refused(r, `wtr_${name}`), `waiter ${name}`).toBe('FORBIDDEN');
    for (const who of ['drv', 'mkt']) {
      for (const name of Object.keys(unchanged)) expect(refused(r, `${who}_${name}`), `${who} ${name}`).toBe('FORBIDDEN');
    }
    for (const who of WHO) {
      for (const table of ['tabs', 'orders', 'order_items', 'order_item_modifiers', 'payments']) {
        expect(ok<number>(r, `${who}_read_${table}`), `${who} ${table}`).toBe(0);
      }
    }
    if (ok<boolean>(r, 'tickets_exist')) expect(ok<number>(r, 'wtr_read_tickets')).toBe(0);
  });

  it('the waiter’s cleaning list needs its photo, which the waiters and MGMT read and no one else', () => {
    const photoLine = JSON.stringify([
      { text_en: 'Photo of the clean floor', text_ar: 'صورة الأرضية نظيفة', photo_required: true },
      { text_en: 'Chairs up', text_ar: 'ارفع الكراسي' },
    ]);
    const r = scenario([
      // Start from no waiter list, whatever another session committed; the
      // rollback puts it back (as checklist-photos.test.ts does for all).
      `delete from checklist_run_items where run_id in (select id from checklist_runs where role = 'waiter');
       delete from checklist_runs where role = 'waiter';
       delete from checklist_template_items where template_id in (select id from checklist_templates where role = 'waiter');
       delete from checklist_templates where role = 'waiter';`,
      ...NEW,
      MK('wtr2', 'waiter'), MK('bar', 'barista'), MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('tpl', 'owner', `select app.save_checklist_template({{venue}}, 'waiter', 'close', 0, 'Closing', 'الإغلاق', '${photoLine}'::jsonb)`),
      T('today', 'wtr', `select app.my_checklists_today({{venue}})`),
      RES('item', 'today', 'lists,0,items,0,id'),
      PHOTO('p1', 'wtr', 'checklists'),
      T('no_photo', 'wtr', `select app.mark_checklist_item({{item}}, true)`),
      T('with_photo', 'wtr', `select app.mark_checklist_item({{item}}, true, null, {{p1}})`),
      T('abar_tick', 'abar', `select app.mark_checklist_item({{item}}, true, null, {{p1}})`),
      ...(['wtr2', 'manager', 'owner', 'bar', 'drv', 'mkt', 'abar'] as const).map((who) => SEES(`sees_${who}`, who, 'p1')),
    ]);
    ok(r, 'tpl');
    const items = ok<{ lists: { items: { text_en: string; photo_required: boolean }[] }[] }>(r, 'today').lists[0]!.items;
    expect(items.map((i) => [i.text_en, i.photo_required])).toEqual([
      ['Photo of the clean floor', true],
      ['Chairs up', false],
    ]);
    expect(refused(r, 'no_photo')).toBe('RECORD_INVALID:photo_path');
    expect(ok<{ photo_path: string }>(r, 'with_photo').photo_path).toMatch(/\/checklists\//);
    // The list is the waiter's: another role ticks nothing on it.
    expect(refused(r, 'abar_tick')).toBe('FORBIDDEN');
    for (const who of ['wtr2', 'manager', 'owner']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(true);
    for (const who of ['bar', 'drv', 'mkt', 'abar']) expect(ok<boolean>(r, `sees_${who}`), who).toBe(false);
  });

  it('the waiter answers a guest’s call at his venue: the push, the call and its table, ack, resolve; not another venue’s', () => {
    // A live guest session and its call, at venue A and at an inactive venue
    // B the waiter does not work at. The inserts run before any staff claim
    // is set, so the push trigger has no caller to skip.
    const call = (v: string, venue: string) => [
      KEEP(`tbl_${v}`, `insert into cafe_tables (table_number, venue_id)
                        values ('ABW-${v}-' || left(gen_random_uuid()::text, 8), ${venue}) returning id::text`),
      KEEP(`guest_${v}`, `insert into auth.users (id, raw_user_meta_data, aud, role, is_anonymous)
                          values (gen_random_uuid(), '{}', 'authenticated', 'authenticated', true) returning id::text`),
      KEEP(`sess_${v}`, `insert into guest_sessions (table_id, auth_user_id, expires_at, venue_id)
                         values ({{tbl_${v}}}::uuid, {{guest_${v}}}::uuid, now() + interval '1 hour', ${venue}) returning id::text`),
      KEEP(`call_${v}`, `insert into waiter_calls (table_id, guest_session_id, reason, venue_id)
                         values ({{tbl_${v}}}::uuid, {{sess_${v}}}::uuid, 'water', ${venue}) returning id::text`),
    ];
    const both = `({{call_a}}::uuid, {{call_b}}::uuid)`;
    const r = scenario([
      `insert into venues (id, slug, name_en, name_ar, is_active)
       values ('${OTHER_VENUE}', 'abw-other-venue', 'ABW other', 'مكان آخر', false);`,
      ...NEW,
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      ...call('a', '{{venue}}'),
      ...call('b', `'${OTHER_VENUE}'`),
      Q('pushed', `select jsonb_object_agg(v.name, exists (select 1 from notification_outbox o
                     where o.created_at = now() and o.payload->>'title_key' = 'waiter_call_new'
                       and o.payload->>'dedupe' = 'waiter_call:' || {{call_a}} and o.profile_id = v.val::uuid))
                    from pg_temp.vars v where v.name in ('wtr','abar','drv','mkt','cashier','manager')`),
      Q('pushed_b', `select to_jsonb(count(*)) from notification_outbox
                      where created_at = now() and payload->>'dedupe' = 'waiter_call:' || {{call_b}}`),
      KEEP('label_a', `select table_number from cafe_tables where id = {{tbl_a}}::uuid`),

      // The reads: his venue's call and its table, the way the till embeds it.
      T('wtr_calls', 'wtr', `select coalesce(jsonb_agg(c.id), '[]') from waiter_calls c where c.id in ${both}`),
      T('wtr_table', 'wtr', `select to_jsonb(t.table_number) from waiter_calls c
                               join cafe_tables t on t.id = c.table_id where c.id = {{call_a}}::uuid`),
      ...(['abar', 'drv', 'mkt'] as const).map((who) =>
        T(`${who}_calls`, who, `select to_jsonb(count(*)) from waiter_calls where id in ${both}`)),

      // Another venue's call is missing to him and to the till; the three
      // roles without the floor are refused before any row is looked at.
      T('wtr_ack_b', 'wtr', `select app.ack_waiter_call({{call_b}}::uuid)`),
      T('wtr_resolve_b', 'wtr', `select app.resolve_waiter_call({{call_b}}::uuid)`),
      T('cashier_resolve_b', 'cashier', `select app.resolve_waiter_call({{call_b}}::uuid)`),
      T('wtr_ack_nil', 'wtr', `select app.ack_waiter_call(${NIL})`),
      ...(['abar', 'drv', 'mkt'] as const).flatMap((who) => [
        T(`${who}_ack`, who, `select app.ack_waiter_call({{call_a}}::uuid)`),
        T(`${who}_resolve`, who, `select app.resolve_waiter_call({{call_a}}::uuid)`),
      ]),

      T('wtr_ack', 'wtr', `select app.ack_waiter_call({{call_a}}::uuid)`),
      T('wtr_ack_again', 'wtr', `select app.ack_waiter_call({{call_a}}::uuid)`),
      T('wtr_resolve', 'wtr', `select app.resolve_waiter_call({{call_a}}::uuid)`),
      Q('after', `select jsonb_build_object(
                    'a', (select jsonb_build_object('status', status, 'ack', acknowledged_by, 'res', resolved_by)
                            from waiter_calls where id = {{call_a}}::uuid),
                    'b', (select status from waiter_calls where id = {{call_b}}::uuid),
                    'wtr', {{wtr}})`),
    ]);

    expect(ok(r, 'pushed')).toEqual({ wtr: true, abar: false, drv: false, mkt: false, cashier: false, manager: false });
    expect(ok<number>(r, 'pushed_b')).toBe(0);

    const a = ok<{ a: { status: string; ack: string; res: string }; b: string; wtr: string }>(r, 'after');
    expect(ok<string[]>(r, 'wtr_calls')).toHaveLength(1);
    expect(ok<string>(r, 'wtr_table')).toMatch(/^ABW-a-/);
    for (const who of ['abar', 'drv', 'mkt']) expect(ok<number>(r, `${who}_calls`), who).toBe(0);

    expect(refused(r, 'wtr_ack_b')).toBe('CALL_NOT_FOUND');
    expect(refused(r, 'wtr_resolve_b')).toBe('CALL_NOT_FOUND');
    expect(refused(r, 'cashier_resolve_b')).toBe('CALL_NOT_FOUND');
    expect(refused(r, 'wtr_ack_nil')).toBe('CALL_NOT_FOUND');
    for (const who of ['abar', 'drv', 'mkt']) {
      expect(refused(r, `${who}_ack`), who).toBe('FORBIDDEN');
      expect(refused(r, `${who}_resolve`), who).toBe('FORBIDDEN');
    }

    expect(ok(r, 'wtr_ack')).toMatchObject({ duplicate: false, status: 'acknowledged' });
    expect(ok(r, 'wtr_ack_again')).toMatchObject({ duplicate: true, status: 'acknowledged' });
    expect(ok(r, 'wtr_resolve')).toMatchObject({ duplicate: false, status: 'resolved' });
    expect(a.a).toEqual({ status: 'resolved', ack: a.wtr, res: a.wtr });
    expect(a.b).toBe('raised');
  });

  it.skipIf(!realtime)('the waiter hears the floor topic and not the kitchen’s; driver and marketing hear neither', () => {
    // The way Realtime authorises a private channel: a message on the topic,
    // read back as the member with realtime.topic set (0022's policies).
    const hears = (topic: string, who: string) =>
      T(`${topic}_${who}`, who, `select to_jsonb(count(*)) from realtime.messages where id = {{rt_${topic}}}::uuid`);
    const r = scenario([
      ...NEW,
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      ...(['floor', 'kds'] as const).map((topic) =>
        KEEP(`rt_${topic}`, `insert into realtime.messages (topic, extension, event, payload, private)
                             values ('${topic}', 'broadcast', 'abw_probe', '{}'::jsonb, true) returning id::text`)),
      `select set_config('realtime.topic', 'floor', true);`,
      ...(['wtr', 'abar', 'cashier', 'drv', 'mkt'] as const).map((who) => hears('floor', who)),
      `select set_config('realtime.topic', 'kds', true);`,
      ...(['wtr', 'abar', 'drv', 'mkt'] as const).map((who) => hears('kds', who)),
    ]);
    for (const who of ['wtr', 'abar', 'cashier']) expect(ok<number>(r, `floor_${who}`), `floor ${who}`).toBe(1);
    for (const who of ['drv', 'mkt']) expect(ok<number>(r, `floor_${who}`), `floor ${who}`).toBe(0);
    expect(ok<number>(r, 'kds_abar')).toBe(1);
    for (const who of ['wtr', 'drv', 'mkt']) expect(ok<number>(r, `kds_${who}`), `kds ${who}`).toBe(0);
  });

  it('both are hireable, and the owner moves an account onto each and back', () => {
    const position = (role: string) =>
      `select app.start_protocol('hiring', null, 'Wave 5 ${role}', null, '{}',
         '{"role":"${role}","why":"Evenings are short","hours":"18:00 to 02:00","start_date":"2026-11-01"}')`;
    const r = scenario([
      MK('mover', 'barista'),
      T('pos_waiter', 'manager', position('waiter')),
      T('pos_abar', 'manager', position('assistant_barista')),
      RES('run', 'pos_waiter', 'run_id'),
      KEEP('s_int', `select id::text from protocol_run_steps where run_id = {{run}} and step_key = 'interviews'`),
      T('step', 'owner', `select app.add_run_step({{run}}, {{s_int}},
         '{"name_en":"Floor trial","name_ar":"تجربة الصالة","actor_roles":["waiter"],"needs_owner_ok":false,"optional":true,"items":[]}')`),
      T('onto_waiter', 'owner', `select app.set_staff_role({{mover}}, 'waiter')`),
      T('back_1', 'owner', `select app.set_staff_role({{mover}}, 'barista')`),
      T('onto_abar', 'owner', `select app.set_staff_role({{mover}}, 'assistant_barista')`),
      T('back_2', 'owner', `select app.set_staff_role({{mover}}, 'barista')`),
      Q('audit', `select jsonb_agg(after->>'role' order by at, id) from audit_log
                   where action = 'staff.role_set' and entity_id = {{mover}}`),
    ]);
    expect(ok(r, 'pos_waiter')).toMatchObject({ run_id: expect.any(String) });
    expect(ok(r, 'pos_abar')).toMatchObject({ run_id: expect.any(String) });
    ok(r, 'step');
    expect(ok(r, 'onto_waiter')).toMatchObject({ role: 'waiter', is_active: true });
    expect(ok(r, 'back_1')).toMatchObject({ role: 'barista' });
    expect(ok(r, 'onto_abar')).toMatchObject({ role: 'assistant_barista', is_active: true });
    expect(ok(r, 'back_2')).toMatchObject({ role: 'barista' });
    expect(ok(r, 'audit')).toEqual(['waiter', 'barista', 'assistant_barista', 'barista']);
  });
});

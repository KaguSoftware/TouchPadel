/**
 * 0382 branch_isolation (F-27, F-28): everything stays inside its own branch.
 *
 *   * no broadcast goes out on the building-wide 'kds', 'floor' or 'courts'
 *     topic, and the read policies admit only the per-branch topics;
 *   * split_evenly, split_by_item and eligible_promotions refuse another
 *     branch's tab (VENUE_MISMATCH) and still answer at the tab's own branch;
 *   * a manager sees and decides the staff requests of their own branches'
 *     people only; the owner sees every one.
 */
import { describe, it, expect } from 'vitest';
import { docker, scenario, T, Q, MK, LET } from './psql-scenario';

/** A second open branch X, and a tab at branch A on a day session of its own. */
const BRANCH_X_AND_TAB_A = [
  LET('x', `insert into venues (slug, name_en, name_ar, status) values ('ldb-x-' || substr(md5(random()::text), 1, 20), 'LDB X', 'فرع س', 'open') returning id`),
  LET('day', `insert into day_sessions (business_date, status, opened_by, opening_float_iqd, venue_id, closed_at)
              values (date '1900-01-01' + (random() * 20000)::int, 'closed', {{owner}}::uuid, 0, {{venue}}::uuid, now()) returning id`),
  LET('tab', `insert into tabs (day_session_id, venue_id, label) values ({{day}}::uuid, {{venue}}::uuid, 'LDB iso') returning id`),
];

describe.skipIf(!docker)('0382 F-27 realtime topics', () => {
  it('no function sends on a building-wide kds, floor or courts topic', () => {
    const r = scenario([
      Q('senders', `select coalesce(jsonb_agg(p.proname order by p.proname), '[]')
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname in ('app', 'public')
                       and p.prosrc ~ 'realtime\\.send'
                       and p.prosrc ~ '''(kds|floor|courts)''\\s*,\\s*true'`),
    ]);
    expect(r.senders?.data).toEqual([]);
  });

  it('the read policies admit the branch topics only', () => {
    const r = scenario([
      Q('quals', `select jsonb_object_agg(policyname, qual) from pg_policies
                   where schemaname = 'realtime' and policyname in ('touchpadel_rt_staff_topics', 'touchpadel_rt_courts')`),
    ]);
    const quals = r.quals?.data as Record<string, string>;
    expect(Object.keys(quals).sort()).toEqual(['touchpadel_rt_courts', 'touchpadel_rt_staff_topics']);
    for (const q of Object.values(quals)) {
      expect(q).not.toMatch(/'(kds|floor|courts)'::text/);
      expect(q).toMatch(/\[0-9a-f-\]\{36\}/);
    }
  });

  it('a kitchen screen of branch X may not join branch A\'s topic, and A\'s may', () => {
    const r = scenario([
      ...BRANCH_X_AND_TAB_A,
      MK('chefA', 'chef'),
      MK('chefX', 'chef', 'x'),
      T('a', 'chefA', `select to_jsonb(app.is_staff_at({{venue}}::uuid, 'chef'))`),
      T('x', 'chefX', `select to_jsonb(app.is_staff_at({{venue}}::uuid, 'chef'))`),
    ]);
    expect(r.a?.data).toBe(true);
    expect(r.x?.data).toBe(false);
  });
});

describe.skipIf(!docker)('0382 F-28 bills', () => {
  it('another branch\'s cashier is refused VENUE_MISMATCH; the tab\'s own branch reads it', () => {
    const r = scenario([
      ...BRANCH_X_AND_TAB_A,
      MK('cashA', 'cashier'),
      MK('cashX', 'cashier', 'x'),
      T('evenX', 'cashX', `select to_jsonb(app.split_evenly({{tab}}::uuid, 2))`),
      T('itemX', 'cashX', `select to_jsonb(app.split_by_item({{tab}}::uuid, '[[],[]]'::jsonb))`),
      T('promoX', 'cashX', `select app.eligible_promotions({{tab}}::uuid, null)`),
      T('evenA', 'cashA', `select to_jsonb(app.split_evenly({{tab}}::uuid, 2))`),
      T('promoA', 'cashA', `select app.eligible_promotions({{tab}}::uuid, null)`),
      T('evenOwner', 'owner', `select to_jsonb(app.split_evenly({{tab}}::uuid, 2))`),
    ]);
    expect(r.evenX).toMatchObject({ ok: false, code: 'VENUE_MISMATCH' });
    expect(r.itemX).toMatchObject({ ok: false, code: 'VENUE_MISMATCH' });
    expect(r.promoX).toMatchObject({ ok: false, code: 'VENUE_MISMATCH' });
    expect(r.evenA).toMatchObject({ ok: true, data: [0, 0] });
    expect(r.promoA?.ok).toBe(true);
    expect(r.evenOwner).toMatchObject({ ok: true, data: [0, 0] });
  });
});

describe.skipIf(!docker)('0382 F-28 staff requests', () => {
  it('a manager reads and decides only their own branches\' people; the owner reads all', () => {
    const r = scenario([
      ...BRANCH_X_AND_TAB_A,
      MK('mgrX', 'manager', 'x'),
      MK('cashA', 'cashier'),
      MK('cashX', 'cashier', 'x'),
      LET('reqA', `insert into staff_requests (staff_id, kind, from_date, to_date, note)
                   values ({{cashA}}::uuid, 'leave', current_date + 30, current_date + 31, 'ldb A') returning id`),
      LET('reqX', `insert into staff_requests (staff_id, kind, from_date, to_date, note)
                   values ({{cashX}}::uuid, 'leave', current_date + 30, current_date + 31, 'ldb X') returning id`),
      T('pageX', 'mgrX', `select (select jsonb_agg(e->>'note' order by e->>'note') from jsonb_array_elements(app.staff_requests_page(null, 200, 0)->'requests') e where e->>'note' like 'ldb %')`),
      T('tableX', 'mgrX', `select jsonb_agg(note order by note) from staff_requests where note like 'ldb %'`),
      T('pageOwner', 'owner', `select (select jsonb_agg(e->>'note' order by e->>'note') from jsonb_array_elements(app.staff_requests_page(null, 200, 0)->'requests') e where e->>'note' like 'ldb %')`),
      // Only the owner decides (0072/0361); the trigger holds whatever body
      // decides: a write with a manager of X's claims on A's request fails.
      `select pg_temp.run('trigA', 'mgrX', $q$update staff_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now() where id = {{reqA}}::uuid returning to_jsonb(status)$q$, null);`,
      `select pg_temp.run('trigX', 'mgrX', $q$update staff_requests set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = {{reqX}}::uuid returning to_jsonb(status)$q$, null);`,
      T('decideOwner', 'owner', `select app.decide_staff_request({{reqA}}::uuid, true, 'ok')`),
      T('own', 'cashA', `select (select jsonb_agg(e->>'note') from jsonb_array_elements(app.staff_requests_page(null, 200, 0)->'requests') e where e->>'note' like 'ldb %')`),
    ]);
    expect(r.pageX).toMatchObject({ ok: true, data: ['ldb X'] });
    expect(r.tableX).toMatchObject({ ok: true, data: ['ldb X'] });
    expect(r.pageOwner).toMatchObject({ ok: true, data: ['ldb A', 'ldb X'] });
    expect(r.trigA).toMatchObject({ ok: false, code: 'VENUE_MISMATCH' });
    expect(r.trigX).toMatchObject({ ok: true, data: 'approved' });
    expect(r.decideOwner?.ok).toBe(true);
    expect(r.own).toMatchObject({ ok: true, data: ['ldb A'] });
  });
});

describe.skipIf(!docker)('0400 F-27 staff and setup reads', () => {
  it('a manager sees their own branches\' people and the owners; the owner sees everyone', () => {
    const r = scenario([
      ...BRANCH_X_AND_TAB_A,
      MK('mgrX', 'manager', 'x'),
      MK('cashX', 'cashier', 'x'),
      MK('cashA', 'cashier'),
      T('tableX', 'mgrX', `select jsonb_build_object('cashA', exists (select 1 from staff where id = {{cashA}}::uuid),
                             'cashX', exists (select 1 from staff where id = {{cashX}}::uuid),
                             'owner', exists (select 1 from staff where id = {{owner}}::uuid),
                             'self', exists (select 1 from staff where id = auth.uid()))`),
      T('listX', 'mgrX', `select jsonb_build_object('cashA', exists (select 1 from app.list_staff() l where l.id = {{cashA}}::uuid),
                            'cashX', exists (select 1 from app.list_staff() l where l.id = {{cashX}}::uuid))`),
      T('listA', 'manager', `select to_jsonb(exists (select 1 from app.list_staff() l where l.id = {{cashA}}::uuid)
                                         and not exists (select 1 from app.list_staff() l where l.id = {{cashX}}::uuid))`),
      T('listOwner', 'owner', `select to_jsonb((select count(*) from app.list_staff() l where l.id in ({{cashA}}::uuid, {{cashX}}::uuid)))`),
      T('lockX', 'mgrX', `select app.clear_pin_lockout({{cashA}}::uuid)`),
      T('lockOwn', 'mgrX', `select app.clear_pin_lockout({{cashX}}::uuid)`),
      T('replaysMgr', 'manager', `select to_jsonb(count(*)) from sync_replays`),
      T('tgMgr', 'manager', `select to_jsonb(count(*)) from telegram_staff`),
      MK('drv', 'driver'),
      T('reachDriver', 'drv', `select app.kitchen_reach(null)`),
      T('reachX', 'mgrX', `select to_jsonb(jsonb_array_length(app.kitchen_reach(null)))`),
    ]);
    expect(r.tableX?.data).toEqual({ cashA: false, cashX: true, owner: true, self: true });
    expect(r.listX?.data).toEqual({ cashA: false, cashX: true });
    expect(r.listA?.data).toBe(true);
    expect(r.listOwner?.data).toBe(2);
    expect(r.lockX).toMatchObject({ ok: false, code: 'STAFF_NOT_FOUND' });
    expect(r.lockOwn).toMatchObject({ ok: true });
    expect(r.replaysMgr?.data).toBe(0);
    expect(r.tgMgr?.data).toBe(0);
    expect(r.reachDriver).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.reachX).toMatchObject({ ok: true, data: 0 });
  });
});

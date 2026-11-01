/**
 * 0383 second_jobs (F-18, F-39): a second job opens everything its role opens.
 *
 *   * app.my_staff_roles: the main role, then each second job; an owner alone;
 *   * checklists: a shared list of the second job's role shows on the
 *     person's phone (my_checklists_today), and an "each" list gives them
 *     their own copy, exactly as the sweep's pushes already counted them;
 *   * teachings: the second job's team;
 *   * stock: the union of the jobs' kinds and stores;
 *   * edge functions: requireStaffRole's rule (judgeStaffAccess) passes a
 *     second job and applies the blocked pages (0384).
 */
import { describe, it, expect } from 'vitest';
import { judgeStaffAccess, staffRolesOf } from '../supabase/functions/_shared/staffAccess.ts';
import { docker, scenario, T, Q, FX, MK, LET } from './psql-scenario';

describe('edge requireStaffRole rule (judgeStaffAccess)', () => {
  const cashierDesk = { role: 'cashier', is_active: true, extra_roles: ['court_desk'], blocked_areas: [] };
  it('a second job passes the guard of its role', () => {
    expect(judgeStaffAccess(cashierDesk, ['court_desk', 'manager', 'owner'])).toEqual({ ok: true, roles: ['cashier', 'court_desk'] });
    expect(judgeStaffAccess({ ...cashierDesk, extra_roles: [] }, ['court_desk'])).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('an inactive row or none is refused', () => {
    expect(judgeStaffAccess({ ...cashierDesk, is_active: false }, ['cashier'])).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(judgeStaffAccess(null, ['cashier'])).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('the work of pages that are all blocked is AREA_BLOCKED; one open page is enough', () => {
    const blocked = { ...cashierDesk, blocked_areas: ['customers'] };
    expect(judgeStaffAccess(blocked, ['court_desk'], ['customers'])).toMatchObject({ ok: false, code: 'AREA_BLOCKED' });
    expect(judgeStaffAccess(blocked, ['court_desk'], ['customers', 'desk'])).toMatchObject({ ok: true });
    expect(judgeStaffAccess(blocked, ['court_desk'])).toMatchObject({ ok: true });
  });
  it('an owner holds the owner alone and is never blocked', () => {
    const owner = { role: 'owner', is_active: true, extra_roles: ['cashier'], blocked_areas: ['till'] };
    expect(staffRolesOf(owner)).toEqual(['owner']);
    expect(judgeStaffAccess(owner, ['owner'], ['till'])).toMatchObject({ ok: true });
  });
});

const NOCLAIMS = `select set_config('request.jwt.claims', '', true);`;
const LIST = (name: string, role: string, copy: string) =>
  `select app.save_checklist({{venue}}, null, 0, '${JSON.stringify({
    name_en: name, name_ar: 'قائمة', audience: 'role', role, copy_mode: copy, repeat_kind: 'weekdays',
    weekdays: [0, 1, 2, 3, 4, 5, 6], slot: 'open', items: [{ text_en: 'Line', text_ar: 'سطر' }],
  })}'::jsonb)`;
const MINE = (who: string, label: string) =>
  T(label, who, `select coalesce(jsonb_agg(jsonb_build_object('name', l->>'name_en', 'mine', (l->>'assignee_id') = auth.uid()::text) order by l->>'name_en'), '[]')
                   from jsonb_array_elements(app.my_checklists_today({{venue}}::uuid)->'lists') l
                  where l->>'name_en' like 'LDB %'`);

describe.skipIf(!docker)('0383 my_staff_roles', () => {
  it('main role, then second jobs; an owner alone; a guest none', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      FX(`update staff set extra_roles = '{shop_staff,court_desk}' where id = {{c1}}::uuid`),
      FX(`insert into pg_temp.vars values ('guest', gen_random_uuid()::text)`),
      T('c1', 'c1', `select to_jsonb(app.my_staff_roles())`),
      T('owner', 'owner', `select to_jsonb(app.my_staff_roles())`),
      T('guest', 'guest', `select to_jsonb(app.my_staff_roles())`),
    ]);
    expect(r.c1?.data).toEqual(['cashier', 'court_desk', 'shop_staff']);
    expect(r.owner?.data).toEqual(['owner']);
    expect(r.guest?.data).toEqual([]);
  });
});

describe.skipIf(!docker)('0383 checklists (F-39)', () => {
  it('a second job\'s shared list and own copy show on the phone, and its line can be ticked', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      T('shared', 'owner', LIST('LDB shared desk', 'court_desk', 'shared')),
      T('each', 'owner', LIST('LDB each desk', 'court_desk', 'each')),
      NOCLAIMS,
      MINE('c1', 'before'),
      FX(`update staff set extra_roles = '{court_desk}' where id = {{c1}}::uuid`),
      MINE('c1', 'after'),
      LET('item', `select i.id from checklist_run_items i join checklist_runs r on r.id = i.run_id
                     join checklist_templates t on t.id = r.template_id
                    where t.name_en = 'LDB shared desk' limit 1`),
      T('tick', 'c1', `select to_jsonb(app.mark_checklist_item({{item}}::uuid, true, null, null) is not null)`),
    ]);
    expect(r.shared?.ok, JSON.stringify(r.shared)).toBe(true);
    expect(r.before?.data).toEqual([]);
    expect(r.after?.data).toEqual([
      { name: 'LDB each desk', mine: true },
      { name: 'LDB shared desk', mine: null },
    ]);
    expect(r.tick, JSON.stringify(r.tick)).toMatchObject({ ok: true });
  });
});

describe.skipIf(!docker)('0383 teachings', () => {
  it('a second job reads that job\'s team', () => {
    const r = scenario([
      MK('c1', 'cashier'),
      FX(`insert into teachings (venue_id, team, author_id, title, body) values ({{venue}}::uuid, 'bar', {{owner}}::uuid, 'LDB espresso', 'x')`),
      FX(`update staff set extra_roles = '{barista}' where id = {{c1}}::uuid`),
      T('bar', 'c1', `select (select jsonb_agg(e->>'title') from jsonb_array_elements(app.teachings_for_me({{venue}}::uuid, null, 100, 0)->'teachings') e where e->>'title' like 'LDB %')`),
      T('kitchen', 'c1', `select app.teachings_for_me({{venue}}::uuid, 'kitchen', 10, 0)`),
    ]);
    expect(r.bar).toMatchObject({ ok: true, data: ['LDB espresso'] });
    expect(r.kitchen).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
});

describe.skipIf(!docker)('0383 stock', () => {
  it('the jobs\' rules add up', () => {
    const r = scenario([
      Q('kinds', `select to_jsonb(app.stock_log_kinds('{cashier,shop_staff}'))`),
      Q('kindsCashier', `select to_jsonb(app.stock_log_kinds('{cashier}'))`),
      Q('countShop', `select to_jsonb(app.stock_may_count_at('{cashier,shop_staff}', 'shop'))`),
      Q('countCafe', `select to_jsonb(app.stock_may_count_at('{cashier,shop_staff}', 'cafe'))`),
      Q('logCafe', `select to_jsonb(app.stock_may_log_at('{shop_staff,cashier}', 'cafe'))`),
      Q('logCafeShop', `select to_jsonb(app.stock_may_log_at('{shop_staff}', 'cafe'))`),
      MK('c1', 'cashier'),
      T('viewBefore', 'c1', `select app.staff_stock_view({{venue}}::uuid, 'retail') is not null`),
      FX(`update staff set extra_roles = '{shop_staff}' where id = {{c1}}::uuid`),
      T('view', 'c1', `select to_jsonb(app.staff_stock_view({{venue}}::uuid, 'retail') is not null)`),
      T('today', 'c1', `select jsonb_build_object('counts', app.stock_today({{venue}}::uuid)->'counts' is not null and jsonb_typeof(app.stock_today({{venue}}::uuid)->'counts') = 'array')`),
      T('countCafeRpc', 'c1', `select app.stock_pick_list('count', 'cafe', {{venue}}::uuid, null)`),
      T('countShopRpc', 'c1', `select to_jsonb(app.stock_pick_list('count', 'shop', {{venue}}::uuid, null) is not null)`),
    ]);
    expect(r.kinds?.data).toEqual(['purchased', 'retail']);
    expect(r.kindsCashier?.data).toEqual(['purchased']);
    expect(r.countShop?.data).toBe(true);
    expect(r.countCafe?.data).toBe(false);
    expect(r.logCafe?.data).toBe(true);
    expect(r.logCafeShop?.data).toBe(false);
    expect(r.viewBefore).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.view).toMatchObject({ ok: true, data: true });
    expect(r.today).toMatchObject({ ok: true, data: { counts: true } });
    expect(r.countCafeRpc).toMatchObject({ ok: false, code: 'FORBIDDEN', hint: 'location' });
    expect(r.countShopRpc).toMatchObject({ ok: true, data: true });
  });
});

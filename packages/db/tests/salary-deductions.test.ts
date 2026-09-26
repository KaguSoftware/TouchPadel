/**
 * salary_deductions (wave5-addendum-2026-09-25 §2.5, §2.0, §6.1; contracts
 * §8.2): a head proposes a pay deduction for a member of their team, a
 * manager or the owner decides it, and it never reaches the owner assistant.
 *
 *   * proposing: Bareq (head barista) for a barista and for Hussein (the
 *     assistant barista, M9), Rusul (head chef) for a chef, a manager for the
 *     cashier and the waiter; a head for another team, another head, himself
 *     or an owner is FORBIDDEN:staff_id; MGMT hear deduction_proposed with the
 *     proposer's name only (no amount, no reason, no target), and the person
 *     does not;
 *   * deciding: an approval tells the proposer and the person, a decline
 *     tells the proposer and needs a note; nobody decides their own proposal
 *     or one against themselves; decided stays decided; only the owner
 *     cancels, only an approval, with a reason;
 *   * reads: the person sees approved and cancelled rows with no proposer,
 *     decision note or cancel reason; the proposer their own proposals; the
 *     month view totals approved rows only; another venue's row is
 *     REF_NOT_FOUND;
 *   * limits: a replayed key, the amount cap, the 60-day window;
 *   * the pay month (V16): a row dated last month and approved now counts in
 *     this month, flagged dated_earlier, and in neither view for last month;
 *     a decline leaves it null and a cancel keeps it;
 *   * denials: every role but the heads and MGMT is refused the writes and
 *     MGMT's reads, the driver and marketing included, and reads no row of
 *     the table (§8.2);
 *   * a manager who is the person reads it only as the person does: not in
 *     the table, deductions_page (nor its waiting count) or deductions_month;
 *   * the LLM wall: no assistant_readable_columns row, and every
 *     staff.deduction.% audit row carries {status} only, with no reason code;
 *     the push queue's recipient and payload are not assistant-readable, so a
 *     deduction_recorded row never names the person.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff and deductions are created
 * inside it and each call runs as `authenticated` with the caller's JWT
 * claims. Nothing is committed. Without docker on PATH the suite skips itself.
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
  values (v, 'sd-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SD ' || p_name, p_role, true);
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
const OTHER_VENUE = '00000000-0000-4000-8000-00000000d3d3';
/** An inactive venue nobody here works at. */
const OTHER_VENUE_SQL = `insert into venues (id, slug, name_en, name_ar, is_active)
  values ('${OTHER_VENUE}', 'sd-other-venue', 'SD other', 'مكان آخر', false);`;
/** The venue's business day and its month, as the RPCs compute them. */
const DAYS = [
  KEEP('today', `select app.venue_business_date({{venue}}::uuid)::text`),
  KEEP('month', `select date_trunc('month', app.venue_business_date({{venue}}::uuid))::date::text`),
  KEEP('last_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) - interval '1 month')::date::text`),
];

const propose = (who: string, label: string, target: string, amount: number | string, extra = '') =>
  T(label, who, `select app.propose_deduction({{${target}}}::uuid, ${amount}, {{today}}::date - 1, 'Late three times'${extra})`);
const decide = (who: string, label: string, id: string, approve: string, note = 'null') =>
  T(label, who, `select app.decide_deduction({{${id}}}::uuid, ${approve}, ${note})`);

interface Target { id: string; display_name: string; role: string }
interface MyRow { id: string; amount_iqd: number; status: string; dated_earlier: boolean; [k: string]: unknown }

describe.skipIf(!docker)('salary_deductions (rolled-back transactions)', () => {
  it('heads propose for their own team, MGMT for anyone at the venue; MGMT hear it with no amount', () => {
    const r = scenario([
      ...DAYS,
      MK('hb', 'head_barista'), MK('hb2', 'head_barista'), MK('bar', 'barista'), MK('ab', 'assistant_barista'),
      MK('hc', 'head_chef'), MK('chef', 'chef'), MK('w', 'waiter'), MK('mgr2', 'manager'),
      T('t_hb', 'hb', `select app.deduction_targets({{venue}})`),
      T('t_hc', 'hc', `select app.deduction_targets()`),
      T('t_mgr', 'manager', `select app.deduction_targets({{venue}})`),
      T('t_owner', 'owner', `select app.deduction_targets({{venue}})`),
      propose('hb', 'p_bar', 'bar', 25000),
      propose('hb', 'p_ab', 'ab', 15000),
      propose('hb', 'p_chef', 'chef', 1000),
      propose('hb', 'p_hb2', 'hb2', 1000),
      propose('hb', 'p_self', 'hb', 1000),
      propose('hb', 'p_owner', 'owner', 1000),
      propose('hc', 'p_hc_chef', 'chef', 5000),
      propose('hc', 'p_hc_bar', 'bar', 5000),
      propose('manager', 'p_cashier', 'cashier', 7000),
      propose('manager', 'p_waiter', 'w', 7000),
      propose('owner', 'p_mgr2', 'mgr2', 7000),
      propose('owner', 'p_owner_self', 'owner', 7000),
      RES('bar_id', 'p_bar', 'id'),
      Q('push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)), '[]'::jsonb)
                   from notification_outbox o
                  where o.created_at = now() and o.payload->>'title_key' = 'deduction_proposed'`),
      Q('who', `select jsonb_build_object('hb', {{hb}}, 'bar', {{bar}}, 'ab', {{ab}}, 'manager', {{manager}},
                                          'owner', {{owner}}, 'mgr2', {{mgr2}})`),
      Q('row', `select jsonb_build_object('status', status, 'staff_id', staff_id, 'proposed_by', proposed_by,
                                          'amount_iqd', amount_iqd, 'pay_month', pay_month, 'reason', reason)
                  from salary_deductions where id = {{bar_id}}::uuid`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    const ids = (label: string) => ok<{ staff: Target[] }>(r, label).staff.map((s) => s.id);
    // Bareq: his bar team, never a head, himself, another team or an owner.
    expect(ids('t_hb')).toEqual(expect.arrayContaining([who.bar, who.ab]));
    for (const role of ok<{ staff: Target[] }>(r, 't_hb').staff.map((s) => s.role)) {
      expect(['barista', 'assistant_barista']).toContain(role);
    }
    expect(ok<{ staff: Target[] }>(r, 't_hc').staff.map((s) => s.role)).toEqual(
      expect.not.arrayContaining(['head_chef', 'barista', 'head_barista', 'assistant_barista']));
    // MGMT: any non-owner at the venue but themselves.
    expect(ids('t_mgr')).toEqual(expect.arrayContaining([who.bar, who.ab, who.hb, who.mgr2, SEED_STAFF_IDS.cashier]));
    expect(ids('t_mgr')).not.toContain(who.manager);
    expect(ids('t_mgr')).not.toContain(who.owner);
    expect(ok<{ staff: Target[] }>(r, 't_owner').staff.map((s) => s.role)).not.toContain('owner');

    for (const l of ['p_bar', 'p_ab', 'p_hc_chef', 'p_cashier', 'p_waiter', 'p_mgr2']) {
      expect(ok<{ status: string }>(r, l), l).toMatchObject({ status: 'waiting' });
    }
    for (const l of ['p_chef', 'p_hb2', 'p_self', 'p_owner', 'p_hc_bar', 'p_owner_self']) {
      expect(refused(r, l), l).toBe('FORBIDDEN:staff_id');
    }
    expect(ok(r, 'row')).toEqual({ status: 'waiting', staff_id: who.bar, proposed_by: who.hb, amount_iqd: 25000,
                                   pay_month: null, reason: 'Late three times' });

    const push = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'push');
    const to = push.map((p) => p.to);
    // Bareq's two proposals reach each manager and owner once (dedupe per
    // proposer); the manager's reach the other MGMT, never the person.
    expect(to).toEqual(expect.arrayContaining([who.manager, who.owner, who.mgr2]));
    for (const id of [who.bar, who.ab, who.hb]) expect(to).not.toContain(id);
    const fromHb = push.filter((p) => p.payload.dedupe === `deduction:${who.hb}`);
    expect(fromHb.filter((p) => p.to === who.manager)).toHaveLength(1);
    expect(fromHb[0]!.kind).toBe('staff_decide');
    expect(fromHb[0]!.payload).toEqual({ route: 'staff', id: null, title_key: 'deduction_proposed',
                                         params: { name: 'SD hb' }, dedupe: `deduction:${who.hb}` });
    // The owner's proposal against mgr2 tells the other MGMT, never mgr2.
    const fromOwner = push.filter((p) => p.payload.dedupe === `deduction:${who.owner}`);
    expect(fromOwner.map((p) => p.to)).toContain(who.manager);
    expect(fromOwner.map((p) => p.to)).not.toContain(who.mgr2);
    const all = JSON.stringify(push);
    expect(all).not.toMatch(/amount|25000|15000|7000|Late three|SD bar|SD ab|SD w\b|SD mgr2/);
  });

  it('decides, cancels and reads: each side sees only its own part', () => {
    const r = scenario([
      ...DAYS,
      OTHER_VENUE_SQL,
      MK('hb', 'head_barista'), MK('bar', 'barista'), MK('ab', 'assistant_barista'), MK('hc', 'head_chef'),
      MK('w', 'waiter'), MK('mgr2', 'manager'),
      propose('hb', 'a', 'bar', 25000), RES('a', 'a', 'id'),
      propose('hb', 'b', 'ab', 15000), RES('b', 'b', 'id'),
      propose('manager', 'c', 'w', 7000), RES('c', 'c', 'id'),
      propose('owner', 'd', 'mgr2', 9000), RES('d', 'd', 'id'),
      propose('hb', 'e', 'bar', 4000), RES('e', 'e', 'id'),
      propose('hb', 'f', 'bar', 3000), RES('f', 'f', 'id'),
      KEEP('far', `insert into salary_deductions (venue_id, staff_id, amount_iqd, deduction_date, reason, proposed_by)
                   values ('${OTHER_VENUE}', {{bar}}::uuid, 1000, current_date, 'far', {{hb}}::uuid) returning id::text`),
      decide('manager', 'approve_a', 'a', 'true'),
      Q('decided_push', `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                                                  order by o.payload->>'title_key'), '[]'::jsonb)
                           from notification_outbox o
                          where o.created_at = now()
                            and o.payload->>'title_key' in ('deduction_approved', 'deduction_recorded')`),
      decide('manager', 'decline_bare', 'e', 'false'),
      decide('manager', 'decline_e', 'e', 'false', `'Not his fault'`),
      Q('declined_push', `select coalesce(jsonb_agg(o.profile_id), '[]'::jsonb) from notification_outbox o
                           where o.created_at = now() and o.payload->>'title_key' = 'deduction_declined'`),
      decide('manager', 'own', 'c', 'true'),
      decide('mgr2', 'against_self', 'd', 'true'),
      decide('manager', 'again', 'a', 'false', `'x'`),
      decide('manager', 'long_note', 'f', 'true', `repeat('n', 1001)`),
      decide('manager', 'approve_f', 'f', 'true', `'  Agreed.  '`),
      T('wd_after', 'hb', `select app.withdraw_deduction({{a}}::uuid)`),
      T('wd_other', 'hc', `select app.withdraw_deduction({{b}}::uuid)`),
      T('wd_b', 'hb', `select app.withdraw_deduction({{b}}::uuid)`),
      T('wd_again', 'hb', `select app.withdraw_deduction({{b}}::uuid)`),
      T('cancel_mgr', 'manager', `select app.cancel_deduction({{a}}::uuid, 'x')`),
      T('cancel_waiting', 'owner', `select app.cancel_deduction({{c}}::uuid, 'x')`),
      T('cancel_bare', 'owner', `select app.cancel_deduction({{a}}::uuid, '  ')`),
      T('cancel_long', 'owner', `select app.cancel_deduction({{a}}::uuid, repeat('r', 1001))`),
      T('cancel_a', 'owner', `select app.cancel_deduction({{a}}::uuid, 'Approved by mistake')`),
      T('cancel_again', 'owner', `select app.cancel_deduction({{a}}::uuid, 'x')`),
      Q('cancel_push', `select to_jsonb(count(*)) from notification_outbox o
                         where o.created_at = now() and o.payload->>'title_key' like 'deduction%'
                           and o.payload->>'title_key' not in ('deduction_proposed', 'deduction_approved',
                                                              'deduction_recorded', 'deduction_declined')`),
      T('far_decide', 'manager', `select app.decide_deduction({{far}}::uuid, true)`),
      T('far_withdraw', 'hb', `select app.withdraw_deduction({{far}}::uuid)`),
      T('far_cancel', 'owner', `select app.cancel_deduction({{far}}::uuid, 'x')`),
      T('missing', 'manager', `select app.decide_deduction(gen_random_uuid(), true)`),
      Q('months', `select jsonb_object_agg(id, jsonb_build_object('status', status, 'pay_month', pay_month))
                     from salary_deductions where id in ({{a}}::uuid, {{e}}::uuid, {{f}}::uuid)`),
      T('mine_bar', 'bar', `select app.my_deductions({{venue}})`),
      T('mine_ab', 'ab', `select app.my_deductions()`),
      T('props_hb', 'hb', `select app.my_deduction_proposals({{venue}})`),
      T('props_hc', 'hc', `select app.my_deduction_proposals({{venue}})`),
      T('page_all', 'manager', `select app.deductions_page({{venue}}, 'all', 200)`),
      T('page_waiting', 'owner', `select app.deductions_page({{venue}})`),
      T('page_bad', 'manager', `select app.deductions_page({{venue}}, 'mine')`),
      T('month', 'manager', `select app.deductions_month({{venue}})`),
      Q('who', `select jsonb_build_object('hb', {{hb}}, 'bar', {{bar}}, 'manager', {{manager}}, 'a', {{a}},
                                          'b', {{b}}, 'c', {{c}}, 'd', {{d}}, 'e', {{e}}, 'f', {{f}}, 'month', {{month}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok<{ status: string; pay_month: string }>(r, 'approve_a')).toMatchObject({ status: 'approved', pay_month: who.month });
    const decided = ok<Array<{ to: string; kind: string; payload: Record<string, unknown> }>>(r, 'decided_push');
    expect(decided).toEqual([
      { to: who.hb, kind: 'staff_decided', payload: { route: 'staff', id: null, title_key: 'deduction_approved', params: {} } },
      { to: who.bar, kind: 'staff_info', payload: { route: 'staff', id: null, title_key: 'deduction_recorded', params: {} } },
    ]);
    expect(refused(r, 'decline_bare')).toBe('REASON_REQUIRED');
    expect(ok<{ status: string; pay_month: null }>(r, 'decline_e')).toMatchObject({ status: 'declined', pay_month: null });
    expect(ok<string[]>(r, 'declined_push')).toEqual([who.hb]);
    expect(refused(r, 'own')).toBe('CANNOT_DECIDE_OWN');
    expect(refused(r, 'against_self')).toBe('CANNOT_DECIDE_OWN');
    expect(refused(r, 'again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(ok<{ status: string }>(r, 'approve_f').status).toBe('approved');
    expect(refused(r, 'wd_after')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'wd_other')).toBe('FORBIDDEN');
    expect(ok(r, 'wd_b')).toEqual({ status: 'withdrawn' });
    expect(refused(r, 'wd_again')).toBe('SUBMISSION_DECIDED');
    expect(refused(r, 'cancel_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'cancel_waiting')).toBe('INVALID_TRANSITION');
    expect(refused(r, 'cancel_bare')).toBe('REASON_REQUIRED');
    expect(refused(r, 'cancel_long')).toBe('TEXT_TOO_LONG:reason');
    expect(ok<{ status: string }>(r, 'cancel_a').status).toBe('cancelled');
    expect(refused(r, 'cancel_again')).toBe('INVALID_TRANSITION');
    expect(ok<number>(r, 'cancel_push')).toBe(0);
    for (const l of ['far_decide', 'far_withdraw', 'far_cancel', 'missing']) expect(refused(r, l), l).toBe('REF_NOT_FOUND:id');
    // A decline leaves the pay month null; a cancel keeps it.
    expect(ok(r, 'months')).toEqual({
      [who.a!]: { status: 'cancelled', pay_month: who.month },
      [who.e!]: { status: 'declined', pay_month: null },
      [who.f!]: { status: 'approved', pay_month: who.month },
    });

    // The person: approved and cancelled, never who proposed it or the notes.
    const mine = ok<{ month: string; total_iqd: number; deductions: MyRow[] }>(r, 'mine_bar');
    expect(mine.month).toBe(who.month);
    expect(mine.deductions.map((d) => [d.id, d.status]).sort()).toEqual([[who.a, 'cancelled'], [who.f, 'approved']].sort());
    expect(mine.total_iqd).toBe(3000);
    for (const d of mine.deductions) {
      expect(Object.keys(d).sort()).toEqual(['amount_iqd', 'dated_earlier', 'decided_at', 'deduction_date', 'id', 'reason', 'status']);
    }
    expect(JSON.stringify(mine)).not.toMatch(/SD hb|Agreed|Approved by mistake|Not his fault/);
    // Hussein's was withdrawn: nothing to see.
    expect(ok<{ deductions: MyRow[] }>(r, 'mine_ab').deductions).toEqual([]);

    // The proposer: their own, every status, with the decision note.
    const props = ok<{ proposals: Array<Record<string, unknown>> }>(r, 'props_hb').proposals;
    expect(props.map((p) => p.id).sort()).toEqual([who.a, who.b, who.e, who.f].sort());
    expect(props.find((p) => p.id === who.e)).toMatchObject({ status: 'declined', decision_note: 'Not his fault',
                                                              staff_name: 'SD bar', staff_role: 'barista' });
    expect(props.find((p) => p.id === who.f)).toMatchObject({ decision_note: 'Agreed.' });
    expect(ok<{ proposals: unknown[] }>(r, 'props_hc').proposals).toEqual([]);

    // MGMT: everything, waiting first.
    type Page = { deductions: Array<Record<string, unknown>>; waiting_count: number; total: number };
    const page = ok<Page>(r, 'page_all');
    const mineOnPage = page.deductions.filter((d) => [who.a, who.b, who.c, who.d, who.e, who.f].includes(d.id as string));
    expect(mineOnPage).toHaveLength(6);
    const firstDecided = page.deductions.findIndex((d) => d.status !== 'waiting');
    expect(page.deductions.slice(firstDecided).some((d) => d.status === 'waiting')).toBe(false);
    expect(page.deductions.find((d) => d.id === who.a)).toMatchObject({
      status: 'cancelled', cancel_reason: 'Approved by mistake', cancelled_by_name: 'Dev Owner', can_cancel: false,
      proposed_by_name: 'SD hb', proposed_by_role: 'head_barista', decided_by_name: 'Dev Manager' });
    expect(page.deductions.find((d) => d.id === who.c)).toMatchObject({ status: 'waiting', can_decide: false });
    expect(page.deductions.find((d) => d.id === who.d)).toMatchObject({ status: 'waiting', can_decide: true });
    expect(page.deductions.find((d) => d.id === who.f)).toMatchObject({ can_cancel: false, can_decide: false });
    const waiting = ok<Page>(r, 'page_waiting');
    expect(waiting.deductions.every((d) => d.status === 'waiting')).toBe(true);
    expect(waiting.waiting_count).toBe(waiting.total);
    expect(waiting.deductions.find((d) => d.id === who.f)).toBeUndefined();
    expect(refused(r, 'page_bad')).toBe('INVALID_ARGUMENT:filter');

    // The month: approved rows in the totals; cancelled listed, never counted.
    type Month = { month: string; totals: Record<string, number>;
                   people: Array<{ staff_id: string; approved_iqd: number; approved_count: number; waiting_iqd: number;
                                   waiting_count: number; deductions: MyRow[] }> };
    const month = ok<Month>(r, 'month');
    expect(month.month).toBe(who.month);
    const bar = month.people.find((p) => p.staff_id === who.bar)!;
    expect(bar).toMatchObject({ approved_iqd: 3000, approved_count: 1, waiting_iqd: 0, waiting_count: 0 });
    expect(bar.deductions.map((d) => d.status).sort()).toEqual(['approved', 'cancelled']);
    const listed = month.people.flatMap((p) => p.deductions);
    const sum = (s: string) => listed.filter((d) => d.status === s).reduce((n, d) => n + d.amount_iqd, 0);
    expect(month.totals.approved_iqd).toBe(sum('approved'));
    expect(month.totals.waiting_iqd).toBe(sum('waiting'));
    expect(month.totals.people).toBe(month.people.length);
    expect(listed.some((d) => d.status === 'declined' || d.status === 'withdrawn')).toBe(false);
  });

  it('holds the limits: a replayed key, the amount and the 60-day window', () => {
    const r = scenario([
      ...DAYS,
      MK('hb', 'head_barista'), MK('bar', 'barista'),
      propose('hb', 'k1', 'bar', 5000, `, p_idempotency_key => 'SD-KEY-1'`),
      propose('hb', 'k2', 'bar', 5000, `, p_idempotency_key => 'SD-KEY-1'`),
      Q('k_rows', `select to_jsonb(count(*)) from salary_deductions where staff_id = {{bar}}::uuid`),
      propose('hb', 'zero', 'bar', 0),
      propose('hb', 'over', 'bar', 2000001),
      propose('hb', 'max', 'bar', 2000000),
      T('tomorrow', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, {{today}}::date + 1, 'x')`),
      T('day61', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, {{today}}::date - 61, 'x')`),
      T('day60', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, {{today}}::date - 60, 'x')`),
      T('no_date', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, null, 'x')`),
      T('no_reason', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, {{today}}::date, '   ')`),
      T('long_reason', 'hb', `select app.propose_deduction({{bar}}::uuid, 1000, {{today}}::date, repeat('r', 501))`),
      T('no_staff', 'hb', `select app.propose_deduction(null, 1000, {{today}}::date, 'x')`),
    ]);
    const first = ok<{ id: string }>(r, 'k1');
    expect(ok(r, 'k2')).toEqual({ id: first.id, status: 'waiting', duplicate: true });
    expect(refused(r, 'zero')).toBe('INVALID_AMOUNT');
    expect(refused(r, 'over')).toBe('INVALID_AMOUNT');
    expect(ok<{ status: string }>(r, 'max').status).toBe('waiting');
    expect(refused(r, 'tomorrow')).toBe('INVALID_ARGUMENT:date');
    expect(refused(r, 'day61')).toBe('INVALID_ARGUMENT:date');
    expect(ok<{ status: string }>(r, 'day60').status).toBe('waiting');
    expect(refused(r, 'no_date')).toBe('INVALID_ARGUMENT:date');
    expect(refused(r, 'no_reason')).toBe('TEXT_REQUIRED:reason');
    expect(refused(r, 'long_reason')).toBe('TEXT_TOO_LONG:reason');
    expect(refused(r, 'no_staff')).toBe('FORBIDDEN:staff_id');
    // Counted right after the replay: one row for the two calls.
    expect(ok<number>(r, 'k_rows')).toBe(1);
  });

  it('counts a deduction in the month it is approved in (V16)', () => {
    const r = scenario([
      ...DAYS,
      MK('hb', 'head_barista'), MK('bar', 'barista'),
      // Dated the last day of last month, approved today.
      T('late', 'hb', `select app.propose_deduction({{bar}}::uuid, 12000, {{month}}::date - 1, 'Broke the grinder')`),
      RES('late', 'late', 'id'),
      decide('manager', 'approve', 'late', 'true'),
      T('this_month', 'manager', `select app.deductions_month({{venue}})`),
      T('last_month', 'manager', `select app.deductions_month({{venue}}, {{last_month}}::date)`),
      T('mine_now', 'bar', `select app.my_deductions({{venue}})`),
      T('mine_before', 'bar', `select app.my_deductions({{venue}}, {{last_month}}::date + 9)`),
      T('page', 'manager', `select app.deductions_page({{venue}}, 'decided')`),
      Q('who', `select jsonb_build_object('late', {{late}}, 'month', {{month}}, 'last_month', {{last_month}}, 'bar', {{bar}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok<{ pay_month: string }>(r, 'approve').pay_month).toBe(who.month);
    const find = (label: string) =>
      ok<{ people: Array<{ deductions: MyRow[] }> }>(r, label).people.flatMap((p) => p.deductions).find((d) => d.id === who.late);
    expect(find('this_month')).toMatchObject({ status: 'approved', amount_iqd: 12000, dated_earlier: true });
    expect(find('last_month')).toBeUndefined();
    expect(ok<{ month: string }>(r, 'last_month').month).toBe(who.last_month);
    const now = ok<{ month: string; total_iqd: number; deductions: MyRow[] }>(r, 'mine_now');
    expect(now.deductions).toEqual([expect.objectContaining({ id: who.late, dated_earlier: true, status: 'approved' })]);
    expect(now.total_iqd).toBe(12000);
    // Any day of a month means that month.
    const before = ok<{ month: string; deductions: MyRow[] }>(r, 'mine_before');
    expect(before.month).toBe(who.last_month);
    expect(before.deductions).toEqual([]);
    expect(ok<{ deductions: MyRow[] }>(r, 'page').deductions.find((d) => d.id === who.late))
      .toMatchObject({ pay_month: who.month, dated_earlier: true });
  });

  it('refuses every other role, the driver and marketing included, and they read no row (§8.2)', () => {
    const roles = ['barista', 'assistant_barista', 'chef', 'waiter', 'driver', 'marketing'] as const;
    const who = [...roles, 'cashier', 'desk'] as const;
    const r = scenario([
      ...DAYS,
      MK('hb', 'head_barista'), MK('bar_t', 'barista'),
      ...roles.map((role) => MK(role, role)),
      propose('hb', 'row', 'bar_t', 5000), RES('row', 'row', 'id'),
      ...who.flatMap((w) => [
        T(`propose_${w}`, w, `select app.propose_deduction({{bar_t}}::uuid, 1000, {{today}}::date, 'x')`),
        T(`targets_${w}`, w, `select app.deduction_targets({{venue}})`),
        T(`decide_${w}`, w, `select app.decide_deduction({{row}}::uuid, true)`),
        T(`cancel_${w}`, w, `select app.cancel_deduction({{row}}::uuid, 'x')`),
        T(`page_${w}`, w, `select app.deductions_page({{venue}})`),
        T(`month_${w}`, w, `select app.deductions_month({{venue}})`),
        T(`props_${w}`, w, `select app.my_deduction_proposals({{venue}})`),
        T(`mine_${w}`, w, `select app.my_deductions({{venue}})`),
        T(`read_${w}`, w, `select to_jsonb(count(*)) from salary_deductions`),
      ]),
      T('read_manager', 'manager', `select to_jsonb(count(*)) from salary_deductions`),
      T('read_hb', 'hb', `select to_jsonb(count(*)) from salary_deductions`),
    ]);
    for (const w of who) {
      for (const fn of ['propose', 'targets', 'decide', 'cancel', 'page', 'month', 'props']) {
        expect(refused(r, `${fn}_${w}`), `${fn} as ${w}`).toBe('FORBIDDEN');
      }
      // Their own (empty) month is theirs to read.
      expect(ok<{ deductions: unknown[] }>(r, `mine_${w}`), w).toMatchObject({ total_iqd: 0, deductions: [] });
      expect(ok<number>(r, `read_${w}`), w).toBe(0);
    }
    expect(ok<number>(r, 'read_manager')).toBeGreaterThan(0);
    expect(ok<number>(r, 'read_hb')).toBe(0);
  });

  it('a manager who is the person sees only what the person sees', () => {
    const IDS = (label: string, who: string, sql: string) =>
      T(label, who, `select coalesce(jsonb_agg(x), '[]'::jsonb) from (${sql}) x(x)`);
    const views = (tag: string, who: string) => [
      T(`${tag}_rows`, who, `select to_jsonb(count(*)) from salary_deductions where id = {{d}}::uuid`),
      IDS(`${tag}_page`, who, `select e->>'id' from jsonb_array_elements(app.deductions_page({{venue}}, 'all')->'deductions') e`),
      T(`${tag}_waiting`, who, `select app.deductions_page({{venue}}, 'waiting')->'waiting_count'`),
      IDS(`${tag}_month`, who, `select p->>'staff_id' from jsonb_array_elements(app.deductions_month({{venue}})->'people') p`),
    ];
    const r = scenario([
      ...DAYS,
      MK('mgr2', 'manager'),
      propose('manager', 'p', 'mgr2', 20000), RES('d', 'p', 'id'),
      ...views('w', 'mgr2'),
      ...views('w_proposer', 'manager'),
      decide('owner', 'approve', 'd', 'true', `'Agreed'`),
      ...views('a', 'mgr2'),
      ...views('a_owner', 'owner'),
      T('mine', 'mgr2', `select app.my_deductions({{venue}})`),
      Q('who', `select jsonb_build_object('d', {{d}}, 'mgr2', {{mgr2}})`),
    ]);
    const who = ok<{ d: string; mgr2: string }>(r, 'who');
    ok(r, 'approve');
    // Waiting and approved alike: no row, no page line, no month line, and
    // the waiting count leaves it out.
    for (const tag of ['w', 'a']) {
      expect(ok<number>(r, `${tag}_rows`), tag).toBe(0);
      expect(ok<string[]>(r, `${tag}_page`), tag).not.toContain(who.d);
      expect(ok<string[]>(r, `${tag}_month`), tag).not.toContain(who.mgr2);
    }
    expect(ok<number>(r, 'w_waiting')).toBe(ok<number>(r, 'w_proposer_waiting') - 1);
    // Everyone else at MGMT still reads it.
    expect(ok<number>(r, 'w_proposer_rows')).toBe(1);
    expect(ok<string[]>(r, 'w_proposer_page')).toContain(who.d);
    expect(ok<string[]>(r, 'w_proposer_month')).toContain(who.mgr2);
    expect(ok<string[]>(r, 'a_owner_page')).toContain(who.d);
    // As the person: the approved row, with nothing of who proposed it.
    const mine = ok<{ deductions: MyRow[] }>(r, 'mine').deductions;
    expect(mine.map((m) => m.id)).toEqual([who.d]);
    expect(Object.keys(mine[0]!).sort()).toEqual(['amount_iqd', 'dated_earlier', 'decided_at', 'deduction_date', 'id', 'reason', 'status']);
  });

  it('keeps deductions from the owner assistant: no readable column, and audit rows carry {status} only', () => {
    const r = scenario([
      ...DAYS,
      MK('hb', 'head_barista'), MK('bar', 'barista'),
      propose('hb', 'a', 'bar', 25000), RES('a', 'a', 'id'),
      propose('hb', 'b', 'bar', 15000), RES('b', 'b', 'id'),
      propose('hb', 'c', 'bar', 5000), RES('c', 'c', 'id'),
      decide('manager', 'approve', 'a', 'true', `'Agreed'`),
      decide('manager', 'decline', 'b', 'false', `'Not his fault'`),
      T('withdraw', 'hb', `select app.withdraw_deduction({{c}}::uuid)`),
      T('cancel', 'owner', `select app.cancel_deduction({{a}}::uuid, 'Approved by mistake')`),
      Q('columns', `select to_jsonb(count(*)) from app.assistant_readable_columns where table_name = 'salary_deductions'`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'entity', a.entity, 'before', a.before,
                                                      'after', a.after, 'reason_code', a.reason_code) order by a.id)
                    from audit_log a
                   where a.action like 'staff.deduction.%' and a.entity_id in ({{a}}, {{b}}, {{c}})`),
      // The push queue: deduction_recorded went to the person, so its
      // recipient and payload would name them beside the approval's audit row.
      Q('recorded', `select to_jsonb(count(*)) from notification_outbox
                      where profile_id = {{bar}}::uuid and payload->>'title_key' = 'deduction_recorded'`),
      Q('outbox_columns', `select coalesce(jsonb_agg(column_name order by column_name), '[]'::jsonb)
                             from app.assistant_readable_columns
                            where table_name = 'notification_outbox' and column_name in ('profile_id', 'payload')`),
      T('outbox_named', 'owner', `select app.assistant_run_tool('assistant_table_read',
                                    jsonb_build_object('p_table', 'notification_outbox',
                                                       'p_columns', jsonb_build_array('profile_id', 'kind', 'created_at')))`),
      T('outbox_payload', 'owner', `select app.assistant_run_tool('assistant_table_read',
                                      jsonb_build_object('p_table', 'notification_outbox',
                                                         'p_columns', jsonb_build_array('payload')))`),
      // Last: a tool call that runs leaves the transaction read-only.
      T('outbox_default', 'owner', `select app.assistant_run_tool('assistant_table_read',
                                      jsonb_build_object('p_table', 'notification_outbox', 'p_limit', 200))`),
      Q('who', `select jsonb_build_object('bar', {{bar}})`),
    ]);
    for (const l of ['approve', 'decline', 'withdraw', 'cancel']) ok(r, l);
    expect(ok<number>(r, 'columns')).toBe(0);
    const audit = ok<Array<{ action: string; entity: string; before: object | null; after: object; reason_code: null }>>(r, 'audit');
    expect(audit.map((a) => a.action).sort()).toEqual([
      'staff.deduction.approve', 'staff.deduction.cancel', 'staff.deduction.decline',
      'staff.deduction.propose', 'staff.deduction.propose', 'staff.deduction.propose', 'staff.deduction.withdraw',
    ]);
    for (const a of audit) {
      expect(a.entity).toBe('salary_deduction');
      expect(a.reason_code).toBeNull();
      for (const side of [a.before, a.after]) {
        if (side !== null) expect(Object.keys(side)).toEqual(['status']);
      }
    }
    expect(JSON.stringify(audit)).not.toMatch(/25000|15000|Agreed|fault|mistake|SD bar/);

    expect(ok<number>(r, 'recorded')).toBe(1);
    expect(ok<string[]>(r, 'outbox_columns')).toEqual([]);
    expect(refused(r, 'outbox_named')).toBe('ASSISTANT_UNKNOWN_COLUMN');
    expect(refused(r, 'outbox_payload')).toBe('ASSISTANT_UNKNOWN_COLUMN');
    const rows = JSON.stringify(ok(r, 'outbox_default'));
    expect(rows).not.toContain(ok<{ bar: string }>(r, 'who').bar);
    expect(rows).not.toMatch(/deduction_/);
  });
});

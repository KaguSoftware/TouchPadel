/**
 * Gender hours (0353): courts kept for women or men at set times.
 *
 *   * the card: app.upsert_court_gender_rule is a manager's or the owner's
 *     (FORBIDDEN for the till), refuses a bad gender, no days, an empty
 *     window and dates the wrong way round, sorts the days and audits;
 *   * the clock: app.slot_gender_rules counts any overlap, a window past
 *     midnight belongs to the day it starts on, a court rule keeps only its
 *     court, an off rule or a date outside the rule's keeps nothing;
 *   * the booking guard: a booking or hold with a guest account on a kept
 *     slot needs that gender (SLOT_GENDER_RESTRICTED, detail the kept one) and
 *     any gender at all (GENDER_REQUIRED); a typed desk name passes; moving a
 *     booking into a kept window is judged, a status change is not;
 *   * the match guard: an open or men's match touching a women's window is
 *     refused, a women's match and a sandbox match pass;
 *   * desk_register_customer stamps the desk's gender (gender_set_by staff).
 *
 * HOW. As staff-access.test.ts: every scenario is ONE psql transaction that
 * is rolled back. Without docker on PATH the stack part skips itself.
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

const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('venue', '${VENUE_A_ID}');
insert into vars
select 'c' || row_number() over (order by sort_order, id), id::text
  from courts where venue_id = '${VENUE_A_ID}' and is_active order by sort_order, id limit 2;

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

-- p_who NULL: a fixture write as postgres (no claims), else the caller's JWT as authenticated.
create function pg_temp.run(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_detail text; v_hint text;
begin
  if p_who is null then
    perform set_config('request.jwt.claims', '', true);
  else
    select val into v_uid from pg_temp.vars where name = p_who;
    if v_uid is null then raise exception 'unknown principal %', p_who; end if;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, ''),
                                        'hint', nullif(v_hint, '')));
  end;
end $f$;

-- Keep a value (the first column of p_sql) as {{p_name}}.
create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.vars values (p_name, v);
end $f$;

-- A guest account with a profile and the given gender (NULL: none).
create function pg_temp.guest(p_name text, p_gender text) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'gr-' || p_name || '-' || v || '@test.touch.local',
          jsonb_build_object('full_name', 'GR ' || p_name), 'authenticated', 'authenticated');
  if p_gender is not null then
    update profiles set gender = p_gender, gender_set_at = now(), gender_set_by = 'guest' where id = v;
  end if;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  detail?: string | null;
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

/** A call as `authenticated` with the caller's claims. */
const T = (label: string, who: string, sql: string) => `select pg_temp.run('${label}', '${who}', $q$${sql}$q$);`;
/** A fixture write or read as postgres, its outcome kept under `label`. */
const FX = (label: string, sql: string) => `select pg_temp.run('${label}', null, $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const GUEST = (name: string, gender: 'female' | 'male' | null) =>
  `select pg_temp.guest('${name}', ${gender ? `'${gender}'` : 'null'});`;

/** A rule written as postgres (the fixture path), kept as `name`. */
const RULE = (name: string, cols: { gender: string; court?: string; days: string; start: string; end: string; extra?: string }) =>
  KEEP(
    name,
    `insert into court_gender_rules (venue_id, name, gender, court_id, days_of_week, start_time, end_time ${cols.extra ? ', ' + cols.extra.split('=')[0] : ''})
     values ({{venue}}::uuid, 'gr ${name}', '${cols.gender}', ${cols.court ? `{{${cols.court}}}::uuid` : 'null'},
             '${cols.days}', '${cols.start}', '${cols.end}' ${cols.extra ? ', ' + cols.extra.split('=')[1] : ''})
     returning id::text`,
  );

/** A booking (or hold) for a guest on a court, Baghdad wall time; NULL guest = a typed desk name. */
const BOOK = (label: string, court: string, guest: string | null, from: string, to: string, kind = 'booking') =>
  FX(
    label,
    `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source,
                               hold_expires_at)
     values ({{venue}}::uuid, {{${court}}}::uuid, '${kind}', '${kind === 'hold' ? 'pending' : 'confirmed'}',
             '${from}+03', '${to}+03', ${guest ? `{{${guest}}}::uuid` : 'null'}, 'GR walk-in',
             '${guest ? 'mobile' : 'desk'}', ${kind === 'hold' ? `now() + interval '10 minutes'` : 'null'})
     returning to_jsonb(id)`,
  );

const RULES_AT = (label: string, court: string | null, from: string, to: string) =>
  FX(label, `select to_jsonb(app.slot_gender_rules({{venue}}::uuid, ${court ? `{{${court}}}::uuid` : 'null'}, '${from}+03', '${to}+03'))`);

// 2030-01-07 is a Monday (dow 1); 2030-01-11 a Friday, 2030-01-12 a Saturday.
const MON = '2030-01-07';

const UPSERT = (args: string) => `select to_jsonb(app.upsert_court_gender_rule(${args}))`;

describe.skipIf(!docker)('0353 upsert_court_gender_rule', () => {
  it('a manager or the owner saves; bad input is refused; days are sorted; audited', () => {
    const r = scenario([
      T('cash', 'cashier', UPSERT(`'x', 'female', '{1}', '10:00', '12:00'`)),
      T('badGender', 'manager', UPSERT(`'x', 'other', '{1}', '10:00', '12:00'`)),
      T('noDays', 'manager', UPSERT(`'x', 'female', '{}', '10:00', '12:00'`)),
      T('badDay', 'manager', UPSERT(`'x', 'female', '{7}', '10:00', '12:00'`)),
      T('sameTime', 'manager', UPSERT(`'x', 'female', '{1}', '10:00', '10:00'`)),
      T('noName', 'manager', UPSERT(`'  ', 'female', '{1}', '10:00', '12:00'`)),
      T('dates', 'manager', UPSERT(`'x', 'female', '{1}', '10:00', '12:00', p_valid_from => '2030-02-01', p_valid_to => '2030-01-01'`)),
      T('noCourt', 'manager', UPSERT(`'x', 'female', '{1}', '10:00', '12:00', p_court_id => gen_random_uuid()`)),
      T('noRule', 'manager', UPSERT(`'x', 'female', '{1}', '10:00', '12:00', p_id => gen_random_uuid()`)),
      T('mgr', 'manager', UPSERT(`' Ladies ', 'female', '{3,1,1}', '10:00', '12:00', p_venue_id => {{venue}}::uuid`)),
      KEEP('r1', `select id::text from court_gender_rules where name = 'Ladies' and venue_id = {{venue}}::uuid order by created_at desc limit 1`),
      FX('row', `select jsonb_build_object('days', days_of_week, 'gender', gender, 'court', court_id, 'active', is_active)
                   from court_gender_rules where id = {{r1}}::uuid`),
      T('own', 'owner', UPSERT(`'Men late', 'male', '{5}', '22:00', '02:00', p_id => {{r1}}::uuid, p_court_id => {{c1}}::uuid, p_is_active => false`)),
      FX('row2', `select jsonb_build_object('gender', gender, 'court', court_id = {{c1}}::uuid, 'active', is_active, 'end', end_time)
                    from court_gender_rules where id = {{r1}}::uuid`),
      FX('audit', `select to_jsonb(array_agg(action order by action)) from audit_log
                    where entity = 'court_gender_rules' and entity_id = {{r1}}`),
    ]);
    expect(r.cash).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(r.badGender).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_gender' });
    expect(r.noDays).toMatchObject({ ok: false, code: 'INVALID_DAYS' });
    expect(r.badDay).toMatchObject({ ok: false, code: 'INVALID_DAYS' });
    expect(r.sameTime).toMatchObject({ ok: false, code: 'INVALID_TIME_RANGE' });
    expect(r.noName).toMatchObject({ ok: false, code: 'NAME_LENGTH' });
    expect(r.dates).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_valid_to' });
    expect(r.noCourt).toMatchObject({ ok: false, code: 'COURT_NOT_FOUND' });
    expect(r.noRule).toMatchObject({ ok: false, code: 'RULE_NOT_FOUND' });
    expect(r.mgr).toMatchObject({ ok: true });
    expect(r.row!.data).toEqual({ days: [1, 3], gender: 'female', court: null, active: true });
    expect(r.own).toMatchObject({ ok: true });
    expect(r.row2!.data).toEqual({ gender: 'male', court: true, active: false, end: '02:00:00' });
    expect(r.audit!.data).toEqual(['gender_rule.create', 'gender_rule.update']);
  });
});

describe.skipIf(!docker)('0353 slot_gender_rules', () => {
  it('any overlap counts, a late window runs past midnight, a court rule keeps its court only', () => {
    const r = scenario([
      RULE('all', { gender: 'female', days: '{1}', start: '16:00', end: '18:00' }),
      RULE('late', { gender: 'male', court: 'c1', days: '{5}', start: '22:00', end: '02:00' }),
      RULE('off', { gender: 'male', days: '{1}', start: '08:00', end: '09:00', extra: 'is_active=false' }),
      RULE('later', { gender: 'male', days: '{1}', start: '06:00', end: '07:00', extra: "valid_from='2031-01-01'" }),
      RULES_AT('before', null, `${MON} 15:00`, `${MON} 16:00`),
      RULES_AT('touch', null, `${MON} 15:30`, `${MON} 17:00`),
      RULES_AT('inside', 'c2', `${MON} 16:00`, `${MON} 17:00`),
      RULES_AT('after', null, `${MON} 18:00`, `${MON} 19:00`),
      RULES_AT('tuesday', null, '2030-01-08 16:00', '2030-01-08 17:00'),
      RULES_AT('lateC1', 'c1', '2030-01-12 01:00', '2030-01-12 02:00'),
      RULES_AT('lateC2', 'c2', '2030-01-12 01:00', '2030-01-12 02:00'),
      RULES_AT('lateAny', null, '2030-01-11 23:00', '2030-01-12 00:00'),
      RULES_AT('satNight', 'c1', '2030-01-12 22:00', '2030-01-12 23:00'),
      RULES_AT('offRule', null, `${MON} 08:00`, `${MON} 09:00`),
      RULES_AT('notYet', null, `${MON} 06:00`, `${MON} 07:00`),
    ]);
    expect(r.before!.data).toBeNull();
    expect(r.touch!.data).toEqual(['female']);
    expect(r.inside!.data).toEqual(['female']);
    expect(r.after!.data).toBeNull();
    expect(r.tuesday!.data).toBeNull();
    expect(r.lateC1!.data).toEqual(['male']);
    expect(r.lateC2!.data).toBeNull();
    expect(r.lateAny!.data).toEqual(['male']);
    expect(r.satNight!.data).toBeNull();
    expect(r.offRule!.data).toBeNull();
    expect(r.notYet!.data).toBeNull();
  });
});

describe.skipIf(!docker)('0353 reservations_gender_guard', () => {
  it('a kept slot takes the kept gender only, and an account must have one', () => {
    const r = scenario([
      GUEST('her', 'female'),
      GUEST('him', 'male'),
      GUEST('anon', null),
      RULE('w', { gender: 'female', court: 'c1', days: '{1}', start: '16:00', end: '18:00' }),
      BOOK('man', 'c1', 'him', `${MON} 17:00`, `${MON} 18:00`),
      BOOK('manHold', 'c1', 'him', `${MON} 15:00`, `${MON} 16:30`, 'hold'),
      BOOK('noGender', 'c1', 'anon', `${MON} 16:00`, `${MON} 17:00`),
      BOOK('woman', 'c1', 'her', `${MON} 16:00`, `${MON} 17:00`),
      BOOK('walkIn', 'c1', null, `${MON} 17:00`, `${MON} 18:00`),
      BOOK('otherCourt', 'c2', 'him', `${MON} 16:00`, `${MON} 17:00`),
      BOOK('manLater', 'c1', 'him', `${MON} 19:00`, `${MON} 20:00`),
    ]);
    expect(r.man).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'female' });
    expect(r.manHold).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'female' });
    expect(r.noGender).toMatchObject({ ok: false, code: 'GENDER_REQUIRED', detail: 'female' });
    expect(r.woman).toMatchObject({ ok: true });
    expect(r.walkIn).toMatchObject({ ok: true });
    expect(r.otherCourt).toMatchObject({ ok: true });
    expect(r.manLater).toMatchObject({ ok: true });
  });

  it('a move into a kept window is judged; a status change on a booking already there is not', () => {
    const r = scenario([
      GUEST('him', 'male'),
      KEEP(
        'b',
        `insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source)
         values ({{venue}}::uuid, {{c1}}::uuid, 'booking', 'confirmed', '${MON} 19:00+03', '${MON} 20:00+03',
                 {{him}}::uuid, 'GR him', 'mobile') returning id::text`,
      ),
      RULE('w', { gender: 'female', days: '{1}', start: '19:00', end: '21:00' }),
      FX('arrive', `update reservations set status = 'arrived' where id = {{b}}::uuid returning to_jsonb(status)`),
      FX('extend', `update reservations set end_at = end_at + interval '30 minutes' where id = {{b}}::uuid returning to_jsonb(end_at)`),
      RULE('w2', { gender: 'female', days: '{1}', start: '10:00', end: '11:00' }),
      FX('move', `update reservations set start_at = '${MON} 10:00+03', end_at = '${MON} 11:00+03' where id = {{b}}::uuid returning to_jsonb(id)`),
    ]);
    expect(r.arrive).toMatchObject({ ok: true });
    expect(r.extend).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED' });
    expect(r.move).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'female' });
  });

  it('two rules that disagree keep everyone out, said as both', () => {
    const r = scenario([
      GUEST('her', 'female'),
      RULE('w', { gender: 'female', days: '{1}', start: '16:00', end: '18:00' }),
      RULE('m', { gender: 'male', court: 'c1', days: '{1}', start: '17:00', end: '19:00' }),
      BOOK('her', 'c1', 'her', `${MON} 17:00`, `${MON} 18:00`),
    ]);
    expect(r.her).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'both' });
  });
});

const MATCH = (label: string, category: string, from: string, to: string, sandbox = false) =>
  FX(
    label,
    `insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                          price_iqd, shares_iqd, price_court_id, fill_deadline_at, share_token, organised_by,
                          created_by_staff_id, sandbox)
     values ({{venue}}::uuid, 'filling', '${from}+03', '${to}+03', 60, 'public', 'open', '${category}',
             40000, array[10000, 10000, 10000, 10000]::bigint[], {{c1}}::uuid, '${from}+03'::timestamptz - interval '2 hours',
             substr(replace(gen_random_uuid()::text, '-', ''), 1, 22), 'desk', {{manager}}::uuid, ${sandbox})
     returning to_jsonb(id)`,
  );

describe.skipIf(!docker)('0353 matches_gender_guard', () => {
  it('a match touching a women\'s window at its branch must be a women\'s match', () => {
    const r = scenario([
      RULE('w', { gender: 'female', court: 'c2', days: '{1}', start: '16:00', end: '18:00' }),
      MATCH('open', 'open', `${MON} 16:00`, `${MON} 17:00`),
      MATCH('men', 'men', `${MON} 17:30`, `${MON} 18:30`),
      MATCH('women', 'women', `${MON} 16:00`, `${MON} 17:00`),
      MATCH('sandbox', 'open', `${MON} 16:00`, `${MON} 17:00`, true),
      MATCH('outside', 'open', `${MON} 19:00`, `${MON} 20:00`),
    ]);
    expect(r.open).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'female' });
    expect(r.men).toMatchObject({ ok: false, code: 'SLOT_GENDER_RESTRICTED', detail: 'female' });
    expect(r.women).toMatchObject({ ok: true });
    expect(r.sandbox).toMatchObject({ ok: true });
    expect(r.outside).toMatchObject({ ok: true });
  });
});

describe.skipIf(!docker)('0353 desk_register_customer', () => {
  it('stamps the gender the desk gives, refuses another value, and still takes none', () => {
    const r = scenario([
      KEEP('u1', `insert into auth.users (id, email, raw_user_meta_data, aud, role)
                  values (gen_random_uuid(), 'gr-desk1-' || gen_random_uuid() || '@test.touch.local', '{}', 'authenticated', 'authenticated')
                  returning id::text`),
      KEEP('u2', `insert into auth.users (id, email, raw_user_meta_data, aud, role)
                  values (gen_random_uuid(), 'gr-desk2-' || gen_random_uuid() || '@test.touch.local', '{}', 'authenticated', 'authenticated')
                  returning id::text`),
      KEEP('u3', `insert into auth.users (id, email, raw_user_meta_data, aud, role)
                  values (gen_random_uuid(), 'gr-desk3-' || gen_random_uuid() || '@test.touch.local', '{}', 'authenticated', 'authenticated')
                  returning id::text`),
      FX('given', `select app.desk_register_customer({{u1}}::uuid, 'GR Desk One', '+964 770 900 1353', 'ar', {{manager}}::uuid, 'female')`),
      FX('stamp', `select jsonb_build_object('gender', gender, 'by', gender_set_by, 'at', gender_set_at is not null)
                     from profiles where id = {{u1}}::uuid`),
      FX('bad', `select app.desk_register_customer({{u2}}::uuid, 'GR Desk Two', '+964 770 900 2353', 'ar', {{manager}}::uuid, 'x')`),
      FX('none', `select app.desk_register_customer({{u3}}::uuid, 'GR Desk Three', '+964 770 900 3353', 'en', {{manager}}::uuid)`),
    ]);
    expect(r.given).toMatchObject({ ok: true, data: { gender: 'female' } });
    expect(r.stamp!.data).toEqual({ gender: 'female', by: 'staff', at: true });
    expect(r.bad).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_gender' });
    expect(r.none).toMatchObject({ ok: true, data: { gender: null } });
  });
});

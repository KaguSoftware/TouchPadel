/**
 * Coaching, database sub-step 2a: the schema (docs/design/coaching/db.md §4.1–§4.4,
 * money.md §3–§4; build contracts §1.1, §1.2, R1, R6, R22, R24, R26, R30, R43,
 * R49, R50, R56, R67, R74, R75). Migrations reservation_kind_lesson,
 * outbox_lesson_kinds, booking_payments_lesson_checks, tabs_kind_lesson,
 * coaching_settings, coaching_tables and coaching_indexes.
 *
 *   * the sixteen tables: RLS on, no policy, no client grant; the branch guard
 *     on the branch tables only, re-created on reservations, tabs and
 *     booking_payments with their new link;
 *   * reservation_kind 'lesson', the lesson court row's CHECKs and the 0071
 *     hold rule widened for a lesson's court hold (R1); every new or re-created
 *     constraint on an existing table validated;
 *   * tabs_lesson_shape, the booking_payments anchor and refund reasons for
 *     purpose 'lesson';
 *   * the CHECKs of lesson_types (lesson_types_cutoff, R26), courses, lessons,
 *     enrolments, attendance, strikes (lapsed_hold, R30), events, statements
 *     (the card guard, R49/R74) and statement lines (signed adjustments, R22);
 *   * the two exclusions: one live lesson per coach at every branch, one live
 *     time-off period;
 *   * the sanitisers, lesson_events append-only, statement lines frozen once
 *     approved, paid or void (STATEMENT_NOT_DRAFT, R22);
 *   * the partial indexes (one live court row per lesson, one live statement a
 *     month, one line per lesson, R24) and the storage folder;
 *   * the coach mutex (R6): app.lock_coach blocks, app.try_lock_coach never waits;
 *   * the settings: shipped off everywhere, the view's three columns and never the
 *     share, the manager reads, the owner writes, an online mode refused until
 *     the lessons terms are live (ONLINE_PAYMENT_OFF detail terms, R50, R67);
 *   * 0297 (DB-45, DB-46): the owner assistant reads no coach money or share
 *     column (C-28, D1), and no client reads venue_settings.coach_share_bp or
 *     coach_max_open_private (the table is granted column by column).
 *
 * Nothing writes a coaching row before the coaching RPCs, so every case is one
 * rolled-back psql transaction (the stores-harness scenario): rows are planted
 * as postgres, staff calls run as `authenticated` with the caller's claims.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import {
  dockerReachable,
  KEEP,
  MK,
  psql,
  psqlSession,
  Q,
  scenario,
  T,
  X,
  ok,
  refused,
  waitForSleeper,
  type Results,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** The planting helpers: e() captures a refusal as postgres; ins() plants one row from jsonb. */
const SETUP = String.raw`
create function pg_temp.e(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_con text; v_detail text;
begin
  perform set_config('request.jwt.claims', '', true);  -- a fixture write, not a staff write
  begin
    if p_sql ~* '^\s*(select|with)\M' then
      execute pg_temp.sub(p_sql) into v_res;
    else
      execute pg_temp.sub(p_sql);
    end if;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_con = constraint_name, v_detail = pg_exception_detail;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'constraint', nullif(v_con, ''),
                                        'detail', nullif(v_detail, '')));
  end;
end $f$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

-- One row of p_table from the jsonb (every key a column), its id back.
create function pg_temp.ins(p_table text, p_row jsonb) returns text language plpgsql as $f$
declare v_cols text; v_out text;
begin
  perform set_config('request.jwt.claims', '', true);
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_row) k;
  execute format('insert into public.%I as x (%s) select %s from jsonb_populate_record(null::public.%I, $1) '
                 'returning to_jsonb(x) ->> ''id''', p_table, v_cols, v_cols, p_table)
    into v_out using p_row;
  return v_out;
end $f$;

create function pg_temp.t0() returns timestamptz language sql as $f$
  select date_trunc('hour', now()) + interval '5 days'
$f$;

create function pg_temp.coach(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('coaches', jsonb_build_object('profile_id', pg_temp.var('g1'),
           'display_name_en', 'Coach One', 'display_name_ar', 'المدرّب الأول') || p)
$f$;
create function pg_temp.lt(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lesson_types', jsonb_build_object('venue_id', pg_temp.var('venue'), 'kind', 'private',
           'name_en', 'Private', 'name_ar', 'حصة خاصة', 'duration_min', 60, 'price_iqd', 25000,
           'court_share_iqd', 5000, 'max_places', 2, 'launched_at', now(), 'is_active', true) || p)
$f$;
create function pg_temp.course(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('courses', jsonb_build_object('venue_id', pg_temp.var('venue'), 'coach_id', pg_temp.var('c1'),
           'lesson_type_id', pg_temp.var('lt_course'), 'price_iqd', 80000, 'court_share_iqd', 5000,
           'coach_share_bp', 6000, 'sessions_count', 4, 'max_places', 8, 'min_places', 3,
           'cutoff_at', pg_temp.t0() - interval '2 hours', 'signup_closes_at', pg_temp.t0() + interval '21 days',
           'created_by_kind', 'staff', 'created_by_staff_id', pg_temp.var('desk')) || p)
$f$;
create function pg_temp.lesson(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lessons', jsonb_build_object('venue_id', pg_temp.var('venue'), 'coach_id', pg_temp.var('c1'),
           'lesson_type_id', pg_temp.var('lt'), 'kind', 'private', 'start_at', pg_temp.t0(),
           'end_at', pg_temp.t0() + interval '1 hour', 'price_iqd', 25000, 'court_share_iqd', 5000,
           'coach_share_bp', 6000, 'max_places', 2, 'min_places', 1, 'booked_by_kind', 'staff',
           'created_by_staff_id', pg_temp.var('desk')) || p)
$f$;
create function pg_temp.en(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lesson_enrolments', jsonb_build_object('venue_id', pg_temp.var('venue'),
           'lesson_id', pg_temp.var('l1'), 'guest_id', pg_temp.var('g2'), 'booked_by_kind', 'guest',
           'booked_by_profile_id', pg_temp.var('g2'), 'price_iqd', 25000, 'payment_mode', 'desk',
           'link_confirmed_at', now()) || p)
$f$;
create function pg_temp.st(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('coach_statements', jsonb_build_object('coach_id', pg_temp.var('c1'),
           'venue_id', pg_temp.var('venue'), 'month', date_trunc('month', now())::date) || p)
$f$;
create function pg_temp.line(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('coach_statement_lines', jsonb_build_object('statement_id', pg_temp.var('s1'),
           'venue_id', pg_temp.var('venue'), 'lesson_id', pg_temp.var('l1'), 'collected_iqd', 25000,
           'court_share_iqd', 5000, 'share_bp', 6000, 'coach_iqd', 12000) || p)
$f$;
`;

/** Plant as postgres and capture the outcome. The SQL must return jsonb or nothing. */
const E = (label: string, sql: string) => `select pg_temp.e('${label}', $q$${sql}$q$);`;

const GUEST = (name: string) =>
  KEEP(
    name,
    `insert into auth.users (id, email, raw_user_meta_data, aud, role)
              values (gen_random_uuid(), 'coach2a-${name}-' || gen_random_uuid() || '@test.touch.local',
                      '{"full_name":"Test ${name}"}', 'authenticated', 'authenticated') returning id`,
  );
const COURT = (name: string, venue = '{{venue}}') =>
  KEEP(
    name,
    `insert into courts (name_en, name_ar, venue_id)
              values ('C2A ${name}', 'ملعب ${name}', ${venue}) returning id`,
  );

/** A coach (g1), the three types at venue A, a private lesson l1 and a court. */
const BASE = [
  SETUP,
  GUEST('g1'),
  GUEST('g2'),
  COURT('court'),
  KEEP('c1', `select pg_temp.coach()`),
  KEEP('lt', `select pg_temp.lt()`),
  KEEP(
    'lt_group',
    `select pg_temp.lt('{"kind":"group","name_en":"Group","max_places":8,"min_places":3,"cutoff_hours":2,"price_iqd":10000}')`,
  ),
  KEEP(
    'lt_course',
    `select pg_temp.lt('{"kind":"course","name_en":"Course","max_places":8,"min_places":3,"cutoff_hours":2,"price_iqd":80000,"sessions_count":4}')`,
  ),
  KEEP('l1', `select pg_temp.lesson()`),
];

/** The constraint (or, when none is named, the message) a refused plant tripped. */
function tripped(r: Results, label: string): string {
  const o = r[label] as { ok: boolean; code?: string; constraint?: string | null } | undefined;
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.constraint ?? o!.code!;
}

const BRANCH_TABLES = [
  'coach_branches',
  'coach_hours',
  'lesson_types',
  'coach_lesson_types',
  'coach_prices',
  'courses',
  'lessons',
  'lesson_enrolments',
  'lesson_attendance',
  'lesson_strikes',
  'lesson_events',
  'coach_statements',
  'coach_statement_lines',
];
const CHAIN_TABLES = ['coaches', 'coach_time_off', 'coach_photo_purges'];

describe.skipIf(!docker)('coaching schema (2a)', () => {
  it('sixteen tables: RLS on, no policy, no client grant; the guard on the branch tables only', () => {
    const r = scenario('c2a-a', [
      SETUP,
      Q(
        'tables',
        `select jsonb_object_agg(c.relname, jsonb_build_object(
                     'rls', c.relrowsecurity,
                     'policies', (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
                     'client', has_table_privilege('anon', c.oid, 'select,insert,update,delete')
                               or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete'),
                     'service', has_table_privilege('service_role', c.oid, 'select,insert,update,delete'),
                     'guard', exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'zz_branch_guard'),
                     'venue_id', (select case when a.attnotnull then 'not null' else 'nullable' end
                                    from pg_attribute a
                                   where a.attrelid = c.oid and a.attname = 'venue_id' and not a.attisdropped),
                     'venue_default', (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
                                         join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                                        where d.adrelid = c.oid and a.attname = 'venue_id')))
                     from pg_class c
                    where c.relnamespace = 'public'::regnamespace
                      and c.relname in (${[...BRANCH_TABLES, ...CHAIN_TABLES].map((t) => `'${t}'`).join(', ')})`,
      ),
      Q(
        'guards',
        `select jsonb_object_agg(c.relname, pg_get_triggerdef(t.oid))
                     from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where t.tgname = 'zz_branch_guard' and c.relname in ('reservations', 'tabs', 'booking_payments')`,
      ),
    ]);
    const tables = ok<Record<string, Record<string, unknown>>>(r, 'tables');
    expect(Object.keys(tables).sort()).toEqual([...BRANCH_TABLES, ...CHAIN_TABLES].sort());
    for (const [name, t] of Object.entries(tables)) {
      expect(t, name).toMatchObject({ rls: true, policies: 0, client: false, service: true });
      const branch = BRANCH_TABLES.includes(name);
      expect(t.guard, `${name} zz_branch_guard`).toBe(branch);
      // A branch row names its branch (no default: every writer names it); a chain row has none.
      expect(t.venue_id, `${name} venue_id`).toBe(branch ? 'not null' : null);
      expect(t.venue_default, `${name} venue_id default`).toBeNull();
    }
    const guards = ok<Record<string, string>>(r, 'guards');
    expect(guards.reservations).toMatch(/'lessons', 'lesson_id'\)/);
    expect(guards.tabs).toMatch(/'lesson_enrolments', 'lesson_enrolment_id'\)/);
    expect(guards.booking_payments).toMatch(/'lesson_enrolments', 'lesson_enrolment_id'\)/);
  });

  it('every new or re-created constraint on an existing table is validated; the enum has lesson', () => {
    const r = scenario('c2a-b', [
      SETUP,
      Q('kinds', `select to_jsonb(enum_range(null::reservation_kind)::text[])`),
      Q(
        'cons',
        `select jsonb_object_agg(conname || '@' || conrelid::regclass::text, convalidated)
                   from pg_constraint
                  where (conrelid, conname) in (
                    ('public.reservations'::regclass, 'reservations_lesson_id_fkey'),
                    ('public.reservations'::regclass, 'reservations_lesson_link'),
                    ('public.reservations'::regclass, 'reservations_lesson_kind'),
                    ('public.reservations'::regclass, 'reservations_lesson_row'),
                    ('public.reservations'::regclass, 'reservations_live_hold_has_guest'),
                    ('public.tabs'::regclass, 'tabs_lesson_enrolment_fkey'),
                    ('public.tabs'::regclass, 'tabs_lesson_iqd_nonneg'),
                    ('public.tabs'::regclass, 'tabs_lesson_shape'),
                    ('public.tabs'::regclass, 'tabs_kind_chk'),
                    ('public.booking_payments'::regclass, 'booking_payments_lesson_enrolment_fkey'),
                    ('public.booking_payments'::regclass, 'booking_payments_anchor'),
                    ('public.booking_payments'::regclass, 'booking_payments_reason_by_purpose'),
                    ('public.booking_payments'::regclass, 'booking_payments_purpose_check'),
                    ('public.booking_payments'::regclass, 'booking_payments_refund_reason_check'),
                    ('public.notification_outbox'::regclass, 'notification_outbox_kind_check'),
                    ('public.venue_settings'::regclass, 'venue_settings_coaching_rules'),
                    ('public.platform_settings'::regclass, 'platform_settings_lesson_terms'))`,
      ),
      Q(
        'cols',
        `select jsonb_object_agg(table_name || '.' || column_name,
                                         jsonb_build_object('nullable', is_nullable, 'default', column_default, 'type', data_type))
                   from information_schema.columns
                  where table_schema = 'public'
                    and ((table_name = 'reservations' and column_name = 'lesson_id')
                      or (table_name = 'tabs' and column_name in ('lesson_enrolment_id', 'lesson_iqd'))
                      or (table_name = 'booking_payments' and column_name = 'lesson_enrolment_id'))`,
      ),
    ]);
    expect(ok<string[]>(r, 'kinds')).toEqual(['booking', 'hold', 'maintenance', 'lesson']);
    const cons = ok<Record<string, boolean>>(r, 'cons');
    expect(Object.keys(cons)).toHaveLength(17);
    for (const [name, valid] of Object.entries(cons)) expect(valid, name).toBe(true);
    const cols = ok<Record<string, { nullable: string; default: string | null; type: string }>>(
      r,
      'cols',
    );
    expect(cols['reservations.lesson_id']).toMatchObject({
      nullable: 'YES',
      default: null,
      type: 'uuid',
    });
    expect(cols['tabs.lesson_enrolment_id']).toMatchObject({ nullable: 'YES', default: null });
    // bigint with a named CHECK, not the iqd domain (no rewrite of the till's table).
    expect(cols['tabs.lesson_iqd']).toMatchObject({ nullable: 'NO', default: '0', type: 'bigint' });
    expect(cols['booking_payments.lesson_enrolment_id']).toMatchObject({
      nullable: 'YES',
      default: null,
    });
  });

  it('a lesson court row: kind lesson or a held hold, named, unpriced, guest-less; the widened hold rule (R1)', () => {
    const res = (label: string, patch: string, start = 'pg_temp.t0()') =>
      E(
        label,
        `select to_jsonb(pg_temp.ins('reservations', jsonb_build_object(
                  'venue_id', {{venue}}, 'court_id', {{court}}, 'kind', 'lesson', 'status', 'confirmed',
                  'start_at', ${start}, 'end_at', ${start} + interval '1 hour', 'source', 'desk',
                  'guest_name', 'Lesson', 'lesson_id', {{l1}}) || ${patch}))`,
      );
    const r = scenario('c2a-c', [
      ...BASE,
      KEEP(
        'l_other_branch',
        `select pg_temp.ins('lessons', jsonb_build_object('venue_id', {{other_venue}},
            'coach_id', {{c1}}, 'lesson_type_id', pg_temp.lt(jsonb_build_object('venue_id', {{other_venue}})),
            'kind', 'private', 'start_at', pg_temp.t0() + interval '7 days', 'end_at', pg_temp.t0() + interval '7 days 1 hour',
            'price_iqd', 25000, 'court_share_iqd', 0, 'coach_share_bp', 6000, 'max_places', 2, 'min_places', 1,
            'booked_by_kind', 'staff', 'created_by_staff_id', {{desk}}))`,
      ),
      KEEP(
        'l_held',
        `select pg_temp.lesson(jsonb_build_object('start_at', pg_temp.t0() + interval '2 hours',
            'end_at', pg_temp.t0() + interval '3 hours', 'status', 'held', 'hold_expires_at', now() + interval '10 minutes',
            'booked_by_kind', 'guest', 'created_by_profile_id', {{g2}}, 'created_by_staff_id', null))`,
      ),
      res('lesson_row', `'{}'`),
      // A private lesson paid online holds its court with a hold row naming it, no guest (R1).
      res(
        'lesson_hold',
        `jsonb_build_object('kind', 'hold', 'status', 'pending', 'hold_expires_at', now() + interval '10 minutes',
            'lesson_id', {{l_held}})`,
        `pg_temp.t0() + interval '2 hours'`,
      ),
      res(
        'orphan_hold',
        `jsonb_build_object('kind', 'hold', 'status', 'pending', 'hold_expires_at', now() + interval '10 minutes', 'lesson_id', null, 'guest_name', null)`,
        `pg_temp.t0() + interval '4 hours'`,
      ),
      res('lesson_without_id', `'{"lesson_id":null}'`, `pg_temp.t0() + interval '6 hours'`),
      res('booking_with_lesson', `'{"kind":"booking"}'`, `pg_temp.t0() + interval '8 hours'`),
      res('lesson_named', `'{"guest_name":"Omar"}'`, `pg_temp.t0() + interval '10 hours'`),
      res('lesson_priced', `'{"price_iqd":25000}'`, `pg_temp.t0() + interval '12 hours'`),
      res(
        'lesson_with_guest',
        `jsonb_build_object('guest_id', {{g2}})`,
        `pg_temp.t0() + interval '14 hours'`,
      ),
      res(
        'lesson_unknown',
        `jsonb_build_object('lesson_id', gen_random_uuid())`,
        `pg_temp.t0() + interval '16 hours'`,
      ),
      res(
        'lesson_other_branch',
        `jsonb_build_object('lesson_id', {{l_other_branch}})`,
        `pg_temp.t0() + interval '18 hours'`,
      ),
      // One live court row per lesson (coaching_indexes): a second confirmed row for l1.
      res('second_live_row', `'{}'`, `pg_temp.t0() + interval '20 hours'`),
    ]);
    ok(r, 'lesson_row');
    ok(r, 'lesson_hold');
    expect(tripped(r, 'orphan_hold')).toBe('reservations_live_hold_has_guest');
    expect(tripped(r, 'lesson_without_id')).toBe('reservations_lesson_link');
    expect(tripped(r, 'booking_with_lesson')).toBe('reservations_lesson_kind');
    expect(tripped(r, 'lesson_named')).toBe('reservations_lesson_row');
    expect(tripped(r, 'lesson_priced')).toBe('reservations_lesson_row');
    expect(tripped(r, 'lesson_with_guest')).toBe('reservations_lesson_row');
    expect(tripped(r, 'lesson_unknown')).toBe('reservations_lesson_id_fkey');
    expect(tripped(r, 'lesson_other_branch')).toBe('VENUE_MISMATCH');
    expect(tripped(r, 'second_live_row')).toBe('reservations_one_live_per_lesson');
  });

  it('tabs_lesson_shape, the booking_payments anchor and the lesson refund reasons', () => {
    const pay = (label: string, patch: string) =>
      E(
        label,
        `select to_jsonb(pg_temp.ins('booking_payments', jsonb_build_object(
                  'purpose', 'lesson', 'provider', 'fake', 'sandbox', false, 'request_id', gen_random_uuid(),
                  'amount_iqd', 25000, 'quoted_price_iqd', 25000, 'status', 'created', 'locale', 'en',
                  'deadline_at', now() + interval '15 minutes', 'guest_id', {{g2}},
                  'venue_id', {{venue}}, 'lesson_enrolment_id', {{e1}}) || ${patch}))`,
      );
    const tab = (label: string, patch: string) =>
      E(
        label,
        `select to_jsonb(pg_temp.ins('tabs', jsonb_build_object(
                  'venue_id', {{venue}}, 'day_session_id', {{day}}, 'kind', 'lesson', 'status', 'open',
                  'lesson_enrolment_id', {{e1}}) || ${patch}))`,
      );
    const r = scenario('c2a-d', [
      ...BASE,
      KEEP('e1', `select pg_temp.en()`),
      KEEP(
        'day',
        `select pg_temp.ins('day_sessions', jsonb_build_object('venue_id', {{venue}},
                     'business_date', current_date + 400, 'opened_by', {{manager}}, 'opening_float_iqd', 0))`,
      ),
      pay('lesson_payment', `'{}'`),
      pay('second_active', `'{}'`),
      pay('without_enrolment', `'{"lesson_enrolment_id":null}'`),
      pay('without_branch', `'{"venue_id":null}'`),
      pay('with_booking', `jsonb_build_object('reservation_id', gen_random_uuid())`),
      pay('ticket_count', `'{"ticket_count":1}'`),
      pay('reason_cashout', `'{"status":"failed","refund_reason":"ticket_cashout"}'`),
      pay('reason_coach_cancel', `'{"status":"failed","refund_reason":"coach_cancel"}'`),
      pay('reason_under_filled', `'{"status":"failed","refund_reason":"under_filled"}'`),
      pay(
        'ticket_with_enrolment',
        `'{"purpose":"ticket","venue_id":null,"ticket_count":1,"quoted_price_iqd":25000}'`,
      ),
      tab('lesson_tab', `'{}'`),
      tab('second_live_tab', `'{}'`),
      tab('lesson_tab_no_enrolment', `'{"lesson_enrolment_id":null}'`),
      tab('cafe_tab_with_enrolment', `'{"kind":"cafe"}'`),
      tab(
        'cafe_tab_lesson_money',
        `'{"kind":"cafe","lesson_enrolment_id":null,"lesson_iqd":5000}'`,
      ),
      tab('lesson_tab_court_cap', `'{"court_cap_iqd":5000,"status":"settled"}'`),
      tab('lesson_tab_negative', `'{"lesson_iqd":-1,"status":"settled"}'`),
    ]);
    ok(r, 'lesson_payment');
    expect(tripped(r, 'second_active')).toBe('booking_payments_one_active_lesson');
    expect(tripped(r, 'without_enrolment')).toBe('booking_payments_anchor');
    expect(tripped(r, 'without_branch')).toBe('booking_payments_anchor');
    expect(tripped(r, 'with_booking')).toBe('booking_payments_anchor');
    expect(tripped(r, 'ticket_count')).toBe('booking_payments_anchor');
    expect(tripped(r, 'reason_cashout')).toBe('booking_payments_reason_by_purpose');
    ok(r, 'reason_coach_cancel');
    ok(r, 'reason_under_filled');
    expect(tripped(r, 'ticket_with_enrolment')).toBe('booking_payments_anchor');
    ok(r, 'lesson_tab');
    expect(tripped(r, 'second_live_tab')).toBe('tabs_one_live_per_enrolment');
    expect(tripped(r, 'lesson_tab_no_enrolment')).toBe('tabs_lesson_shape');
    expect(tripped(r, 'cafe_tab_with_enrolment')).toBe('tabs_lesson_shape');
    expect(tripped(r, 'cafe_tab_lesson_money')).toBe('tabs_lesson_shape');
    expect(tripped(r, 'lesson_tab_court_cap')).toBe('tabs_lesson_shape');
    expect(tripped(r, 'lesson_tab_negative')).toBe('tabs_lesson_iqd_nonneg');
  });

  it('lesson_types, courses and coaches: kinds, places, the cut-off rule (R26), prices, photos', () => {
    const lt = (label: string, patch: string) =>
      E(label, `select to_jsonb(pg_temp.lt('${patch}'))`);
    const r = scenario('c2a-e', [
      ...BASE,
      lt('draft', '{"price_iqd":null,"launched_at":null,"is_active":false}'),
      lt('launched_without_price', '{"price_iqd":null}'),
      lt('active_unlaunched', '{"launched_at":null}'),
      lt('free', '{"price_iqd":0}'),
      lt('private_five', '{"max_places":5}'),
      lt('private_min_two', '{"min_places":2}'),
      lt('private_cutoff', '{"cutoff_hours":2}'),
      lt(
        'group_min_three_no_cutoff',
        '{"kind":"group","max_places":8,"min_places":3,"cutoff_hours":0}',
      ),
      lt(
        'group_min_one_no_cutoff',
        '{"kind":"group","max_places":8,"min_places":1,"cutoff_hours":0}',
      ),
      lt('group_seventeen', '{"kind":"group","max_places":17,"min_places":1}'),
      lt('course_no_sessions', '{"kind":"course","max_places":8,"min_places":1}'),
      lt(
        'course_type_cheap',
        '{"kind":"course","max_places":8,"min_places":1,"sessions_count":4,"price_iqd":3}',
      ),
      lt('private_sessions', '{"sessions_count":4}'),
      lt('duration_45', '{"duration_min":45}'),
      lt('kind_clinic', '{"kind":"clinic"}'),
      E(
        'coach_photo',
        `select to_jsonb(pg_temp.coach(jsonb_build_object('profile_id', {{g2}},
          'photo_path', 'coaches/' || gen_random_uuid() || '/a1b2.jpg')))`,
      ),
      E(
        'coach_photo_bad',
        `select to_jsonb(pg_temp.coach(jsonb_build_object('profile_id', {{g2}},
          'photo_path', 'items/x.jpg')))`,
      ),
      E('coach_twice', `select to_jsonb(pg_temp.coach())`),
      E(
        'coach_retired_unstamped',
        `select to_jsonb(pg_temp.coach(jsonb_build_object('profile_id', {{g2}}, 'status', 'retired')))`,
      ),
      E('course_ok', `select to_jsonb(pg_temp.course())`),
      E('course_cheap', `select to_jsonb(pg_temp.course('{"price_iqd":3}'))`),
      E(
        'course_cutoff_after_signup',
        `select to_jsonb(pg_temp.course(jsonb_build_object('cutoff_at', pg_temp.t0() + interval '30 days')))`,
      ),
      E('course_coach_by_staff', `select to_jsonb(pg_temp.course('{"created_by_kind":"coach"}'))`),
      E('course_cancelled_unstamped', `select to_jsonb(pg_temp.course('{"status":"cancelled"}'))`),
      E(
        'coach_price',
        `select to_jsonb(pg_temp.ins('coach_prices', jsonb_build_object('coach_id', {{c1}},
          'lesson_type_id', {{lt}}, 'venue_id', {{venue}}, 'price_iqd', 30000)))`,
      ),
      E(
        'coach_price_zero',
        `select to_jsonb(pg_temp.ins('coach_prices', jsonb_build_object('coach_id', {{c1}},
          'lesson_type_id', {{lt_group}}, 'venue_id', {{venue}}, 'price_iqd', 0)))`,
      ),
      E(
        'hours_ok',
        `select to_jsonb(pg_temp.ins('coach_hours', jsonb_build_object('coach_id', {{c1}},
          'venue_id', {{venue}}, 'weekday', 0, 'start_time', '18:00', 'end_time', '24:00', 'set_by', 'coach')))`,
      ),
      E(
        'hours_off_grid',
        `select to_jsonb(pg_temp.ins('coach_hours', jsonb_build_object('coach_id', {{c1}},
          'venue_id', {{venue}}, 'weekday', 1, 'start_time', '18:15', 'end_time', '20:00', 'set_by', 'coach')))`,
      ),
      E(
        'hours_backwards',
        `select to_jsonb(pg_temp.ins('coach_hours', jsonb_build_object('coach_id', {{c1}},
          'venue_id', {{venue}}, 'weekday', 1, 'start_time', '20:00', 'end_time', '18:00', 'set_by', 'coach')))`,
      ),
      E(
        'hours_staff_unnamed',
        `select to_jsonb(pg_temp.ins('coach_hours', jsonb_build_object('coach_id', {{c1}},
          'venue_id', {{venue}}, 'weekday', 1, 'start_time', '18:00', 'end_time', '20:00', 'set_by', 'staff')))`,
      ),
      E(
        'hours_weekday_seven',
        `select to_jsonb(pg_temp.ins('coach_hours', jsonb_build_object('coach_id', {{c1}},
          'venue_id', {{venue}}, 'weekday', 7, 'start_time', '18:00', 'end_time', '20:00', 'set_by', 'coach')))`,
      ),
    ]);
    ok(r, 'draft');
    expect(tripped(r, 'launched_without_price')).toBe('lesson_types_launch');
    expect(tripped(r, 'active_unlaunched')).toBe('lesson_types_launch');
    expect(tripped(r, 'free')).toBe('lesson_types_price');
    expect(tripped(r, 'private_five')).toBe('lesson_types_places');
    expect(['lesson_types_places', 'lesson_types_cutoff']).toContain(tripped(r, 'private_min_two'));
    expect(tripped(r, 'private_cutoff')).toBe('lesson_types_places');
    // R26: a minimum above one needs a cut-off of at least an hour.
    expect(tripped(r, 'group_min_three_no_cutoff')).toBe('lesson_types_cutoff');
    ok(r, 'group_min_one_no_cutoff');
    expect(tripped(r, 'group_seventeen')).toBe('lesson_types_places');
    expect(tripped(r, 'course_no_sessions')).toBe('lesson_types_sessions');
    expect(tripped(r, 'course_type_cheap')).toBe('lesson_types_price');
    expect(tripped(r, 'private_sessions')).toBe('lesson_types_sessions');
    expect(tripped(r, 'duration_45')).toBe('lesson_types_duration');
    expect(tripped(r, 'kind_clinic')).toBe('lesson_types_kind');
    ok(r, 'coach_photo');
    expect(tripped(r, 'coach_photo_bad')).toBe('coaches_photo');
    expect(tripped(r, 'coach_twice')).toBe('coaches_profile_id_key');
    expect(tripped(r, 'coach_retired_unstamped')).toBe('coaches_retired');
    ok(r, 'course_ok');
    expect(tripped(r, 'course_cheap')).toBe('courses_numbers');
    expect(tripped(r, 'course_cutoff_after_signup')).toBe('courses_numbers');
    expect(tripped(r, 'course_coach_by_staff')).toBe('courses_created_by');
    expect(tripped(r, 'course_cancelled_unstamped')).toBe('courses_cancel');
    ok(r, 'coach_price');
    expect(tripped(r, 'coach_price_zero')).toBe('coach_prices_positive');
    ok(r, 'hours_ok');
    expect(tripped(r, 'hours_off_grid')).toBe('coach_hours_window');
    expect(tripped(r, 'hours_backwards')).toBe('coach_hours_window');
    expect(tripped(r, 'hours_staff_unnamed')).toBe('coach_hours_set_by');
    expect(tripped(r, 'hours_weekday_seven')).toBe('coach_hours_weekday');
  });

  it('lessons and enrolments: kinds, holds, endings, the typed student, links, parties, payment modes', () => {
    const l = (label: string, patch: string) =>
      E(label, `select to_jsonb(pg_temp.lesson(${patch}))`);
    const en = (label: string, patch: string) => E(label, `select to_jsonb(pg_temp.en(${patch}))`);
    const at = (h: number) =>
      `'start_at', pg_temp.t0() + interval '${h} hours', 'end_at', pg_temp.t0() + interval '${h + 1} hours'`;
    const r = scenario('c2a-f', [
      ...BASE,
      KEEP('course1', `select pg_temp.course()`),
      KEEP(
        'held',
        `select pg_temp.lesson(jsonb_build_object(${at(2)}, 'status', 'held', 'hold_expires_at', now() + interval '10 minutes'))`,
      ),
      l(
        'held_group',
        `jsonb_build_object(${at(4)}, 'kind', 'group', 'lesson_type_id', {{lt_group}}, 'price_iqd', 10000, 'max_places', 8, 'min_places', 3, 'cutoff_at', pg_temp.t0(), 'status', 'held', 'hold_expires_at', now() + interval '10 minutes')`,
      ),
      l('held_unstamped', `jsonb_build_object(${at(6)}, 'status', 'held')`),
      l(
        'group_without_cutoff',
        `jsonb_build_object(${at(8)}, 'kind', 'group', 'lesson_type_id', {{lt_group}}, 'price_iqd', 10000, 'max_places', 8, 'min_places', 3)`,
      ),
      l(
        'course_session',
        `jsonb_build_object(${at(10)}, 'kind', 'course', 'lesson_type_id', {{lt_course}}, 'course_id', {{course1}}, 'session_no', 1, 'price_iqd', null, 'max_places', 8, 'min_places', 3, 'cutoff_at', pg_temp.t0() - interval '2 hours')`,
      ),
      l(
        'course_session_priced',
        `jsonb_build_object(${at(12)}, 'kind', 'course', 'lesson_type_id', {{lt_course}}, 'course_id', {{course1}}, 'session_no', 2, 'max_places', 8, 'min_places', 3, 'cutoff_at', pg_temp.t0() - interval '2 hours')`,
      ),
      l(
        'course_session_twice',
        `jsonb_build_object(${at(14)}, 'kind', 'course', 'lesson_type_id', {{lt_course}}, 'course_id', {{course1}}, 'session_no', 1, 'price_iqd', null, 'max_places', 8, 'min_places', 3, 'cutoff_at', pg_temp.t0() - interval '2 hours')`,
      ),
      l(
        'too_long',
        `jsonb_build_object('start_at', pg_temp.t0() + interval '16 hours', 'end_at', pg_temp.t0() + interval '21 hours')`,
      ),
      l(
        'expired_wrong_reason',
        `jsonb_build_object(${at(22)}, 'status', 'expired', 'cancelled_at', now(), 'cancel_reason', 'coach_cancel')`,
      ),
      l(
        'expired',
        `jsonb_build_object(${at(24)}, 'status', 'expired', 'cancelled_at', now(), 'cancel_reason', 'payment_expired')`,
      ),
      l(
        'cancelled_unstamped',
        `jsonb_build_object(${at(26)}, 'status', 'cancelled', 'cancel_reason', 'coach_cancel')`,
      ),
      l('completed_unstamped', `jsonb_build_object(${at(28)}, 'status', 'completed')`),
      l('guest_booked_without_profile', `jsonb_build_object(${at(30)}, 'booked_by_kind', 'guest')`),
      // The enrolments, on l1 (private, party up to 2).
      en('guest', `'{}'`),
      en('guest_again', `'{}'`),
      en(
        'guest_unconfirmed',
        `jsonb_build_object('lesson_id', {{held}}, 'link_confirmed_at', null)`,
      ),
      en(
        'coach_typed',
        `jsonb_build_object('guest_id', null, 'guest_name', 'Ali', 'guest_phone', '+964 770 123 4567', 'booked_by_kind', 'coach', 'booked_by_profile_id', {{g1}}, 'link_confirmed_at', null)`,
      ),
      en(
        'coach_pending_link',
        `jsonb_build_object('lesson_id', {{held}}, 'guest_name', 'Ali', 'booked_by_kind', 'coach', 'booked_by_profile_id', {{g1}}, 'link_confirmed_at', null)`,
      ),
      en(
        'coach_untyped',
        `jsonb_build_object('booked_by_kind', 'coach', 'booked_by_profile_id', {{g1}}, 'link_confirmed_at', null)`,
      ),
      en(
        'coach_online',
        `jsonb_build_object('guest_id', null, 'guest_name', 'Ali', 'booked_by_kind', 'coach', 'booked_by_profile_id', {{g1}}, 'link_confirmed_at', null, 'payment_mode', 'online')`,
      ),
      en(
        'bad_phone',
        `jsonb_build_object('guest_id', null, 'guest_name', 'Ali', 'guest_phone', 'call me', 'booked_by_kind', 'staff', 'booked_by_staff_id', {{desk}}, 'booked_by_profile_id', null, 'link_confirmed_at', null)`,
      ),
      en(
        'both_targets',
        `jsonb_build_object('course_id', {{course1}}, 'first_session_no', 1, 'sessions_covered', 4)`,
      ),
      en(
        'course_without_sessions',
        `jsonb_build_object('lesson_id', null, 'course_id', {{course1}})`,
      ),
      en(
        'course_party',
        `jsonb_build_object('lesson_id', null, 'course_id', {{course1}}, 'first_session_no', 1, 'sessions_covered', 4, 'party_size', 2, 'guest_id', {{g1}}, 'booked_by_profile_id', {{g1}})`,
      ),
      en(
        'too_many_friends',
        `jsonb_build_object('guest_id', {{g1}}, 'booked_by_profile_id', {{g1}}, 'party_size', 2, 'friend_names', jsonb_build_array('Sara', 'Huda'))`,
      ),
      en(
        'held_desk',
        `jsonb_build_object('guest_id', {{g1}}, 'booked_by_profile_id', {{g1}}, 'status', 'held', 'hold_expires_at', now() + interval '10 minutes')`,
      ),
      en(
        'expired_wrong_kind',
        `jsonb_build_object('guest_id', {{g1}}, 'booked_by_profile_id', {{g1}}, 'status', 'expired', 'cancelled_at', now(), 'cancel_kind', 'guest_free')`,
      ),
      en(
        'outside_paid_negative',
        `jsonb_build_object('guest_id', {{g1}}, 'booked_by_profile_id', {{g1}}, 'refunded_outside_iqd', -1)`,
      ),
      // Attendance and the strike ledger (lapsed_hold, R30).
      E(
        'attended',
        `select to_jsonb(pg_temp.ins('lesson_attendance', jsonb_build_object('lesson_id', {{l1}},
          'enrolment_id', (select id from lesson_enrolments where lesson_id = {{l1}} and guest_id = {{g2}}),
          'venue_id', {{venue}}, 'status', 'attended', 'marked_by_kind', 'staff', 'marked_by_staff_id', {{desk}})))`,
      ),
      E(
        'marked_by_coach_unnamed',
        `select to_jsonb(pg_temp.ins('lesson_attendance', jsonb_build_object('lesson_id', {{l1}},
          'enrolment_id', (select id from lesson_enrolments where lesson_id = {{l1}} and guest_id = {{g2}}),
          'venue_id', {{venue}}, 'status', 'no_show', 'marked_by_kind', 'coach')))`,
      ),
      E(
        'strike_lapsed',
        `select to_jsonb(pg_temp.ins('lesson_strikes', jsonb_build_object('lesson_id', {{l1}},
          'enrolment_id', (select id from lesson_enrolments where lesson_id = {{l1}} and guest_id = {{g2}}),
          'venue_id', {{venue}}, 'guest_id', {{g2}}, 'kind', 'lapsed_hold')))`,
      ),
      E(
        'strike_half_settled',
        `select to_jsonb(pg_temp.ins('lesson_strikes', jsonb_build_object('lesson_id', {{held}},
          'enrolment_id', (select id from lesson_enrolments where lesson_id = {{l1}} and guest_id = {{g2}}),
          'venue_id', {{venue}}, 'guest_id', {{g2}}, 'kind', 'no_show', 'settled_at', now())))`,
      ),
    ]);
    expect(tripped(r, 'held_group')).toBe('lessons_hold');
    expect(tripped(r, 'held_unstamped')).toBe('lessons_hold');
    expect(tripped(r, 'group_without_cutoff')).toBe('lessons_cutoff');
    ok(r, 'course_session');
    expect(tripped(r, 'course_session_priced')).toBe('lessons_price');
    expect(tripped(r, 'course_session_twice')).toBe('lessons_course_session');
    expect(tripped(r, 'too_long')).toBe('lessons_time');
    expect(tripped(r, 'expired_wrong_reason')).toBe('lessons_ended');
    ok(r, 'expired');
    expect(tripped(r, 'cancelled_unstamped')).toBe('lessons_ended');
    expect(tripped(r, 'completed_unstamped')).toBe('lessons_ended');
    expect(tripped(r, 'guest_booked_without_profile')).toBe('lessons_booked_by');
    ok(r, 'guest');
    expect(tripped(r, 'guest_again')).toBe('lesson_enrolments_one_live_lesson');
    expect(tripped(r, 'guest_unconfirmed')).toBe('lesson_enrolments_link');
    ok(r, 'coach_typed');
    ok(r, 'coach_pending_link'); // C-21: a verified match links, unconfirmed
    expect(tripped(r, 'coach_untyped')).toBe('lesson_enrolments_typed');
    expect(tripped(r, 'coach_online')).toBe('lesson_enrolments_payment');
    expect(tripped(r, 'bad_phone')).toBe('lesson_enrolments_phone');
    expect(tripped(r, 'both_targets')).toBe('lesson_enrolments_target');
    expect(tripped(r, 'course_without_sessions')).toBe('lesson_enrolments_course');
    expect(tripped(r, 'course_party')).toBe('lesson_enrolments_party');
    expect(tripped(r, 'too_many_friends')).toBe('lesson_enrolments_friends');
    expect(tripped(r, 'held_desk')).toBe('lesson_enrolments_hold');
    expect(tripped(r, 'expired_wrong_kind')).toBe('lesson_enrolments_ended');
    expect(tripped(r, 'outside_paid_negative')).toBe('iqd_check');
    ok(r, 'attended');
    expect(tripped(r, 'marked_by_coach_unnamed')).toBe('lesson_attendance_by');
    ok(r, 'strike_lapsed');
    expect(tripped(r, 'strike_half_settled')).toBe('lesson_strikes_settled');
  });

  it('one live lesson per coach at a time, at every branch; one live time-off period; the branch guard', () => {
    const r = scenario('c2a-g', [
      ...BASE,
      KEEP('lt_b', `select pg_temp.lt(jsonb_build_object('venue_id', {{other_venue}}))`),
      // l1 runs t0 .. t0+1h at venue A. The same coach at venue B, half an hour later.
      E(
        'overlap_other_branch',
        `select to_jsonb(pg_temp.lesson(jsonb_build_object('venue_id', {{other_venue}},
          'lesson_type_id', {{lt_b}}, 'start_at', pg_temp.t0() + interval '30 minutes',
          'end_at', pg_temp.t0() + interval '90 minutes')))`,
      ),
      E(
        'back_to_back',
        `select to_jsonb(pg_temp.lesson(jsonb_build_object('start_at', pg_temp.t0() + interval '1 hour',
          'end_at', pg_temp.t0() + interval '2 hours')))`,
      ),
      E(
        'overlap_cancelled',
        `select to_jsonb(pg_temp.lesson(jsonb_build_object('start_at', pg_temp.t0() + interval '30 minutes',
          'end_at', pg_temp.t0() + interval '90 minutes', 'status', 'cancelled', 'cancelled_at', now(),
          'cancel_reason', 'coach_cancel')))`,
      ),
      E(
        'time_off',
        `select to_jsonb(pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
          'period', tstzrange(pg_temp.t0() + interval '1 day', pg_temp.t0() + interval '2 days', '[)'), 'set_by', 'coach')))`,
      ),
      E(
        'time_off_overlap',
        `select to_jsonb(pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
          'period', tstzrange(pg_temp.t0() + interval '36 hours', pg_temp.t0() + interval '3 days', '[)'), 'set_by', 'coach')))`,
      ),
      E(
        'time_off_cancelled_overlap',
        `select to_jsonb(pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
          'period', tstzrange(pg_temp.t0() + interval '36 hours', pg_temp.t0() + interval '3 days', '[)'), 'set_by', 'coach',
          'cancelled_at', now())))`,
      ),
      E(
        'time_off_closed_end',
        `select to_jsonb(pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
          'period', tstzrange(pg_temp.t0() + interval '5 days', pg_temp.t0() + interval '6 days', '[]'), 'set_by', 'coach')))`,
      ),
      // The guard: a link to another branch's row.
      E(
        'enrolment_other_branch',
        `select to_jsonb(pg_temp.en(jsonb_build_object('venue_id', {{other_venue}})))`,
      ),
      E(
        'type_link_other_branch',
        `select to_jsonb(pg_temp.ins('coach_lesson_types', jsonb_build_object('coach_id', {{c1}},
          'lesson_type_id', {{lt_b}}, 'venue_id', {{venue}})))`,
      ),
      E(
        'lesson_type_other_branch',
        `select to_jsonb(pg_temp.lesson(jsonb_build_object('lesson_type_id', {{lt_b}},
          'start_at', pg_temp.t0() + interval '3 days', 'end_at', pg_temp.t0() + interval '3 days 1 hour')))`,
      ),
      // A staff session has no grant on any coaching table: only the definer RPCs write.
      T(
        'staff_insert',
        'manager',
        `insert into coach_branches (coach_id, venue_id) values ({{c1}}, {{venue}}) returning to_jsonb(coach_id)`,
      ),
      T('staff_select', 'owner', `select to_jsonb(count(*)) from lessons`),
    ]);
    expect(tripped(r, 'overlap_other_branch')).toBe('lessons_coach_no_overlap');
    ok(r, 'back_to_back');
    ok(r, 'overlap_cancelled');
    ok(r, 'time_off');
    expect(tripped(r, 'time_off_overlap')).toBe('coach_time_off_no_overlap');
    ok(r, 'time_off_cancelled_overlap');
    expect(tripped(r, 'time_off_closed_end')).toBe('coach_time_off_period');
    expect(tripped(r, 'enrolment_other_branch')).toBe('VENUE_MISMATCH');
    expect(tripped(r, 'type_link_other_branch')).toBe('VENUE_MISMATCH');
    expect(tripped(r, 'lesson_type_other_branch')).toBe('VENUE_MISMATCH');
    expect(refused(r, 'staff_insert')).toMatch(/permission denied for table coach_branches/);
    expect(refused(r, 'staff_select')).toMatch(/permission denied for table lessons/);
  });

  it('the sanitisers clean typed text; a typed name made of controls is NULL; friend names keep their order', () => {
    const r = scenario('c2a-h', [
      ...BASE,
      KEEP(
        'c2',
        `select pg_temp.coach(jsonb_build_object('profile_id', {{g2}},
          'display_name_en', E'  Sara\\u200e  Coach ', 'display_name_ar', E'سارة\\u202e',
          'bio_en', E'Line one\\nline\\u0007 two', 'bio_ar', E'\\u0007'))`,
      ),
      Q(
        'coach',
        `select jsonb_build_object('en', display_name_en, 'ar', display_name_ar, 'bio_en', bio_en, 'bio_ar', bio_ar)
                    from coaches where id = {{c2}}`,
      ),
      KEEP(
        'lt2',
        `select pg_temp.lt(jsonb_build_object('name_en', E'Kids\\u0007  clinic', 'description_en', E'\\u202eA\\nB'))`,
      ),
      Q(
        'type',
        `select jsonb_build_object('name', name_en, 'description', description_en) from lesson_types where id = {{lt2}}`,
      ),
      KEEP(
        'co',
        `select pg_temp.course(jsonb_build_object('title_en', E' Spring\\u0007 ', 'title_ar', E'\\u200f'))`,
      ),
      Q(
        'course',
        `select jsonb_build_object('en', title_en, 'ar', title_ar) from courses where id = {{co}}`,
      ),
      KEEP(
        'off',
        `select pg_temp.ins('coach_time_off', jsonb_build_object('coach_id', {{c1}},
          'period', tstzrange(pg_temp.t0() + interval '9 days', pg_temp.t0() + interval '10 days', '[)'), 'set_by', 'coach',
          'reason', E'  away\\u0007 '))`,
      ),
      Q('off_row', `select to_jsonb(reason) from coach_time_off where id = {{off}}`),
      KEEP(
        'e1',
        `select pg_temp.en(jsonb_build_object('party_size', 3, 'friend_names',
          jsonb_build_array(E'  Ali\\u0007 ', '', E'\\u200e', 'Omar'), 'guest_name', E'\\u0007', 'guest_phone', '   '))`,
      ),
      Q(
        'enrolment',
        `select jsonb_build_object('name', guest_name, 'phone', guest_phone, 'friends', friend_names)
                        from lesson_enrolments where id = {{e1}}`,
      ),
      KEEP(
        'e2',
        `select pg_temp.en(jsonb_build_object('guest_id', null, 'guest_name', E' Huda\\u0007 ', 'guest_phone',
          E'\\u200e+964 770 000 1111', 'booked_by_kind', 'coach', 'booked_by_profile_id', {{g1}}, 'link_confirmed_at', null))`,
      ),
      Q(
        'typed',
        `select jsonb_build_object('name', guest_name, 'phone', guest_phone) from lesson_enrolments where id = {{e2}}`,
      ),
      KEEP('s1', `select pg_temp.st()`),
      X(`update coach_statements set status = 'void', voided_at = now(), voided_by = {{manager}},
            void_reason = E' duplicate\\u0007 ' where id = {{s1}}`),
      Q('statement', `select to_jsonb(void_reason) from coach_statements where id = {{s1}}`),
    ]);
    expect(ok(r, 'coach')).toEqual({
      en: 'Sara Coach',
      ar: 'سارة',
      bio_en: 'Line one\nline two',
      bio_ar: '',
    });
    expect(ok(r, 'type')).toEqual({ name: 'Kids clinic', description: 'A\nB' });
    expect(ok(r, 'course')).toEqual({ en: 'Spring', ar: '' });
    expect(ok(r, 'off_row')).toBe('away');
    expect(ok(r, 'enrolment')).toEqual({ name: null, phone: null, friends: ['Ali', 'Omar'] });
    expect(ok(r, 'typed')).toEqual({ name: 'Huda', phone: '+964 770 000 1111' });
    expect(ok(r, 'statement')).toBe('duplicate');
  });

  it('statements: one live a month, the card guard (R49, R74), signed adjustments, one line per lesson, frozen once approved, paid or void', () => {
    const r = scenario('c2a-i', [
      ...BASE,
      KEEP('s1', `select pg_temp.st()`),
      E('second_live', `select to_jsonb(pg_temp.st())`),
      E(
        'mid_month',
        `select to_jsonb(pg_temp.st(jsonb_build_object('month', date_trunc('month', now())::date + 3)))`,
      ),
      E(
        'paid_unstamped',
        `select to_jsonb(pg_temp.st(jsonb_build_object('month', (date_trunc('month', now()) - interval '1 month')::date,
          'status', 'paid')))`,
      ),
      E(
        'card_number',
        `select to_jsonb(pg_temp.st(jsonb_build_object('month', (date_trunc('month', now()) - interval '2 months')::date,
          'status', 'paid', 'approved_at', now(), 'approved_by', {{manager}}, 'paid_at', now(), 'paid_by', {{manager}},
          'paid_reference', '4111 1111-1111 1111')))`,
      ),
      E(
        'paid',
        `select to_jsonb(pg_temp.st(jsonb_build_object('month', (date_trunc('month', now()) - interval '3 months')::date,
          'status', 'paid', 'approved_at', now(), 'approved_by', {{manager}}, 'paid_at', now(), 'paid_by', {{manager}},
          'paid_reference', 'TRX-2026-10-01')))`,
      ),
      E('line', `select to_jsonb(pg_temp.line())`),
      E('line_twice', `select to_jsonb(pg_temp.line())`),
      KEEP(
        'l2',
        `select pg_temp.lesson(jsonb_build_object('start_at', pg_temp.t0() + interval '1 day', 'end_at', pg_temp.t0() + interval '25 hours'))`,
      ),
      E(
        'line_negative',
        `select to_jsonb(pg_temp.line(jsonb_build_object('lesson_id', {{l2}}, 'coach_iqd', -500)))`,
      ),
      E(
        'adjustment_negative',
        `select to_jsonb(pg_temp.line(jsonb_build_object('lesson_id', {{l2}}, 'coach_iqd', -500,
          'collected_iqd', -1000, 'is_adjustment', true)))`,
      ),
      E(
        'draft_line_update',
        `update coach_statement_lines set coach_iqd = 12500 where statement_id = {{s1}} and lesson_id = {{l1}}`,
      ),
      X(
        `update coach_statements set status = 'approved', approved_at = now(), approved_by = {{manager}} where id = {{s1}}`,
      ),
      E(
        'approved_insert',
        `select to_jsonb(pg_temp.line(jsonb_build_object('lesson_id', pg_temp.lesson(jsonb_build_object(
          'start_at', pg_temp.t0() + interval '2 days', 'end_at', pg_temp.t0() + interval '49 hours')))))`,
      ),
      E(
        'approved_update',
        `update coach_statement_lines set coach_iqd = 1 where statement_id = {{s1}} and lesson_id = {{l1}}`,
      ),
      E('approved_delete', `delete from coach_statement_lines where statement_id = {{s1}}`),
      X(`update coach_statements set status = 'void', voided_at = now(), voided_by = {{manager}}, void_reason = 'redraft'
          where id = {{s1}}`),
      E(
        'void_update',
        `update coach_statement_lines set coach_iqd = 1 where statement_id = {{s1}} and lesson_id = {{l1}}`,
      ),
      // A void statement frees its month for a fresh draft.
      E('redraft', `select to_jsonb(pg_temp.st())`),
      Q(
        'lines',
        `select to_jsonb(count(*)) from coach_statement_lines where statement_id = {{s1}}`,
      ),
    ]);
    expect(tripped(r, 'second_live')).toBe('coach_statements_one_live');
    expect(tripped(r, 'mid_month')).toBe('coach_statements_month');
    expect(tripped(r, 'paid_unstamped')).toBe('coach_statements_stamps');
    expect(tripped(r, 'card_number')).toBe('coach_statements_no_card');
    ok(r, 'paid');
    ok(r, 'line');
    expect(tripped(r, 'line_twice')).toBe('coach_statement_lines_one_per_lesson');
    expect(tripped(r, 'line_negative')).toBe('coach_statement_lines_sign');
    ok(r, 'adjustment_negative');
    ok(r, 'draft_line_update');
    expect(tripped(r, 'approved_insert')).toBe('STATEMENT_NOT_DRAFT');
    expect(tripped(r, 'approved_update')).toBe('STATEMENT_NOT_DRAFT');
    expect(tripped(r, 'approved_delete')).toBe('STATEMENT_NOT_DRAFT');
    expect(tripped(r, 'void_update')).toBe('STATEMENT_NOT_DRAFT');
    ok(r, 'redraft');
    expect(ok(r, 'lines')).toBe(2);
  });

  it('lesson_events is append-only and carries a target, an actor and an object', () => {
    const ev = (label: string, patch: string) =>
      E(
        label,
        `select to_jsonb(pg_temp.ins('lesson_events', jsonb_build_object('venue_id', {{venue}}, 'lesson_id', {{l1}},
                  'type', 'booked', 'actor', 'system') || ${patch}))`,
      );
    const r = scenario('c2a-j', [
      ...BASE,
      ev('booked', `'{}'`),
      ev('no_target', `'{"lesson_id":null}'`),
      ev('guest_unnamed', `'{"actor":"guest"}'`),
      ev('data_array', `'{"data":[1]}'`),
      ev('type_unknown', `'{"type":"teleported"}'`),
      E('update', `update lesson_events set code = 'x' where lesson_id = {{l1}}`),
      E('delete', `delete from lesson_events where lesson_id = {{l1}}`),
    ]);
    ok(r, 'booked');
    expect(tripped(r, 'no_target')).toBe('lesson_events_target');
    expect(tripped(r, 'guest_unnamed')).toBe('lesson_events_actor');
    expect(tripped(r, 'data_array')).toBe('lesson_events_data');
    expect(tripped(r, 'type_unknown')).toBe('lesson_events_type');
    expect(tripped(r, 'update')).toMatch(/append-only|not allowed|forbid/i);
    expect(tripped(r, 'delete')).toMatch(/append-only|not allowed|forbid/i);
  });

  it('the indexes are named, the hot-table ones partial; the storage folder; the assistant reads the catalogue, never students or pay', () => {
    const r = scenario('c2a-k', [
      SETUP,
      Q(
        'indexes',
        `select jsonb_object_agg(indexname, indexdef) from pg_indexes
                     where schemaname = 'public' and indexname in (
                       'reservations_one_live_per_lesson', 'reservations_lesson', 'tabs_one_live_per_enrolment',
                       'tabs_by_lesson_enrolment', 'booking_payments_one_active_lesson',
                       'booking_payments_by_lesson_enrolment')`,
      ),
      Q(
        'count',
        `select to_jsonb(count(*)) from pg_indexes
                   where schemaname = 'public'
                     and tablename in ('coaches', 'coach_branches', 'coach_time_off', 'coach_hours', 'lesson_types',
                                       'coach_lesson_types', 'coach_prices', 'courses', 'lessons', 'lesson_enrolments',
                                       'lesson_attendance', 'lesson_strikes', 'lesson_events', 'coach_statements',
                                       'coach_statement_lines', 'coach_photo_purges')`,
      ),
      Q(
        'policy',
        `select to_jsonb(with_check) from pg_policies
                    where schemaname = 'storage' and tablename = 'objects' and policyname = 'menu_media_staff_insert'`,
      ),
      Q(
        'readable',
        `select jsonb_object_agg(t, n) from (
                       select table_name as t, count(*) as n from app.assistant_readable_columns
                        where table_name in ('coaches', 'coach_branches', 'coach_hours', 'lesson_types', 'coach_lesson_types',
                                             'coach_prices', 'courses', 'lessons', 'lesson_enrolments', 'lesson_attendance',
                                             'lesson_strikes', 'lesson_events', 'coach_time_off', 'coach_statements',
                                             'coach_statement_lines', 'coach_photo_purges')
                        group by table_name) x`,
      ),
      Q(
        'identity',
        `select to_jsonb(coalesce(array_agg(table_name || '.' || column_name), '{}'))
                       from app.assistant_readable_columns
                      where table_name in ('coaches', 'courses', 'lessons')
                        and column_name in ('profile_id', 'created_by_profile_id', 'bio_en', 'bio_ar', 'photo_path',
                                            'public_accepted_at')`,
      ),
    ]);
    const idx = ok<Record<string, string>>(r, 'indexes');
    expect(Object.keys(idx).sort()).toEqual([
      'booking_payments_by_lesson_enrolment',
      'booking_payments_one_active_lesson',
      'reservations_lesson',
      'reservations_one_live_per_lesson',
      'tabs_by_lesson_enrolment',
      'tabs_one_live_per_enrolment',
    ]);
    for (const [name, def] of Object.entries(idx))
      expect(def, name).toMatch(/WHERE \(.*(lesson_id|lesson_enrolment_id) IS NOT NULL/);
    expect(idx.reservations_one_live_per_lesson).toMatch(/^CREATE UNIQUE INDEX/);
    // Primary keys, unique columns, two exclusions and the coaching_indexes file's indexes.
    expect(ok<number>(r, 'count')).toBeGreaterThanOrEqual(40);
    expect(ok<string>(r, 'policy')).toMatch(/'coaches'::text/);
    const readable = ok<Record<string, number>>(r, 'readable');
    expect(Object.keys(readable).sort()).toEqual([
      'coach_branches',
      'coach_hours',
      'coach_lesson_types',
      'coach_prices',
      'coaches',
      'courses',
      'lesson_types',
      'lessons',
    ]);
    expect(ok(r, 'identity')).toEqual([]);
  });

  it('coaching settings: off everywhere; the view has three columns and never the share; R50/R67 refuse an online mode until the terms are live', () => {
    const set = (label: string, who: string, patch: string) =>
      T(label, who, `select app.set_coaching_settings({{venue}}, '${patch}'::jsonb)`);
    const r = scenario('c2a-l', [
      SETUP,
      Q(
        'defaults',
        `select jsonb_agg(distinct jsonb_build_object('on', coaching_enabled, 'mode', lesson_payment_mode,
                       'bp', coach_share_bp, 'public', lesson_prices_public, 'cap', coach_max_open_private))
                       from venue_settings`,
      ),
      Q(
        'view',
        `select jsonb_agg(column_name order by ordinal_position) from information_schema.columns
                  where table_schema = 'public' and table_name = 'venue_settings_public'
                    and (column_name in ('coaching_enabled', 'lesson_payment_mode', 'lesson_prices_public')
                         or column_name in ('coach_share_bp', 'coach_max_open_private'))`,
      ),
      Q(
        'internal',
        `select jsonb_object_agg(p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                                         or has_function_privilege('anon', p.oid, 'EXECUTE'))
                       from pg_proc p where p.pronamespace = 'app'::regnamespace
                        and p.proname in ('coaching_rules', 'lesson_terms_ok', 'lock_coach', 'try_lock_coach')`,
      ),
      Q('terms_before', `select to_jsonb(app.lesson_terms_ok('2026-10-01'))`),
      T('mgr_read', 'manager', `select app.coaching_settings({{venue}})`),
      T('desk_read', 'desk', `select app.coaching_settings({{venue}})`),
      set('mgr_write', 'manager', '{"coaching_enabled":true}'),
      set('empty', 'owner', '{}'),
      set('bad_key', 'owner', '{"coach_name":"x"}'),
      set('bad_bp', 'owner', '{"coach_share_bp":10001}'),
      set('bad_cap', 'owner', '{"coach_max_open_private":0}'),
      set('bad_mode', 'owner', '{"lesson_payment_mode":"cash"}'),
      set('bad_bool', 'owner', '{"coaching_enabled":"yes"}'),
      set('online_early', 'owner', '{"lesson_payment_mode":"online_optional"}'),
      set(
        'switched_on',
        'owner',
        '{"coaching_enabled":true,"coach_max_open_private":12,"lesson_prices_public":true}',
      ),
      Q(
        'audit',
        `select to_jsonb(count(*)) from audit_log where action = 'venue.coaching_settings'
                     and entity_id = {{venue}} and at >= now()`,
      ),
      X(`update platform_settings set lesson_terms_version = '2026-10-01.9' where id`),
      set('online_ok', 'owner', '{"lesson_payment_mode":"online_required"}'),
      Q(
        'terms',
        `select jsonb_build_array(app.lesson_terms_ok(null), app.lesson_terms_ok('2026-10-01'),
                                           app.lesson_terms_ok('2026-10-01.10'), app.lesson_terms_ok('2026-10-02'))`,
      ),
      E('bad_terms_version', `update platform_settings set lesson_terms_version = 'soon' where id`),
      E(
        'bad_mode_row',
        `update venue_settings set lesson_payment_mode = 'cash' where venue_id = {{venue}}`,
      ),
    ]);
    expect(ok(r, 'defaults')).toEqual([
      { on: false, mode: 'desk', bp: 6000, public: false, cap: 10 },
    ]);
    expect(ok(r, 'view')).toEqual([
      'coaching_enabled',
      'lesson_payment_mode',
      'lesson_prices_public',
    ]);
    expect(ok(r, 'internal')).toEqual({
      coaching_rules: false,
      lesson_terms_ok: false,
      lock_coach: false,
      try_lock_coach: false,
    });
    expect(ok(r, 'terms_before')).toBe(false);
    expect(ok<Record<string, unknown>>(r, 'mgr_read')).toMatchObject({
      coaching_enabled: false,
      lesson_payment_mode: 'desk',
      coach_share_bp: 6000,
      lesson_prices_public: false,
      coach_max_open_private: 10,
      online_payments_available: false,
      lesson_terms_ready: false,
    });
    expect(refused(r, 'desk_read')).toBe('FORBIDDEN');
    expect(refused(r, 'mgr_write')).toBe('FORBIDDEN');
    expect(r.empty).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'p_patch' });
    expect(r.bad_key).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT', detail: 'coach_name' });
    expect(r.bad_bp).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: 'coach_share_bp',
    });
    expect(r.bad_cap).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: 'coach_max_open_private',
    });
    expect(r.bad_mode).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: 'lesson_payment_mode',
    });
    expect(r.bad_bool).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENT',
      detail: 'coaching_enabled',
    });
    expect(r.online_early).toMatchObject({
      ok: false,
      code: 'ONLINE_PAYMENT_OFF',
      detail: 'terms',
    });
    expect(ok<Record<string, unknown>>(r, 'switched_on')).toMatchObject({
      coaching_enabled: true,
      coach_max_open_private: 12,
      lesson_prices_public: true,
      lesson_payment_mode: 'desk',
    });
    expect(ok(r, 'audit')).toBe(1);
    expect(ok<Record<string, unknown>>(r, 'online_ok')).toMatchObject({
      lesson_payment_mode: 'online_required',
      online_payments_available: true,
      lesson_terms_ready: true,
    });
    expect(ok(r, 'terms')).toEqual([false, false, true, true]);
    expect(tripped(r, 'bad_terms_version')).toBe('platform_settings_lesson_terms');
    expect(tripped(r, 'bad_mode_row')).toBe('venue_settings_coaching_rules');
  });

  it('0297 (DB-45, D1): no readable column looks like a coach share, and no readable table pairs a coach with money, coach_prices.price_iqd aside', () => {
    // The gate behind C-28: 0278's readable-columns insert is ON CONFLICT DO
    // NOTHING, so a later catch-up insert could bring the money columns back.
    // A coach identifier is a column like coach_id (R42's underscore-optional
    // pattern) or the coaches table itself; money is a column ending _iqd or
    // _bp. coach_prices.price_iqd is the catalogue price a guest is quoted,
    // kept readable by D1.
    const r = scenario('c297-a', [
      Q(
        'share',
        `select to_jsonb(coalesce(array_agg(table_name || '.' || column_name order by table_name, column_name), '{}'))
                    from app.assistant_readable_columns
                   where column_name ~* 'share_bp' or column_name ~* 'coach_?(share|iqd)'`,
      ),
      Q(
        'paired',
        `select to_jsonb(coalesce(array_agg(m.table_name || '.' || m.column_name order by m.table_name, m.column_name), '{}'))
                    from app.assistant_readable_columns m
                   where (m.column_name ~* '_iqd$' or m.column_name ~* '_bp$')
                     and (m.table_name = 'coaches'
                          or exists (select 1 from app.assistant_readable_columns c
                                      where c.table_name = m.table_name and c.column_name ~* 'coach_?id'))
                     and (m.table_name, m.column_name) <> ('coach_prices', 'price_iqd')`,
      ),
      Q(
        'kept',
        `select jsonb_object_agg(table_name, cols) from (
                     select table_name, jsonb_agg(column_name order by column_name) as cols
                       from app.assistant_readable_columns
                      where (table_name in ('lessons', 'courses') and column_name in ('coach_id', 'price_iqd',
                               'court_share_iqd', 'coach_share_bp'))
                         or (table_name = 'coach_prices' and column_name in ('coach_id', 'price_iqd'))
                         or (table_name = 'venue_settings' and column_name in ('coach_share_bp', 'coaching_enabled'))
                      group by table_name) x`,
      ),
    ]);
    expect(ok(r, 'share')).toEqual([]);
    expect(ok(r, 'paired')).toEqual([]);
    expect(ok(r, 'kept')).toEqual({
      coach_prices: ['coach_id', 'price_iqd'],
      courses: ['coach_id'],
      lessons: ['coach_id'],
      venue_settings: ['coaching_enabled'],
    });
  });

  it('0297 (DB-46): venue_settings is granted column by column; no client reads coach_share_bp or coach_max_open_private', () => {
    const r = scenario('c297-b', [
      SETUP,
      MK('barista', 'barista'),
      Q(
        'privileges',
        `select jsonb_build_object(
                    'table', has_table_privilege('authenticated', 'public.venue_settings', 'SELECT'),
                    'share', has_column_privilege('authenticated', 'public.venue_settings', 'coach_share_bp', 'SELECT'),
                    'cap', has_column_privilege('authenticated', 'public.venue_settings', 'coach_max_open_private', 'SELECT'),
                    'anon', has_any_column_privilege('anon', 'public.venue_settings', 'SELECT'))`,
      ),
      Q(
        'ungranted',
        `select to_jsonb(coalesce(array_agg(column_name::text order by ordinal_position), '{}'))
                       from information_schema.columns
                      where table_schema = 'public' and table_name = 'venue_settings'
                        and not has_column_privilege('authenticated', 'public.venue_settings', column_name::text, 'SELECT')`,
      ),
      T(
        'barista_share',
        'barista',
        `select to_jsonb(coach_share_bp) from venue_settings where venue_id = {{venue}}`,
      ),
      T(
        'barista_cap',
        'barista',
        `select to_jsonb(coach_max_open_private) from venue_settings where venue_id = {{venue}}`,
      ),
      T(
        'manager_share',
        'manager',
        `select to_jsonb(coach_share_bp) from venue_settings where venue_id = {{venue}}`,
      ),
      T('owner_star', 'owner', `select to_jsonb(count(*)) from (select * from venue_settings) x`),
      T(
        'barista_named',
        'barista',
        `select to_jsonb(timezone) from venue_settings where venue_id = {{venue}}`,
      ),
      T('owner_rules', 'owner', `select app.coaching_settings({{venue}})`),
    ]);
    expect(ok(r, 'privileges')).toEqual({ table: false, share: false, cap: false, anon: false });
    expect(ok(r, 'ungranted')).toEqual(['coach_share_bp', 'coach_max_open_private']);
    for (const label of ['barista_share', 'barista_cap', 'manager_share', 'owner_star'])
      expect(refused(r, label), label).toMatch(/permission denied for table venue_settings/);
    expect(typeof ok<string>(r, 'barista_named')).toBe('string');
    expect(ok<Record<string, unknown>>(r, 'owner_rules')).toMatchObject({
      coach_share_bp: 6000,
      coach_max_open_private: 10,
    });
  });
});

describe.skipIf(!docker)('the coach mutex (R6)', () => {
  it('app.lock_coach holds the coach key until commit; app.try_lock_coach never waits, and only that coach is busy', async () => {
    const coach = '00000000-0000-4000-8000-00000000c0a1';
    const other = '00000000-0000-4000-8000-00000000c0a2';
    const holder = psqlSession(
      `set application_name = 'c2a-lock'; begin; select app.lock_coach('${coach}'); select pg_sleep(4); commit;`,
    );
    try {
      await waitForSleeper('c2a-lock');
      const out = psql(`begin;
        select app.try_lock_coach('${coach}')::text || ',' || app.try_lock_coach('${other}')::text
               || ',' || app.try_lock_coach(null)::text;
        rollback;`);
      expect(out.split('\n').filter(Boolean).pop()).toBe('false,true,false');
    } finally {
      await holder;
    }
    // Free again once the holder committed.
    expect(
      psql(`begin; select app.try_lock_coach('${coach}'); rollback;`)
        .split('\n')
        .filter(Boolean)
        .pop(),
    ).toBe('t');
  });
});

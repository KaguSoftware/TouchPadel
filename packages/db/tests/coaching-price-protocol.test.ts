/**
 * Coaching lesson prices through the owner's price or promotion change (build contracts C-5, C-17,
 * §1.8, R14, R46; db.md §4.6.4, §4.8; operator.md §5.13.2, §5.14). Migration price_promo_lessons
 * (0285), with the 0282 writers it calls (upsert_lesson_type, set_coach_price,
 * set_coach_lesson_types and their internals).
 *
 *   * the price lock, as the manager and as the owner: a launched type's price or court share is
 *     PRICE_VIA_PROTOCOL detail price; its length, sessions or a private type's party size detail
 *     shape (R46); putting a draft on sale LAUNCH_VIA_PROTOCOL; a draft's every field, a launched
 *     type's names, group places and its switch stay direct; a coach price is the owner's even on
 *     a draft (D-8); the owner passes every lock;
 *   * lesson_price: the proposal's before snapshot (figures and shape, a client copy replaced),
 *     numbers limited to the figures the proposal carries, the owner's approval, the apply that
 *     changes the price (protocol.price.apply, counts lesson_types), booked lessons keeping their
 *     snapshots, and the numbers read (places and money over 30 days, X28);
 *   * lesson_launch: a draft goes on sale at the approved figures; a draft whose length, sessions,
 *     party size or figures change between the owner's approval and the apply is
 *     PRICE_TARGET_CHANGED hint lesson_type, now or at the cron, which reverts the run (never a raw
 *     23514); a launched type switched off and on in between still applies (R46);
 *   * coach_price: set, change on a draft type, remove (null), the numbers per coach; a coach not
 *     teaching the type or retired, a no-op, a course price under one dinar a session refused at
 *     the proposal; unlinking the coach from the type deletes the coach price and makes a pending
 *     coach_price run PRICE_TARGET_CHANGED hint coach_price;
 *   * marketing: NOT_STEP_ACTOR hint change on all three kinds, FORBIDDEN targets and figures;
 *   * the targets' shapes (X28) and no cost or sales key in them;
 *   * the proposal's refusals: RECORD_INVALID with the field as hint, never a writer's code; a
 *     resubmission keeps its lesson type.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (stores-harness.ts, the
 * price-promo.test.ts flow): coaches, lesson types and past lessons are planted as postgres, each
 * call runs as `authenticated` with the caller's claims, the cron as the database owner. Without
 * docker on PATH the suite skips itself.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import {
  dockerReachable,
  KEEP,
  MK,
  Q,
  RES,
  scenario,
  T,
  X,
  ok,
  type Results,
} from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

// ── planting (as postgres, claims cleared) ─────────────────────────────────
const SETUP = String.raw`
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

-- A launched private type at venue A, 60 minutes, a party of up to 2, 25,000 with a 5,000 court share.
create function pg_temp.lt(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lesson_types', jsonb_build_object('venue_id', pg_temp.var('venue'), 'kind', 'private',
           'name_en', 'CPP Private', 'name_ar', 'حصة خاصة', 'duration_min', 60, 'price_iqd', 25000,
           'court_share_iqd', 5000, 'max_places', 2, 'launched_at', now() - interval '60 days',
           'is_active', true) || p)
$f$;

-- A past private lesson of coach c1 on type lt, three days ago.
create function pg_temp.lesson(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lessons', jsonb_build_object('venue_id', pg_temp.var('venue'), 'coach_id', pg_temp.var('c1'),
           'lesson_type_id', pg_temp.var('lt'), 'kind', 'private', 'start_at', now() - interval '3 days',
           'end_at', now() - interval '3 days' + interval '1 hour', 'price_iqd', 25000,
           'court_share_iqd', 5000, 'coach_share_bp', 6000, 'max_places', 2, 'min_places', 1,
           'booked_by_kind', 'staff', 'created_by_staff_id', pg_temp.var('desk')) || p)
$f$;

-- A desk-booked walk-in on a lesson, 25,000 at the desk.
create function pg_temp.en(p jsonb) returns text language sql as $f$
  select pg_temp.ins('lesson_enrolments', jsonb_build_object('venue_id', pg_temp.var('venue'),
           'guest_name', 'CPP Walk-in', 'booked_by_kind', 'staff', 'booked_by_staff_id', pg_temp.var('desk'),
           'price_iqd', 25000, 'payment_mode', 'desk') || p)
$f$;
`;

const GUEST = (name: string) =>
  KEEP(
    name,
    `insert into auth.users (id, email, raw_user_meta_data, aud, role)
              values (gen_random_uuid(), 'cpp-${name}-' || gen_random_uuid() || '@test.touch.local',
                      '{"full_name":"Test ${name}"}', 'authenticated', 'authenticated') returning id::text`,
  );
/** A coach on a new guest profile, teaching at venue A; `extra` is a jsonb SQL expression. */
const COACH = (name: string, extra = `'{}'::jsonb`) => [
  GUEST(`${name}_g`),
  KEEP(
    name,
    `select pg_temp.ins('coaches', jsonb_build_object('profile_id', {{${name}_g}},
                'display_name_en', 'CPP ${name}', 'display_name_ar', 'مدرّب') || ${extra})`,
  ),
  X(`insert into coach_branches (coach_id, venue_id) values ({{${name}}}, {{venue}})`),
];
const RETIRED = `jsonb_build_object('status', 'retired', 'retired_at', now())`;
const TEACH = (coach: string, type: string, venue = 'venue') =>
  X(
    `insert into coach_lesson_types (coach_id, lesson_type_id, venue_id) values ({{${coach}}}, {{${type}}}, {{${venue}}})`,
  );
/** A lesson type: the launched private default, changed by a JSON literal. */
const LT = (name: string, json = '{}') => KEEP(name, `select pg_temp.lt('${json}')`);
const DRAFT = `"launched_at":null,"is_active":false`;
const GROUP = `"kind":"group","max_places":8,"min_places":3,"cutoff_hours":2,"price_iqd":10000`;
const COURSE = `"kind":"course","max_places":8,"min_places":3,"cutoff_hours":2,"price_iqd":80000,"sessions_count":4`;

// ── the 0282 writers ───────────────────────────────────────────────────────
const UPSERT = (label: string, who: string, type: string, patch: string) =>
  T(
    label,
    who,
    `select app.upsert_lesson_type({{venue}}::uuid, {{${type}}}::uuid, '${patch}'::jsonb)`,
  );
const COACH_PRICE = (
  label: string,
  who: string,
  coach: string,
  type: string,
  price: number | null,
) =>
  T(
    label,
    who,
    `select app.set_coach_price({{${coach}}}::uuid, {{${type}}}::uuid, ${price ?? 'null'}::bigint)`,
  );

// ── one run: start, numbers by the manager, the owner's OK, announce skipped, apply ──
const REASON = `'reason', 'Costs moved', 'expected_effect', 'Same margin'`;
const START = (label: string, who: string, record: string) =>
  T(
    label,
    who,
    `select app.start_protocol(p_kind => 'price_promo', p_title_en => 'CPP ${label}',
                   p_title_ar => ${who === 'owner' ? `'تغيير ${label}'` : 'null'},
                   p_first_record => ${record}, p_venue_id => {{venue}}::uuid)`,
  );
const STEPK = (name: string, run: string, key: string) =>
  KEEP(
    name,
    `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`,
  );
/** The live (undecided, not withdrawn or set aside) submission of a step. */
const LIVE_SUB = (name: string, step: string) =>
  KEEP(
    name,
    `select id::text from protocol_submissions where run_step_id = {{${step}}}
                 and decision is null and withdrawn_at is null and superseded_at is null`,
  );
/** Start a run and keep its id and step ids as <run>, <run>_prop, _num, _ann, _app. */
const RUN = (run: string, who: string, record: string) => [
  START(`${run}_start`, who, record),
  RES(run, `${run}_start`, 'run_id'),
  STEPK(`${run}_prop`, run, 'propose'),
  STEPK(`${run}_num`, run, 'numbers'),
  STEPK(`${run}_ann`, run, 'announce'),
  STEPK(`${run}_app`, run, 'apply'),
];
const NUMBERS = (run: string, record = `'{"recommendation":"go"}'`) => [
  T(`${run}_numbers`, 'manager', `select app.submit_step({{${run}_num}}, ${record})`),
  LIVE_SUB(`${run}_sub_num`, `${run}_num`),
  T(`${run}_num_ok`, 'owner', `select app.decide_step({{${run}_sub_num}}, 'approve')`),
  T(`${run}_skip`, 'manager', `select app.skip_step({{${run}_ann}}, 'No announcement')`),
];
const APPLY_NOW = (run: string) =>
  T(`${run}_apply`, 'manager', `select app.submit_step({{${run}_app}}, '{"when":"now"}')`);
const APPLY_DATE = (run: string) =>
  T(
    `${run}_apply`,
    'manager',
    `select app.submit_step({{${run}_app}}, jsonb_build_object('when', 'date', 'at', now() + interval '1 day'))`,
  );
/** The date has come: the run is due for the cron. */
const DUE = (run: string) =>
  X(`update protocol_runs set scheduled_for = now() - interval '1 minute' where id = {{${run}}}`);
const RUN_STATUS = (label: string, run: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'finished', finished_at is not null) from protocol_runs where id = {{${run}}}`,
  );
/** The proposal's stored (normalised) record. */
const RECORD = (label: string, run: string) =>
  Q(
    label,
    `select x.record from protocol_submissions x where x.run_step_id = {{${run}_prop}}
             order by x.round desc, x.submitted_at desc limit 1`,
  );
const AUDIT = (label: string, run: string, action = 'protocol.price.apply') =>
  Q(
    label,
    `select coalesce(jsonb_agg(after order by at), '[]') from audit_log
             where action = '${action}' and entity_id = {{${run}}}::text`,
  );
const TYPE_ROW = (label: string, type: string) =>
  Q(
    label,
    `select jsonb_build_object('price', price_iqd, 'share', court_share_iqd, 'duration', duration_min,
                                       'sessions', sessions_count, 'places', max_places, 'active', is_active,
                                       'launched', launched_at is not null)
              from lesson_types where id = {{${type}}}`,
  );
const COACH_PRICE_ROW = (label: string, coach: string, type: string) =>
  Q(
    label,
    `select coalesce((select jsonb_build_object('price', price_iqd, 'run', protocol_run_id)
                               from coach_prices where coach_id = {{${coach}}} and lesson_type_id = {{${type}}}),
                            'null'::jsonb)`,
  );
const VARS = Q('vars', `select jsonb_object_agg(name, val) from pg_temp.vars`);

// ── reading results ────────────────────────────────────────────────────────
/** A refusal as CODE, or CODE:detail (the coaching writers), or CODE:hint (the protocol hooks). */
function why(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  const extra = o!.detail ?? o!.hint;
  return extra ? `${o!.code}:${extra}` : o!.code!;
}
const v = (r: Results, name: string): string => ok<Record<string, string>>(r, 'vars')[name]!;

/** Keys that would carry a cost or a sales figure, at any depth (price-promo.test.ts). */
function salesKeys(val: unknown, path = ''): string[] {
  if (Array.isArray(val)) return val.flatMap((x, i) => salesKeys(x, `${path}[${i}]`));
  if (val && typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/^(cost|revenue|margin|units|count|redemption|sold)|_30d$/i.test(k)
        ? [`${path}.${k}`]
        : []),
      ...salesKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

/** X28 (DB's shapes; the operator and the staff phone parse them). */
const X28 = {
  lessonTypes: [
    'lesson_type_id',
    'kind',
    'name_en',
    'name_ar',
    'duration_min',
    'sessions_count',
    'max_places',
    'price_iqd',
    'court_share_iqd',
    'is_active',
  ],
  coaches: ['coach_id', 'display_name_en', 'display_name_ar', 'lesson_types'],
  coachTypes: [
    'lesson_type_id',
    'name_en',
    'name_ar',
    'kind',
    'sessions_count',
    'type_price_iqd',
    'coach_price_iqd',
  ],
  numbers: [
    'lesson_type_id',
    'coach_id',
    'kind',
    'name_en',
    'name_ar',
    'current_price_iqd',
    'new_price_iqd',
    'current_court_share_iqd',
    'new_court_share_iqd',
    'places_30d',
    'owed_30d_iqd',
  ],
};

type Lesson = Record<(typeof X28.numbers)[number], unknown>;

describe.skipIf(!docker)(
  'coaching lesson prices through the price or promotion change (0285)',
  () => {
    it('locks a launched type and every coach price for a manager; drafts stay direct; the owner passes', () => {
      const r = scenario('cpp-a', [
        SETUP,
        LT('lt'),
        LT('lt_group', `{${GROUP},"name_en":"CPP Group"}`),
        LT('lt_course', `{${COURSE},"name_en":"CPP Course"}`),
        LT('d', `{"name_en":"CPP Draft","price_iqd":null,${DRAFT}}`),
        ...COACH('c1'),
        TEACH('c1', 'lt'),
        TEACH('c1', 'd'),

        // A manager on a launched type: price and court share, then the shape (R46).
        UPSERT('m_price', 'manager', 'lt', '{"price_iqd":30000}'),
        UPSERT('m_share', 'manager', 'lt', '{"court_share_iqd":6000}'),
        UPSERT('m_duration', 'manager', 'lt', '{"duration_min":90}'),
        UPSERT('m_party', 'manager', 'lt', '{"max_places":3}'),
        UPSERT('m_sessions', 'manager', 'lt_course', '{"sessions_count":5}'),
        // ...and what stays the manager's: names, group places, the switch off and back on.
        UPSERT('m_name', 'manager', 'lt', '{"name_en":"CPP Private 60"}'),
        UPSERT('m_group_places', 'manager', 'lt_group', '{"max_places":10}'),
        UPSERT('m_off', 'manager', 'lt', '{"is_active":false}'),
        UPSERT('m_on', 'manager', 'lt', '{"is_active":true}'),
        // A draft is edited directly (C-17), price included; putting it on sale is the protocol's.
        UPSERT(
          'm_draft',
          'manager',
          'd',
          '{"price_iqd":20000,"court_share_iqd":4000,"duration_min":90}',
        ),
        UPSERT('m_launch', 'manager', 'd', '{"is_active":true}'),
        // A coach price is never a manager's direct write, a draft's included (D-8).
        COACH_PRICE('m_coach', 'manager', 'c1', 'lt', 30000),
        COACH_PRICE('m_coach_draft', 'manager', 'c1', 'd', 30000),

        // The owner passes every lock.
        UPSERT('o_price', 'owner', 'lt', '{"price_iqd":30000,"duration_min":90}'),
        UPSERT('o_launch', 'owner', 'd', '{"is_active":true}'),
        COACH_PRICE('o_coach', 'owner', 'c1', 'lt', 32000),
        TYPE_ROW('lt_after', 'lt'),
        TYPE_ROW('d_after', 'd'),
        TYPE_ROW('group_after', 'lt_group'),
        COACH_PRICE_ROW('coach_after', 'c1', 'lt'),
      ]);

      expect(why(r, 'm_price')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(why(r, 'm_share')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(why(r, 'm_duration')).toBe('PRICE_VIA_PROTOCOL:shape');
      expect(why(r, 'm_party')).toBe('PRICE_VIA_PROTOCOL:shape');
      expect(why(r, 'm_sessions')).toBe('PRICE_VIA_PROTOCOL:shape');
      for (const label of ['m_name', 'm_group_places', 'm_off', 'm_on', 'm_draft']) ok(r, label);
      expect(r.m_launch!.ok).toBe(false);
      expect(r.m_launch!.code).toBe('LAUNCH_VIA_PROTOCOL');
      expect(why(r, 'm_coach')).toBe('PRICE_VIA_PROTOCOL:price');
      expect(why(r, 'm_coach_draft')).toBe('PRICE_VIA_PROTOCOL:price');

      for (const label of ['o_price', 'o_launch', 'o_coach']) ok(r, label);
      expect(ok(r, 'lt_after')).toMatchObject({
        price: 30000,
        share: 5000,
        duration: 90,
        places: 2,
        active: true,
      });
      expect(ok(r, 'd_after')).toMatchObject({
        price: 20000,
        share: 4000,
        active: true,
        launched: true,
      });
      expect(ok(r, 'group_after')).toMatchObject({ places: 10 });
      // The owner's direct write carries no run.
      expect(ok(r, 'coach_after')).toEqual({ price: 32000, run: null });
    });

    it('lesson_price: the snapshot, the figures, the owner’s approval and the apply', () => {
      const r = scenario('cpp-b', [
        SETUP,
        MK('mkt', 'marketing'),
        LT('lt'),
        ...COACH('c1'),
        ...COACH('c2'),
        TEACH('c1', 'lt'),
        TEACH('c2', 'lt'),
        // Sold in the last 30 days: one by each coach; one cancelled and one older do not count.
        KEEP('l1', `select pg_temp.lesson()`),
        KEEP('e1', `select pg_temp.en(jsonb_build_object('lesson_id', {{l1}}))`),
        KEEP(
          'l2',
          `select pg_temp.lesson(jsonb_build_object('coach_id', {{c2}}, 'start_at', now() - interval '10 days',
                                                           'end_at', now() - interval '10 days' + interval '1 hour'))`,
        ),
        KEEP('e2', `select pg_temp.en(jsonb_build_object('lesson_id', {{l2}}))`),
        KEEP(
          'l3',
          `select pg_temp.lesson(jsonb_build_object('start_at', now() - interval '40 days',
                                                           'end_at', now() - interval '40 days' + interval '1 hour'))`,
        ),
        KEEP('e3', `select pg_temp.en(jsonb_build_object('lesson_id', {{l3}}))`),
        KEEP(
          'l4',
          `select pg_temp.lesson(jsonb_build_object('start_at', now() - interval '5 days',
                                                           'end_at', now() - interval '5 days' + interval '1 hour'))`,
        ),
        KEEP(
          'e4',
          `select pg_temp.en(jsonb_build_object('lesson_id', {{l4}}, 'status', 'cancelled',
                                                       'cancelled_at', now(), 'cancel_kind', 'staff'))`,
        ),

        // A client copy of before is replaced by the type as it stands.
        ...RUN(
          'a',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lt}},
                                'price_iqd', 30000, 'before', jsonb_build_object('price_iqd', 1))`,
        ),
        RECORD('a_record', 'a'),
        // numbers: only the figures the proposal carries, within its bounds.
        T(
          'a_num_share',
          'manager',
          `select app.submit_step({{a_num}}, '{"recommendation":"go","court_share_iqd":6000}')`,
        ),
        T(
          'a_num_zero',
          'manager',
          `select app.submit_step({{a_num}}, '{"recommendation":"go","price_iqd":0}')`,
        ),
        T(
          'a_num_sizes',
          'manager',
          `select app.submit_step({{a_num}}, '{"recommendation":"go","prices":[]}')`,
        ),
        ...NUMBERS('a', `'{"recommendation":"go","price_iqd":32000}'`),
        T('a_figures', 'manager', `select app.price_promo_numbers({{a}})`),
        T('mkt_figures', 'mkt', `select app.price_promo_numbers({{a}})`),
        APPLY_NOW('a'),
        RUN_STATUS('a_status', 'a'),
        TYPE_ROW('lt_after', 'lt'),
        Q('l1_after', `select price_iqd from lessons where id = {{l1}}`),
        AUDIT('a_audit', 'a'),

        // The owner may propose too; the propose step passes as theirs.
        ...RUN(
          'o',
          'owner',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lt}},
                              'court_share_iqd', 7000)`,
        ),
        RECORD('o_record', 'o'),

        // R82: a group type's places are not part of its priced product. The shape stores
        // max_places only for a private type, so a direct places change between the owner's OK
        // and the apply leaves the run applicable.
        LT('lg', `{${GROUP},"name_en":"CPP Group"}`),
        ...RUN(
          'g',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lg}}, 'price_iqd', 12000)`,
        ),
        RECORD('g_record', 'g'),
        ...NUMBERS('g'),
        UPSERT('g_places', 'manager', 'lg', '{"max_places":10}'),
        APPLY_NOW('g'),
        RUN_STATUS('g_status', 'g'),
        TYPE_ROW('lg_after', 'lg'),
        VARS,
      ]);

      const record = ok<Record<string, unknown>>(r, 'a_record');
      expect(record).toMatchObject({
        change: 'lesson_price',
        lesson_type_id: v(r, 'lt'),
        price_iqd: 30000,
      });
      expect(record).not.toHaveProperty('court_share_iqd');
      expect(record.before).toEqual({
        price_iqd: 25000,
        court_share_iqd: 5000,
        shape: { kind: 'private', duration_min: 60, sessions_count: null, max_places: 2 },
      });

      expect(why(r, 'a_num_share')).toBe('RECORD_INVALID:court_share_iqd');
      expect(why(r, 'a_num_zero')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'a_num_sizes')).toBe('RECORD_INVALID:prices');
      ok(r, 'a_num_ok');

      const figures = ok<{ change: string; lesson: Lesson; sizes: unknown[] }>(r, 'a_figures');
      expect(figures.change).toBe('lesson_price');
      expect(Object.keys(figures.lesson)).toEqual(expect.arrayContaining(X28.numbers));
      expect(figures.lesson).toMatchObject({
        lesson_type_id: v(r, 'lt'),
        coach_id: null,
        kind: 'private',
        name_en: 'CPP Private',
        name_ar: 'حصة خاصة',
        current_price_iqd: 25000,
        new_price_iqd: 32000,
        current_court_share_iqd: 5000,
        new_court_share_iqd: 5000,
        places_30d: 2,
        owed_30d_iqd: 50000,
      });
      expect(figures.sizes).toEqual([]);
      expect(why(r, 'mkt_figures')).toBe('FORBIDDEN');

      expect(ok(r, 'a_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'a_status')).toEqual({ status: 'done', finished: true });
      expect(ok(r, 'lt_after')).toMatchObject({
        price: 32000,
        share: 5000,
        duration: 60,
        active: true,
        launched: true,
      });
      // A lesson already booked keeps its snapshot.
      expect(ok(r, 'l1_after')).toBe(25000);
      expect(ok<Array<Record<string, unknown>>>(r, 'a_audit')).toEqual([
        expect.objectContaining({
          run_id: v(r, 'a'),
          change: 'lesson_price',
          counts: { lesson_types: 1 },
        }),
      ]);

      expect(ok(r, 'o_start')).toBeTruthy();
      expect(ok<Record<string, unknown>>(r, 'o_record')).toMatchObject({
        change: 'lesson_price',
        court_share_iqd: 7000,
        before: { price_iqd: 32000, court_share_iqd: 5000 },
      });

      // R82: a group type's shape carries no places.
      expect(
        (ok<Record<string, { shape: unknown }>>(r, 'g_record').before as { shape: unknown }).shape,
      ).toEqual({
        kind: 'group',
        duration_min: 60,
        sessions_count: null,
        max_places: null,
      });
      ok(r, 'g_places');
      expect(ok(r, 'g_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'g_status')).toEqual({ status: 'done', finished: true });
      expect(ok(r, 'lg_after')).toMatchObject({ price: 12000, places: 10 });
    });

    it('lesson_launch: a draft goes on sale; a draft changed after the approval is PRICE_TARGET_CHANGED', () => {
      const launch = (type: string, price: number, share: number) =>
        `jsonb_build_object('change', 'lesson_launch', ${REASON}, 'lesson_type_id', {{${type}}},
                          'price_iqd', ${price}, 'court_share_iqd', ${share})`;
      const r = scenario('cpp-c', [
        SETUP,
        LT('d1', `{"name_en":"CPP Draft 1","price_iqd":18000,"court_share_iqd":3000,${DRAFT}}`),
        LT('d2', `{"name_en":"CPP Draft 2","price_iqd":null,${DRAFT}}`),
        LT('d3', `{${COURSE},"name_en":"CPP Draft course","price_iqd":null,${DRAFT}}`),
        LT('d4', `{"name_en":"CPP Draft 4","price_iqd":18000,${DRAFT}}`),
        LT('lt', `{"name_en":"CPP Launched"}`),
        LT('lt2', `{"name_en":"CPP Launched 2"}`),
        LT('lt3', `{"name_en":"CPP Launched 3"}`),

        // Put on sale at the approved figures: the internal stamps launched_at.
        ...RUN('l', 'manager', launch('d1', 20000, 4000)),
        RECORD('l_record', 'l'),
        ...NUMBERS('l'),
        APPLY_NOW('l'),
        TYPE_ROW('d1_after', 'd1'),
        AUDIT('l_audit', 'l'),

        // The draft's length changes after the owner's OK: stale, still a draft.
        ...RUN('m', 'manager', launch('d2', 20000, 4000)),
        ...NUMBERS('m'),
        UPSERT('m_edit', 'manager', 'd2', '{"duration_min":120}'),
        APPLY_NOW('m'),
        TYPE_ROW('d2_after', 'd2'),

        // A dated launch whose course sessions change before the date: the cron reverts the run.
        ...RUN('n', 'manager', launch('d3', 80000, 5000)),
        ...NUMBERS('n'),
        APPLY_DATE('n'),
        UPSERT('n_edit', 'manager', 'd3', '{"sessions_count":8}'),
        DUE('n'),
        KEEP('due', `select app.price_promo_apply_due()::text`),
        RUN_STATUS('n_status', 'n'),
        AUDIT('n_unschedule', 'n', 'protocol.unschedule'),
        TYPE_ROW('d3_after', 'd3'),

        // The draft's own figures change after the OK: stale too.
        ...RUN('o', 'manager', launch('d4', 20000, 4000)),
        ...NUMBERS('o'),
        UPSERT('o_edit', 'manager', 'd4', '{"price_iqd":19000}'),
        APPLY_NOW('o'),

        // lesson_price: the owner changes the length, or the price, of a launched type in between.
        ...RUN(
          'p',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lt}},
                                'court_share_iqd', 6000)`,
        ),
        ...NUMBERS('p'),
        UPSERT('p_edit', 'owner', 'lt', '{"duration_min":90}'),
        APPLY_NOW('p'),
        ...RUN(
          'q',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lt2}},
                                'price_iqd', 30000)`,
        ),
        ...NUMBERS('q'),
        UPSERT('q_edit', 'owner', 'lt2', '{"price_iqd":27000}'),
        APPLY_NOW('q'),
        // A manager switching a launched type off and on in between is no change of price (R46).
        ...RUN(
          's',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{lt3}},
                                'price_iqd', 30000)`,
        ),
        ...NUMBERS('s'),
        UPSERT('s_off', 'manager', 'lt3', '{"is_active":false}'),
        UPSERT('s_on', 'manager', 'lt3', '{"is_active":true}'),
        APPLY_NOW('s'),
        TYPE_ROW('lt3_after', 'lt3'),
        VARS,
      ]);

      expect(ok<Record<string, unknown>>(r, 'l_record')).toMatchObject({
        change: 'lesson_launch',
        price_iqd: 20000,
        court_share_iqd: 4000,
        before: {
          price_iqd: 18000,
          court_share_iqd: 3000,
          shape: { kind: 'private', duration_min: 60, sessions_count: null, max_places: 2 },
        },
      });
      expect(ok(r, 'l_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'd1_after')).toMatchObject({
        price: 20000,
        share: 4000,
        active: true,
        launched: true,
      });
      expect(ok<Array<Record<string, unknown>>>(r, 'l_audit')).toEqual([
        expect.objectContaining({
          change: 'lesson_launch',
          counts: { lesson_types: 1, launched: 1 },
        }),
      ]);

      ok(r, 'm_edit');
      expect(why(r, 'm_apply')).toBe('PRICE_TARGET_CHANGED:lesson_type');
      expect(ok(r, 'd2_after')).toMatchObject({
        price: null,
        duration: 120,
        active: false,
        launched: false,
      });

      ok(r, 'n_apply');
      ok(r, 'n_edit');
      expect(JSON.parse(v(r, 'due')).reverted).toBeGreaterThanOrEqual(1);
      expect(ok(r, 'n_status')).toEqual({ status: 'active', finished: false });
      expect(ok<Array<Record<string, unknown>>>(r, 'n_unschedule')).toEqual([
        expect.objectContaining({
          status: 'active',
          not_applied: 'PRICE_TARGET_CHANGED',
          hint: 'lesson_type',
        }),
      ]);
      expect(ok(r, 'd3_after')).toMatchObject({
        price: null,
        sessions: 8,
        active: false,
        launched: false,
      });

      ok(r, 'o_edit');
      expect(why(r, 'o_apply')).toBe('PRICE_TARGET_CHANGED:lesson_type');
      ok(r, 'p_edit');
      expect(why(r, 'p_apply')).toBe('PRICE_TARGET_CHANGED:lesson_type');
      ok(r, 'q_edit');
      expect(why(r, 'q_apply')).toBe('PRICE_TARGET_CHANGED:lesson_type');

      ok(r, 's_off');
      ok(r, 's_on');
      expect(ok(r, 's_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'lt3_after')).toMatchObject({ price: 30000, active: true });
    });

    it('coach_price: set, priced on a draft, removed; unlinking deletes it and stales a pending run', () => {
      const coachPrice = (coach: string, type: string, price: number | null) =>
        `jsonb_build_object('change', 'coach_price', ${REASON}, 'coach_id', {{${coach}}}, 'lesson_type_id', {{${type}}},
                          'price_iqd', ${price ?? 'null'}::bigint)`;
      const r = scenario('cpp-d', [
        SETUP,
        LT('lt'),
        LT('lt_course', `{${COURSE},"name_en":"CPP Course"}`),
        LT('d', `{"name_en":"CPP Draft","price_iqd":null,${DRAFT}}`),
        KEEP(
          'lt_x',
          `select pg_temp.lt(jsonb_build_object('venue_id', {{other_venue}}, 'name_en', 'CPP Elsewhere'))`,
        ),
        ...COACH('c1'),
        ...COACH('c2'),
        ...COACH('c3'),
        ...COACH('c_ret', RETIRED),
        TEACH('c1', 'lt'),
        TEACH('c1', 'd'),
        TEACH('c1', 'lt_course'),
        TEACH('c3', 'lt'),
        TEACH('c_ret', 'lt'),
        // c3 has the owner's own price for lt.
        X(
          `insert into coach_prices (coach_id, lesson_type_id, venue_id, price_iqd) values ({{c3}}, {{lt}}, {{venue}}, 28000)`,
        ),
        KEEP('l1', `select pg_temp.lesson()`),
        KEEP('e1', `select pg_temp.en(jsonb_build_object('lesson_id', {{l1}}))`),

        // Set: c1's own price for lt, at the figure the numbers settle.
        ...RUN('a', 'manager', coachPrice('c1', 'lt', 35000)),
        RECORD('a_record', 'a'),
        ...NUMBERS('a', `'{"recommendation":"go","price_iqd":36000}'`),
        T('a_figures', 'manager', `select app.price_promo_numbers({{a}})`),
        APPLY_NOW('a'),
        COACH_PRICE_ROW('a_after', 'c1', 'lt'),
        AUDIT('a_audit', 'a'),
        // A draft type takes a coach price through the protocol (D-8).
        ...RUN('b', 'manager', coachPrice('c1', 'd', 22000)),
        ...NUMBERS('b'),
        APPLY_NOW('b'),
        COACH_PRICE_ROW('b_after', 'c1', 'd'),
        // Remove: c3 goes back to the type's price; the numbers carry no figure.
        ...RUN('c', 'manager', coachPrice('c3', 'lt', null)),
        RECORD('c_record', 'c'),
        T(
          'c_num_price',
          'manager',
          `select app.submit_step({{c_num}}, '{"recommendation":"go","price_iqd":30000}')`,
        ),
        ...NUMBERS('c'),
        T('c_figures', 'manager', `select app.price_promo_numbers({{c}})`),
        APPLY_NOW('c'),
        COACH_PRICE_ROW('c_after', 'c3', 'lt'),

        // Refused at the proposal.
        START('p_not_teaching', 'manager', coachPrice('c2', 'lt', 30000)),
        START('p_retired', 'manager', coachPrice('c_ret', 'lt', 30000)),
        START('p_same', 'manager', coachPrice('c1', 'lt', 36000)),
        START('p_remove_none', 'manager', coachPrice('c3', 'lt', null)),
        START('p_course_cheap', 'manager', coachPrice('c1', 'lt_course', 3)),
        START('p_elsewhere', 'manager', coachPrice('c1', 'lt_x', 30000)),
        START(
          'p_share',
          'manager',
          `jsonb_build_object('change', 'coach_price', ${REASON}, 'coach_id', {{c1}},
                                    'lesson_type_id', {{lt}}, 'price_iqd', 37000, 'court_share_iqd', 1000)`,
        ),

        // The type's shape changes after the OK of a coach price on a draft.
        ...RUN('t', 'manager', coachPrice('c1', 'd', 23000)),
        ...NUMBERS('t'),
        UPSERT('t_edit', 'manager', 'd', '{"duration_min":90}'),
        APPLY_NOW('t'),

        // Unlinking c1 from lt deletes its price for lt, and a pending run for it goes stale.
        ...RUN('s', 'manager', coachPrice('c1', 'lt', 40000)),
        ...NUMBERS('s'),
        T(
          'unlink',
          'manager',
          `select app.set_coach_lesson_types({{c1}}::uuid, {{venue}}::uuid,
                                                                array[{{d}}, {{lt_course}}]::uuid[])`,
        ),
        COACH_PRICE_ROW('s_unlinked', 'c1', 'lt'),
        COACH_PRICE_ROW('s_kept', 'c1', 'd'),
        APPLY_NOW('s'),
        VARS,
      ]);

      expect(ok<Record<string, unknown>>(r, 'a_record')).toMatchObject({
        change: 'coach_price',
        coach_id: v(r, 'c1'),
        lesson_type_id: v(r, 'lt'),
        price_iqd: 35000,
        before: {
          price_iqd: null,
          shape: { kind: 'private', duration_min: 60, sessions_count: null, max_places: 2 },
        },
      });
      expect(ok<{ lesson: Lesson }>(r, 'a_figures').lesson).toMatchObject({
        coach_id: v(r, 'c1'),
        current_price_iqd: 25000, // no own price yet: the type's
        new_price_iqd: 36000,
        current_court_share_iqd: 5000,
        new_court_share_iqd: 5000,
        places_30d: 1, // c1's lesson only
        owed_30d_iqd: 25000,
      });
      expect(ok(r, 'a_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'a_after')).toEqual({ price: 36000, run: v(r, 'a') });
      expect(ok<Array<Record<string, unknown>>>(r, 'a_audit')).toEqual([
        expect.objectContaining({ change: 'coach_price', counts: { coach_prices: 1 } }),
      ]);
      expect(ok(r, 'b_after')).toEqual({ price: 22000, run: v(r, 'b') });

      expect(ok<Record<string, unknown>>(r, 'c_record')).toMatchObject({
        price_iqd: null,
        before: { price_iqd: 28000 },
      });
      expect(why(r, 'c_num_price')).toBe('RECORD_INVALID:price_iqd');
      expect(ok<{ lesson: Lesson }>(r, 'c_figures').lesson).toMatchObject({
        current_price_iqd: 28000,
        new_price_iqd: 25000, // removed: the type's price applies again
      });
      expect(ok(r, 'c_apply')).toMatchObject({ run_status: 'done' });
      expect(ok(r, 'c_after')).toBeNull();

      expect(why(r, 'p_not_teaching')).toBe('RECORD_INVALID:coach_id');
      expect(why(r, 'p_retired')).toBe('RECORD_INVALID:coach_id');
      expect(why(r, 'p_same')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_remove_none')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_course_cheap')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_elsewhere')).toBe('RECORD_INVALID:lesson_type_id');
      expect(why(r, 'p_share')).toBe('RECORD_INVALID:court_share_iqd');

      ok(r, 't_edit');
      expect(why(r, 't_apply')).toBe('PRICE_TARGET_CHANGED:lesson_type');

      ok(r, 'unlink');
      expect(ok(r, 's_unlinked')).toBeNull();
      expect(ok(r, 's_kept')).toEqual({ price: 22000, run: v(r, 'b') });
      expect(why(r, 's_apply')).toBe('PRICE_TARGET_CHANGED:coach_price');
    });

    it('marketing never proposes or reads a lesson price; the targets carry X28’s keys and no sales', () => {
      const kinds = ['lesson_price', 'lesson_launch', 'coach_price'] as const;
      const r = scenario('cpp-e', [
        SETUP,
        MK('mkt', 'marketing'),
        LT('lt'),
        LT('lt_off', `{"name_en":"CPP Off","is_active":false}`),
        LT('lt_course', `{${COURSE},"name_en":"CPP Course"}`),
        LT('d', `{"name_en":"CPP Draft","price_iqd":12000,${DRAFT}}`),
        ...COACH('c1'),
        ...COACH('c_ret', RETIRED),
        TEACH('c1', 'lt'),
        TEACH('c1', 'd'),
        TEACH('c_ret', 'lt'),
        X(
          `insert into coach_prices (coach_id, lesson_type_id, venue_id, price_iqd) values ({{c1}}, {{lt}}, {{venue}}, 30000)`,
        ),

        START(
          'mkt_lesson_price',
          'mkt',
          `jsonb_build_object('change', 'lesson_price', ${REASON},
                                          'lesson_type_id', {{lt}}, 'price_iqd', 30000)`,
        ),
        START(
          'mkt_lesson_launch',
          'mkt',
          `jsonb_build_object('change', 'lesson_launch', ${REASON},
                                           'lesson_type_id', {{d}}, 'price_iqd', 12000, 'court_share_iqd', 0)`,
        ),
        START(
          'mkt_coach_price',
          'mkt',
          `jsonb_build_object('change', 'coach_price', ${REASON},
                                         'coach_id', {{c1}}, 'lesson_type_id', {{lt}}, 'price_iqd', 31000)`,
        ),
        ...kinds.map((k) =>
          T(`mkt_targets_${k}`, 'mkt', `select app.price_promo_targets('${k}', {{venue}}::uuid)`),
        ),
        ...kinds.map((k) =>
          T(
            `mgr_targets_${k}`,
            'manager',
            `select app.price_promo_targets('${k}', {{venue}}::uuid)`,
          ),
        ),
        T(
          'own_targets_lesson_price',
          'owner',
          `select app.price_promo_targets('lesson_price', {{venue}}::uuid)`,
        ),
        VARS,
      ]);

      for (const k of kinds) {
        expect(why(r, `mkt_${k}`), k).toBe('NOT_STEP_ACTOR:change');
        expect(why(r, `mkt_targets_${k}`), k).toBe('FORBIDDEN');
        expect(salesKeys(ok(r, `mgr_targets_${k}`)), k).toEqual([]);
      }

      type TypeRow = Record<string, unknown> & { lesson_type_id: string };
      const priced = ok<{ lesson_types: TypeRow[] }>(r, 'mgr_targets_lesson_price').lesson_types;
      const ids = priced.map((t) => t.lesson_type_id);
      expect(ids).toEqual(expect.arrayContaining([v(r, 'lt'), v(r, 'lt_off'), v(r, 'lt_course')]));
      expect(ids).not.toContain(v(r, 'd'));
      for (const t of priced)
        expect(Object.keys(t)).toEqual(expect.arrayContaining(X28.lessonTypes));
      // Private first, then group, then course.
      expect(priced.map((t) => t.kind)).toEqual(
        [...priced.map((t) => t.kind)].sort(
          (a, b) =>
            ['private', 'group', 'course'].indexOf(String(a)) -
            ['private', 'group', 'course'].indexOf(String(b)),
        ),
      );
      expect(priced.find((t) => t.lesson_type_id === v(r, 'lt_course'))).toMatchObject({
        kind: 'course',
        sessions_count: 4,
        price_iqd: 80000,
        max_places: 8,
      });
      expect(ok(r, 'own_targets_lesson_price')).toEqual(ok(r, 'mgr_targets_lesson_price'));

      const drafts = ok<{ lesson_types: TypeRow[] }>(r, 'mgr_targets_lesson_launch').lesson_types;
      expect(drafts.map((t) => t.lesson_type_id)).toContain(v(r, 'd'));
      expect(drafts.map((t) => t.lesson_type_id)).not.toContain(v(r, 'lt'));
      expect(drafts.find((t) => t.lesson_type_id === v(r, 'd'))).toMatchObject({
        price_iqd: 12000,
        is_active: false,
      });

      type CoachRow = Record<string, unknown> & {
        coach_id: string;
        lesson_types: Array<Record<string, unknown>>;
      };
      const coaches = ok<{ coaches: CoachRow[] }>(r, 'mgr_targets_coach_price').coaches;
      expect(coaches.map((c) => c.coach_id)).toContain(v(r, 'c1'));
      expect(coaches.map((c) => c.coach_id)).not.toContain(v(r, 'c_ret'));
      const c1 = coaches.find((c) => c.coach_id === v(r, 'c1'))!;
      expect(Object.keys(c1)).toEqual(expect.arrayContaining(X28.coaches));
      for (const t of c1.lesson_types)
        expect(Object.keys(t)).toEqual(expect.arrayContaining(X28.coachTypes));
      expect(c1.lesson_types).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lesson_type_id: v(r, 'lt'),
            type_price_iqd: 25000,
            coach_price_iqd: 30000,
          }),
          expect.objectContaining({
            lesson_type_id: v(r, 'd'),
            type_price_iqd: 12000,
            coach_price_iqd: null,
          }),
        ]),
      );
      expect(c1.lesson_types).toHaveLength(2);
    });

    it('refuses a malformed or stale proposal by its field, and a resubmission keeps its lesson type', () => {
      const lessonPrice = (type: string, figures: string) =>
        `jsonb_build_object('change', 'lesson_price', ${REASON}, 'lesson_type_id', {{${type}}}) || ${figures}::jsonb`;
      const r = scenario('cpp-f', [
        SETUP,
        LT('lt'),
        LT('lt2', `{"name_en":"CPP Other"}`),
        LT('lt_course', `{${COURSE},"name_en":"CPP Course"}`),
        LT('d', `{"name_en":"CPP Draft","price_iqd":null,${DRAFT}}`),
        KEEP(
          'lt_x',
          `select pg_temp.lt(jsonb_build_object('venue_id', {{other_venue}}, 'name_en', 'CPP Elsewhere'))`,
        ),

        START('p_draft', 'manager', lessonPrice('d', `'{"price_iqd":20000}'`)),
        START('p_elsewhere', 'manager', lessonPrice('lt_x', `'{"price_iqd":20000}'`)),
        START(
          'p_no_type',
          'manager',
          `jsonb_build_object('change', 'lesson_price', ${REASON}, 'price_iqd', 20000)`,
        ),
        START('p_no_figure', 'manager', lessonPrice('lt', `'{}'`)),
        START('p_same_price', 'manager', lessonPrice('lt', `'{"price_iqd":25000}'`)),
        START('p_same_share', 'manager', lessonPrice('lt', `'{"court_share_iqd":5000}'`)),
        START('p_zero', 'manager', lessonPrice('lt', `'{"price_iqd":0}'`)),
        START('p_huge', 'manager', lessonPrice('lt', `'{"price_iqd":100000001}'`)),
        START('p_negative_share', 'manager', lessonPrice('lt', `'{"court_share_iqd":-1}'`)),
        START('p_text_price', 'manager', lessonPrice('lt', `'{"price_iqd":"30000"}'`)),
        START('p_course_cheap', 'manager', lessonPrice('lt_course', `'{"price_iqd":3}'`)),
        START(
          'p_stray',
          'manager',
          lessonPrice(
            'lt',
            `'{"price_iqd":30000,"menu_item_id":"00000000-0000-4000-8000-000000000001"}'`,
          ),
        ),
        START(
          'p_launch_launched',
          'manager',
          `jsonb_build_object('change', 'lesson_launch', ${REASON},
                                               'lesson_type_id', {{lt}}, 'price_iqd', 20000, 'court_share_iqd', 0)`,
        ),
        START(
          'p_launch_no_share',
          'manager',
          `jsonb_build_object('change', 'lesson_launch', ${REASON},
                                               'lesson_type_id', {{d}}, 'price_iqd', 20000)`,
        ),
        START(
          'p_kind',
          'manager',
          `jsonb_build_object('change', 'lesson', ${REASON}, 'lesson_type_id', {{lt}})`,
        ),
        // The course at one dinar a session is the floor.
        START('p_course_floor', 'manager', lessonPrice('lt_course', `'{"price_iqd":4}'`)),

        // Sent back to the proposal: the new round may change the figures, not the type.
        ...RUN('b', 'manager', lessonPrice('lt', `'{"price_iqd":30000}'`)),
        T('b_numbers', 'manager', `select app.submit_step({{b_num}}, '{"recommendation":"drop"}')`),
        LIVE_SUB('b_sub_num', 'b_num'),
        T(
          'b_back',
          'owner',
          `select app.decide_step({{b_sub_num}}, 'send_back', 'Try the other type', {{b_prop}}::uuid)`,
        ),
        T(
          'b_other_type',
          'manager',
          `select app.submit_step({{b_prop}}, ${lessonPrice('lt2', `'{"price_iqd":30000}'`)})`,
        ),
        T(
          'b_other_kind',
          'manager',
          `select app.submit_step({{b_prop}}, jsonb_build_object('change', 'lesson_launch', ${REASON},
                                     'lesson_type_id', {{d}}, 'price_iqd', 30000, 'court_share_iqd', 0))`,
        ),
        T(
          'b_same_type',
          'manager',
          `select app.submit_step({{b_prop}}, ${lessonPrice('lt', `'{"price_iqd":29000}'`)})`,
        ),
      ]);

      expect(why(r, 'p_draft')).toBe('RECORD_INVALID:lesson_type_id');
      expect(why(r, 'p_elsewhere')).toBe('RECORD_INVALID:lesson_type_id');
      expect(why(r, 'p_no_type')).toBe('RECORD_INVALID:lesson_type_id');
      expect(why(r, 'p_no_figure')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_same_price')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_same_share')).toBe('RECORD_INVALID:court_share_iqd');
      expect(why(r, 'p_zero')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_huge')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_negative_share')).toBe('RECORD_INVALID:court_share_iqd');
      expect(why(r, 'p_text_price')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_course_cheap')).toBe('RECORD_INVALID:price_iqd');
      expect(why(r, 'p_stray')).toBe('RECORD_INVALID:menu_item_id');
      expect(why(r, 'p_launch_launched')).toBe('RECORD_INVALID:lesson_type_id');
      expect(why(r, 'p_launch_no_share')).toBe('RECORD_INVALID:court_share_iqd');
      expect(why(r, 'p_kind')).toBe('RECORD_INVALID:change');
      ok(r, 'p_course_floor');

      expect(ok(r, 'b_back')).toMatchObject({ decision: 'send_back' });
      expect(why(r, 'b_other_type')).toBe('RECORD_INVALID:change');
      expect(why(r, 'b_other_kind')).toBe('RECORD_INVALID:change');
      expect(ok(r, 'b_same_type')).toMatchObject({ auto: true });
    });
  },
);

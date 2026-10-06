/**
 * Coaching, migration 0286 lesson_sweep (docs/design/coaching/db.md §4.9, §7 row
 * coaching-sweep.test.ts; build contracts C-14, CD-2, CD-8, R25, R26, R30, R31, R38, R44, R45,
 * R63, R65).
 *
 *   * lesson_strike_record: the three kinds, guest-booked only (CD-2), never twice, a foreign
 *     session refused;
 *   * hold_strikes_settle: lesson strikes join the hold ladder, oldest first; a stale one is settled
 *     uncounted;
 *   * lesson_sweep, each step: held expiry through Money's lesson_hold_expire (a lapsed_hold
 *     strike; a payment still inside its grace left alone); a deleted student's enrolment
 *     cancelled account_deleted, a pending link to a deleted account dropped silently (C-21); a
 *     retired coach's lesson and course cancelled coach_retired; the cut-off judged once, only
 *     before the start (late: an under_filled {late: true} event, nothing cancelled), confirmed,
 *     deferred while held places could reach the minimum, cancelled under_filled; a course's
 *     cut-off, start and end; a lesson completed 15 minutes after its end with its court row; a
 *     second run in the same minute does nothing;
 *   * lesson_typed_purge (the hourly CD-8 purge): typed phone and friend names gone, the typed name
 *     the fixed marker 'Walk-in', never NULL; a 'Deleted account' marker kept.
 *   * 0295 (lesson_payment_strikes_sweep; D4, D5): a SUCCESS while the branch trades offline is
 *     venue_offline and ends the place with no strike and nothing left to pay (DB-35); a place
 *     whose lesson row succeeded, or that lapsed after the branch moved lessons to the desk or
 *     switched coaching off, strikes nobody (DB-35, DB-36); a lapsed_hold stays unsettled while its
 *     payment is open and its late SUCCESS withdraws it (DB-37); a late SUCCESS at a branch closed
 *     meanwhile is slot_lost (DB-38); the sweep expires a stale hold of a lesson no longer held
 *     (DB-39), starts a refund a cancel never started (DB-40), and cancels an empty group or course
 *     judged late at a zero cut-off (DB-41).
 *
 * Not here (two connections; coaching-races.test.ts): a busy coach skipped by try_lock_coach; an
 * attended correction that skips a strike row the ladder's settle holds.
 *
 * The sweep runs over the whole database, so every assertion reads the planted rows' own state,
 * never the run's global counts.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, scenario, X, type Results } from './stores-harness';
import { COURT, E, GUEST, PLANT } from './coaching-plant';

const up = await stackAvailable();
const docker = up && dockerReachable();

function failed(r: Results, label: string): { code: string; detail: string | null } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return { code: o!.code!, detail: o!.detail ?? null };
}

/** The state of one lesson, enrolment or course, as jsonb. */
const LESSON = (label: string, id: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'cancel_reason', cancel_reason,
              'checked', cutoff_checked_at is not null, 'completed_at', completed_at is not null)
              from lessons where id = {{${id}}}`,
  );
const ENROL = (label: string, id: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'cancel_kind', cancel_kind,
              'guest_id', guest_id, 'guest_name', guest_name, 'guest_phone', guest_phone)
              from lesson_enrolments where id = {{${id}}}`,
  );
const COURSE = (label: string, id: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'cancel_reason', cancel_reason,
              'checked', cutoff_checked_at is not null)
              from courses where id = {{${id}}}`,
  );
const EVENTS = (label: string, col: 'lesson_id' | 'course_id', id: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('type', type, 'code', code, 'actor', actor, 'data', data)
              order by id), '[]'::jsonb) from lesson_events where ${col} = {{${id}}}`,
  );

/** A coach of its own for every case (one live lesson per coach at a time). */
const COACH = (name: string) => [
  GUEST(`${name}_p`),
  KEEP(name, `select pg_temp.coach({{${name}_p}})`),
];

const GROUP_TYPE = KEEP(
  'lt_group',
  `select pg_temp.ltype('{"kind":"group","name_en":"Group","max_places":4,
  "min_places":3,"cutoff_hours":2,"price_iqd":15000}'::jsonb)`,
);
const PRIVATE_TYPE = KEEP('lt', `select pg_temp.ltype()`);
const COURSE_TYPE = KEEP(
  'lt_course',
  `select pg_temp.ltype('{"kind":"course","name_en":"Course","max_places":8,
  "min_places":3,"cutoff_hours":2,"price_iqd":100001,"sessions_count":4,"court_share_iqd":8000}'::jsonb)`,
);

/** A group session of coach `coach`, from `start` for one hour, its cut-off at `cutoff`. */
const GROUP = (name: string, coach: string, start: string, cutoff: string) =>
  KEEP(
    name,
    `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{${coach}}},
    'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 4, 'min_places', 3,
    'start_at', ${start}, 'end_at', ${start} + interval '1 hour', 'cutoff_at', ${cutoff}))`,
  );

/** A course of coach `coach` with four weekly sessions from `start`. */
function COURSE_WITH_SESSIONS(
  name: string,
  coach: string,
  start: string,
  cutoff: string,
  extra = `'{}'::jsonb`,
) {
  const out = [
    KEEP(
      name,
      `select pg_temp.ins('courses', jsonb_build_object('venue_id', {{venue}}, 'coach_id', {{${coach}}},
      'lesson_type_id', {{lt_course}}, 'price_iqd', 100001, 'court_share_iqd', 8000, 'coach_share_bp', 6000,
      'sessions_count', 4, 'max_places', 8, 'min_places', 3, 'cutoff_at', ${cutoff},
      'signup_closes_at', ${start} + interval '21 days', 'created_by_kind', 'staff',
      'created_by_staff_id', {{desk}}) || ${extra})`,
    ),
  ];
  for (let n = 1; n <= 4; n++) {
    out.push(
      KEEP(
        `${name}_s${n}`,
        `select pg_temp.lesson(jsonb_build_object('kind', 'course', 'coach_id', {{${coach}}},
        'lesson_type_id', {{lt_course}}, 'course_id', {{${name}}}, 'session_no', ${n}, 'price_iqd', null,
        'court_share_iqd', 8000, 'max_places', 8, 'min_places', 3, 'cutoff_at', ${cutoff},
        'start_at', ${start} + interval '${(n - 1) * 7} days',
        'end_at', ${start} + interval '${(n - 1) * 7} days 1 hour'))`,
      ),
    );
  }
  return out;
}

const NOW_H = `date_trunc('hour', now())`;

/** Venue A takes lessons online (inside the rolled-back scenario only). */
const ONLINE_A = X(
  `update venue_settings set coaching_enabled = true, lesson_payment_mode = 'online_optional'
    where venue_id = {{venue}}`,
);

/**
 * A guest's private lesson held for an online payment, as 0283's lesson_book_private and
 * lesson-begin leave it: the lesson and its enrolment `held`, a pending court `hold` row naming the
 * lesson, and one attempt (`<name>_rq` its request id, `<name>_pay` its row).
 */
function HELD_PRIVATE(
  name: string,
  coach: string,
  guest: string,
  start: string,
  o: {
    venue?: string;
    court?: string;
    lt?: string;
    hold?: string;
    deadline?: string;
    pay?: string;
  } = {},
) {
  const venue = o.venue ?? 'venue';
  const court = o.court ?? 'court1';
  const lt = o.lt ?? 'lt';
  const hold = o.hold ?? `now() + interval '15 minutes'`;
  return [
    KEEP(
      name,
      `select pg_temp.lesson(jsonb_build_object('venue_id', {{${venue}}}, 'coach_id', {{${coach}}},
      'lesson_type_id', {{${lt}}}, 'status', 'held', 'hold_expires_at', ${hold},
      'booked_by_kind', 'guest', 'created_by_profile_id', {{${guest}}}, 'created_by_staff_id', null,
      'start_at', ${start}, 'end_at', ${start} + interval '1 hour'))`,
    ),
    KEEP(
      `${name}_hold`,
      `select pg_temp.ins('reservations', jsonb_build_object('venue_id', {{${venue}}},
      'court_id', {{${court}}}, 'kind', 'hold', 'status', 'pending', 'hold_expires_at', ${hold},
      'start_at', ${start}, 'end_at', ${start} + interval '1 hour', 'source', 'mobile',
      'guest_name', 'Lesson', 'lesson_id', {{${name}}}))`,
    ),
    KEEP(
      `${name}_e`,
      `select pg_temp.genrol({{${guest}}}, jsonb_build_object('venue_id', {{${venue}}},
      'lesson_id', {{${name}}}, 'status', 'held', 'hold_expires_at', ${hold}))`,
    ),
    KEEP(`${name}_rq`, `select gen_random_uuid()::text`),
    KEEP(
      `${name}_pay`,
      `select pg_temp.ins('booking_payments', jsonb_build_object('purpose', 'lesson', 'provider', 'fake',
      'sandbox', false, 'request_id', {{${name}_rq}}, 'amount_iqd', 40000, 'quoted_price_iqd', 40000,
      'locale', 'en', 'deadline_at', ${o.deadline ?? `now() + interval '15 minutes'`},
      'guest_id', {{${guest}}}, 'venue_id', {{${venue}}}, 'lesson_enrolment_id', {{${name}_e}},
      'hold_id', {{${name}_hold}}) || ${o.pay ?? `'{"status":"pending"}'::jsonb`})`,
    ),
  ];
}

/** What the webhook does with the bank's answer (as postgres, the service role's body). */
const BANK = (label: string, name: string, status = 'SUCCESS', amount = 40000) =>
  E(
    label,
    `select app.deposit_apply({{${name}_rq}}::uuid, null, '${status}', ${amount}, 'IQD', false, 'webhook',
            true, '{}'::jsonb)`,
  );

const PAYMENT = (label: string, name: string) =>
  Q(
    label,
    `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
       from booking_payments where id = {{${name}_pay}}`,
  );
const STRIKES = (label: string, enrolment: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'settled', settled_at is not null,
              'counted', counted)), '[]'::jsonb) from lesson_strikes where enrolment_id = {{${enrolment}}}`,
  );
const ENROL_EVENTS = (label: string, enrolment: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('type', type, 'code', code, 'data', data) order by id),
              '[]'::jsonb) from lesson_events where enrolment_id = {{${enrolment}}}`,
  );

describe.skipIf(!docker)('coaching 0286: lesson_strike_record', () => {
  it('records only a guest-booked enrolment of a live account, once; refuses a foreign session', () => {
    const r = scenario('cf283-a', [
      PLANT,
      ...COACH('c1'),
      PRIVATE_TYPE,
      GUEST('g'),
      GUEST('g2'),
      GUEST('gdel'),
      KEEP(
        'l1',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} + interval '2 days', 'end_at', ${NOW_H} + interval '2 days 1 hour'))`,
      ),
      KEEP(
        'l2',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} + interval '3 days', 'end_at', ${NOW_H} + interval '3 days 1 hour'))`,
      ),
      KEEP('e_guest', `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{l1}}))`),
      KEEP(
        'e_coach',
        `select pg_temp.cenrol({{c1_p}}, jsonb_build_object('lesson_id', {{l1}}, 'guest_id', {{g2}},
        'link_confirmed_at', now()))`,
      ),
      KEEP('e_del', `select pg_temp.genrol({{gdel}}, jsonb_build_object('lesson_id', {{l2}}))`),
      X(
        `update profiles set deleted_at = now(), full_name = 'Deleted account' where id = {{gdel}}`,
      ),
      E(
        'bad_kind',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_guest}}, {{l1}}, 'late')) x`,
      ),
      E(
        'foreign',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_guest}}, {{l2}}, 'no_show')) x`,
      ),
      E(
        'guest',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_guest}}, {{l1}}, 'no_show')) x`,
      ),
      E(
        'again',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_guest}}, {{l1}}, 'late_cancel')) x`,
      ),
      E(
        'coach',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_coach}}, {{l1}}, 'no_show')) x`,
      ),
      E(
        'deleted',
        `select 'true'::jsonb from (select app.lesson_strike_record({{e_del}}, {{l2}}, 'lapsed_hold')) x`,
      ),
      Q(
        'rows',
        `select coalesce(jsonb_agg(jsonb_build_object('enrolment_id', enrolment_id, 'kind', kind,
                   'guest_id', guest_id, 'settled', settled_at is not null) order by struck_at), '[]'::jsonb)
                   from lesson_strikes where lesson_id in ({{l1}}, {{l2}})`,
      ),
    ]);
    expect(failed(r, 'bad_kind')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_kind' });
    expect(failed(r, 'foreign')).toEqual({ code: 'INVALID_ARGUMENT', detail: 'p_lesson_id' });
    for (const label of ['guest', 'again', 'coach', 'deleted']) ok(r, label);
    const rows = ok<Array<Record<string, unknown>>>(r, 'rows');
    // One row: the guest's no-show. The second call is a no-op (a plain-read existence check,
    // R65); the coach-booked student and the deleted account never strike (CD-2).
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'no_show', settled: false });
  });
});

describe.skipIf(!docker)('coaching 0286: hold_strikes_settle', () => {
  it('settles lesson strikes into the hold ladder, oldest first; a stale one uncounted', () => {
    const r = scenario('cf283-b', [
      PLANT,
      ...COACH('c1'),
      PRIVATE_TYPE,
      GUEST('g'),
      X(`update platform_settings set hold_strikes_since = now() - interval '30 days' where id`),
      KEEP(
        'l1',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} - interval '5 hours', 'end_at', ${NOW_H} - interval '4 hours'))`,
      ),
      KEEP(
        'l2',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} - interval '3 hours', 'end_at', ${NOW_H} - interval '2 hours'))`,
      ),
      KEEP(
        'l3',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} - interval '5 days', 'end_at', ${NOW_H} - interval '5 days' + interval '1 hour'))`,
      ),
      KEEP('e1', `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{l1}}))`),
      KEEP('e2', `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{l2}}))`),
      KEEP('e3', `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{l3}}))`),
      // Strikes as the attendance marks and the cancel would record them, at their times.
      X(`insert into lesson_strikes (enrolment_id, lesson_id, venue_id, guest_id, kind, struck_at) values
           ({{e1}}, {{l1}}, {{venue}}, {{g}}, 'no_show', now() - interval '4 hours'),
           ({{e2}}, {{l2}}, {{venue}}, {{g}}, 'late_cancel', now() - interval '2 hours'),
           ({{e3}}, {{l3}}, {{venue}}, {{g}}, 'no_show', now() - interval '5 days')`),
      E('settled', `select to_jsonb(app.hold_strikes_settle(array[{{g}}]::uuid[]))`),
      E('again', `select to_jsonb(app.hold_strikes_settle(array[{{g}}]::uuid[]))`),
      Q(
        'rows',
        `select jsonb_object_agg(kind || ':' || (struck_at < now() - interval '2 days')::text,
                   jsonb_build_object('settled', settled_at is not null, 'counted', counted))
                   from lesson_strikes where guest_id = {{g}}`,
      ),
      Q(
        'standing',
        `select jsonb_build_object('strikes', s.strikes, 'blocked', s.blocked_until is not null)
                       from hold_standing s where s.key = app.hold_standing_key({{g}})`,
      ),
    ]);
    expect(ok<number>(r, 'settled')).toBe(2);
    expect(ok<number>(r, 'again')).toBe(0);
    expect(ok(r, 'rows')).toEqual({
      'no_show:false': { settled: true, counted: true },
      'late_cancel:false': { settled: true, counted: true },
      'no_show:true': { settled: true, counted: false },
    });
    // Two strikes in one day: the second is a 2-hour wait (0252's ladder).
    expect(ok(r, 'standing')).toEqual({ strikes: 2, blocked: true });
  });
});

describe.skipIf(!docker)('coaching 0286: lesson_sweep', () => {
  it('the cut-off: confirmed, under-filled, deferred, cancelled at start - 10 min, judged late (R26, R38)', () => {
    const r = scenario('cf283-c', [
      PLANT,
      GROUP_TYPE,
      ...COACH('ca'),
      ...COACH('cb'),
      ...COACH('cc'),
      ...COACH('cd'),
      ...COACH('ce'),
      GUEST('s1'),
      GUEST('s2'),
      GUEST('s3'),
      GUEST('s4'),
      // a: three booked of three, due -> confirmed.
      GROUP('la', 'ca', `${NOW_H} + interval '3 hours'`, `now() - interval '1 minute'`),
      ...['s1', 's2', 's3'].map((s) =>
        KEEP(
          `ea_${s}`,
          `select pg_temp.genrol({{${s}}}, jsonb_build_object('lesson_id', {{la}}, 'price_iqd', 15000))`,
        ),
      ),
      // b: one booked of three, nobody paying -> under_filled.
      GROUP('lb', 'cb', `${NOW_H} + interval '3 hours'`, `now() - interval '1 minute'`),
      KEEP(
        'eb',
        `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{lb}}, 'price_iqd', 15000))`,
      ),
      // c: two booked and one mid-payment, start hours away -> deferred (R38).
      GROUP('lc', 'cc', `${NOW_H} + interval '3 hours'`, `now() - interval '1 minute'`),
      KEEP(
        'ec1',
        `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{lc}}, 'price_iqd', 15000))`,
      ),
      KEEP(
        'ec2',
        `select pg_temp.genrol({{s2}}, jsonb_build_object('lesson_id', {{lc}}, 'price_iqd', 15000))`,
      ),
      KEEP(
        'ec3',
        `select pg_temp.genrol({{s3}}, jsonb_build_object('lesson_id', {{lc}}, 'price_iqd', 15000,
        'status', 'held', 'hold_expires_at', now() + interval '10 minutes'))`,
      ),
      // d: the same, but it starts in five minutes -> judged on booked: under_filled.
      GROUP('ld', 'cd', `now() + interval '5 minutes'`, `now() - interval '1 minute'`),
      KEEP(
        'ed1',
        `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{ld}}, 'price_iqd', 15000))`,
      ),
      KEEP(
        'ed2',
        `select pg_temp.genrol({{s2}}, jsonb_build_object('lesson_id', {{ld}}, 'price_iqd', 15000))`,
      ),
      KEEP(
        'ed3',
        `select pg_temp.genrol({{s3}}, jsonb_build_object('lesson_id', {{ld}}, 'price_iqd', 15000,
        'status', 'held', 'hold_expires_at', now() + interval '10 minutes'))`,
      ),
      // e: started half an hour ago, one booked, never judged -> late: stamp, event, nothing cancelled.
      GROUP('le', 'ce', `now() - interval '30 minutes'`, `now() - interval '150 minutes'`),
      KEEP(
        'ee',
        `select pg_temp.genrol({{s4}}, jsonb_build_object('lesson_id', {{le}}, 'price_iqd', 15000))`,
      ),
      E('run1', `select app.lesson_sweep()`),
      LESSON('a', 'la'),
      LESSON('b', 'lb'),
      LESSON('c', 'lc'),
      LESSON('d', 'ld'),
      LESSON('e', 'le'),
      ENROL('eb', 'eb'),
      ENROL('ed1', 'ed1'),
      EVENTS('ev_b', 'lesson_id', 'lb'),
      EVENTS('ev_e', 'lesson_id', 'le'),
      E('run2', `select app.lesson_sweep()`),
      LESSON('a2', 'la'),
      LESSON('c2', 'lc'),
      LESSON('e2', 'le'),
      EVENTS('ev_e2', 'lesson_id', 'le'),
    ]);
    const run1 = ok<Record<string, number>>(r, 'run1');
    for (const k of [
      'held_expired',
      'held_waiting',
      'deleted_cancelled',
      'links_dropped',
      'retired_cancelled',
      'under_filled',
      'courses_under_filled',
      'judged_late',
      'cutoffs_confirmed',
      'deferred',
      'courses_running',
      'completed',
      'courses_completed',
      'purged',
      'skipped',
      'errors',
    ]) {
      expect(run1, k).toHaveProperty(k);
    }
    expect(run1.errors).toBe(0);

    expect(ok(r, 'a')).toMatchObject({ status: 'scheduled', checked: true });
    expect(ok(r, 'b')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'under_filled',
      checked: true,
    });
    expect(ok(r, 'eb')).toMatchObject({ status: 'cancelled', cancel_kind: 'under_filled' });
    expect(ok(r, 'c')).toMatchObject({ status: 'scheduled', checked: false });
    expect(ok(r, 'd')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'under_filled',
      checked: true,
    });
    expect(ok(r, 'ed1')).toMatchObject({ status: 'cancelled', cancel_kind: 'under_filled' });
    expect(ok(r, 'e')).toMatchObject({ status: 'scheduled', checked: true });

    const evB = ok<Array<{ type: string; data: Record<string, unknown> }>>(r, 'ev_b');
    expect(evB.some((e) => e.type === 'under_filled')).toBe(true);
    const evE = ok<Array<{ type: string; actor: string; data: Record<string, unknown> }>>(
      r,
      'ev_e',
    );
    expect(evE).toEqual([
      {
        type: 'under_filled',
        code: null,
        actor: 'system',
        data: expect.objectContaining({ late: true, places_taken: 1, min_places: 3 }),
      },
    ]);

    // A second run in the same minute changes nothing: judged once, still deferred.
    expect(ok<Record<string, number>>(r, 'run2').errors).toBe(0);
    expect(ok(r, 'a2')).toEqual(ok(r, 'a'));
    expect(ok(r, 'c2')).toMatchObject({ status: 'scheduled', checked: false });
    expect(ok(r, 'e2')).toEqual(ok(r, 'e'));
    expect(ok<unknown[]>(r, 'ev_e2')).toHaveLength(1);
  });

  it('a course: cut-off cancels it with its sessions; a started one runs; a finished one completes', () => {
    const r = scenario('cf283-d', [
      PLANT,
      COURSE_TYPE,
      ...COACH('ca'),
      ...COACH('cb'),
      ...COACH('cc'),
      GUEST('s1'),
      // Under-filled at its cut-off, session 1 tomorrow.
      ...COURSE_WITH_SESSIONS(
        'ka',
        'ca',
        `${NOW_H} + interval '1 day'`,
        `now() - interval '1 minute'`,
      ),
      KEEP(
        'eka',
        `select pg_temp.genrol({{s1}}, jsonb_build_object('course_id', {{ka}}, 'price_iqd', 100001,
        'first_session_no', 1, 'sessions_covered', 4))`,
      ),
      // Session 1 started an hour ago, cut-off already judged: -> running.
      ...COURSE_WITH_SESSIONS(
        'kb',
        'cb',
        `now() - interval '1 hour'`,
        `now() - interval '3 hours'`,
        `jsonb_build_object('cutoff_checked_at', now() - interval '3 hours')`,
      ),
      // Every session over (weekly, the last ended an hour ago): -> sessions completed, course completed.
      ...COURSE_WITH_SESSIONS(
        'kc',
        'cc',
        `${NOW_H} - interval '22 days'`,
        `${NOW_H} - interval '23 days'`,
        `jsonb_build_object('cutoff_checked_at', now() - interval '23 days', 'status', 'running')`,
      ),
      E('run', `select app.lesson_sweep()`),
      COURSE('ka', 'ka'),
      LESSON('ka_s1', 'ka_s1'),
      LESSON('ka_s4', 'ka_s4'),
      ENROL('eka', 'eka'),
      EVENTS('ev_ka', 'course_id', 'ka'),
      COURSE('kb', 'kb'),
      COURSE('kc', 'kc'),
      LESSON('kc_s1', 'kc_s1'),
      LESSON('kc_s4', 'kc_s4'),
      EVENTS('ev_kc', 'course_id', 'kc'),
      Q(
        'kc_completed',
        `select jsonb_build_object('course', count(*) filter (where lesson_id is null),
                                  'sessions', count(*) filter (where lesson_id is not null))
           from lesson_events where course_id = {{kc}} and type = 'completed'`,
      ),
    ]);
    expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
    expect(ok(r, 'ka')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'under_filled',
      checked: true,
    });
    expect(ok(r, 'ka_s1')).toMatchObject({
      status: 'cancelled',
      cancel_reason: 'under_filled',
      checked: true,
    });
    expect(ok(r, 'ka_s4')).toMatchObject({ status: 'cancelled', checked: true });
    expect(ok(r, 'eka')).toMatchObject({ status: 'cancelled', cancel_kind: 'course_cancelled' });
    expect(ok<Array<{ type: string }>>(r, 'ev_ka').some((e) => e.type === 'under_filled')).toBe(
      true,
    );

    expect(ok(r, 'kb')).toMatchObject({ status: 'running' });

    expect(ok(r, 'kc_s1')).toMatchObject({ status: 'completed', completed_at: true });
    expect(ok(r, 'kc_s4')).toMatchObject({ status: 'completed', completed_at: true });
    expect(ok(r, 'kc')).toMatchObject({ status: 'completed' });
    const evKc = ok<Array<{ type: string; data: Record<string, unknown> }>>(r, 'ev_kc');
    // One completed event per session (each names its course too, F NOTES §2.14), and one
    // course-wide one.
    expect(evKc.filter((e) => e.type === 'completed')).toHaveLength(5);
    expect(ok(r, 'kc_completed')).toEqual({ course: 1, sessions: 4 });
  });

  it('completion: 15 minutes after the end, the lesson and its court row; not before', () => {
    const r = scenario('cf283-e', [
      PLANT,
      PRIVATE_TYPE,
      COURT('court1'),
      ...COACH('ca'),
      ...COACH('cb'),
      KEEP(
        'l_done',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{ca}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} - interval '3 hours', 'end_at', ${NOW_H} - interval '2 hours'))`,
      ),
      KEEP('r_done', `select pg_temp.courtrow({{l_done}}, {{court1}})`),
      KEEP(
        'l_just',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{cb}}, 'lesson_type_id', {{lt}},
        'start_at', now() - interval '65 minutes', 'end_at', now() - interval '5 minutes'))`,
      ),
      KEEP('r_just', `select pg_temp.courtrow({{l_just}}, {{court1}})`),
      E('run', `select app.lesson_sweep()`),
      LESSON('done', 'l_done'),
      LESSON('just', 'l_just'),
      Q(
        'rows',
        `select jsonb_object_agg(lesson_id::text, status) from reservations
                   where lesson_id in ({{l_done}}, {{l_just}})`,
      ),
      EVENTS('ev', 'lesson_id', 'l_done'),
    ]);
    expect(ok(r, 'done')).toMatchObject({ status: 'completed', completed_at: true });
    expect(ok(r, 'just')).toMatchObject({ status: 'scheduled', completed_at: false });
    const rows = ok<Record<string, string>>(r, 'rows');
    expect(Object.values(rows).sort()).toEqual(['completed', 'confirmed']);
    expect(ok<Array<{ type: string; actor: string }>>(r, 'ev')).toEqual([
      expect.objectContaining({ type: 'completed', actor: 'system' }),
    ]);
  });

  it('a deleted student is cancelled account_deleted; a pending link to a deleted account is dropped (C-21)', () => {
    const r = scenario('cf283-f', [
      PLANT,
      PRIVATE_TYPE,
      GROUP_TYPE,
      ...COACH('ca'),
      ...COACH('cb'),
      GUEST('gdel'),
      GUEST('glink'),
      KEEP(
        'l1',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{ca}}, 'lesson_type_id', {{lt}},
        'booked_by_kind', 'guest', 'created_by_profile_id', {{gdel}}, 'created_by_staff_id', null,
        'start_at', ${NOW_H} + interval '1 day', 'end_at', ${NOW_H} + interval '1 day 1 hour'))`,
      ),
      KEEP('e1', `select pg_temp.genrol({{gdel}}, jsonb_build_object('lesson_id', {{l1}}))`),
      GROUP('lg', 'cb', `${NOW_H} + interval '2 days'`, `${NOW_H} + interval '1 day 22 hours'`),
      KEEP(
        'e_link',
        `select pg_temp.cenrol({{cb_p}}, jsonb_build_object('lesson_id', {{lg}}, 'guest_id', {{glink}},
        'price_iqd', 15000))`,
      ),
      X(`update profiles set deleted_at = now(), full_name = 'Deleted account'
          where id in ({{gdel}}, {{glink}})`),
      E('run', `select app.lesson_sweep()`),
      ENROL('e1', 'e1'),
      LESSON('l1', 'l1'),
      ENROL('e_link', 'e_link'),
      Q(
        'link_events',
        `select to_jsonb(count(*)) from lesson_events where enrolment_id = {{e_link}}`,
      ),
    ]);
    expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
    expect(ok(r, 'e1')).toMatchObject({ status: 'cancelled', cancel_kind: 'account_deleted' });
    expect(ok(r, 'l1')).toMatchObject({ status: 'cancelled', cancel_reason: 'account_deleted' });
    // The typed student stays booked under the typed name and phone; the link is gone silently.
    expect(ok(r, 'e_link')).toMatchObject({
      status: 'booked',
      guest_id: null,
      guest_name: 'Typed Student',
      guest_phone: '07700000001',
    });
    expect(ok<number>(r, 'link_events')).toBe(0);
  });

  it('a retired coach: lessons not started and courses with a session left cancelled coach_retired (R45, R63)', () => {
    const r = scenario('cf283-g', [
      PLANT,
      PRIVATE_TYPE,
      COURSE_TYPE,
      ...COACH('cr'),
      KEEP(
        'l1',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{cr}}, 'lesson_type_id', {{lt}},
        'start_at', ${NOW_H} + interval '1 day', 'end_at', ${NOW_H} + interval '1 day 1 hour'))`,
      ),
      ...COURSE_WITH_SESSIONS(
        'k',
        'cr',
        `${NOW_H} + interval '2 days'`,
        `${NOW_H} + interval '1 day 22 hours'`,
      ),
      X(`update coaches set status = 'retired', retired_at = now() where id = {{cr}}`),
      E('run', `select app.lesson_sweep()`),
      LESSON('l1', 'l1'),
      COURSE('k', 'k'),
      LESSON('k_s2', 'k_s2'),
    ]);
    expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
    expect(ok(r, 'l1')).toMatchObject({ status: 'cancelled', cancel_reason: 'coach_retired' });
    expect(ok(r, 'k')).toMatchObject({ status: 'cancelled', cancel_reason: 'coach_retired' });
    expect(ok(r, 'k_s2')).toMatchObject({ status: 'cancelled' });
  });

  it('a lapsed online hold expires through lesson_hold_expire with a lapsed_hold strike; an open payment waits', () => {
    const held = (name: string, coach: string, guest: string, hours: number) => [
      KEEP(
        name,
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{${coach}}}, 'lesson_type_id', {{lt}},
        'status', 'held', 'hold_expires_at', now() - interval '1 minute',
        'booked_by_kind', 'guest', 'created_by_profile_id', {{${guest}}}, 'created_by_staff_id', null,
        'start_at', ${NOW_H} + interval '${hours} hours', 'end_at', ${NOW_H} + interval '${hours + 1} hours'))`,
      ),
      KEEP(
        `${name}_hold`,
        `select pg_temp.ins('reservations', jsonb_build_object('venue_id', {{venue}},
        'court_id', {{court1}}, 'kind', 'hold', 'status', 'pending', 'hold_expires_at', now() - interval '1 minute',
        'start_at', ${NOW_H} + interval '${hours} hours', 'end_at', ${NOW_H} + interval '${hours + 1} hours',
        'source', 'mobile', 'guest_name', 'Lesson', 'lesson_id', {{${name}}}))`,
      ),
      KEEP(
        `${name}_e`,
        `select pg_temp.genrol({{${guest}}}, jsonb_build_object('lesson_id', {{${name}}},
        'status', 'held', 'hold_expires_at', now() - interval '1 minute'))`,
      ),
    ];
    const r = scenario('cf283-h', [
      PLANT,
      PRIVATE_TYPE,
      COURT('court1'),
      X(`update platform_settings set hold_strikes_since = now() - interval '30 days' where id`),
      // 0295 (DB-36): a lapse strikes only while the branch takes lessons online.
      ONLINE_A,
      ...COACH('ca'),
      ...COACH('cb'),
      GUEST('g1'),
      GUEST('g2'),
      ...held('lh', 'ca', 'g1', 30),
      ...held('lw', 'cb', 'g2', 34),
      // g2 is still on the Qi page: a payment inside the ten-minute grace.
      X(`insert into booking_payments (purpose, provider, sandbox, request_id, amount_iqd, quoted_price_iqd, status,
            locale, deadline_at, guest_id, venue_id, lesson_enrolment_id, hold_id)
          values ('lesson', 'fake', false, gen_random_uuid(), 40000, 40000, 'pending', 'en',
                  now() + interval '5 minutes', {{g2}}, {{venue}}, {{lw_e}}, {{lw_hold}})`),
      E('run', `select app.lesson_sweep()`),
      LESSON('lh', 'lh'),
      ENROL('lh_e', 'lh_e'),
      Q('lh_hold', `select to_jsonb(status) from reservations where id = {{lh_hold}}`),
      Q(
        'lh_strike',
        `select coalesce(jsonb_agg(kind), '[]'::jsonb) from lesson_strikes where enrolment_id = {{lh_e}}`,
      ),
      LESSON('lw', 'lw'),
      ENROL('lw_e', 'lw_e'),
    ]);
    expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
    expect(ok(r, 'lh')).toMatchObject({ status: 'expired', cancel_reason: 'payment_expired' });
    expect(ok(r, 'lh_e')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
    expect(ok(r, 'lh_hold')).toBe('expired');
    expect(ok(r, 'lh_strike')).toEqual(['lapsed_hold']);
    expect(ok(r, 'lw')).toMatchObject({ status: 'held' });
    expect(ok(r, 'lw_e')).toMatchObject({ status: 'held' });
  });
});

describe.skipIf(!docker)('coaching 0286: lesson_typed_purge (CD-8, R44)', () => {
  it('365 days after the last session: phone and friends gone, the typed name a marker, never NULL', () => {
    const r = scenario('cf283-i', [
      PLANT,
      PRIVATE_TYPE,
      ...COACH('ca'),
      ...COACH('cb'),
      GUEST('g'),
      GUEST('gd'),
      KEEP(
        'l_old',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{ca}}, 'lesson_type_id', {{lt}},
        'status', 'completed', 'completed_at', now() - interval '400 days',
        'start_at', ${NOW_H} - interval '400 days', 'end_at', ${NOW_H} - interval '400 days' + interval '1 hour'))`,
      ),
      KEEP(
        'l_recent',
        `select pg_temp.lesson(jsonb_build_object('coach_id', {{cb}}, 'lesson_type_id', {{lt}},
        'status', 'completed', 'completed_at', now() - interval '100 days',
        'start_at', ${NOW_H} - interval '100 days', 'end_at', ${NOW_H} - interval '100 days' + interval '1 hour'))`,
      ),
      KEEP(
        'e_typed',
        `select pg_temp.cenrol({{ca_p}}, jsonb_build_object('lesson_id', {{l_old}},
        'created_at', now() - interval '401 days'))`,
      ),
      KEEP(
        'e_guest',
        `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{l_old}}, 'party_size', 2,
        'friend_names', array['Ali'], 'created_at', now() - interval '401 days'))`,
      ),
      KEEP(
        'e_deleted',
        `select pg_temp.cenrol({{ca_p}}, jsonb_build_object('lesson_id', {{l_old}},
        'guest_name', 'Deleted account', 'guest_phone', null, 'guest_id', {{gd}}, 'link_confirmed_at', now(),
        'created_at', now() - interval '401 days'))`,
      ),
      KEEP(
        'e_recent',
        `select pg_temp.cenrol({{cb_p}}, jsonb_build_object('lesson_id', {{l_recent}},
        'created_at', now() - interval '101 days'))`,
      ),
      E('purged', `select to_jsonb(app.lesson_typed_purge(500))`),
      E('again', `select to_jsonb(app.lesson_typed_purge(500))`),
      Q(
        'rows',
        `select jsonb_object_agg(id::text, jsonb_build_object('name', guest_name, 'phone', guest_phone,
                   'friends', to_jsonb(friend_names)))
                   from lesson_enrolments where id in ({{e_typed}}, {{e_guest}}, {{e_deleted}}, {{e_recent}})`,
      ),
      Q(
        'ids',
        `select jsonb_build_object('typed', {{e_typed}}, 'guest', {{e_guest}}, 'deleted', {{e_deleted}},
                  'recent', {{e_recent}})`,
      ),
    ]);
    expect(ok<number>(r, 'purged')).toBeGreaterThanOrEqual(2);
    const ids = ok<{ typed: string; guest: string; deleted: string; recent: string }>(r, 'ids');
    const rows = ok<
      Record<string, { name: string | null; phone: string | null; friends: string[] }>
    >(r, 'rows');
    expect(rows[ids.typed]).toEqual({ name: 'Walk-in', phone: null, friends: [] });
    expect(rows[ids.guest]).toEqual({ name: null, phone: null, friends: [] });
    expect(rows[ids.deleted]).toEqual({ name: 'Deleted account', phone: null, friends: [] });
    expect(rows[ids.recent]).toEqual({ name: 'Typed Student', phone: '07700000001', friends: [] });
    // The purge is table-wide, so the second run may still find rows of other suites; what it
    // must not do is touch these four again: the rows above are read after it ran.
    ok<number>(r, 'again');
  });
});

// ── 0295 (lesson_payment_strikes_sweep): DB-35..DB-41, decisions D4 and D5 ────────────────────

/** Venue A trades offline (inside the scenario only): offline mode on, every till stale, a day open. */
const DEGRADE_A = [
  X(`update venue_settings set offline_mode_enabled = true where venue_id = {{venue}}`),
  X(`insert into stations (id, venue_id, is_till) values ('TILL-CF295', {{venue}}, true)
       on conflict (id) do update set venue_id = excluded.venue_id, is_till = true, retired_at = null`),
  X(`insert into device_heartbeats (device_id, venue_id, last_seen_at, queue_depth, is_till)
       values ('TILL-CF295', {{venue}}, now() - interval '1 day', 0, true)
       on conflict (device_id) do update set last_seen_at = excluded.last_seen_at`),
  X(`update device_heartbeats set last_seen_at = now() - interval '1 day'
      where venue_id = {{venue}} and (is_till or device_id like 'TILL%')`),
  X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
     select {{venue}}, date '4999-12-31', 'open', {{manager}}, 0
      where not exists (select 1 from day_sessions where venue_id = {{venue}} and status in ('open', 'closing'))`),
];

/** A failed first attempt, twenty minutes past its deadline. */
const FAILED_PAY = `'{"status":"failed","failure_code":"declined"}'::jsonb
  || jsonb_build_object('failed_at', now() - interval '20 minutes')`;

describe.skipIf(!docker)(
  'coaching 0295: the online lesson payment and its strike (DB-35, DB-36, DB-38)',
  () => {
    it('DB-35: a SUCCESS while the branch trades offline refunds venue_offline and ends the place, with no strike and no second payment', () => {
      const r = scenario('cf295-a', [
        PLANT,
        PRIVATE_TYPE,
        COURT('court1'),
        ONLINE_A,
        X(`update platform_settings set hold_strikes_since = now() - interval '30 days' where id`),
        ...DEGRADE_A,
        ...COACH('ca'),
        ...COACH('cb'),
        GUEST('g'),
        GUEST('g2'),
        // Inside the 48-hour protected horizon: the bank's SUCCESS cannot book it offline.
        ...HELD_PRIVATE('lo', 'ca', 'g', `${NOW_H} + interval '5 hours'`),
        // Further out, a payment of the wrong amount (amount_mismatch: the place stays held).
        ...HELD_PRIVATE('lm', 'cb', 'g2', `${NOW_H} + interval '30 days'`),
        Q('degraded', `select to_jsonb(app.is_degraded({{venue}}))`),
        BANK('ok', 'lo'),
        PAYMENT('pay', 'lo'),
        ENROL('e', 'lo_e'),
        LESSON('l', 'lo'),
        Q('hold', `select to_jsonb(status) from reservations where id = {{lo_hold}}`),
        STRIKES('strikes', 'lo_e'),
        ENROL_EVENTS('events', 'lo_e'),
        // Nothing left to pay: the place is over.
        E('again', `select app.lesson_payment_prepare({{g}}::uuid, {{lo_e}}::uuid, 'en', 'fake')`),
        // The sweep later finds nothing to expire, and strikes nobody.
        E('run', `select app.lesson_sweep()`),
        STRIKES('strikes2', 'lo_e'),
        // The wrong amount: refunded, the place still held; once it lapses it expires with no
        // strike, because a lesson row of it succeeded (the guest paid).
        BANK('mismatch', 'lm', 'SUCCESS', 39000),
        PAYMENT('pay_m', 'lm'),
        ENROL('e_m', 'lm_e'),
        X(
          `update lesson_enrolments set hold_expires_at = now() - interval '1 minute' where id = {{lm_e}}`,
        ),
        E('expire_m', `select to_jsonb(app.lesson_hold_expire({{lm_e}}::uuid))`),
        ENROL('e_m2', 'lm_e'),
        STRIKES('strikes_m', 'lm_e'),
      ]);
      expect(ok(r, 'degraded')).toBe(true);
      expect(ok(r, 'ok')).toMatchObject({
        matched: true,
        status: 'refund_pending',
        purpose: 'lesson',
      });
      expect(ok(r, 'pay')).toEqual({
        status: 'refund_pending',
        reason: 'venue_offline',
        amount: 40000,
      });
      expect(ok(r, 'e')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
      expect(ok(r, 'l')).toMatchObject({ status: 'expired', cancel_reason: 'payment_expired' });
      expect(ok(r, 'hold')).toBe('expired');
      expect(ok(r, 'strikes')).toEqual([]);
      expect(
        ok<Array<{ type: string; code: string | null; data: Record<string, unknown> }>>(
          r,
          'events',
        ),
      ).toEqual([
        expect.objectContaining({
          type: 'expired',
          code: 'payment_expired',
          data: expect.objectContaining({ reason: 'venue_offline' }),
        }),
      ]);
      const again = failed(r, 'again');
      expect([again.code, again.detail]).toEqual(['LESSON_NOT_PAYABLE', 'expired']);
      expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
      expect(ok(r, 'strikes2')).toEqual([]);

      expect(ok(r, 'mismatch')).toMatchObject({ status: 'refund_pending' });
      expect(ok(r, 'pay_m')).toMatchObject({ status: 'refund_pending', reason: 'amount_mismatch' });
      expect(ok(r, 'e_m')).toMatchObject({ status: 'held' });
      expect(ok(r, 'expire_m')).toBe(true);
      expect(ok(r, 'e_m2')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
      expect(ok(r, 'strikes_m')).toEqual([]);
    });

    it('DB-36: a lapse after the branch moved lessons to the desk, or switched coaching off, strikes nobody', () => {
      const r = scenario('cf295-b', [
        PLANT,
        PRIVATE_TYPE,
        COURT('court1'),
        ONLINE_A,
        X(`update platform_settings set hold_strikes_since = now() - interval '30 days' where id`),
        ...COACH('ca'),
        ...COACH('cb'),
        GUEST('g1'),
        GUEST('g2'),
        // g1's place lapsed a minute ago after one failed attempt; g2's (also one failed
        // attempt) is still inside its window while the sweep runs.
        ...HELD_PRIVATE('ld', 'ca', 'g1', `${NOW_H} + interval '30 hours'`, {
          hold: `now() - interval '1 minute'`,
          deadline: `now() - interval '20 minutes'`,
          pay: FAILED_PAY,
        }),
        ...HELD_PRIVATE('lc', 'cb', 'g2', `${NOW_H} + interval '34 hours'`, {
          deadline: `now() - interval '20 minutes'`,
          pay: FAILED_PAY,
        }),
        // The owner moves lessons to desk payment: the sweep expires g1's place, no strike.
        X(`update venue_settings set lesson_payment_mode = 'desk' where venue_id = {{venue}}`),
        E('run', `select app.lesson_sweep()`),
        ENROL('e1', 'ld_e'),
        STRIKES('s1', 'ld_e'),
        // Coaching switched off with online payment on: g2's place expires, no strike.
        X(`update venue_settings set coaching_enabled = false, lesson_payment_mode = 'online_optional'
          where venue_id = {{venue}}`),
        E('expire2', `select to_jsonb(app.lesson_hold_expire({{lc_e}}::uuid))`),
        ENROL('e2', 'lc_e'),
        STRIKES('s2', 'lc_e'),
      ]);
      expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
      expect(ok(r, 'e1')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
      expect(ok(r, 's1')).toEqual([]);
      expect(ok(r, 'expire2')).toBe(true);
      expect(ok(r, 'e2')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
      expect(ok(r, 's2')).toEqual([]);
    });

    it('DB-38: a late SUCCESS for a place at a branch closed meanwhile is slot_lost and books nothing there', () => {
      const r = scenario('cf295-c', [
        PLANT,
        ...COACH('cc'),
        GUEST('g'),
        X(`update venues set status = 'open' where id = {{other_venue}}`),
        X(`insert into coach_branches (coach_id, venue_id) values ({{cc}}, {{other_venue}})`),
        KEEP('lt_b', `select pg_temp.ltype(jsonb_build_object('venue_id', {{other_venue}}))`),
        KEEP(
          'court_b',
          `insert into courts (name_en, name_ar, venue_id)
                  values ('CF295 b', 'ملعب ب', {{other_venue}}) returning id`,
        ),
        ...HELD_PRIVATE('lb', 'cc', 'g', `${NOW_H} + interval '30 days'`, {
          venue: 'other_venue',
          court: 'court_b',
          lt: 'lt_b',
          deadline: `now() - interval '20 minutes'`,
        }),
        // The window is over with the bank silent: the place expires (the sweep's step 1)...
        X(
          `update lesson_enrolments set hold_expires_at = now() - interval '1 minute' where id = {{lb_e}}`,
        ),
        E('expire', `select to_jsonb(app.lesson_hold_expire({{lb_e}}::uuid))`),
        // ...the branch closes, and then the bank says SUCCESS.
        X(`update venues set status = 'closed' where id = {{other_venue}}`),
        BANK('late', 'lb'),
        PAYMENT('pay', 'lb'),
        LESSON('l', 'lb'),
        ENROL('e', 'lb_e'),
        Q(
          'live',
          `select to_jsonb(count(*)) from reservations
          where venue_id = {{other_venue}} and status in ('pending', 'confirmed', 'arrived')`,
        ),
      ]);
      expect(ok(r, 'expire')).toBe(true);
      expect(ok(r, 'late')).toMatchObject({ matched: true, status: 'refund_pending' });
      expect(ok(r, 'pay')).toEqual({
        status: 'refund_pending',
        reason: 'slot_lost',
        amount: 40000,
      });
      expect(ok(r, 'l')).toMatchObject({ status: 'expired' });
      expect(ok(r, 'e')).toMatchObject({ status: 'expired' });
      expect(ok(r, 'live')).toBe(0);
    });
  },
);

describe.skipIf(!docker)(
  'coaching 0295: hold_strikes_settle waits for a payment in flight (DB-37, D5)',
  () => {
    it('a lapsed_hold whose payment is still open stays unsettled; its late SUCCESS withdraws it and the standing never moves', () => {
      const r = scenario('cf295-d', [
        PLANT,
        PRIVATE_TYPE,
        COURT('court1'),
        ONLINE_A,
        X(`update platform_settings set hold_strikes_since = now() - interval '30 days' where id`),
        ...COACH('ca'),
        ...COACH('cb'),
        GUEST('g'),
        GUEST('g2'),
        // The window and the attempt's ten-minute grace are both over; the bank has not answered.
        ...HELD_PRIVATE('lp', 'ca', 'g', `${NOW_H} + interval '30 hours'`, {
          hold: `now() - interval '1 minute'`,
          deadline: `now() - interval '20 minutes'`,
        }),
        Q(
          'before',
          `select coalesce((select to_jsonb(s.strikes) from hold_standing s
                           where s.key = app.hold_standing_key({{g}})), '0'::jsonb)`,
        ),
        E('run', `select app.lesson_sweep()`),
        ENROL('e', 'lp_e'),
        STRIKES('recorded', 'lp_e'),
        E('settle', `select to_jsonb(app.hold_strikes_settle(array[{{g}}]::uuid[]))`),
        STRIKES('unsettled', 'lp_e'),
        BANK('late', 'lp'),
        STRIKES('after', 'lp_e'),
        E('settle2', `select to_jsonb(app.hold_strikes_settle(array[{{g}}]::uuid[]))`),
        Q(
          'standing',
          `select coalesce((select to_jsonb(s.strikes) from hold_standing s
                           where s.key = app.hold_standing_key({{g}})), '0'::jsonb)`,
        ),
        // Two days on, an open payment no longer holds the strike back: settled uncounted.
        ...HELD_PRIVATE('lq', 'cb', 'g2', `${NOW_H} + interval '34 hours'`),
        X(`update lesson_enrolments set status = 'expired', cancel_kind = 'expired', cancelled_at = now(),
                hold_expires_at = null where id = {{lq_e}}`),
        X(`insert into lesson_strikes (enrolment_id, lesson_id, venue_id, guest_id, kind, struck_at)
         values ({{lq_e}}, {{lq}}, {{venue}}, {{g2}}, 'lapsed_hold', now() - interval '3 days')`),
        E('settle3', `select to_jsonb(app.hold_strikes_settle(array[{{g2}}]::uuid[]))`),
        STRIKES('stale', 'lq_e'),
      ]);
      expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
      expect(ok(r, 'e')).toMatchObject({ status: 'expired', cancel_kind: 'expired' });
      expect(ok(r, 'recorded')).toEqual([{ kind: 'lapsed_hold', settled: false, counted: null }]);
      expect(ok(r, 'settle')).toBe(0);
      expect(ok(r, 'unsettled')).toEqual([{ kind: 'lapsed_hold', settled: false, counted: null }]);
      // The bank paid after all: revived, or refunded slot_lost; either way the strike goes (R65).
      expect(['succeeded', 'refund_pending']).toContain(
        (ok(r, 'late') as { status: string }).status,
      );
      expect(ok(r, 'after')).toEqual([]);
      expect(ok(r, 'settle2')).toBe(0);
      expect(ok(r, 'standing')).toEqual(ok(r, 'before'));
      expect(ok(r, 'settle3')).toBe(0);
      expect(ok(r, 'stale')).toEqual([{ kind: 'lapsed_hold', settled: true, counted: false }]);
    });
  },
);

describe.skipIf(!docker)(
  'coaching 0295: the sweep releases stale holds, starts missed refunds, ends empty items (DB-39..DB-41)',
  () => {
    it('DB-39: a pending hold of a lesson no longer held (a release SKIP LOCKED missed) is expired; a held one is left', () => {
      const r = scenario('cf295-e', [
        PLANT,
        PRIVATE_TYPE,
        COURT('court1'),
        ...COACH('ca'),
        ...COACH('cb'),
        GUEST('g'),
        GUEST('g2'),
        // Cancelled while another transaction held its hold row: the row stayed pending.
        ...HELD_PRIVATE('lx', 'ca', 'g', `${NOW_H} + interval '30 hours'`),
        X(`update lessons set status = 'cancelled', cancel_reason = 'guest_cancel', cancelled_at = now(),
                hold_expires_at = null where id = {{lx}}`),
        X(`update lesson_enrolments set status = 'cancelled', cancel_kind = 'guest_free', cancelled_at = now(),
                hold_expires_at = null where id = {{lx_e}}`),
        // Still held inside its window: its hold is live.
        ...HELD_PRIVATE('lh', 'cb', 'g2', `${NOW_H} + interval '34 hours'`),
        E('run', `select app.lesson_sweep()`),
        Q('x_hold', `select to_jsonb(status) from reservations where id = {{lx_hold}}`),
        Q('h_hold', `select to_jsonb(status) from reservations where id = {{lh_hold}}`),
        E('run2', `select app.lesson_sweep()`),
      ]);
      const run = ok<Record<string, number>>(r, 'run');
      expect(run.errors).toBe(0);
      expect(run.holds_released).toBeGreaterThanOrEqual(1);
      expect(ok(r, 'x_hold')).toBe('expired');
      expect(ok(r, 'h_hold')).toBe('pending');
      expect(ok<Record<string, number>>(r, 'run2').errors).toBe(0);
    });

    it('DB-40: a refund a cancel never started goes out on the next sweep, with no other payment open', () => {
      const r = scenario('cf295-f', [
        PLANT,
        GROUP_TYPE,
        ...COACH('ca'),
        GUEST('g'),
        GROUP('lg', 'ca', `${NOW_H} + interval '3 days'`, `${NOW_H} + interval '2 days'`),
        KEEP(
          'eg',
          `select pg_temp.genrol({{g}}, jsonb_build_object('lesson_id', {{lg}}, 'price_iqd', 15000))`,
        ),
        KEEP('pay', `select pg_temp.paid({{eg}})`),
        // A cancel that wrote its statuses but never reached the refund.
        X(`update lesson_enrolments set status = 'cancelled', cancel_kind = 'staff', cancelled_at = now()
          where id = {{eg}}`),
        E('run', `select app.lesson_sweep()`),
        Q(
          'p',
          `select jsonb_build_object('status', status, 'reason', refund_reason, 'amount', refund_amount_iqd)
           from booking_payments where id = {{pay}}`,
        ),
        E('run2', `select app.lesson_sweep()`),
        Q(
          'refunded_events',
          `select to_jsonb(count(*)) from lesson_events where enrolment_id = {{eg}} and type = 'refunded'`,
        ),
      ]);
      const run = ok<Record<string, number>>(r, 'run');
      expect(run.errors).toBe(0);
      expect(run.refunds_started).toBeGreaterThanOrEqual(1);
      expect(ok(r, 'p')).toEqual({
        status: 'refund_pending',
        reason: 'staff_cancel',
        amount: 15000,
      });
      // Started once.
      expect(ok<Record<string, number>>(r, 'run2').errors).toBe(0);
      expect(ok(r, 'refunded_events')).toBe(1);
    });

    it('DB-41 (D4): an empty group or course at a zero cut-off is cancelled when judged late, its courts freed; one with a place runs', () => {
      const r = scenario('cf295-g', [
        PLANT,
        COURT('court1'),
        COURT('court2'),
        KEEP(
          'lt_g0',
          `select pg_temp.ltype('{"kind":"group","name_en":"Group 0","max_places":4,
        "min_places":1,"cutoff_hours":0,"price_iqd":15000}'::jsonb)`,
        ),
        KEEP(
          'lt_c0',
          `select pg_temp.ltype('{"kind":"course","name_en":"Course 0","max_places":8,
        "min_places":1,"cutoff_hours":0,"price_iqd":100001,"sessions_count":4,"court_share_iqd":8000}'::jsonb)`,
        ),
        ...COACH('ca'),
        ...COACH('cb'),
        ...COACH('cc'),
        GUEST('s1'),
        // Empty, started five minutes ago, its cut-off at its start (cutoff_hours 0).
        KEEP(
          'le',
          `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{ca}},
        'lesson_type_id', {{lt_g0}}, 'price_iqd', 15000, 'max_places', 4, 'min_places', 1,
        'start_at', now() - interval '5 minutes', 'end_at', now() + interval '55 minutes',
        'cutoff_at', now() - interval '5 minutes'))`,
        ),
        KEEP('re', `select pg_temp.courtrow({{le}}, {{court1}})`),
        // The same with one booked place: it runs.
        KEEP(
          'lf',
          `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{cb}},
        'lesson_type_id', {{lt_g0}}, 'price_iqd', 15000, 'max_places', 4, 'min_places', 1,
        'start_at', now() - interval '5 minutes', 'end_at', now() + interval '55 minutes',
        'cutoff_at', now() - interval '5 minutes'))`,
        ),
        KEEP(
          'ef',
          `select pg_temp.genrol({{s1}}, jsonb_build_object('lesson_id', {{lf}}, 'price_iqd', 15000))`,
        ),
        // An empty course whose session 1 began five minutes ago, its cut-off at that start.
        KEEP(
          'k',
          `select pg_temp.ins('courses', jsonb_build_object('venue_id', {{venue}}, 'coach_id', {{cc}},
        'lesson_type_id', {{lt_c0}}, 'price_iqd', 100001, 'court_share_iqd', 8000, 'coach_share_bp', 6000,
        'sessions_count', 4, 'max_places', 8, 'min_places', 1, 'cutoff_at', now() - interval '5 minutes',
        'signup_closes_at', now() + interval '21 days', 'created_by_kind', 'staff',
        'created_by_staff_id', {{desk}}))`,
        ),
        ...[1, 2, 3, 4].map((n) =>
          KEEP(
            `k_s${n}`,
            `select pg_temp.lesson(jsonb_build_object('kind', 'course', 'coach_id', {{cc}},
          'lesson_type_id', {{lt_c0}}, 'course_id', {{k}}, 'session_no', ${n}, 'price_iqd', null,
          'court_share_iqd', 8000, 'max_places', 8, 'min_places', 1, 'cutoff_at', now() - interval '5 minutes',
          'start_at', now() - interval '5 minutes' + interval '${(n - 1) * 7} days',
          'end_at', now() + interval '55 minutes' + interval '${(n - 1) * 7} days'))`,
          ),
        ),
        KEEP('rk1', `select pg_temp.courtrow({{k_s1}}, {{court2}})`),
        KEEP('rk2', `select pg_temp.courtrow({{k_s2}}, {{court2}})`),
        E('run', `select app.lesson_sweep()`),
        LESSON('e', 'le'),
        LESSON('f', 'lf'),
        COURSE('k', 'k'),
        LESSON('k1', 'k_s1'),
        LESSON('k4', 'k_s4'),
        Q(
          'rows',
          `select jsonb_object_agg(id::text, status) from reservations
          where id in ({{re}}, {{rk1}}, {{rk2}})`,
        ),
      ]);
      expect(ok<Record<string, number>>(r, 'run').errors).toBe(0);
      expect(ok(r, 'e')).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'under_filled',
        checked: true,
      });
      expect(ok(r, 'f')).toMatchObject({ status: 'scheduled', checked: true });
      expect(ok(r, 'k')).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'under_filled',
        checked: true,
      });
      expect(ok(r, 'k1')).toMatchObject({ status: 'cancelled', cancel_reason: 'under_filled' });
      expect(ok(r, 'k4')).toMatchObject({ status: 'cancelled', cancel_reason: 'under_filled' });
      expect(Object.values(ok<Record<string, string>>(r, 'rows'))).toEqual([
        'cancelled',
        'cancelled',
        'cancelled',
      ]);
    });
  },
);

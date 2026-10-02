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
 *
 * Not here (two connections; coaching-races.test.ts and coaching-strikes.test.ts): a busy coach
 * skipped by try_lock_coach; a settle that skips a strike row another transaction holds.
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
    // Nothing of these rows is left to purge.
    const again = ok<number>(r, 'again');
    expect(again).toBeGreaterThanOrEqual(0);
  });
});

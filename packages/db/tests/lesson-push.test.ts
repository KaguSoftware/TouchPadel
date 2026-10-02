/**
 * 0283, lane Guest: the lesson push family in the database (docs/design/
 * coaching/guest.md §4.5; build contracts §1.9, R18, R40, R44, R78, CD-7,
 * C-21).
 *
 *   * c_keys (in app.lesson_notify's body) equals the lesson subset of
 *     _shared/guest-push.json (the guest-push.test.ts pattern);
 *   * app.lesson_notify: each INVALID_ARGUMENT, the closed payload, the one
 *     recipient per route (a student, a walk-in -> 0, an unconfirmed link
 *     only for lesson.added_by_coach, due now() + 5 s and not nudged, the
 *     lesson's coach, the statement's coach), the actor skipped and a
 *     reminder not, deleted and tokenless profiles skipped, the dedupe inside
 *     and outside 15 minutes, the kind from the key, a failing insert that
 *     returns 0 while the caller goes on, send-push nudged only for rows due
 *     now;
 *   * the fan-out (lesson_events_notify, R40): every row of the guest.md
 *     §4.5.4 table driven through the real RPCs of 0283 (and the internals the
 *     sweep calls), each queuing exactly its keys to exactly its recipients,
 *     the silent rows queuing nothing, the three traces (a guest cancels a
 *     private lesson; the desk cancels one; an under-filled course), and
 *     Money's paid_online and expired events planted the way 0284 writes
 *     them (0284 appends its own cases through its real bodies);
 *   * no name and no amount in any queued payload (CD-7);
 *   * reminders (the deferred triggers, R78): a booked private lesson queues
 *     one at start - 3 h; a course enrolment one per covered scheduled
 *     session; a reschedule moves them; a cancel clears them; a lesson inside
 *     3 hours gets none; a held place gets none until booked; an unconfirmed
 *     link gets none until "Yes", and "Not me" leaves none; one sync per
 *     session per flush (F21).
 *
 * The reminder triggers are deferred to commit. A rolled-back scenario never
 * commits, so it flushes them with SET CONSTRAINTS ... IMMEDIATE (then
 * DEFERRED again) at the end of each step, which is what a commit does.
 * Between steps CLEAR moves the queued rows aside, so a case reads only its
 * own pushes (and the 15-minute dedupe starts afresh).
 */
import { describe, expect, it } from 'vitest';
import guestPush from '../supabase/functions/_shared/guest-push.json';
import { stackAvailable } from './helpers';
import { Q, X, dockerReachable, psql, scenario, type Results } from './stores-harness';
import { E, GUEST, SETUP, data, failed } from './matches-harness';
import { COACH_SETUP, KEPT, LT, randomPhone } from './coaching-read-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const LESSON_KINDS = ['lesson_update', 'lesson_reminder', 'coach_update'];
const LESSON_KEYS = Object.fromEntries(
  Object.entries(guestPush.title_keys as Record<string, string>).filter(([, kind]) =>
    LESSON_KINDS.includes(kind),
  ),
);

const PUSH = '{"push":"ExponentPushToken[c280]"}';
const PLAYER = (name: string) => GUEST(name, PUSH);

const TRIGGERS =
  'lessons_reminders, lesson_enrolments_reminders_ins, lesson_enrolments_reminders_upd';
/** What a commit does to the deferred reminder triggers. */
const FLUSH = `set constraints ${TRIGGERS} immediate; set constraints ${TRIGGERS} deferred;`;

/**
 * The lesson-family rows queued for the scenario's people, as
 * "who:key#ref[@lesson][[taken/total]]", sorted; reminders as
 * "who@lesson:minutes before its start"; CLEAR moves the queued rows into
 * pg_temp.seen (for the CD-7 scan) and deletes them.
 */
const PUSHES = String.raw`
create temp table seen (kind text, payload jsonb);
create temp table nudges (n int);
create function pg_temp.nm(p text) returns text language sql as $f$
  select coalesce((select v.name from pg_temp.vars v where v.val = p order by length(v.name), v.name limit 1), p)
$f$;
create function pg_temp.pushes() returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb) from (
    select pg_temp.nm(o.profile_id::text) || ':' || (o.payload->>'title_key')
           || '#' || pg_temp.nm(o.payload->>'id')
           || coalesce('@' || pg_temp.nm(o.payload->'params'->>'lesson_id'), '')
           || coalesce('[' || (o.payload->'params'->>'places_taken') || '/'
                           || (o.payload->'params'->>'places_total') || ']', '') as t
      from notification_outbox o
     where o.kind in ('lesson_update', 'coach_update')
       and o.profile_id in (select id from pg_temp.guests)) x
$f$;
create function pg_temp.reminders(p_like text default '%') returns jsonb language sql as $f$
  select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb) from (
    select pg_temp.nm(o.profile_id::text) || '@' || pg_temp.nm(o.payload->'params'->>'lesson_id') || ':'
           || (extract(epoch from (l.start_at - o.scheduled_for)) / 60)::int as t
      from notification_outbox o
      join lessons l on l.id::text = o.payload->'params'->>'lesson_id'
     where o.kind = 'lesson_reminder'
       and o.sent_at is null
       and o.profile_id in (select id from pg_temp.guests)
       and pg_temp.nm(o.payload->'params'->>'lesson_id') like p_like) x
$f$;
create function pg_temp.clear() returns void language plpgsql as $f$
begin
  insert into pg_temp.seen
  select o.kind, o.payload from notification_outbox o
   where o.kind in ('lesson_update', 'coach_update', 'lesson_reminder')
     and o.profile_id in (select id from pg_temp.guests);
  delete from notification_outbox o
   where o.kind in ('lesson_update', 'coach_update')
     and o.profile_id in (select id from pg_temp.guests);
end $f$;
`;
const P = (label: string) => Q(label, `select pg_temp.pushes()`);
const REM = (label: string, like = '%') => Q(label, `select pg_temp.reminders('${like}')`);
const CLEAR = `select pg_temp.clear();`;
/** Send-push nudges are counted by a stand-in (the guest-push.test.ts way). */
const NUDGE_STUB = X(`create or replace function app.push_nudge() returns void language sql
                      as 'insert into pg_temp.nudges values (1)'`);
const NUDGES = (label: string) => Q(label, `select to_jsonb(count(*)) from pg_temp.nudges`);
const list = (r: Results, label: string) => [...data<string[]>(r, label)].sort();

describe.skipIf(!docker)(
  'c_keys in app.lesson_notify is the lesson subset of _shared/guest-push.json',
  () => {
    it('parses to the same key -> kind map as the three lesson kinds’ keys', () => {
      const def = psql(
        `select pg_get_functiondef('app.lesson_notify(uuid,text,text,jsonb)'::regprocedure)`,
      );
      const m = def.match(/c_keys constant jsonb := '(\{[\s\S]*?\})';/);
      expect(m).not.toBeNull();
      expect(JSON.parse(m![1]!)).toEqual(LESSON_KEYS);
      expect(Object.keys(LESSON_KEYS)).toHaveLength(18);
      expect(new Set(Object.values(LESSON_KEYS))).toEqual(new Set(LESSON_KINDS));
    });
  },
);

describe.skipIf(!docker)('app.lesson_notify (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('c280n', [
      SETUP,
      COACH_SETUP,
      PUSHES,
      `select pg_temp.cbranch();`,
      `select pg_temp.coach('ca');`,
      PLAYER('st'),
      GUEST('notoken'),
      PLAYER('gone'),
      PLAYER('pend'),
      X(`update profiles set deleted_at = now() where id = {{gone}}`),
      X(`select pg_temp.plant_lesson('L', jsonb_build_object('coach', 'co_ca', 'kind', 'private', 'court', 'c1',
                                                             'booked_by', 'guest', 'by', 'st', 'start', ${LT(2, 10)}))`),
      X(`select pg_temp.plant_enrolment('eS', '{"lesson": "L", "guest": "st"}'::jsonb)`),
      X(`select pg_temp.plant_lesson('G', jsonb_build_object('coach', 'co_ca', 'kind', 'group', 'court', 'c2',
                                                             'start', ${LT(2, 12)}))`),
      X(`select pg_temp.plant_enrolment('eP', '{"lesson": "G", "guest": "pend", "booked_by": "coach", "linked": false,
                                               "name": "Typed P", "price": 15000}'::jsonb)`),
      X(`select pg_temp.plant_enrolment('eW', '{"lesson": "G", "booked_by": "coach", "name": "Walk W",
                                               "price": 15000}'::jsonb)`),
      X(
        `select pg_temp.plant_enrolment('eN', '{"lesson": "G", "guest": "notoken", "price": 15000}'::jsonb)`,
      ),
      X(
        `select pg_temp.plant_enrolment('eD', '{"lesson": "G", "guest": "gone", "price": 15000}'::jsonb)`,
      ),
      // A lesson starting in two hours: its reminder would be in the past.
      X(`select pg_temp.plant_lesson('Lnear', jsonb_build_object('coach', 'co_ca', 'kind', 'private', 'court', 'c3',
                                                                 'booked_by', 'guest', 'by', 'st',
                                                                 'start', date_trunc('minute', now()) + interval '2 hours'))`),
      X(`select pg_temp.plant_enrolment('eNear', '{"lesson": "Lnear", "guest": "st"}'::jsonb)`),
      X(`insert into coach_statements (coach_id, venue_id, month)
         values ({{co_ca}}, {{v}}, date_trunc('month', now())::date - interval '1 month')`),
      `select pg_temp.keep('stm', $q$select id::text from coach_statements where coach_id = {{co_ca}}$q$);`,
      NUDGE_STUB,

      E('bad_key', null, `select to_jsonb(app.lesson_notify({{eS}}, 'nope'))`),
      E('bad_ref', null, `select to_jsonb(app.lesson_notify(null, 'coach.new_student'))`),
      E(
        'bad_array',
        null,
        `select to_jsonb(app.lesson_notify({{L}}, 'coach.new_student', null, '[1]'))`,
      ),
      E(
        'bad_key_param',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.booked', null,
                                  jsonb_build_object('lesson_id', {{L}}::text, 'name', 'x')))`,
      ),
      E(
        'bad_lesson_id',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.booked', null, '{"lesson_id": "nope"}'))`,
      ),
      E(
        'bad_places',
        null,
        `select to_jsonb(app.lesson_notify({{L}}, 'coach.new_student', null, '{"places_taken": 65}'))`,
      ),
      E(
        'bad_fraction',
        null,
        `select to_jsonb(app.lesson_notify({{L}}, 'coach.new_student', null, '{"places_taken": 1.5}'))`,
      ),
      E(
        'bad_text',
        null,
        `select to_jsonb(app.lesson_notify({{L}}, 'coach.new_student', null, '{"places_taken": "3"}'))`,
      ),
      E(
        'bad_amount',
        null,
        `select to_jsonb(app.lesson_notify({{L}}, 'coach.new_student', null, '{"amount_iqd": 30000}'))`,
      ),
      E('no_lesson_id', null, `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.booked'))`),

      E(
        'student',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.booked', 'd1',
                            jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      Q(
        'student_row',
        `select jsonb_build_object('kind', o.kind, 'payload', o.payload, 'now', o.scheduled_for = now())
                          from notification_outbox o where o.payload->>'dedupe' = 'd1'`,
      ),
      E(
        'deduped',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.booked', 'd1',
                            jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      X(`insert into notification_outbox (profile_id, kind, payload, created_at)
         values ({{st}}, 'lesson_update', '{"dedupe": "d2"}', now() - interval '16 minutes')`),
      E(
        'outside_window',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.cancelled_by_coach', 'd2',
                                   jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      E(
        'walkin',
        null,
        `select to_jsonb(app.lesson_notify({{eW}}, 'lesson.booked', null,
                           jsonb_build_object('lesson_id', {{G}}::text)))`,
      ),
      E(
        'pending_booked',
        null,
        `select to_jsonb(app.lesson_notify({{eP}}, 'lesson.booked', null,
                                   jsonb_build_object('lesson_id', {{G}}::text)))`,
      ),
      NUDGES('nudges_before_added'),
      E(
        'pending_added',
        null,
        `select to_jsonb(app.lesson_notify({{eP}}, 'lesson.added_by_coach', 'd4',
                                  jsonb_build_object('lesson_id', {{G}}::text)))`,
      ),
      Q(
        'pending_added_row',
        `select jsonb_build_object('kind', o.kind, 'due5', o.scheduled_for = now() + interval '5 seconds')
                                from notification_outbox o where o.payload->>'dedupe' = 'd4'`,
      ),
      NUDGES('nudges_after_added'),
      E(
        'student_added',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.added_by_coach', null,
                                  jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      E(
        'notoken',
        null,
        `select to_jsonb(app.lesson_notify({{eN}}, 'lesson.booked', null,
                            jsonb_build_object('lesson_id', {{G}}::text)))`,
      ),
      E(
        'gone',
        null,
        `select to_jsonb(app.lesson_notify({{eD}}, 'lesson.booked', null,
                         jsonb_build_object('lesson_id', {{G}}::text)))`,
      ),
      E(
        'coach',
        null,
        `select to_jsonb(app.lesson_notify({{G}}, 'coach.new_student', 'd5',
                          '{"places_taken": 1, "places_total": 4}'))`,
      ),
      Q(
        'coach_row',
        `select jsonb_build_object('who', pg_temp.nm(o.profile_id::text), 'kind', o.kind,
                                                'payload', o.payload)
                        from notification_outbox o where o.payload->>'dedupe' = 'd5'`,
      ),
      E('actor_skip', 'ca', `select to_jsonb(app.lesson_notify({{G}}, 'coach.court_moved', 'd6'))`),
      E(
        'reminder_self',
        'st',
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.reminder', null,
                                  jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      Q(
        'reminder_row',
        `select jsonb_build_object('kind', o.kind, 'at_3h', o.scheduled_for = l.start_at - interval '3 hours')
                           from notification_outbox o join lessons l on l.id = {{L}}
                          where o.profile_id = {{st}} and o.payload->>'title_key' = 'lesson.reminder'`,
      ),
      E(
        'reminder_past',
        null,
        `select to_jsonb(app.lesson_notify({{eNear}}, 'lesson.reminder', null,
                                  jsonb_build_object('lesson_id', {{Lnear}}::text)))`,
      ),
      E(
        'statement',
        null,
        `select to_jsonb(app.lesson_notify({{stm}}, 'coach.statement_ready', 'd7'))`,
      ),
      Q(
        'statement_row',
        `select jsonb_build_object('who', pg_temp.nm(o.profile_id::text), 'kind', o.kind,
                                                    'route', o.payload->>'route', 'id', o.payload->>'id')
                            from notification_outbox o where o.payload->>'dedupe' = 'd7'`,
      ),
      E(
        'unknown_ref',
        null,
        `select to_jsonb(app.lesson_notify('00000000-0000-4000-8000-0000000c2803', 'coach.new_student'))`,
      ),
      NUDGES('nudges_before_failure'),
      X(
        `create function pg_temp.boom() returns trigger language plpgsql as $b$ begin raise exception 'boom'; end $b$`,
      ),
      X(
        `create trigger zz_c280_boom before insert on notification_outbox for each row execute function pg_temp.boom()`,
      ),
      E(
        'failing',
        null,
        `select to_jsonb(app.lesson_notify({{eS}}, 'lesson.under_filled', 'd8',
                            jsonb_build_object('lesson_id', {{L}}::text)))`,
      ),
      X(`drop trigger zz_c280_boom on notification_outbox`),
      Q(
        'after_failure',
        `select to_jsonb(count(*)) from notification_outbox where payload->>'dedupe' = 'd8'`,
      ),
      Q('ids', `select jsonb_object_agg(name, val) from pg_temp.vars`),
    ]);
  });

  it('refuses a bad call where a test can see it', () => {
    expect(failed(r, 'bad_key')).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'title_key' });
    expect(failed(r, 'bad_ref')).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'p_ref' });
    for (const label of [
      'bad_array',
      'bad_key_param',
      'bad_lesson_id',
      'bad_places',
      'bad_fraction',
      'bad_text',
      'bad_amount',
      'no_lesson_id',
    ]) {
      expect(failed(r, label), label).toMatchObject({ code: 'INVALID_ARGUMENT', hint: 'params' });
    }
  });

  it('queues the closed payload to a student, due now, and dedupes for 15 minutes', () => {
    const ids = data<Record<string, string>>(r, 'ids');
    expect(data(r, 'student')).toBe(1);
    expect(data(r, 'student_row')).toEqual({
      kind: 'lesson_update',
      now: true,
      payload: {
        route: 'lesson',
        id: ids.eS,
        title_key: 'lesson.booked',
        params: { lesson_id: ids.L },
        dedupe: 'd1',
      },
    });
    expect(data(r, 'deduped')).toBe(0);
    expect(data(r, 'outside_window')).toBe(1);
  });

  it('finds the one recipient by the route: a walk-in, an unconfirmed link, the coach, the statement', () => {
    const ids = data<Record<string, string>>(r, 'ids');
    expect(data(r, 'walkin')).toBe(0);
    // C-21: an unconfirmed link hears only "is this you?", five seconds later, with no nudge.
    expect(data(r, 'pending_booked')).toBe(0);
    expect(data(r, 'pending_added')).toBe(1);
    expect(data(r, 'pending_added_row')).toEqual({ kind: 'lesson_update', due5: true });
    expect(data(r, 'nudges_after_added')).toBe(data(r, 'nudges_before_added'));
    expect(data(r, 'student_added')).toBe(0);
    expect(data(r, 'notoken')).toBe(0);
    expect(data(r, 'gone')).toBe(0);
    expect(data(r, 'coach')).toBe(1);
    expect(data(r, 'coach_row')).toEqual({
      who: 'ca',
      kind: 'coach_update',
      payload: {
        route: 'coach_lesson',
        id: ids.G,
        title_key: 'coach.new_student',
        params: { places_taken: 1, places_total: 4 },
        dedupe: 'd5',
      },
    });
    expect(data(r, 'statement')).toBe(1);
    expect(data(r, 'statement_row')).toEqual({
      who: 'ca',
      kind: 'coach_update',
      route: 'coach_statements',
      id: ids.stm,
    });
    expect(data(r, 'unknown_ref')).toBe(0);
  });

  it('skips the actor but never for a reminder; a reminder in the past is not queued', () => {
    expect(data(r, 'actor_skip')).toBe(0);
    expect(data(r, 'reminder_self')).toBe(1);
    expect(data(r, 'reminder_row')).toEqual({ kind: 'lesson_reminder', at_3h: true });
    expect(data(r, 'reminder_past')).toBe(0);
  });

  it('nudges send-push only for rows due now; a failing insert returns 0 and never fails its caller', () => {
    // student, outside_window, coach, statement: due now. The link push and
    // the reminder wait for the sweep.
    expect(data(r, 'nudges_before_failure')).toBe(4);
    expect(data(r, 'failing')).toBe(0);
    expect(data(r, 'after_failure')).toBe(0);
  });
});

describe.skipIf(!docker)(
  'the fan-out, every mapping row through the real transitions (rolled back)',
  () => {
    let r: Results;
    const MX = randomPhone(); // verified on mx's account: a coach's typed phone matches it
    const MY2 = randomPhone(); // verified on my2's account: "Not me"
    const WALKIN = randomPhone(); // nobody's

    it('runs the scenario', () => {
      const guests = [
        'g1',
        'g2',
        'g3',
        'g4',
        'g5',
        'g6',
        'g7',
        'g8',
        'g9',
        'g10',
        'g11',
        'g12',
        'g13',
        'g14',
        'g15',
        'g16',
        'mx',
        'my2',
      ];
      r = scenario('c280f', [
        SETUP,
        COACH_SETUP,
        PUSHES,
        `select pg_temp.cbranch();`,
        `select pg_temp.coach('ca');`,
        `select pg_temp.coach('cb');`,
        ...guests.map(PLAYER),
        X(
          `update auth.users set phone = '${MX.slice(1)}', phone_confirmed_at = now() where id = {{mx}}`,
        ),
        X(
          `update auth.users set phone = '${MY2.slice(1)}', phone_confirmed_at = now() where id = {{my2}}`,
        ),
        NUDGE_STUB,

        // ── A: a guest books a private lesson at the desk price, then cancels it
        // (trace 1: the lesson's cancelled is silent; enrolment_cancelled,
        // guest_free from booked, tells the coach).
        E(
          'a',
          'g1',
          `select app.lesson_book_private({{co_ca}}, {{tp}}, ${LT(2, 10)}, 1, '{}'::text[], 'desk', 30000, 'c280-a')`,
        ),
        KEPT('A', 'a', 'lesson_id'),
        KEPT('eA', 'a', 'enrolment_id'),
        P('a_pushes'),
        FLUSH,
        REM('a_rem', 'A'),
        CLEAR,
        E('a2', 'g1', `select app.lesson_cancel_mine({{eA}})`),
        P('a2_pushes'),
        FLUSH,
        REM('a2_rem', 'A'),
        CLEAR,

        // ── B: the desk books a private lesson for a picked customer (a student
        // at once), then cancels the lesson (trace 2).
        E(
          'b',
          'desk',
          `select app.desk_book_lesson({{co_ca}}, {{tp}}, ${LT(2, 12)}, {{g2}}, null, null, 1, 'c280-b')`,
        ),
        KEPT('B', 'b', 'lesson_id'),
        KEPT('eB', 'b', 'enrolment_id'),
        P('b_pushes'),
        FLUSH,
        REM('b_rem', 'B'),
        CLEAR,
        E('b2', 'desk', `select app.desk_cancel_lesson({{B}}, 'customer_request')`),
        P('b2_pushes'),
        FLUSH,
        REM('b2_rem', 'B'),
        CLEAR,

        // ── C: the coach books for typed phones: one matches mx (pending, C-21),
        // who says yes; one matches nobody; one matches my2, who says "Not me".
        NUDGES('c_nudges_before'),
        E(
          'c',
          'ca',
          `select app.coach_book_private({{tp}}, {{v}}, ${LT(2, 14)}, 'Typed Student', '${MX}', 1, 'c280-c')`,
        ),
        KEPT('C', 'c', 'lesson_id'),
        KEPT('eC', 'c', 'enrolment_id'),
        P('c_pushes'),
        NUDGES('c_nudges_after'),
        Q(
          'c_due',
          `select jsonb_agg(o.scheduled_for = now() + interval '5 seconds')
                    from notification_outbox o
                   where o.profile_id = {{mx}} and o.payload->>'title_key' = 'lesson.added_by_coach'`,
        ),
        FLUSH,
        REM('c_rem', 'C'),
        CLEAR,
        E('c2', 'mx', `select app.lesson_link_confirm({{eC}}, true)`),
        P('c2_pushes'),
        FLUSH,
        REM('c2_rem', 'C'),
        CLEAR,
        E(
          'c3',
          'ca',
          `select app.coach_book_private({{tp}}, {{v}}, ${LT(2, 16)}, 'Walk In', '${WALKIN}', 1, 'c280-c3')`,
        ),
        P('c3_pushes'),
        CLEAR,
        E(
          'c4',
          'ca',
          `select app.coach_book_private({{tp}}, {{v}}, ${LT(2, 18)}, 'Typed Two', '${MY2}', 1, 'c280-c4')`,
        ),
        KEPT('C4', 'c4', 'lesson_id'),
        KEPT('eC4', 'c4', 'enrolment_id'),
        P('c4_pushes'),
        CLEAR,
        E('c5', 'my2', `select app.lesson_link_confirm({{eC4}}, false)`),
        P('c5_pushes'),
        FLUSH,
        REM('c5_rem', 'C%'),
        CLEAR,

        // ── D: a group session the desk schedules for the coach; joins and adds;
        // the desk and the coach move it; the desk changes its court; a desk
        // removal, a coach removal; the coach cancels it.
        E('d', 'desk', `select app.desk_create_group({{co_ca}}, {{tg}}, ${LT(3, 10)}, 'c280-d')`),
        KEPT('G1', 'd', 'lesson_id'),
        P('d_pushes'),
        CLEAR,
        E('d0', 'ca', `select app.coach_create_group({{tg}}, {{v}}, ${LT(3, 16)}, 'c280-d0')`),
        KEPT('G0', 'd0', 'lesson_id'),
        P('d0_pushes'),
        CLEAR,
        E('d1', 'g3', `select app.lesson_join({{G1}}, 'desk', 15000, 'c280-d1')`),
        KEPT('e3', 'd1', 'enrolment_id'),
        P('d1_pushes'),
        CLEAR,
        E('d2', 'desk', `select app.desk_add_student({{G1}}, null, {{g4}}, null, null, 'c280-d2')`),
        KEPT('e4', 'd2', 'enrolment_id'),
        P('d2_pushes'),
        CLEAR,
        E(
          'd3',
          'ca',
          `select app.coach_add_student({{G1}}, null, 'Walkie Typed', null, 'c280-d3')`,
        ),
        P('d3_pushes'),
        CLEAR,
        FLUSH,
        REM('d_rem', 'G1'),
        E('d4', 'desk', `select app.desk_reschedule_session({{G1}}, ${LT(3, 12)})`),
        P('d4_pushes'),
        FLUSH,
        REM('d4_rem', 'G1'),
        CLEAR,
        E('d5', 'ca', `select app.coach_reschedule_session({{G1}}, ${LT(3, 14)})`),
        P('d5_pushes'),
        CLEAR,
        E(
          'd6',
          'desk',
          `select app.desk_move_lesson_court({{G1}},
                         (select c.id from courts c
                           where c.venue_id = {{v}}
                             and c.id <> (select x.court_id from reservations x
                                           where x.lesson_id = {{G1}} and x.status in ('pending', 'confirmed', 'arrived'))
                           order by c.sort_order limit 1))`,
        ),
        P('d6_pushes'),
        CLEAR,
        E('d7', 'desk', `select app.desk_cancel_enrolment({{e4}}, 'customer_request')`),
        P('d7_pushes'),
        CLEAR,
        E('d8', 'ca', `select app.coach_remove_student({{e3}}, 'other')`),
        P('d8_pushes'),
        CLEAR,
        E('d9', 'g5', `select app.lesson_join({{G1}}, 'desk', 15000, 'c280-d9')`),
        KEPT('e5', 'd9', 'enrolment_id'),
        P('d9_pushes'),
        CLEAR,
        E('d10', 'ca', `select app.coach_cancel_lesson({{G1}}, 'coach_unavailable')`),
        P('d10_pushes'),
        FLUSH,
        REM('d10_rem', 'G1'),
        CLEAR,

        // ── E: a coach's group session under-filled at its cut-off (the
        // internal the sweep calls); a late judgement cancels nothing and tells
        // nobody (R26).
        E('e', 'ca', `select app.coach_create_group({{tg}}, {{v}}, ${LT(3, 18)}, 'c280-e')`),
        KEPT('G2', 'e', 'lesson_id'),
        E('e1', 'g6', `select app.lesson_join({{G2}}, 'desk', 15000, 'c280-e1')`),
        KEPT('e6', 'e1', 'enrolment_id'),
        CLEAR,
        E(
          'e2',
          null,
          `select app.lesson_cancel_internal({{G2}}, 'under_filled', 'system', null, null)`,
        ),
        P('e2_pushes'),
        CLEAR,
        X(`insert into lesson_events (venue_id, lesson_id, type, actor, data)
         values ({{v}}, {{G0}}, 'under_filled', 'system', '{"late": true, "places_taken": 0, "min_places": 2}')`),
        P('e3_pushes'),
        CLEAR,

        // ── F: a course the desk schedules; two join; the desk moves session 2;
        // one leaves; the desk cancels the course.
        E(
          'f',
          'desk',
          `select app.desk_create_course({{co_ca}}, {{tc}},
                        array[${LT(4, 10)}, ${LT(5, 10)}, ${LT(6, 10)}, ${LT(7, 10)}]::timestamptz[],
                        'C280 course', 'دورة', 'c280-f')`,
        ),
        KEPT('K1', 'f', 'course_id'),
        KEPT('S1', 'f', 'lesson_ids,0'),
        KEPT('S2', 'f', 'lesson_ids,1'),
        KEPT('S3', 'f', 'lesson_ids,2'),
        KEPT('S4', 'f', 'lesson_ids,3'),
        P('f_pushes'),
        CLEAR,
        E('f1', 'g7', `select app.course_join({{K1}}, 'desk', 60000, 'c280-f1')`),
        KEPT('e7', 'f1', 'enrolment_id'),
        P('f1_pushes'),
        CLEAR,
        E('f2', 'g8', `select app.course_join({{K1}}, 'desk', 60000, 'c280-f2')`),
        KEPT('e8', 'f2', 'enrolment_id'),
        P('f2_pushes'),
        CLEAR,
        FLUSH,
        REM('f_rem', 'S_'),
        E('f3', 'desk', `select app.desk_reschedule_session({{S2}}, ${LT(5, 12)})`),
        P('f3_pushes'),
        CLEAR,
        E('f4', 'g8', `select app.lesson_cancel_mine({{e8}})`),
        P('f4_pushes'),
        FLUSH,
        REM('f4_rem', 'S_'),
        CLEAR,
        E('f5', 'desk', `select app.desk_cancel_course({{K1}}, 'court_needed')`),
        P('f5_pushes'),
        FLUSH,
        REM('f5_rem', 'S_'),
        CLEAR,

        // ── G: a course the coach schedules, under-filled (trace 3: the
        // sessions' events are silent, the course's tells the coach once).
        E(
          'gc',
          'ca',
          `select app.coach_create_course({{tc}}, {{v}},
                       array[${LT(4, 14)}, ${LT(5, 14)}, ${LT(6, 14)}, ${LT(7, 14)}]::timestamptz[], '', '', 'c280-g')`,
        ),
        KEPT('K2', 'gc', 'course_id'),
        KEPT('T1', 'gc', 'lesson_ids,0'),
        P('g_pushes'),
        CLEAR,
        E('gj', 'g9', `select app.course_join({{K2}}, 'desk', 60000, 'c280-g1')`),
        KEPT('e9', 'gj', 'enrolment_id'),
        CLEAR,
        E(
          'gu',
          null,
          `select app.course_cancel_internal({{K2}}, 'under_filled', 'system', null, null)`,
        ),
        P('g2_pushes'),
        CLEAR,

        // ── H: the coach cancels the rest of a course.
        E(
          'h',
          'ca',
          `select app.coach_create_course({{tc}}, {{v}},
                       array[${LT(4, 16)}, ${LT(5, 16)}, ${LT(6, 16)}, ${LT(7, 16)}]::timestamptz[], '', '', 'c280-h')`,
        ),
        KEPT('K3', 'h', 'course_id'),
        KEPT('U1', 'h', 'lesson_ids,0'),
        E('h1', 'g10', `select app.course_join({{K3}}, 'desk', 60000, 'c280-h1')`),
        KEPT('e10', 'h1', 'enrolment_id'),
        CLEAR,
        E('h2', 'ca', `select app.coach_cancel_course({{K3}}, 'coach_unavailable')`),
        P('h2_pushes'),
        CLEAR,

        // ── R: a manager retires coach cb (R45): every student hears the coach
        // cancelled; the coach is told nothing.
        E(
          'r1',
          'g11',
          `select app.lesson_book_private({{co_cb}}, {{tp}}, ${LT(2, 10)}, 1, '{}'::text[], 'desk', 30000, 'c280-r1')`,
        ),
        KEPT('R1', 'r1', 'lesson_id'),
        KEPT('e11', 'r1', 'enrolment_id'),
        E('r2', 'desk', `select app.desk_create_group({{co_cb}}, {{tg}}, ${LT(3, 10)}, 'c280-r2')`),
        KEPT('R2', 'r2', 'lesson_id'),
        P('r_pushes'),
        CLEAR,
        E('r3', 'g12', `select app.lesson_join({{R2}}, 'desk', 15000, 'c280-r3')`),
        KEPT('e12', 'r3', 'enrolment_id'),
        CLEAR,
        E('r4', 'manager', `select app.set_coach_status({{co_cb}}, 'retired', 'left the venue')`),
        P('r4_pushes'),
        FLUSH,
        REM('r4_rem', 'R_'),
        CLEAR,

        // ── M: Money's events, planted the way 0284 writes them (lesson_id the
        // place's session, actor system): paid_online tells the coach;
        // expired tells the guest; a held join and a held cancel are silent,
        // with or without data.from; account_deleted from booked tells the coach.
        X(`select pg_temp.plant_enrolment('e13', '{"lesson": "G0", "guest": "g13", "payment_mode": "online",
                                               "price": 15000}'::jsonb)`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, data)
         values ({{v}}, {{G0}}, {{e13}}, 'paid_online', 'system',
                 jsonb_build_object('lesson_id', {{G0}}::text, 'places_taken', 1, 'places_total', 4))`),
        P('m1_pushes'),
        CLEAR,
        X(`select pg_temp.plant_enrolment('e14', '{"lesson": "G0", "guest": "g14", "payment_mode": "online",
                                               "status": "expired", "price": 15000}'::jsonb)`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, code, data)
         values ({{v}}, {{G0}}, {{e14}}, 'expired', 'system', 'payment_expired',
                 jsonb_build_object('lesson_id', {{G0}}::text))`),
        P('m2_pushes'),
        CLEAR,
        X(`select pg_temp.plant_enrolment('e15', '{"lesson": "G0", "guest": "g15", "payment_mode": "online",
                                               "status": "held", "price": 15000}'::jsonb)`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, actor_profile_id)
         values ({{v}}, {{G0}}, {{e15}}, 'joined', 'guest', {{g15}}),
                ({{v}}, {{G0}}, {{e15}}, 'held', 'guest', {{g15}})`),
        X(`update lesson_enrolments set status = 'cancelled', cancel_kind = 'guest_free', cancelled_at = now(),
                hold_expires_at = null
          where id = {{e15}}`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, actor_profile_id, code, data)
         values ({{v}}, {{G0}}, {{e15}}, 'enrolment_cancelled', 'guest', {{g15}}, 'guest_free', '{"from": "held"}')`),
        X(`select pg_temp.plant_enrolment('e16', '{"lesson": "G0", "guest": "g16", "payment_mode": "online",
                                               "status": "cancelled", "cancel_kind": "guest_free",
                                               "price": 15000}'::jsonb)`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, code)
         values ({{v}}, {{G0}}, {{e16}}, 'enrolment_cancelled', 'system', 'guest_free')`),
        P('m3_pushes'),
        CLEAR,
        X(`update lesson_enrolments set status = 'cancelled', cancel_kind = 'account_deleted', cancelled_at = now()
          where id = {{e13}}`),
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, code, data)
         values ({{v}}, {{G0}}, {{e13}}, 'enrolment_cancelled', 'system', 'account_deleted', '{"from": "booked"}')`),
        P('m4_pushes'),
        CLEAR,
        // The silent rows of the table.
        X(`insert into lesson_events (venue_id, lesson_id, enrolment_id, type, actor, code)
         values ({{v}}, {{G0}}, null, 'completed', 'system', null),
                ({{v}}, {{G0}}, {{e13}}, 'attended', 'system', null),
                ({{v}}, {{G0}}, {{e13}}, 'no_show', 'system', null),
                ({{v}}, {{G0}}, {{e13}}, 'unmarked', 'system', null),
                ({{v}}, {{G0}}, {{e13}}, 'settled', 'system', null),
                ({{v}}, {{G0}}, {{e13}}, 'refunded', 'system', 'guest_cancel'),
                ({{v}}, {{A}}, null, 'cancelled', 'system', 'payment_expired'),
                ({{v}}, {{A}}, null, 'cancelled', 'system', 'account_deleted')`),
        P('m5_pushes'),
        CLEAR,

        // Everything queued, for the CD-7 scan.
        Q(
          'seen',
          `select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'payload', s.payload)), '[]'::jsonb)
                   from pg_temp.seen s`,
        ),
        Q(
          'names',
          `select jsonb_agg(x) from (select p.full_name as x from profiles p
                                              where p.id in (select id from pg_temp.guests)
                                            union all select c.display_name_en from coaches c
                                            union all select c.display_name_ar from coaches c) n`,
        ),
      ]);
    });

    it('A — a guest books and cancels a private lesson (trace 1)', () => {
      expect(list(r, 'a_pushes')).toEqual(['ca:coach.new_student#A']);
      expect(list(r, 'a_rem')).toEqual(['g1@A:180']);
      // The lesson's cancelled (guest_cancel) is silent; the enrolment's tells the coach.
      expect(list(r, 'a2_pushes')).toEqual(['ca:coach.student_cancelled#A']);
      expect(list(r, 'a2_rem')).toEqual([]);
    });

    it('B — the desk books for a picked customer, then cancels the lesson (trace 2)', () => {
      expect(list(r, 'b_pushes')).toEqual(['ca:coach.new_student#B', 'g2:lesson.booked#eB@B']);
      expect(list(r, 'b_rem')).toEqual(['g2@B:180']);
      // One coach push (the lesson's), none per enrolment: the lesson is no longer live.
      expect(list(r, 'b2_pushes')).toEqual([
        'ca:coach.lesson_cancelled_by_staff#B',
        'g2:lesson.cancelled_by_staff#eB@B',
      ]);
      expect(list(r, 'b2_rem')).toEqual([]);
    });

    it('C — typed phones: "is this you?" five seconds later, no nudge, no reminder until yes; "Not me" leaves none (C-21, R44)', () => {
      expect(list(r, 'c_pushes')).toEqual(['mx:lesson.added_by_coach#eC@C']);
      expect(data(r, 'c_due')).toEqual([true]);
      expect(data(r, 'c_nudges_after')).toBe(data(r, 'c_nudges_before'));
      expect(list(r, 'c_rem')).toEqual([]);
      expect(list(r, 'c2_pushes')).toEqual([]); // the coach is never told
      expect(list(r, 'c2_rem')).toEqual(['mx@C:180']);
      expect(list(r, 'c3_pushes')).toEqual([]);
      expect(list(r, 'c4_pushes')).toEqual(['my2:lesson.added_by_coach#eC4@C4']);
      expect(list(r, 'c5_pushes')).toEqual([]);
      expect(list(r, 'c5_rem')).toEqual(['mx@C:180']);
    });

    it('D — a group session: added by the desk, joins, adds, moves, a court change, removals, a coach cancel', () => {
      expect(list(r, 'd_pushes')).toEqual(['ca:coach.session_added#G1']);
      expect(list(r, 'd0_pushes')).toEqual([]); // the coach's own creation
      expect(list(r, 'd1_pushes')).toEqual(['ca:coach.new_student#G1[1/4]']);
      expect(list(r, 'd2_pushes')).toEqual([
        'ca:coach.new_student#G1[2/4]',
        'g4:lesson.booked#e4@G1',
      ]);
      expect(list(r, 'd3_pushes')).toEqual([]); // the coach's own add of a walk-in
      expect(list(r, 'd_rem')).toEqual(['g3@G1:180', 'g4@G1:180']);
      expect(list(r, 'd4_pushes')).toEqual([
        'ca:coach.rescheduled_by_staff#G1',
        'g3:lesson.rescheduled#e3@G1',
        'g4:lesson.rescheduled#e4@G1',
      ]);
      // Moved with it: still three hours before the new start.
      expect(list(r, 'd4_rem')).toEqual(['g3@G1:180', 'g4@G1:180']);
      expect(list(r, 'd5_pushes')).toEqual([
        'g3:lesson.rescheduled#e3@G1',
        'g4:lesson.rescheduled#e4@G1',
      ]);
      expect(list(r, 'd6_pushes')).toEqual([
        'ca:coach.court_moved#G1',
        'g3:lesson.court_moved#e3@G1',
        'g4:lesson.court_moved#e4@G1',
      ]);
      expect(list(r, 'd7_pushes')).toEqual([
        'ca:coach.student_cancelled#G1[2/4]',
        'g4:lesson.cancelled_by_staff#e4@G1',
      ]);
      expect(list(r, 'd8_pushes')).toEqual(['g3:lesson.cancelled_by_coach#e3@G1']);
      expect(list(r, 'd9_pushes')).toEqual(['ca:coach.new_student#G1[2/4]']);
      expect(list(r, 'd10_pushes')).toEqual(['g5:lesson.cancelled_by_coach#e5@G1']);
      expect(list(r, 'd10_rem')).toEqual([]);
    });

    it('E — under-filled at the cut-off: each student and the coach once; judged late: nobody (R26)', () => {
      expect(list(r, 'e2_pushes')).toEqual([
        'ca:coach.under_filled#G2',
        'g6:lesson.under_filled#e6@G2',
      ]);
      expect(list(r, 'e3_pushes')).toEqual([]);
    });

    it('F — a course: scheduled by the desk, joins, a session moved, a leave, the desk cancels it', () => {
      expect(list(r, 'f_pushes')).toEqual(['ca:coach.session_added#S1']);
      expect(list(r, 'f1_pushes')).toEqual(['ca:coach.new_student#S1[1/4]']);
      expect(list(r, 'f2_pushes')).toEqual(['ca:coach.new_student#S1[2/4]']);
      expect(list(r, 'f_rem')).toEqual([
        'g7@S1:180',
        'g7@S2:180',
        'g7@S3:180',
        'g7@S4:180',
        'g8@S1:180',
        'g8@S2:180',
        'g8@S3:180',
        'g8@S4:180',
      ]);
      expect(list(r, 'f3_pushes')).toEqual([
        'ca:coach.rescheduled_by_staff#S2',
        'g7:lesson.rescheduled#e7@S2',
        'g8:lesson.rescheduled#e8@S2',
      ]);
      expect(list(r, 'f4_pushes')).toEqual(['ca:coach.student_cancelled#S1[1/4]']);
      expect(list(r, 'f4_rem')).toEqual(['g7@S1:180', 'g7@S2:180', 'g7@S3:180', 'g7@S4:180']);
      // The sessions' events are silent; the student once; the coach once.
      expect(list(r, 'f5_pushes')).toEqual([
        'ca:coach.lesson_cancelled_by_staff#S1',
        'g7:lesson.cancelled_by_staff#e7@S1',
      ]);
      expect(list(r, 'f5_rem')).toEqual([]);
    });

    it('G, H — an under-filled course (trace 3) and a coach cancel of the rest of a course', () => {
      expect(list(r, 'g_pushes')).toEqual([]);
      expect(list(r, 'g2_pushes')).toEqual([
        'ca:coach.under_filled#T1',
        'g9:lesson.under_filled#e9@T1',
      ]);
      expect(list(r, 'h2_pushes')).toEqual(['g10:lesson.cancelled_by_coach#e10@U1']);
    });

    it('R — retiring a coach tells every student the coach cancelled, and the coach nothing (R45)', () => {
      expect(list(r, 'r_pushes')).toEqual(['cb:coach.new_student#R1', 'cb:coach.session_added#R2']);
      expect(list(r, 'r4_pushes')).toEqual([
        'g11:lesson.cancelled_by_coach#e11@R1',
        'g12:lesson.cancelled_by_coach#e12@R2',
      ]);
      expect(list(r, 'r4_rem')).toEqual([]);
    });

    it('M — Money’s events and the silent rows', () => {
      expect(list(r, 'm1_pushes')).toEqual(['ca:coach.new_student#G0[1/4]']);
      expect(list(r, 'm2_pushes')).toEqual(['g14:lesson.payment_expired#e14@G0']);
      expect(list(r, 'm3_pushes')).toEqual([]);
      expect(list(r, 'm4_pushes')).toEqual(['ca:coach.student_cancelled#G0[0/4]']);
      expect(list(r, 'm5_pushes')).toEqual([]);
    });

    it('no queued payload carries a name, an amount or an open key (CD-7)', () => {
      const seen = data<Array<{ kind: string; payload: Json }>>(r, 'seen');
      expect(seen.length).toBeGreaterThan(30);
      const names = data<string[]>(r, 'names').filter((n) => n && n.length > 2);
      for (const { kind, payload } of seen) {
        expect(LESSON_KINDS, kind).toContain(kind);
        expect(
          Object.keys(payload).every((k) =>
            ['route', 'id', 'title_key', 'params', 'dedupe'].includes(k),
          ),
          JSON.stringify(payload),
        ).toBe(true);
        const params = (payload.params ?? {}) as Json;
        expect(
          Object.keys(params).every((k) =>
            ['lesson_id', 'places_taken', 'places_total'].includes(k),
          ),
          JSON.stringify(payload),
        ).toBe(true);
        const text = JSON.stringify(payload);
        expect(text).not.toMatch(/_iqd|amount|price|Typed|Walk/);
        // Params are ids (a lesson) and counts (0..64), never an amount.
        for (const v of Object.values(params)) {
          expect(
            typeof v === 'string'
              ? /^[0-9a-f-]{36}$/.test(v)
              : typeof v === 'number' && v >= 0 && v <= 64,
            text,
          ).toBe(true);
        }
        for (const n of names) expect(text.includes(n), `${n} in ${text}`).toBe(false);
        expect(LESSON_KEYS[payload.title_key as string]).toBe(kind);
      }
    });
  },
);

describe.skipIf(!docker)('reminders follow the rows (rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('c280m', [
      SETUP,
      COACH_SETUP,
      PUSHES,
      `select pg_temp.cbranch();`,
      `select pg_temp.coach('ca');`,
      ...['s1', 's2', 's3', 's4', 's5'].map(PLAYER),

      // A booked private lesson: one reminder at start - 3 h.
      X(`select pg_temp.plant_lesson('Ln', jsonb_build_object('coach', 'co_ca', 'kind', 'private', 'court', 'c1',
                                                              'booked_by', 'guest', 'by', 's1', 'start', ${LT(2, 10)}))`),
      X(`select pg_temp.plant_enrolment('eA', '{"lesson": "Ln", "guest": "s1"}'::jsonb)`),
      FLUSH,
      REM('booked', 'Ln'),
      // A late course join covering sessions 2..4: one per covered session.
      X(
        `select pg_temp.plant_course('K', jsonb_build_object('coach', 'co_ca', 'start', ${LT(3, 12)}))`,
      ),
      X(`select pg_temp.plant_enrolment('eK', '{"course": "K", "guest": "s2", "first": 2, "covered": 3,
                                               "price": 45000}'::jsonb)`),
      FLUSH,
      REM('course', 'K_s_'),
      // A move: the reminder follows the new start.
      X(`update lessons set start_at = start_at + interval '2 hours', end_at = end_at + interval '2 hours',
                rescheduled_at = now()
          where id = {{Ln}}`),
      X(`update reservations set start_at = start_at + interval '2 hours', end_at = end_at + interval '2 hours'
          where lesson_id = {{Ln}}`),
      FLUSH,
      REM('moved', 'Ln'),
      Q(
        'moved_at',
        `select to_jsonb(o.scheduled_for = l.start_at - interval '3 hours')
                       from notification_outbox o join lessons l on l.id = {{Ln}}
                      where o.kind = 'lesson_reminder' and o.payload->'params'->>'lesson_id' = {{Ln}}::text`,
      ),
      // The guest cancels: gone.
      X(`update lesson_enrolments set status = 'cancelled', cancel_kind = 'guest_free', cancelled_at = now()
          where id = {{eA}}`),
      FLUSH,
      REM('cancelled', 'Ln'),
      // Inside its last three hours: none.
      X(`select pg_temp.plant_lesson('Lsoon', jsonb_build_object('coach', 'co_ca', 'kind', 'private', 'court', 'c2',
                                                                 'booked_by', 'guest', 'by', 's1',
                                                                 'start', date_trunc('minute', now()) + interval '2 hours'))`),
      X(`select pg_temp.plant_enrolment('eSoon', '{"lesson": "Lsoon", "guest": "s1"}'::jsonb)`),
      FLUSH,
      REM('soon', 'Lsoon'),
      // Held: none until the payment lands.
      X(`select pg_temp.plant_lesson('Lh', jsonb_build_object('coach', 'co_ca', 'kind', 'private', 'court', 'c2',
                                                              'status', 'held', 'booked_by', 'guest', 'by', 's3',
                                                              'start', ${LT(2, 18)}))`),
      X(`select pg_temp.plant_enrolment('eH', '{"lesson": "Lh", "guest": "s3", "status": "held",
                                               "payment_mode": "online"}'::jsonb)`),
      FLUSH,
      REM('held', 'Lh'),
      X(
        `update reservations set kind = 'lesson', status = 'confirmed', hold_expires_at = null where lesson_id = {{Lh}}`,
      ),
      X(`update lessons set status = 'scheduled', hold_expires_at = null where id = {{Lh}}`),
      X(`update lesson_enrolments set status = 'booked', hold_expires_at = null where id = {{eH}}`),
      FLUSH,
      REM('paid', 'Lh'),
      // An unconfirmed link: none until "Yes"; "Not me" leaves none (C-21, R78).
      X(`select pg_temp.plant_lesson('Lp', jsonb_build_object('coach', 'co_ca', 'kind', 'group', 'court', 'c1',
                                                              'start', ${LT(4, 10)}))`),
      X(`select pg_temp.plant_enrolment('eP', '{"lesson": "Lp", "guest": "s4", "booked_by": "coach", "linked": false,
                                               "name": "Typed S4", "price": 15000}'::jsonb)`),
      X(`select pg_temp.plant_enrolment('eQ', '{"lesson": "Lp", "guest": "s5", "booked_by": "coach", "linked": false,
                                               "name": "Typed S5", "price": 15000}'::jsonb)`),
      FLUSH,
      REM('pending', 'Lp'),
      X(`update lesson_enrolments set link_confirmed_at = now() where id = {{eP}}`),
      X(`update lesson_enrolments set guest_id = null where id = {{eQ}}`),
      FLUSH,
      REM('answered', 'Lp'),
      // A coach cancel, and a course cancelled under-filled: gone.
      X(
        `update lessons set status = 'cancelled', cancel_reason = 'coach_cancel', cancelled_at = now() where id = {{Lp}}`,
      ),
      FLUSH,
      REM('coach_cancel', 'Lp'),
      X(`do $c$ begin
           update lessons set status = 'cancelled', cancel_reason = 'under_filled', cancelled_at = now()
            where course_id = {{K}}::uuid;
           update courses set status = 'cancelled', cancel_reason = 'under_filled', cancelled_at = now()
            where id = {{K}}::uuid;
           update lesson_enrolments set status = 'cancelled', cancel_kind = 'course_cancelled', cancelled_at = now()
            where course_id = {{K}}::uuid and status = 'booked';
         end $c$`),
      FLUSH,
      REM('course_cancel', 'K_s_'),
    ]);
  });

  it('queues, moves and clears lesson.reminder with the rows', () => {
    expect(list(r, 'booked')).toEqual(['s1@Ln:180']);
    expect(list(r, 'course')).toEqual(['s2@K_s2:180', 's2@K_s3:180', 's2@K_s4:180']);
    expect(list(r, 'moved')).toEqual(['s1@Ln:180']);
    expect(data(r, 'moved_at')).toBe(true);
    expect(list(r, 'cancelled')).toEqual([]);
    expect(list(r, 'soon')).toEqual([]);
    expect(list(r, 'held')).toEqual([]);
    expect(list(r, 'paid')).toEqual(['s3@Lh:180']);
    expect(list(r, 'pending')).toEqual([]);
    expect(list(r, 'answered')).toEqual(['s4@Lp:180']);
    expect(list(r, 'coach_cancel')).toEqual([]);
    expect(list(r, 'course_cancel')).toEqual([]);
  });
});

describe.skipIf(!docker)('one sync per session per flush (F21, rolled back)', () => {
  let r: Results;

  it('runs the scenario', () => {
    r = scenario('c280s', [
      SETUP,
      COACH_SETUP,
      PUSHES,
      `select pg_temp.cbranch();`,
      `select pg_temp.coach('ca');`,
      ...['s6', 's7', 's8'].map(PLAYER),
      `create temp table syncs (id uuid);`,
      X(`create or replace function app.lesson_sync_reminders(p_lesson_id uuid) returns void language sql
           as 'insert into pg_temp.syncs values ($1)'`),
      X(
        `select pg_temp.plant_course('K', jsonb_build_object('coach', 'co_ca', 'start', ${LT(3, 10)}))`,
      ),
      // Three enrolments of four sessions each, flushed together: 12 events, 4 syncs.
      X(`select pg_temp.plant_enrolment('e6', '{"course": "K", "guest": "s6"}'::jsonb)`),
      X(`select pg_temp.plant_enrolment('e7', '{"course": "K", "guest": "s7"}'::jsonb)`),
      X(`select pg_temp.plant_enrolment('e8', '{"course": "K", "guest": "s8"}'::jsonb)`),
      FLUSH,
      Q(
        'first',
        `select coalesce(jsonb_agg(x.n order by x.n), '[]'::jsonb)
                    from (select count(*)::int as n from pg_temp.syncs group by id) x`,
      ),
      Q('first_sessions', `select to_jsonb(count(distinct id)) from pg_temp.syncs`),
      X(`delete from pg_temp.syncs where true`),
      // The next flush starts a fresh list: two moved sessions, once each.
      X(`update lessons set rescheduled_at = now(), start_at = start_at + interval '30 minutes',
                end_at = end_at + interval '30 minutes'
          where id in ({{K_s3}}, {{K_s4}})`),
      X(`update lesson_enrolments set party_size = party_size where id = {{e6}}`),
      FLUSH,
      Q(
        'second',
        `select coalesce(jsonb_agg(pg_temp.nm(s.id::text) order by pg_temp.nm(s.id::text)), '[]'::jsonb)
                     from pg_temp.syncs s`,
      ),
    ]);
  });

  it('syncs each session once per flush, and again in a later flush', () => {
    expect(data(r, 'first')).toEqual([1, 1, 1, 1]);
    expect(data(r, 'first_sessions')).toBe(4);
    expect(data(r, 'second')).toEqual(['K_s3', 'K_s4']);
  });
});

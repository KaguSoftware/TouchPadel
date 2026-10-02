/**
 * 0283 (lane DB + Guest): the coaching reads (docs/design/coaching/db.md
 * §4.7.9, guest.md §4.3, operator.md §5.6; build contracts R12, R16, R17,
 * R41, R43, R44, R45, R51, R54, R58, R61, R63, R76, R81).
 *
 *   * shapes: every read answers at least the keys of
 *     packages/core/src/coaching/shapes.ts COACHING_SHAPES (R41, R81):
 *     coaching_public, coach_profile (a named branch and NULL, R17),
 *     coach_slots, lesson_offer (group and course), my_lessons, my_lesson
 *     (lesson, course, pending link), coach_me and coach_me_retired (0282's
 *     body), coach_schedule, coach_lesson (group and course session),
 *     desk_lessons, desk_lesson_detail (group and course session),
 *     customer_lessons;
 *   * privacy by VALUE, not only by key (R58 G2): the four public reads and
 *     my_lessons carry no profiles.id, no phone-shaped string but the
 *     branch's, no student name, no person key; the coach's roster shows a
 *     coach- or desk-booked student as typed, never the linked account (R44),
 *     the phone gone after end_at + 7 days (R54) and while held, the CD-8
 *     marker never falling back to the account; a pending link (C-21) is a
 *     confirm card for its owner, absent from the customer record and
 *     customer_id null at the desk;
 *   * who is listed: coaching off -> {off: true} for the public reads, the
 *     desk still reads coach_slots (R51) and the guest still sees their own
 *     lessons; an unaccepted coach (R61) and a paused one (R16, R76) are not
 *     listed, the paused one answers status paused with nothing bookable, the
 *     unaccepted one is not found but to staff; a retired coach's card never
 *     names them on a guest surface (R63), and they are NOT_A_COACH to the
 *     coach reads (R45).
 *
 * One rolled-back scenario at a branch made inside the transaction
 * (coaching-read-harness.ts); lessons are planted where no RPC can reach the
 * state (ended, held). The calls run as postgres with auth.uid() set the way
 * PostgREST would, so the grants are rls-matrix.ts's business, not this
 * file's.
 */
import { describe, expect, it } from 'vitest';
import {
  COACHING_SHAPES,
  missingKeys,
  type CoachingShapeName,
} from '../../core/src/coaching/shapes';
import { stackAvailable } from './helpers';
import { Q, X, dockerReachable, scenario, type Results } from './stores-harness';
import { E, GUEST, SETUP, data, failed } from './matches-harness';
import {
  BRANCH_PHONE,
  COACH_SETUP,
  LT,
  leaks,
  personKeys,
  phoneShaped,
  randomPhone,
} from './coaching-read-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const TYPED_PHONE = randomPhone(); // what the coach typed for g3 (a pending link)
const RECENT_PHONE = randomPhone(); // a walk-in 3 days ago: still shown (R54)
const PAST_PHONE = randomPhone(); // a walk-in 9 days ago: gone (R54)
const PEOPLE: Record<string, string> = {
  g1: '{"given":"Rawan","family":"Studentova","phone":"+9647711120001"}',
  g2: '{"given":"Bassam","family":"Learnerson","phone":"+9647711120002"}',
  g3: '{"given":"Huda","family":"Pendingova","phone":"+9647711120003"}',
  g4: '{"given":"Omar","family":"Heldmann","phone":"+9647711120004"}',
  stranger: '{"given":"Lina","family":"Outsider","phone":"+9647711120005"}',
};
const STUDENT_NAMES = [
  'Studentova',
  'Learnerson',
  'Pendingova',
  'Heldmann',
  'Outsider',
  'Typed Tariq',
  'Recent Rami',
  'Friendly Ali',
  'Test g1',
  'Test g2',
  'Test g3',
  'Test g4',
];
const PHONES = [
  '+9647711120001',
  '+9647711120002',
  '+9647711120003',
  '+9647711120004',
  '+9647711120005',
  TYPED_PHONE,
  RECENT_PHONE,
  PAST_PHONE,
];

const PLANT = (fn: string, name: string, p: Json) =>
  X(`select pg_temp.${fn}('${name}', '${JSON.stringify(p)}'::jsonb)`);
/** p with a start built in SQL (pg_temp.lt): the JSON is completed inside the database. */
const PLANT_AT = (fn: string, name: string, p: Json, start: string) =>
  X(
    `select pg_temp.${fn}('${name}', '${JSON.stringify(p)}'::jsonb || jsonb_build_object('start', ${start}))`,
  );

function shapeOf(r: Results, label: string, shape: CoachingShapeName): string[] {
  return missingKeys(data(r, label), COACHING_SHAPES[shape]);
}

describe.skipIf(!docker)('0283 coaching reads (rolled back)', () => {
  let r: Results;
  let ids: Record<string, string>;
  let names: Record<string, string>;

  it('runs the scenario', () => {
    r = scenario('c280r', [
      SETUP,
      COACH_SETUP,
      `select pg_temp.cbranch();`,
      ...Object.entries(PEOPLE).map(([name, p]) => GUEST(name, p)),
      `select pg_temp.coach('ca');`,
      `select pg_temp.coach('cu', '{"accepted": false}');`,
      `select pg_temp.coach('cp', '{"status": "paused"}');`,
      `select pg_temp.coach('cr', '{"status": "retired"}');`,
      // C-27: the seeded court desk coaches too (their own profile).
      X(`insert into coaches (profile_id, display_name_en, display_name_ar, status, public_accepted_at)
         values ({{desk}}, 'Desk Coach', 'مدرّب الاستقبال', 'active', now())`),

      // Coach ca: a private lesson g1 booked (with a friend), a group session
      // (g2's own place, a typed student whose phone matched g3 and is
      // pending, g4 mid-payment), a course g2 joined, and two past private
      // lessons for walk-ins (3 and 9 days ago).
      PLANT_AT(
        'plant_lesson',
        'L1',
        { coach: 'co_ca', kind: 'private', court: 'c1', booked_by: 'guest', by: 'g1' },
        LT(2, 10),
      ),
      PLANT('plant_enrolment', 'eL1', {
        lesson: 'L1',
        guest: 'g1',
        party: 2,
        friends: ['Friendly Ali'],
      }),
      PLANT_AT('plant_lesson', 'G1', { coach: 'co_ca', kind: 'group', court: 'c1' }, LT(2, 12)),
      PLANT('plant_enrolment', 'eG1a', { lesson: 'G1', guest: 'g2', price: 15000 }),
      PLANT('plant_enrolment', 'eG1b', {
        lesson: 'G1',
        guest: 'g3',
        booked_by: 'coach',
        name: 'Typed Tariq',
        phone: TYPED_PHONE,
        linked: false,
        price: 15000,
      }),
      PLANT('plant_enrolment', 'eG1c', {
        lesson: 'G1',
        guest: 'g4',
        status: 'held',
        payment_mode: 'online',
        price: 15000,
      }),
      PLANT_AT('plant_course', 'C1', { coach: 'co_ca' }, LT(3, 10)),
      PLANT('plant_enrolment', 'eC1', { course: 'C1', guest: 'g2' }),
      PLANT_AT(
        'plant_lesson',
        'P2',
        { coach: 'co_ca', kind: 'private', court: 'c2', status: 'completed' },
        LT(-3, 10),
      ),
      PLANT('plant_enrolment', 'eP2', {
        lesson: 'P2',
        booked_by: 'coach',
        name: 'Recent Rami',
        phone: RECENT_PHONE,
      }),
      // CD-8: the purge marker on a typed row whose phone matched g1 and was
      // confirmed: the roster says the marker, never the account (R44).
      PLANT_AT(
        'plant_lesson',
        'P1',
        { coach: 'co_ca', kind: 'private', court: 'c2', status: 'completed' },
        LT(-9, 10),
      ),
      PLANT('plant_enrolment', 'eP1', {
        lesson: 'P1',
        guest: 'g1',
        booked_by: 'coach',
        name: 'Walk-in',
        phone: PAST_PHONE,
        linked: true,
      }),
      // g1's history: a past lesson with ca, a past lesson with the retired cr
      // (R63), and a cancelled one.
      PLANT_AT(
        'plant_lesson',
        'P3',
        {
          coach: 'co_ca',
          kind: 'private',
          court: 'c1',
          status: 'completed',
          booked_by: 'guest',
          by: 'g1',
        },
        LT(-5, 10),
      ),
      PLANT('plant_enrolment', 'eP3', { lesson: 'P3', guest: 'g1' }),
      PLANT_AT(
        'plant_lesson',
        'P4',
        {
          coach: 'co_cr',
          kind: 'private',
          court: 'c1',
          status: 'completed',
          booked_by: 'guest',
          by: 'g1',
        },
        LT(-6, 10),
      ),
      PLANT('plant_enrolment', 'eP4', { lesson: 'P4', guest: 'g1' }),
      PLANT_AT(
        'plant_lesson',
        'L5',
        {
          coach: 'co_ca',
          kind: 'private',
          court: 'c2',
          status: 'cancelled',
          booked_by: 'guest',
          by: 'g1',
        },
        LT(4, 18),
      ),
      PLANT('plant_enrolment', 'eL5', {
        lesson: 'L5',
        guest: 'g1',
        status: 'cancelled',
        cancel_kind: 'guest_free',
      }),
      // The unaccepted and the paused coach each have a group session.
      PLANT_AT('plant_lesson', 'Gcu', { coach: 'co_cu', kind: 'group', court: 'c2' }, LT(2, 14)),
      PLANT_AT('plant_lesson', 'Gcp', { coach: 'co_cp', kind: 'group', court: 'c2' }, LT(2, 16)),

      // ── the public reads, anonymous and signed in ──
      E('pub_all', null, `select app.coaching_public(null)`),
      E('pub_v', null, `select app.coaching_public({{v}})`),
      E('pub_unknown', null, `select app.coaching_public('00000000-0000-4000-8000-0000000c2800')`),
      E('prof_v', null, `select app.coach_profile({{co_ca}}, {{v}})`),
      E('prof_null', null, `select app.coach_profile({{co_ca}}, null)`),
      E('prof_cu', null, `select app.coach_profile({{co_cu}}, {{v}})`),
      E('prof_cp', null, `select app.coach_profile({{co_cp}}, {{v}})`),
      E('prof_cr', null, `select app.coach_profile({{co_cr}}, {{v}})`),
      E('prof_null_arg', null, `select app.coach_profile(null, null)`),
      E('slots', null, `select app.coach_slots({{co_ca}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      E('slots_long', null, `select app.coach_slots({{co_ca}}, {{tp}}, ${LT(2, 0)}, ${LT(17, 0)})`),
      E('slots_group', null, `select app.coach_slots({{co_ca}}, {{tg}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      E('slots_cu', null, `select app.coach_slots({{co_cu}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      E(
        'slots_cu_desk',
        'desk',
        `select app.coach_slots({{co_cu}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`,
      ),
      // The coach asks about themselves (coach mode) before accepting: like staff.
      E(
        'slots_cu_self',
        'cu',
        `select app.coach_slots({{co_cu}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`,
      ),
      E('slots_cp', null, `select app.coach_slots({{co_cp}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      Q('t_9', `select to_jsonb(${LT(2, 9)})`),
      Q('t_930', `select to_jsonb(${LT(2, 9.5)})`),
      Q('t_10', `select to_jsonb(${LT(2, 10)})`),
      Q('t_11', `select to_jsonb(${LT(2, 11)})`),
      Q('t_1130', `select to_jsonb(${LT(2, 11.5)})`),
      Q('t_12', `select to_jsonb(${LT(2, 12)})`),
      E('offer_g', null, `select app.lesson_offer({{G1}}, null)`),
      E('offer_g_g2', 'g2', `select app.lesson_offer({{G1}}, null)`),
      E('offer_c', null, `select app.lesson_offer(null, {{C1}})`),
      E('offer_private', null, `select app.lesson_offer({{L1}}, null)`),
      E('offer_session', null, `select app.lesson_offer({{C1_s1}}, null)`),
      E('offer_cu', null, `select app.lesson_offer({{Gcu}}, null)`),
      E('offer_cp', null, `select app.lesson_offer({{Gcp}}, null)`),
      E('offer_both', null, `select app.lesson_offer({{G1}}, {{C1}})`),

      // ── the guest's own ──
      E('my_g1', 'g1', `select app.my_lessons('upcoming')`),
      E('my_g1_past', 'g1', `select app.my_lessons('past')`),
      E('my_g1_cancelled', 'g1', `select app.my_lessons('cancelled')`),
      E('my_g2', 'g2', `select app.my_lessons()`),
      E('my_g3', 'g3', `select app.my_lessons('upcoming')`),
      E('my_bad', 'g1', `select app.my_lessons('soon')`),
      E('my_anon', null, `select app.my_lessons('upcoming')`),
      E('my1_g1', 'g1', `select app.my_lesson({{eL1}})`),
      E('my1_g2c', 'g2', `select app.my_lesson({{eC1}})`),
      E('my1_g3', 'g3', `select app.my_lesson({{eG1b}})`),
      E('my1_g4', 'g4', `select app.my_lesson({{eG1c}})`),
      E('my1_stranger', 'stranger', `select app.my_lesson({{eL1}})`),

      // ── coach mode ──
      E('me_ca', 'ca', `select app.coach_me()`),
      E('me_cr', 'cr', `select app.coach_me()`),
      E('me_g1', 'g1', `select app.coach_me()`),
      E('me_desk', 'desk', `select app.coach_me()`),
      E('sched_ca', 'ca', `select app.coach_schedule(${LT(-10, 0)}, ${LT(10, 0)})`),
      E('sched_long', 'ca', `select app.coach_schedule(${LT(0, 0)}, ${LT(40, 0)})`),
      E('sched_cr', 'cr', `select app.coach_schedule(${LT(0, 0)}, ${LT(10, 0)})`),
      E('sched_g1', 'g1', `select app.coach_schedule(${LT(0, 0)}, ${LT(10, 0)})`),
      E('roster_g', 'ca', `select app.coach_lesson({{G1}})`),
      E('roster_c', 'ca', `select app.coach_lesson({{C1_s2}})`),
      E('roster_p1', 'ca', `select app.coach_lesson({{P1}})`),
      E('roster_p2', 'ca', `select app.coach_lesson({{P2}})`),
      E('roster_other', 'ca', `select app.coach_lesson({{Gcu}})`),
      E('roster_cr', 'cr', `select app.coach_lesson({{P4}})`),

      // ── the desk ──
      E('desk_list', 'desk', `select app.desk_lessons({{v}}, ${LT(-9, 0)}, ${LT(-2, 0)})`),
      E('desk_list2', 'desk', `select app.desk_lessons({{v}}, ${LT(2, 0)}, ${LT(5, 0)})`),
      E('desk_list_cashier', 'cashier', `select app.desk_lessons({{v}}, ${LT(2, 0)}, ${LT(5, 0)})`),
      E('desk_list_long', 'desk', `select app.desk_lessons({{v}}, ${LT(0, 0)}, ${LT(8, 0)})`),
      E('desk_list_guest', 'g1', `select app.desk_lessons({{v}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      E('desk_g1', 'desk', `select app.desk_lesson_detail({{G1}})`),
      E('desk_c', 'desk', `select app.desk_lesson_detail({{C1_s1}})`),
      E(
        'desk_nil',
        'desk',
        `select app.desk_lesson_detail('00000000-0000-4000-8000-0000000c2801')`,
      ),
      E('cust_g2', 'desk', `select app.customer_lessons({{g2}})`),
      E('cust_g1', 'desk', `select app.customer_lessons({{g1}})`),
      E('cust_g3', 'desk', `select app.customer_lessons({{g3}})`),
      E('cust_nil', 'desk', `select app.customer_lessons('00000000-0000-4000-8000-0000000c2802')`),

      // ── coaching switched off at the branch ──
      X(`update venue_settings set coaching_enabled = false where venue_id = {{v}}`),
      E('off_pub', null, `select app.coaching_public({{v}})`),
      E('off_pub_all', null, `select app.coaching_public(null)`),
      E('off_prof', null, `select app.coach_profile({{co_ca}}, {{v}})`),
      E('off_prof_null', null, `select app.coach_profile({{co_ca}}, null)`),
      E('off_slots', null, `select app.coach_slots({{co_ca}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`),
      E(
        'off_slots_desk',
        'desk',
        `select app.coach_slots({{co_ca}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`,
      ),
      E(
        'off_slots_self',
        'ca',
        `select app.coach_slots({{co_ca}}, {{tp}}, ${LT(2, 0)}, ${LT(3, 0)})`,
      ),
      E('off_offer', null, `select app.lesson_offer({{G1}}, null)`),
      E('off_my', 'g2', `select app.my_lessons('upcoming')`),
      E('off_me', 'ca', `select app.coach_me()`),
      E('off_sched', 'ca', `select app.coach_schedule(${LT(0, 0)}, ${LT(10, 0)})`),
      E('off_desk', 'desk', `select app.desk_lessons({{v}}, ${LT(2, 0)}, ${LT(5, 0)})`),

      // Every id kept, for the value scans; the students' account names.
      Q('ids', `select jsonb_object_agg(name, val) from pg_temp.vars`),
      Q(
        'names',
        `select jsonb_object_agg(v.name, p.full_name) from pg_temp.vars v
                   join profiles p on p.id::text = v.val where v.name in ('g1', 'g2', 'g3', 'g4')`,
      ),
    ]);
    ids = data<Record<string, string>>(r, 'ids');
    names = data<Record<string, string>>(r, 'names');
  });

  /** Every profiles.id made here: students, coaches' own profiles, the desk who coaches. */
  const profileIds = () =>
    ['g1', 'g2', 'g3', 'g4', 'stranger', 'ca', 'cu', 'cp', 'cr', 'desk'].map((k) => ids[k]!);

  it('answers every read with at least its COACHING_SHAPES keys (R41, R81)', () => {
    const cases: Array<[string, CoachingShapeName]> = [
      ['pub_v', 'coaching_public'],
      ['pub_all', 'coaching_public'],
      ['prof_v', 'coach_profile'],
      ['prof_null', 'coach_profile'],
      ['prof_cp', 'coach_profile'],
      ['slots', 'coach_slots'],
      ['slots_cp', 'coach_slots'],
      ['slots_cu_desk', 'coach_slots'],
      ['offer_g', 'lesson_offer'],
      ['offer_g_g2', 'lesson_offer'],
      ['offer_c', 'lesson_offer'],
      ['my_g1', 'my_lessons'],
      ['my_g1_past', 'my_lessons'],
      ['my_g1_cancelled', 'my_lessons'],
      ['my_g2', 'my_lessons'],
      ['my_g3', 'my_lessons'],
      ['my1_g1', 'my_lesson'],
      ['my1_g2c', 'my_lesson'],
      ['my1_g3', 'my_lesson'],
      ['my1_g4', 'my_lesson'],
      ['me_ca', 'coach_me'],
      ['me_desk', 'coach_me'],
      ['me_cr', 'coach_me_retired'],
      ['sched_ca', 'coach_schedule'],
      ['roster_g', 'coach_lesson'],
      ['roster_c', 'coach_lesson'],
      ['roster_p1', 'coach_lesson'],
      ['desk_list', 'desk_lessons'],
      ['desk_list2', 'desk_lessons'],
      ['desk_list_cashier', 'desk_lessons'],
      ['desk_g1', 'desk_lesson_detail'],
      ['desk_c', 'desk_lesson_detail'],
      ['cust_g2', 'customer_lessons'],
      ['cust_g1', 'customer_lessons'],
    ];
    for (const [label, shape] of cases)
      expect(shapeOf(r, label, shape), `${label} as ${shape}`).toEqual([]);
    // The course answers carry their optional sessions; the lesson ones may not.
    expect(Array.isArray(data<Json>(r, 'offer_c').sessions)).toBe(true);
    expect(data<Json>(r, 'offer_g')).not.toHaveProperty('sessions');
    expect((data<Json>(r, 'my1_g2c').sessions as Json[]).length).toBe(4);
    expect(data<Json>(r, 'my1_g1')).not.toHaveProperty('sessions');
    expect(data<Json>(r, 'offer_g')).toHaveProperty('lesson_id', ids.G1);
    expect(data<Json>(r, 'offer_c')).toHaveProperty('course_id', ids.C1);
  });

  it('the public reads and my_lessons carry no profile id, person phone, student name or person key (R43, R58)', () => {
    const publicLabels = [
      'pub_all',
      'pub_v',
      'prof_v',
      'prof_null',
      'prof_cp',
      'slots',
      'slots_cp',
      'offer_g',
      'offer_g_g2',
      'offer_c',
    ];
    for (const label of publicLabels) {
      const v = data(r, label);
      expect(leaks(v, profileIds(), PHONES), label).toEqual([]);
      expect(phoneShaped(v, [BRANCH_PHONE]), label).toEqual([]);
      expect(personKeys(v), label).toEqual([]);
      const text = JSON.stringify(v);
      for (const n of STUDENT_NAMES) expect(text.includes(n), `${label} names ${n}`).toBe(false);
    }
    // The guest's own list names nobody else, and never their own profile id.
    for (const label of ['my_g1', 'my_g1_past', 'my_g1_cancelled', 'my_g2', 'my_g3']) {
      const v = data(r, label);
      expect(leaks(v, profileIds(), PHONES), label).toEqual([]);
      expect(phoneShaped(v), label).toEqual([]);
      expect(personKeys(v), label).toEqual([]);
      const text = JSON.stringify(v);
      for (const n of STUDENT_NAMES) expect(text.includes(n), `${label} names ${n}`).toBe(false);
    }
    // The only phone a public read sends is the branch's.
    expect((data<Json>(r, 'prof_v').venue as Json).phone).toBe(BRANCH_PHONE);
    expect(data<Json>(r, 'offer_g').phone).toBe(BRANCH_PHONE);
  });

  it('lists the accepted, active coach and their open sessions only (R16, R61, R76)', () => {
    const pub = data<Json>(r, 'pub_v');
    expect(pub.off).toBe(false);
    expect((pub.coaches as Json[]).map((c) => c.id)).toEqual([ids.co_ca]);
    expect((pub.branches as Json[]).map((b) => b.venue_id)).toEqual([ids.v]);
    const sessions = pub.sessions as Json[];
    expect(sessions.map((s) => s.lesson_id ?? s.course_id).sort()).toEqual([ids.G1, ids.C1].sort());
    const g = sessions.find((s) => s.lesson_id === ids.G1)!;
    // Three places taken: g2, the typed student, and g4's live hold.
    expect(g).toMatchObject({ kind: 'group', places_left: 1, max_places: 4, coach_id: ids.co_ca });
    const c = sessions.find((s) => s.course_id === ids.C1)!;
    expect(c).toMatchObject({
      kind: 'course',
      sessions_count: 4,
      sessions_left: 4,
      places_left: 3,
    });
    expect((pub.lesson_types as Json[]).map((t) => t.id).sort()).toEqual(
      [ids.tg, ids.tc, ids.tp].sort(),
    );
    const offers = (pub.coaches as Json[])[0]!.offers as Json[];
    expect(offers.find((o) => o.lesson_type_id === ids.tp)).toMatchObject({ price_iqd: 30000 });
    // Every open branch: ours is among them.
    expect(((data<Json>(r, 'pub_all').branches as Json[]) ?? []).map((b) => b.venue_id)).toContain(
      ids.v,
    );
    expect(data(r, 'pub_unknown')).toEqual({ off: true });
  });

  it('coach_profile: the named branch, the NULL branch (R17), the paused, unaccepted and retired coach', () => {
    const v = data<Json>(r, 'prof_v');
    expect(v).toMatchObject({ off: false, bookable: true });
    expect(v.coach).toMatchObject({ id: ids.co_ca, status: 'active', venue_ids: [ids.v] });
    expect((v.offers as Json[]).map((o) => o.lesson_type_id).sort()).toEqual(
      [ids.tp, ids.tg, ids.tc].sort(),
    );
    expect((v.sessions as Json[]).length).toBe(2);
    expect(data<Json>(r, 'prof_null')).toMatchObject({
      off: false,
      venue: null,
      offers: [],
      sessions: [],
    });
    expect((data<Json>(r, 'prof_null').coach as Json).venue_ids).toEqual([ids.v]);
    expect(data<Json>(r, 'prof_cp')).toMatchObject({
      off: false,
      bookable: false,
      offers: [],
      sessions: [],
    });
    expect((data<Json>(r, 'prof_cp').coach as Json).status).toBe('paused');
    expect(failed(r, 'prof_cu').code).toBe('COACH_NOT_FOUND');
    expect(failed(r, 'prof_cr').code).toBe('COACH_NOT_FOUND');
    expect(failed(r, 'prof_null_arg')).toMatchObject({
      code: 'INVALID_ARGUMENT',
      detail: 'p_coach_id',
    });
  });

  it('coach_slots: grid starts the coach and a court are free for; private only; staff see the unaccepted coach', () => {
    const s = data<Json>(r, 'slots');
    expect(s).toMatchObject({
      off: false,
      venue_id: ids.v,
      lesson_type_id: ids.tp,
      duration_min: 60,
      bookable: true,
    });
    const starts = (s.starts as Json[]).map((x) => x.start_at);
    expect(starts).toContain(data(r, 't_9'));
    expect(starts).toContain(data(r, 't_11'));
    // L1 10:00-11:00 and G1 12:00-13:00 hold the coach: no start overlaps them.
    for (const busy of ['t_930', 't_10', 't_1130', 't_12'])
      expect(starts, busy).not.toContain(data(r, busy));
    for (const x of s.starts as Json[])
      expect(Object.keys(x).sort()).toEqual(['end_at', 'start_at']);
    expect(failed(r, 'slots_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });
    expect(failed(r, 'slots_group').code).toBe('LESSON_TYPE_NOT_FOUND');
    expect(failed(r, 'slots_cu').code).toBe('COACH_NOT_FOUND');
    expect(data<Json>(r, 'slots_cu_desk')).toMatchObject({ off: false, bookable: true });
    expect(data<Json>(r, 'slots_cu_self')).toMatchObject({ off: false, bookable: true });
    expect(data<Json>(r, 'slots_cp')).toMatchObject({ off: false, bookable: false, starts: [] });
  });

  it('lesson_offer: a group session and a course; mine for its holder; private lessons, sessions and hidden coaches are not offers', () => {
    expect(data<Json>(r, 'offer_g')).toMatchObject({
      kind: 'group',
      status: 'open',
      places_taken: 3,
      places_left: 1,
      max_places: 4,
      min_places: 2,
      price_iqd: 15000,
      full_price_iqd: 15000,
      late_join: null,
      mine: null,
      payment_mode: 'desk',
      cancellation_window_hours: 12,
    });
    expect(data<Json>(r, 'offer_g_g2').mine).toEqual({ enrolment_id: ids.eG1a, status: 'booked' });
    const c = data<Json>(r, 'offer_c');
    expect(c).toMatchObject({
      kind: 'course',
      status: 'open',
      price_iqd: 60000,
      full_price_iqd: 60000,
      late_join: null,
    });
    expect((c.sessions as Json[]).map((s) => s.session_no)).toEqual([1, 2, 3, 4]);
    for (const label of ['offer_private', 'offer_session', 'offer_cu', 'offer_cp']) {
      expect(failed(r, label).code, label).toBe('LESSON_NOT_FOUND');
    }
    expect(failed(r, 'offer_both')).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('my_lessons: scopes, the pending link as a confirm card, a retired coach never named (C-21, R63)', () => {
    const up1 = data<Json[]>(r, 'my_g1');
    expect(up1.map((x) => x.enrolment_id)).toEqual([ids.eL1]);
    expect(up1[0]).toMatchObject({
      kind: 'private',
      status: 'booked',
      lesson_status: 'scheduled',
      booked_by: 'guest',
      confirm_needed: false,
      party_size: 2,
      payment_mode: 'desk',
      price_iqd: 30000,
    });
    // Latest first. The typed row whose phone matched g1 and was confirmed
    // (P1, 9 days ago) is g1's too.
    const past = data<Json[]>(r, 'my_g1_past');
    expect(past.map((x) => x.enrolment_id)).toEqual([ids.eP3, ids.eP4, ids.eP1]);
    expect(past[1]!.coach).toEqual({
      id: ids.co_cr,
      display_name_en: null,
      display_name_ar: null,
      photo_path: null,
    });
    expect(past[2]).toMatchObject({ booked_by: 'coach', confirm_needed: false });
    expect(data<Json[]>(r, 'my_g1_cancelled').map((x) => x.enrolment_id)).toEqual([ids.eL5]);
    expect(data<Json[]>(r, 'my_g2').map((x) => x.enrolment_id)).toEqual([ids.eG1a, ids.eC1]);
    const pend = data<Json[]>(r, 'my_g3');
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({
      enrolment_id: ids.eG1b,
      confirm_needed: true,
      booked_by: 'coach',
      paid_online_iqd: null,
      owed_iqd: null,
      refund: null,
      pending_payment: null,
    });
    expect(failed(r, 'my_bad')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_scope' });
    expect(failed(r, 'my_anon').code).toBe('AUTH_REQUIRED');
  });

  it('my_lesson: the cancel preview, the course sessions, a held place, the confirm card; not yours is not found', () => {
    const one = data<Json>(r, 'my1_g1');
    expect(one.friend_names).toEqual(['Friendly Ali']);
    expect(one.court_name_en).toBe('C280 court 1');
    expect(one.can).toEqual({ cancel: true, pay: false, confirm: false });
    expect(one.cancel).toMatchObject({
      policy: 'free',
      free_because: null,
      counts_late: true,
      refund_sessions: null,
      next_start_at: null,
    });
    const course = data<Json>(r, 'my1_g2c');
    expect(course.cancel).toMatchObject({ policy: 'free', refund_sessions: 4, kept_sessions: 0 });
    expect((course.cancel as Json).next_start_at).toBe((course.sessions as Json[])[0]!.start_at);
    const held = data<Json>(r, 'my1_g4');
    expect(held).toMatchObject({ status: 'held' });
    expect(held.can).toEqual({ cancel: true, pay: true, confirm: false });
    const card = data<Json>(r, 'my1_g3');
    expect(card).toMatchObject({ confirm_needed: true, friend_names: [], court_name_en: null });
    expect(card.can).toEqual({ cancel: false, pay: false, confirm: true });
    expect(failed(r, 'my1_stranger').code).toBe('ENROLMENT_NOT_FOUND');
  });

  it('coach_me (0282): the coach, a staff member who coaches (C-27), a retired coach (R45), a guest', () => {
    const me = data<Json>(r, 'me_ca');
    expect(me.coach).toMatchObject({
      id: ids.co_ca,
      status: 'active',
      public_accepted: true,
      add_cap: 30,
    });
    expect(((me.coach as Json).branches as Json[]).map((b) => b.venue_id)).toEqual([ids.v]);
    expect(data<Json>(r, 'me_cr').coach).toEqual({
      id: ids.co_cr,
      status: 'retired',
      display_name_en: 'Coach cr',
      display_name_ar: 'المدرّب cr',
    });
    expect(data<Json>(r, 'me_g1').coach).toBeNull();
    expect((data<Json>(r, 'me_desk').coach as Json).display_name_en).toBe('Desk Coach');
    // Off at the branch: coach mode still reads, with the branch marked off (R45).
    const off = data<Json>(r, 'off_me');
    expect(((off.coach as Json).branches as Json[])[0]).toMatchObject({
      venue_id: ids.v,
      coaching_enabled: false,
    });
  });

  it('coach_schedule and coach_lesson: own lessons only, typed names, the phone window (C-16, R44, R54)', () => {
    const sched = data<Json>(r, 'sched_ca');
    const listed = (sched.lessons as Json[]).map((l) => l.lesson_id);
    for (const k of ['L1', 'G1', 'P1', 'P2', 'P3', 'C1_s1', 'C1_s4'])
      expect(listed, k).toContain(ids[k]);
    expect(listed).not.toContain(ids.Gcu);
    expect(listed).not.toContain(ids.P4);
    expect(JSON.stringify(sched)).not.toMatch(/_iqd/);
    expect(failed(r, 'sched_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });

    const g = data<Json>(r, 'roster_g');
    const roster = g.roster as Json[];
    const by = (id: string) => roster.find((x) => x.enrolment_id === id)!;
    expect(by(ids.eG1a!)).toMatchObject({
      name: names.g2,
      phone: '+9647711120002',
      booked_by: 'guest',
    });
    // R44: as typed, never the matched account (g3), never a hint that it matched.
    expect(by(ids.eG1b!)).toMatchObject({
      name: 'Typed Tariq',
      phone: TYPED_PHONE,
      booked_by: 'coach',
    });
    expect(JSON.stringify(g)).not.toContain('Pendingova');
    // P13: no phone while held.
    expect(by(ids.eG1c!)).toMatchObject({ status: 'held', phone: null });
    expect(leaks(g, profileIds(), [])).toEqual([]);
    expect(JSON.stringify(g)).not.toMatch(/_iqd|price/);
    expect(g.can).toMatchObject({
      add: true,
      remove: true,
      cancel: true,
      cancel_course: false,
      reschedule: true,
      mark: false,
    });

    const c = data<Json>(r, 'roster_c');
    expect((c.lesson as Json).places_taken).toBe(1);
    expect((c.course as Json).sessions as Json[]).toHaveLength(4);
    expect((c.roster as Json[]).map((x) => x.enrolment_id)).toEqual([ids.eC1]);
    expect(c.can).toMatchObject({ cancel: false, cancel_course: true });

    // CD-3 / R54: 9 days after, the name is the purge marker and the phone gone;
    // 3 days after, the typed phone is still there.
    expect((data<Json>(r, 'roster_p1').roster as Json[])[0]).toMatchObject({
      name: 'Walk-in',
      phone: null,
    });
    expect(JSON.stringify(data(r, 'roster_p1'))).not.toContain('Studentova');
    expect((data<Json>(r, 'roster_p2').roster as Json[])[0]).toMatchObject({
      name: 'Recent Rami',
      phone: RECENT_PHONE,
    });

    expect(failed(r, 'roster_other').code).toBe('LESSON_NOT_FOUND');
    expect(failed(r, 'roster_cr').code).toBe('NOT_A_COACH');
    expect(failed(r, 'sched_cr').code).toBe('NOT_A_COACH');
    expect(failed(r, 'sched_g1').code).toBe('NOT_A_COACH');
  });

  it('the desk: the envelope (R20), typed labels (R44), a pending link reads like a walk-in (C-21)', () => {
    const list = data<Json>(r, 'desk_list2');
    expect(list).toMatchObject({ coaching_enabled: true, lesson_payment_mode: 'desk' });
    const coaches = (list.coaches as Json[]).map((c) => c.coach_id).sort();
    // Active and paused coaches at the branch, accepted or not; never retired.
    expect(coaches).toEqual([ids.co_ca, ids.co_cu, ids.co_cp].sort());
    const lessons = list.lessons as Json[];
    const l1 = lessons.find((l) => l.lesson_id === ids.L1)!;
    expect(l1).toMatchObject({
      kind: 'private',
      label: names.g1,
      party_size: 2,
      owing: 1,
      owing_iqd: 30000,
      enrolments: 1,
    });
    const g1 = lessons.find((l) => l.lesson_id === ids.G1)!;
    expect(g1).toMatchObject({ kind: 'group', label: null, places_taken: 3, enrolments: 3 });
    expect(lessons.some((l) => l.lesson_id === ids.C1_s1)).toBe(true);
    expect(lessons.find((l) => l.lesson_id === ids.C1_s1)!.course).toMatchObject({
      course_id: ids.C1,
      session_no: 1,
    });
    // P2 was booked by the coach for a typed walk-in.
    const past = (data<Json>(r, 'desk_list').lessons as Json[]).find(
      (l) => l.lesson_id === ids.P2,
    )!;
    expect(past).toMatchObject({ label: 'Recent Rami', booked_by_kind: 'coach' });
    expect(failed(r, 'desk_list_long')).toMatchObject({ code: 'INVALID_ARGUMENT', detail: 'p_to' });
    expect(failed(r, 'desk_list_guest').code).toBe('FORBIDDEN');

    const detail = data<Json>(r, 'desk_g1');
    const rows = detail.enrolments as Json[];
    const typed = rows.find((e) => e.enrolment_id === ids.eG1b)!;
    expect(typed).toMatchObject({
      full_name: 'Typed Tariq',
      phone: TYPED_PHONE,
      typed: true,
      customer_id: null,
      flags: [],
    });
    expect(rows.find((e) => e.enrolment_id === ids.eG1a)).toMatchObject({
      customer_id: ids.g2,
      typed: false,
      full_name: names.g2,
    });
    expect(JSON.stringify(detail)).not.toContain('Pendingova');
    expect((detail.lesson as Json).can).toMatchObject({
      add_student: true,
      cancel: true,
      cancel_course: false,
      reschedule: true,
      move_court: true,
    });
    expect(failed(r, 'desk_nil').code).toBe('LESSON_NOT_FOUND');

    const cust = data<Json>(r, 'cust_g2');
    expect((cust.lessons as Json[]).map((l) => l.enrolment_id).sort()).toEqual(
      [ids.eG1a, ids.eC1].sort(),
    );
    expect(cust.coach).toBeNull();
    // A pending link never reaches the customer record (C-21).
    expect(data<Json>(r, 'cust_g3').lessons).toEqual([]);
    // g1's confirmed typed row (P1) is theirs, so it is on the record.
    expect((data<Json>(r, 'cust_g1').lessons as Json[]).map((l) => l.enrolment_id)).toContain(
      ids.eP1,
    );
    expect(failed(r, 'cust_nil').code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('coaching off: the public reads answer {off: true}; the desk still stages (R51); the guest keeps their lessons', () => {
    expect(data(r, 'off_pub')).toEqual({ off: true });
    const all = data<Json>(r, 'off_pub_all');
    expect(
      all.off === true || !((all.branches as Json[]) ?? []).some((b) => b.venue_id === ids.v),
    ).toBe(true);
    expect(data(r, 'off_prof')).toEqual({ off: true });
    expect(data(r, 'off_prof_null')).toEqual({ off: true });
    expect(data(r, 'off_slots')).toEqual({ off: true });
    expect(data(r, 'off_offer')).toEqual({ off: true });
    expect(data<Json>(r, 'off_slots_desk')).toMatchObject({ off: false, bookable: true });
    // The coach about themselves, with coaching off (coach mode keeps working, R45).
    expect(data<Json>(r, 'off_slots_self')).toMatchObject({ off: false, bookable: true });
    expect(data<Json[]>(r, 'off_my').map((x) => x.enrolment_id)).toEqual([ids.eG1a, ids.eC1]);
    expect(data<Json>(r, 'off_desk')).toMatchObject({ coaching_enabled: false });
    expect(((data<Json>(r, 'off_desk').lessons as Json[]) ?? []).length).toBeGreaterThan(0);
    expect(((data<Json>(r, 'off_sched').lessons as Json[]) ?? []).length).toBeGreaterThan(0);
  });
});

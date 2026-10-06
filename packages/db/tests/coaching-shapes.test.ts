/**
 * Every coaching write answers its contracted shape on the fresh and the duplicate path (plan
 * "Coaching: make it bulletproof" TG-09; build contracts R41, R72; DB-14). In one rolled-back
 * transaction (coaching-core-harness.ts) each write below runs twice, the second time as a
 * replay (the same idempotency key) or a repeat of the same state change, and
 * `missingKeys(answer, COACHING_SHAPES[name])` must be empty both times; where the shape carries
 * `duplicate`, the first answer says false and the second true.
 *
 * Plus a coverage pin: every name in COACHING_SHAPES is checked by at least one test (as
 * `COACHING_SHAPES.<name>`, `COACHING_SHAPES['<name>']`, or a quoted name in a suite that checks
 * shapes by a table of names).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COACHING_SHAPES,
  missingKeys,
  type CoachingShapeName,
} from '../../core/src/coaching/shapes';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, data, E, failed, FROM, K, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** One write: its shape, who calls it, the SQL; the duplicate path repeats the same SQL. */
interface Write {
  name: CoachingShapeName;
  who: string;
  sql: string;
  /** Kept from the fresh answer for later steps: [var, json path]. */
  keep?: ReadonlyArray<readonly [string, string]>;
  /** The repeat is refused with this code instead (a write with no duplicate path by contract). */
  refused?: string;
}

const W = (
  name: CoachingShapeName,
  who: string,
  sql: string,
  keep?: ReadonlyArray<readonly [string, string]>,
  refused?: string,
): Write => ({ name, who, sql, keep, refused });

const ALL_DAY = `(select jsonb_agg(jsonb_build_object('weekday', d, 'start', '00:00', 'end', '24:00'))
                    from generate_series(0, 6) d)`;

/** In call order: later writes use what earlier ones kept. */
const WRITES: Write[] = [
  // ── the desk creates and books ──────────────────────────────────────────
  W(
    'desk_create_group',
    'desk',
    `select app.desk_create_group({{c1}}, {{lt_g}}, ${at(2, 2)}, 'k-s-dcg')`,
    [['G', 'lesson_id']],
  ),
  W(
    'desk_create_course',
    'desk',
    `select app.desk_create_course({{c1}}, {{lt_c}},
       array[${at(20)}, ${at(21)}, ${at(22)}, ${at(23)}]::timestamptz[], 'Spring', 'ربيع', 'k-s-dcc')`,
    [['Kd', 'course_id']],
  ),
  W(
    'desk_book_lesson',
    'desk',
    `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${at(5)}, null, 'Walk In', null, 1, 'k-s-dbl')`,
    [['DBL', 'lesson_id']],
  ),
  W(
    'desk_add_student',
    'desk',
    `select app.desk_add_student({{G}}, null, null, 'Walk G', null, 'k-s-das')`,
    [['DAS_e', 'enrolment_id']],
  ),
  // ── guests ──────────────────────────────────────────────────────────────
  W(
    'lesson_book_private',
    's1',
    `select app.lesson_book_private({{c1}}, {{lt_p}}, ${at(2)}, 1, '{}'::text[], 'desk', 30000, 'k-s-lbp')`,
    [['LBP_e', 'enrolment_id']],
  ),
  W('lesson_join', 's2', `select app.lesson_join({{G}}, 'desk', 15000, 'k-s-lj')`),
  W('course_join', 's3', `select app.course_join({{Kd}}, 'desk', 80000, 'k-s-cj')`),
  W('lesson_cancel_mine', 's1', `select app.lesson_cancel_mine({{LBP_e}})`),
  // ── the coach ───────────────────────────────────────────────────────────
  W(
    'coach_add_student',
    'g1',
    `select app.coach_add_student({{G}}, null, 'Mona', '+964 779 001 2345', 'k-s-cas')`,
    [['CAS_e', 'enrolment_id']],
  ),
  W('lesson_link_confirm', 's4', `select app.lesson_link_confirm({{CAS_e}}, true)`),
  W(
    'coach_book_private',
    'g1',
    `select app.coach_book_private({{lt_p}}, {{v}}, ${at(3)}, 'Student', null, 1, 'k-s-cbp')`,
    [['CBP', 'lesson_id']],
  ),
  W('coach_reschedule_session', 'g1', `select app.coach_reschedule_session({{CBP}}, ${at(3, 4)})`),
  W(
    'coach_create_group',
    'g1',
    `select app.coach_create_group({{lt_g}}, {{v}}, ${at(3, 8)}, 'k-s-ccg')`,
    [['CCG', 'lesson_id']],
  ),
  W(
    'coach_create_course',
    'g1',
    `select app.coach_create_course({{lt_c}}, {{v}},
       array[${at(30)}, ${at(31)}, ${at(32)}, ${at(33)}]::timestamptz[], '', '', 'k-s-ccc')`,
    [['CCC', 'course_id']],
  ),
  W(
    'coach_add_student',
    'g1',
    `select app.coach_add_student({{CCG}}, null, 'Zaid', null, 'k-s-cas2')`,
    [['CAS2_e', 'enrolment_id']],
  ),
  W('coach_remove_student', 'g1', `select app.coach_remove_student({{CAS2_e}}, 'other')`),
  W('coach_cancel_lesson', 'g1', `select app.coach_cancel_lesson({{CCG}}, 'coach_unavailable')`),
  W('coach_cancel_course', 'g1', `select app.coach_cancel_course({{CCC}}, 'coach_unavailable')`),
  W('coach_accept_public', 'g2', `select app.coach_accept_public()`),
  W('set_my_coach_hours', 'g2', `select app.set_my_coach_hours({{v}}, ${ALL_DAY})`),
  W('add_my_time_off', 'g2', `select app.add_my_time_off(${at(40)}, ${at(41)}, 'clinic')`, [
    ['MTO', 'id'],
  ]),
  W('cancel_my_time_off', 'g2', `select app.cancel_my_time_off({{MTO}})`),
  // ── the desk on what exists ─────────────────────────────────────────────
  W('desk_reschedule_session', 'desk', `select app.desk_reschedule_session({{G}}, ${at(2, 6)})`),
  W(
    'desk_move_lesson_court',
    'desk',
    `select app.desk_move_lesson_court({{DBL}}, {{other_court}})`,
  ),
  W(
    'desk_cancel_enrolment',
    'desk',
    `select app.desk_cancel_enrolment({{DAS_e}}, 'customer_request')`,
  ),
  W('desk_cancel_lesson', 'desk', `select app.desk_cancel_lesson({{DBL}}, 'staff_error')`),
  W('desk_cancel_course', 'desk', `select app.desk_cancel_course({{Kd}}, 'staff_error')`),
  // ── attendance on a lesson under way (CBP moved to have started an hour ago) ──
  W(
    'coach_mark_attendance',
    'g1',
    `select app.coach_mark_attendance({{CBP}}, {{CBP_e}}, 'attended')`,
  ),
  W(
    'desk_mark_attendance',
    'desk',
    `select app.desk_mark_attendance({{CBP}}, {{CBP_e}}, 'no_show')`,
  ),
  // ── staff: settings, coaches, types ─────────────────────────────────────
  W(
    'set_coaching_settings',
    'owner',
    `select app.set_coaching_settings({{v}}, '{"coach_max_open_private": 5}'::jsonb)`,
  ),
  W(
    'coach_promote',
    'owner',
    `select app.coach_promote({{g5}}, 'Coach Five', 'المدرّب ٥', 'Bio', 'سيرة', null, array[{{v}}]::uuid[])`,
    undefined,
    // db.md §4.6.1: a coach row not retired is ALREADY_COACH; `duplicate` is always false.
    'ALREADY_COACH',
  ),
  W('coach_update', 'manager', `select app.coach_update({{c3}}, '{"bio_en": "New bio"}'::jsonb)`),
  W('set_coach_branches', 'owner', `select app.set_coach_branches({{c3}}, array[{{v}}]::uuid[])`),
  W(
    'set_coach_lesson_types',
    'manager',
    `select app.set_coach_lesson_types({{c3}}, {{v}}, array[{{lt_p}}, {{lt_g}}]::uuid[])`,
  ),
  W('set_coach_price', 'owner', `select app.set_coach_price({{c3}}, {{lt_p}}, 26000)`),
  W('set_coach_hours', 'owner', `select app.set_coach_hours({{c3}}, {{v}}, ${ALL_DAY})`),
  W(
    'add_coach_time_off',
    'owner',
    `select app.add_coach_time_off({{c3}}, ${at(40)}, ${at(41)}, 'trip')`,
    [['CTO', 'id']],
  ),
  W('cancel_coach_time_off', 'owner', `select app.cancel_coach_time_off({{CTO}})`),
  W('set_coach_status', 'manager', `select app.set_coach_status({{c3}}, 'paused', null)`),
  W(
    'upsert_lesson_type',
    'manager',
    `select app.upsert_lesson_type({{v}}, {{lt_d}}, '{"price_iqd": 13000, "name_en": "Draft group"}'::jsonb)`,
  ),
];

/** A label per write, numbered where a name repeats. */
function labelled(): Array<Write & { label: string }> {
  const seen = new Map<string, number>();
  return WRITES.map((w) => {
    const n = (seen.get(w.name) ?? 0) + 1;
    seen.set(w.name, n);
    return { ...w, label: n === 1 ? w.name : `${w.name}_${n}` };
  });
}

function steps(): string[] {
  const out: string[] = [];
  for (const w of labelled()) {
    if (w.name === 'coach_mark_attendance') {
      // The lesson started an hour ago (a mark needs a started lesson).
      out.push(
        K('CBP_e', `select id::text from lesson_enrolments where lesson_id = {{CBP}}::uuid`),
        X(`update lessons set start_at = now() - interval '1 hour', end_at = now()
            where id = {{CBP}}::uuid`),
      );
    }
    if (w.name === 'desk_move_lesson_court') {
      out.push(
        K(
          'other_court',
          `select c.id::text from courts c
            where c.venue_id = {{v}}::uuid
              and c.id <> (select r.court_id from reservations r
                            where r.lesson_id = {{DBL}}::uuid and r.status = 'confirmed')
            limit 1`,
        ),
      );
    }
    out.push(E(w.label, w.who, w.sql));
    for (const [name, p] of w.keep ?? []) out.push(FROM(name, w.label, p));
    out.push(E(`${w.label}__dup`, w.who, w.sql));
  }
  return out;
}

describe.skipIf(!docker)(
  'coaching writes answer their shape, fresh and duplicate (TG-09, rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('ctg09', [
        SETUP,
        `select pg_temp.branch('v');`,
        X(`update venue_settings set cancellation_window_hours = 12 where venue_id = {{v}}::uuid`),
        `select pg_temp.guest('g1');`,
        `select pg_temp.guest('g2');`,
        `select pg_temp.guest('g3');`,
        `select pg_temp.guest('g5');`,
        ...['s1', 's2', 's3'].map((g) => `select pg_temp.guest('${g}');`),
        `select pg_temp.guest('s4', '{"verified": "9647790012345"}');`,
        `select pg_temp.coach('c1', 'g1', 'v');`,
        `select pg_temp.coach('c2', 'g2', 'v', '{"accepted": false}');`,
        `select pg_temp.coach('c3', 'g3', 'v');`,
        `select pg_temp.lt('lt_p', 'private', 'v');`,
        `select pg_temp.lt('lt_g', 'group', 'v');`,
        `select pg_temp.lt('lt_c', 'course', 'v');`,
        `select pg_temp.lt('lt_d', 'group', 'v', '{"launched_at": null, "is_active": false}');`,
        ...['lt_p', 'lt_g', 'lt_c'].map((t) => `select pg_temp.teach('c1', '${t}');`),
        `select pg_temp.teach('c3', 'lt_p');`,
        E('settings', 'manager', `select app.coaching_settings({{v}})`),
        ...steps(),
      ]);
    });

    it('coaching_settings answers its shape', () => {
      expect(missingKeys(data(r, 'settings'), COACHING_SHAPES.coaching_settings)).toEqual([]);
    });

    it.each(labelled().map((w) => [w.label, w.name, w.refused] as const))(
      '%s',
      (label, name, refusedWith) => {
        const shape = COACHING_SHAPES[name];
        const fresh = data<Json>(r, label);
        expect(missingKeys(fresh, shape), 'fresh').toEqual([]);
        if (refusedWith) {
          expect(failed(r, `${label}__dup`).code).toBe(refusedWith);
          if (shape.keys.includes('duplicate')) expect(fresh.duplicate).toBe(false);
          return;
        }
        const dup = data<Json>(r, `${label}__dup`);
        expect(missingKeys(dup, shape), 'duplicate').toEqual([]);
        if (shape.keys.includes('duplicate')) {
          expect(fresh.duplicate, 'fresh.duplicate').toBe(false);
          expect(dup.duplicate, 'dup.duplicate').toBe(true);
        }
      },
    );
  },
);

describe('every coaching shape is checked by a test (TG-09)', () => {
  it('names each COACHING_SHAPES entry somewhere in the suites', () => {
    const dirs = [
      path.resolve(import.meta.dirname),
      path.resolve(import.meta.dirname, '../../core/src/coaching'),
    ];
    const texts = dirs.flatMap((d) =>
      readdirSync(d)
        .filter((f) => /\.test\.ts$/.test(f))
        .map((f) => readFileSync(path.join(d, f), 'utf8')),
    );
    const checking = texts.filter((t) => t.includes('COACHING_SHAPES'));
    const unchecked = (Object.keys(COACHING_SHAPES) as CoachingShapeName[]).filter(
      (k) =>
        !texts.some(
          (t) => t.includes(`COACHING_SHAPES.${k}`) || t.includes(`COACHING_SHAPES['${k}']`),
        ) && !checking.some((t) => t.includes(`'${k}'`)),
    );
    expect(unchecked).toEqual([]);
  });
});

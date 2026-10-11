/**
 * Coaching, 0335 coach_book_students: coach mode's "Book for a student", K4
 * (owner, 2026-10-11).
 *
 * In one rolled-back transaction (coaching-core-harness.ts):
 *   * the student's phone is required (missing or not a number: refused);
 *   * the other students: names and phones by position, '' for none, at most
 *     one phone per name and party_size - 1 names; a bad phone refused;
 *   * the saved students: one per phone, newest booking's name first, never a
 *     phone; another coach's students are not listed;
 *   * booking a saved student again with no phone takes the stored phone; a
 *     key that is not the caller's own coach booking is refused;
 *   * the coach's roster and the desk's lesson show the other students' phones
 *     (0336);
 *   * emptying friend_names (every scrub does) empties friend_phones.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, code, data, E, FROM, R, SETUP } from './coaching-core-harness';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const P1 = '9647711113331';
const P2 = '9647711113332';
const P3 = '9647711113333';

/** The coach of `who` books lt_p4 at `when`. */
const CB = (
  label: string,
  who: string,
  when: string,
  o: {
    name?: string;
    phone?: string | null;
    party?: number;
    friends?: string;
    phones?: string;
    saved?: string;
  } = {},
) =>
  E(
    label,
    who,
    `select app.coach_book_private({{lt_p4}}, {{v}}, ${when}, '${o.name ?? 'Student'}', ` +
      `${o.phone === null ? 'null' : `'${o.phone ?? P1}'`}, ${o.party ?? 1}, 'k-${label}', ` +
      `${o.friends ?? `'{}'::text[]`}, ${o.phones ?? `'{}'::text[]`}, ` +
      `${o.saved ? `{{${o.saved}}}::uuid` : 'null'})`,
  );

/** The enrolment a recorded booking made, as its stored students. */
const ROW = (label: string, from: string) => [
  FROM(`${from}_e`, from, 'enrolment_id'),
  R(
    label,
    `select jsonb_build_object('name', e.guest_name, 'phone', e.guest_phone,
            'friends', to_jsonb(e.friend_names), 'phones', to_jsonb(e.friend_phones))
       from lesson_enrolments e where e.id = {{${from}_e}}::uuid`,
  ),
];

const BODY: string[] = [
  SETUP,
  `select pg_temp.branch('v');`,
  `select pg_temp.guest('g1');`,
  `select pg_temp.guest('g2');`,
  `select pg_temp.guest('s1');`,
  `select pg_temp.coach('c1', 'g1', 'v');`,
  `select pg_temp.coach('c2', 'g2', 'v');`,
  `select pg_temp.lt('lt_p4', 'private', 'v', '{"max_places": 4}');`,
  `select pg_temp.teach('c1', 'lt_p4');`,
  `select pg_temp.teach('c2', 'lt_p4');`,

  // ── the student's phone is required ─────────────────────────────────────
  CB('no_phone', 'g1', at(2), { phone: null }),
  CB('bad_phone', 'g1', at(2), { phone: '12' }),

  // ── the other students ──────────────────────────────────────────────────
  CB('party', 'g1', at(2), {
    name: 'Sara',
    party: 3,
    friends: `array['Ali', 'Omar']`,
    phones: `array['${P3}', '']`,
  }),
  ...ROW('party_row', 'party'),
  // 0336: the coach's roster and the desk's lesson show them.
  FROM('party_l', 'party', 'lesson_id'),
  E('party_roster', 'g1', `select app.coach_lesson({{party_l}}::uuid)`),
  E('party_desk', 'desk', `select app.desk_lesson_detail({{party_l}}::uuid)`),
  CB('too_many_phones', 'g1', at(3), {
    party: 2,
    friends: `array['Ali']`,
    phones: `array['${P3}', '${P3}']`,
  }),
  CB('bad_friend_phone', 'g1', at(3), { party: 2, friends: `array['Ali']`, phones: `array['12']` }),
  CB('too_many_names', 'g1', at(3), { party: 2, friends: `array['Ali', 'Omar']` }),
  CB('no_phones', 'g1', at(3), { name: 'Huda', phone: P2, party: 2, friends: `array['Zaid']` }),
  ...ROW('no_phones_row', 'no_phones'),

  // ── saved students ──────────────────────────────────────────────────────
  CB('again', 'g1', at(4), { name: 'Sara M' }),
  CB('other_coach', 'g2', at(5), { name: 'Not Mine', phone: '9647711113339' }),
  FROM('other_coach_e', 'other_coach', 'enrolment_id'),
  E('saved', 'g1', `select app.coach_saved_students()`),
  E('saved_stranger', 's1', `select app.coach_saved_students()`),
  FROM('saved_k', 'saved', 'students,0,key'),
  CB('from_saved', 'g1', at(6), { name: 'Sara M', phone: null, saved: 'saved_k' }),
  ...ROW('from_saved_row', 'from_saved'),
  CB('foreign_saved', 'g1', at(7), { name: 'X', phone: null, saved: 'other_coach_e' }),

  // ── a scrub that empties friend_names empties friend_phones ─────────────
  X(`update lesson_enrolments set friend_names = '{}'::text[] where id = {{party_e}}::uuid`),
  R(
    'scrubbed',
    `select jsonb_build_object('friends', to_jsonb(e.friend_names), 'phones', to_jsonb(e.friend_phones))
       from lesson_enrolments e where e.id = {{party_e}}::uuid`,
  ),
];

describe.skipIf(!docker)('0335 coach books students, one transaction', () => {
  let r: Results;
  beforeAll(() => {
    r = scenario('c334', BODY);
  });

  it('shows the other students’ phones in the coach’s roster and at the desk (0336)', () => {
    const roster = data<{ roster: Json[] }>(r, 'party_roster').roster;
    expect(missingKeys(data(r, 'party_roster'), COACHING_SHAPES.coach_lesson)).toEqual([]);
    expect(roster[0]).toMatchObject({
      phone: P1,
      friend_names: ['Ali', 'Omar'],
      friend_phones: [P3, ''],
    });
    const desk = data<{ enrolments: Json[] }>(r, 'party_desk');
    expect(missingKeys(desk, COACHING_SHAPES.desk_lesson_detail)).toEqual([]);
    expect(desk.enrolments[0]).toMatchObject({
      friend_names: ['Ali', 'Omar'],
      friend_phones: [P3, ''],
    });
  });

  it('requires the student’s phone', () => {
    expect(code(r, 'no_phone')).toBe('INVALID_ARGUMENT:p_student_phone');
    expect(code(r, 'bad_phone')).toBe('INVALID_ARGUMENT:p_student_phone');
  });

  it('keeps the other students’ names and phones by position', () => {
    expect(missingKeys(data(r, 'party'), COACHING_SHAPES.coach_book_private)).toEqual([]);
    expect(data<Json>(r, 'party_row')).toEqual({
      name: 'Sara',
      phone: P1,
      friends: ['Ali', 'Omar'],
      phones: [P3, ''],
    });
    expect(data<Json>(r, 'no_phones_row')).toEqual({
      name: 'Huda',
      phone: P2,
      friends: ['Zaid'],
      phones: [],
    });
    expect(code(r, 'too_many_phones')).toBe('INVALID_ARGUMENT:p_friend_phones');
    expect(code(r, 'bad_friend_phone')).toBe('INVALID_ARGUMENT:p_friend_phones');
    expect(code(r, 'too_many_names')).toBe('INVALID_ARGUMENT:p_friend_names');
  });

  it('lists the coach’s own students once per phone, newest name, never a phone', () => {
    const students = data<{ students: Json[] }>(r, 'saved').students;
    expect(students.map((s) => s.name)).toEqual(['Sara M', 'Huda']);
    expect(students[0]).toMatchObject({ lessons: 2 });
    expect(students[1]).toMatchObject({ lessons: 1 });
    for (const s of students)
      expect(Object.keys(s).sort()).toEqual(['key', 'last_at', 'lessons', 'name']);
    expect(JSON.stringify(students)).not.toContain(P1);
    expect(code(r, 'saved_stranger')).toBe('NOT_A_COACH');
  });

  it('books a saved student again with their stored phone; another coach’s is refused', () => {
    expect(data<Json>(r, 'from_saved_row')).toMatchObject({ name: 'Sara M', phone: P1 });
    expect(code(r, 'foreign_saved')).toBe('INVALID_ARGUMENT:p_saved_student');
  });

  it('empties the friends’ phones with their names', () => {
    expect(data<Json>(r, 'scrubbed')).toEqual({ friends: [], phones: [] });
  });
});

import { describe, expect, it } from 'vitest';
import {
  COACHING_SHAPES,
  PUBLIC_COACHING_READS,
  hasKeys,
  missingKeys,
  type CoachingShape,
  type CoachingShapeName,
} from './shapes';

const entries = Object.entries(COACHING_SHAPES) as Array<[CoachingShapeName, CoachingShape]>;

/** 'a[].b[]' → { parent: 'a[]', name: 'b' }; 'a' → { parent: '', name: 'a' }. */
function splitPath(path: string): { parent: string; name: string } {
  const at = path.lastIndexOf('.');
  const last = at < 0 ? path : path.slice(at + 1);
  return { parent: at < 0 ? '' : path.slice(0, at), name: last.replace(/\[\]$/, '') };
}

/** The keys one level of a shape lists: the root's, or a nested path's, plus its optional ones. */
function keysAt(shape: CoachingShape, level: string): string[] {
  const listed = level === '' ? [...shape.keys] : [...(shape.nested?.[level] ?? [])];
  for (const opt of shape.optional ?? []) {
    const { parent, name } = splitPath(opt);
    if (parent === level) listed.push(name);
  }
  if (level === '') for (const group of shape.oneOf ?? []) listed.push(...group);
  return listed;
}

/** A smallest answer that carries every key of `shape` (leaves null, containers filled once). */
function sampleOf(shape: CoachingShape): unknown {
  const build = (level: string): Record<string, unknown> => {
    const obj: Record<string, unknown> = {};
    const prefix = level === '' ? '' : `${level}.`;
    for (const key of keysAt(shape, level)) {
      if (shape.nested?.[`${prefix}${key}[]`]) obj[key] = [build(`${prefix}${key}[]`)];
      else if (shape.nested?.[`${prefix}${key}`]) obj[key] = build(`${prefix}${key}`);
      else obj[key] = null;
    }
    return obj;
  };
  return shape.array ? [build(''), build('')] : build('');
}

describe('COACHING_SHAPES: every list is well formed', () => {
  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(40);
  });

  it.each(entries)('%s: lists are non-empty and have no duplicate', (_name, shape) => {
    expect(shape.rpc.length).toBeGreaterThan(0);
    expect(shape.x === null || /^X\d+$/.test(shape.x)).toBe(true);
    const lists: Array<readonly string[]> = [
      shape.keys,
      ...Object.values(shape.nested ?? {}),
      ...(shape.oneOf ?? []),
    ];
    for (const list of lists) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
      for (const key of list) expect(key).toMatch(/^[a-z][A-Za-z0-9_]*$/);
    }
    expect(new Set(shape.optional ?? []).size).toBe((shape.optional ?? []).length);
  });

  it.each(entries)(
    '%s: no key is both required and optional or in a oneOf group',
    (_name, shape) => {
      const required = new Set(shape.keys);
      for (const opt of shape.optional ?? []) {
        const { parent, name } = splitPath(opt);
        const level = parent === '' ? shape.keys : (shape.nested?.[parent] ?? []);
        expect(level).not.toContain(name);
      }
      for (const group of shape.oneOf ?? []) {
        expect(group.length).toBeGreaterThan(1);
        for (const key of group) expect(required.has(key)).toBe(false);
      }
    },
  );

  it.each(entries)('%s: every nested path hangs off a listed key of its parent', (_name, shape) => {
    for (const path of Object.keys(shape.nested ?? {})) {
      const { parent, name } = splitPath(path);
      if (parent !== '') expect(shape.nested?.[parent], `${path}: parent ${parent}`).toBeDefined();
      expect(keysAt(shape, parent), `${path}: ${name} under '${parent}'`).toContain(name);
      // A name is an array or an object, never both.
      const twin = path.endsWith('[]') ? path.slice(0, -2) : `${path}[]`;
      expect(shape.nested?.[twin]).toBeUndefined();
    }
    for (const opt of shape.optional ?? []) {
      const { parent } = splitPath(opt);
      if (parent !== '') expect(shape.nested?.[parent], `${opt}: parent ${parent}`).toBeDefined();
    }
  });

  it.each(entries)('%s: a full sample answer passes, and losing any key fails', (_name, shape) => {
    const sample = sampleOf(shape);
    expect(missingKeys(sample, shape)).toEqual([]);
    const row = (shape.array ? (sample as unknown[])[0] : sample) as Record<string, unknown>;
    for (const key of shape.keys) {
      const copy = { ...row };
      delete copy[key];
      const value = shape.array ? [copy] : copy;
      expect(missingKeys(value, shape)).toContain(shape.array ? `$[0].${key}` : `$.${key}`);
    }
  });
});

describe('COACHING_SHAPES: scope (R41, R72)', () => {
  it('covers every read of build contracts §1.6 and §1.7', () => {
    const reads = [
      // §1.6 public, guest, coach
      'coaching_public',
      'coach_profile',
      'coach_slots',
      'lesson_offer',
      'my_lessons',
      'my_lesson',
      'coach_me',
      'coach_schedule',
      'coach_hours_mine',
      'coach_lesson',
      'my_coach_statements',
      // §1.7 staff
      'coaching_settings',
      'coaches_admin',
      'desk_lessons',
      'desk_lesson_detail',
      'customer_lessons',
      'lesson_refunds_due',
      'report_coach_statements',
      'coach_statement_detail',
      'report_lessons',
    ];
    const names = new Set(entries.map(([, s]) => s.rpc));
    for (const rpc of reads) expect(names.has(rpc), rpc).toBe(true);
  });

  it('covers the write results the X table binds (X5, X6, X13, X29)', () => {
    const byX = (x: string) => entries.filter(([, s]) => s.x === x).map(([, s]) => s.rpc);
    expect(byX('X5').sort()).toEqual(['course_join', 'lesson_book_private', 'lesson_join']);
    expect(byX('X6')).toEqual(['lesson_cancel_mine']);
    expect(byX('X13').sort()).toEqual(['coach_create_course', 'desk_create_course']);
    expect(byX('X29')).toEqual(
      expect.arrayContaining([
        'desk_book_lesson',
        'desk_cancel_enrolment',
        'desk_cancel_course',
        'set_coach_status',
      ]),
    );
  });

  it('every key of an entry is its own name or a variant of its rpc', () => {
    for (const [name, shape] of entries) {
      expect(name === shape.rpc || name.startsWith(`${shape.rpc}_`)).toBe(true);
    }
  });

  it('pins the names the rulings fixed', () => {
    // X5: the enrolment's status, never the lesson's.
    expect(COACHING_SHAPES.lesson_book_private.keys).toContain('status');
    // X13: both lesson_ids and sessions.
    expect(COACHING_SHAPES.coach_create_course.keys).toEqual(
      expect.arrayContaining(['lesson_ids', 'sessions']),
    );
    // R72: owedToCoachesIqd, never coachShareIqd, on report_courts (an assistant tool, R42).
    const courts = COACHING_SHAPES.report_courts.nested?.lessons ?? [];
    expect(courts).toContain('owedToCoachesIqd');
    expect(courts).not.toContain('coachShareIqd');
    // R72: the statement detail's coach-booked no-shows are rows of {lesson_id, start_at, student_label}.
    expect(COACHING_SHAPES.coach_statement_detail.nested?.['coach_booked_no_shows[]']).toEqual([
      'lesson_id',
      'start_at',
      'student_label',
    ]);
    // X3: DB's envelope with starts[{start_at, end_at}].
    expect(COACHING_SHAPES.coach_slots.nested?.['starts[]']).toEqual(['start_at', 'end_at']);
    // X22: payable_iqd beside total_iqd.
    expect(COACHING_SHAPES.report_coach_statements.nested?.['statements[]']).toEqual(
      expect.arrayContaining(['total_iqd', 'payable_iqd']),
    );
  });
});

describe('public reads carry no person (R12, R43)', () => {
  /** Every key of a shape with its path ('venue.phone', 'coaches[].offers[].price_iqd'). */
  function allKeyPaths(shape: CoachingShape): string[] {
    const out = [...shape.keys, ...(shape.optional ?? []), ...(shape.oneOf ?? []).flat()];
    for (const [path, keys] of Object.entries(shape.nested ?? {})) {
      for (const key of keys) out.push(`${path}.${key}`);
    }
    return out;
  }

  // The only phone a public read carries is the branch's.
  const BRANCH_PHONES: Record<string, readonly string[]> = {
    lesson_offer: ['phone'],
    coach_profile: ['venue.phone'],
  };
  const PERSON =
    /(^|\.)(profile_id|guest_id|customer_id|guest_name|guest_phone|full_name|friend_names|court_id|name|label|roster)$|student/;

  it.each(PUBLIC_COACHING_READS.map((n) => [n]))('%s', (name) => {
    const shape = COACHING_SHAPES[name];
    for (const path of allKeyPaths(shape)) {
      expect(path, `${name}: ${path}`).not.toMatch(PERSON);
      if (/(^|\.)phone$/.test(path)) expect(BRANCH_PHONES[name] ?? []).toContain(path);
    }
  });
});

describe('missingKeys / hasKeys', () => {
  const shape = COACHING_SHAPES.coaching_public;
  const sample = () => sampleOf(shape) as Record<string, unknown>;

  it('passes a full answer and ignores extra keys', () => {
    const answer = { ...sample(), extra: 1 };
    expect(hasKeys(answer, shape)).toBe(true);
    expect(missingKeys(answer, shape)).toEqual([]);
  });

  it('counts a null value as carried', () => {
    const answer = sample();
    answer.server_now = null;
    expect(hasKeys(answer, shape)).toBe(true);
  });

  it('names a missing top-level key and a missing nested key by JSON path', () => {
    const answer = sample();
    delete answer.server_now;
    const coaches = answer.coaches as Array<Record<string, unknown>>;
    const offers = coaches[0]?.offers as Array<Record<string, unknown>>;
    delete offers[0]?.price_iqd;
    expect(missingKeys(answer, shape)).toEqual([
      '$.server_now',
      '$.coaches[0].offers[0].price_iqd',
    ]);
    expect(hasKeys(answer, shape)).toBe(false);
  });

  it('checks every element of an array', () => {
    const answer = sample();
    const sessions = answer.sessions as Array<Record<string, unknown>>;
    const second = { ...(sessions[0] as Record<string, unknown>) };
    delete second.places_left;
    sessions.push(second);
    expect(missingKeys(answer, shape)).toEqual(['$.sessions[1].places_left']);
  });

  it('skips a nested object or array that is null or absent, and reports a wrong container', () => {
    const profile = COACHING_SHAPES.coach_profile;
    const answer = sampleOf(profile) as Record<string, unknown>;
    answer.venue = null; // R17: the /c/<id> card names no branch
    expect(hasKeys(answer, profile)).toBe(true);
    answer.offers = { not: 'an array' };
    expect(missingKeys(answer, profile)).toEqual(['$.offers']);
    answer.offers = [];
    answer.coach = 'not an object';
    expect(missingKeys(answer, profile)).toEqual(['$.coach']);
  });

  it('applies oneOf: a group session offer carries lesson_id, a course offer course_id', () => {
    const offer = COACHING_SHAPES.lesson_offer;
    const group = sampleOf(offer) as Record<string, unknown>;
    expect(group).toHaveProperty('lesson_id');
    expect(hasKeys(group, offer)).toBe(true);
    const course: Record<string, unknown> = { ...group, course_id: 'c' };
    delete course.lesson_id;
    expect(hasKeys(course, offer)).toBe(true);
    delete course.course_id;
    expect(missingKeys(course, offer)).toEqual(['$.(lesson_id|course_id)']);
  });

  it('lets an optional array be absent but checks it when present', () => {
    const offer = COACHING_SHAPES.lesson_offer;
    const answer = sampleOf(offer) as Record<string, unknown>;
    delete answer.sessions;
    expect(hasKeys(answer, offer)).toBe(true);
    answer.sessions = [{ lesson_id: 'l' }];
    expect(missingKeys(answer, offer)).toContain('$.sessions[0].session_no');
  });

  it('reads a bare-array answer row by row', () => {
    const mine = COACHING_SHAPES.my_lessons;
    const rows = sampleOf(mine) as Array<Record<string, unknown>>;
    expect(hasKeys(rows, mine)).toBe(true);
    expect(hasKeys([], mine)).toBe(true);
    delete rows[1]?.owed_iqd;
    expect(missingKeys(rows, mine)).toEqual(['$[1].owed_iqd']);
    expect(missingKeys({ rows }, mine)).toEqual(['$']);
  });

  it('refuses a non-object answer', () => {
    expect(missingKeys(null, shape)).toEqual(['$']);
    expect(missingKeys('x', shape)).toEqual(['$']);
    expect(missingKeys([], shape)).toEqual(['$']);
  });

  it('accepts a bare key list for a flat check', () => {
    expect(hasKeys({ a: 1, b: null }, ['a', 'b'])).toBe(true);
    expect(missingKeys({ a: 1 }, ['a', 'b'])).toEqual(['$.b']);
  });

  it('never throws on hostile input', () => {
    const answer = sample();
    answer.coaches = [null, 3, 'x', { offers: 'no' }];
    expect(() => missingKeys(answer, shape)).not.toThrow();
    expect(missingKeys(answer, shape)).toEqual(
      expect.arrayContaining([
        '$.coaches[0]',
        '$.coaches[1]',
        '$.coaches[2]',
        '$.coaches[3].offers',
      ]),
    );
  });
});

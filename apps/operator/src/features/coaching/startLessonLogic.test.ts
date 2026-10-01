import { describe, expect, it } from 'vitest';
import { wallTimeToUtc } from '@touch/core';
import type { DeskCoach, DeskLessonType } from './lessonPayloads';
import {
  coachesFor,
  cutoffAtOf,
  cutoffPassed,
  gridStarts,
  initialStart,
  kindsOnSale,
  localDayWindow,
  priceFor,
  slotChoice,
  startArgs,
  startDraftErrors,
  startOf,
  startsErrors,
  typesOfKind,
  weeklyStarts,
  type StartDraft,
} from './startLessonLogic';

const TZ = 'Asia/Baghdad';
const at = (date: string, hh: number, mm = 0) =>
  wallTimeToUtc(date, hh * 60 + mm, TZ).toISOString();

function type(over: Partial<DeskLessonType> & { lesson_type_id: string }): DeskLessonType {
  return {
    kind: 'private',
    name_en: 'Private 60 min',
    name_ar: 'خاصة 60 دقيقة',
    duration_min: 60,
    price_iqd: 30000,
    max_places: 4,
    min_places: 1,
    cutoff_hours: 0,
    sessions_count: 1,
    ...over,
  };
}

function coach(over: Partial<DeskCoach> & { coach_id: string }): DeskCoach {
  return {
    display_name_en: 'Coach Sara',
    display_name_ar: 'المدرّبة سارة',
    status: 'active',
    photo_path: null,
    lesson_type_ids: ['p60'],
    prices: [],
    ...over,
  };
}

const TYPES = [
  type({ lesson_type_id: 'p60' }),
  type({
    lesson_type_id: 'g90',
    kind: 'group',
    duration_min: 90,
    price_iqd: 15000,
    max_places: 6,
    min_places: 3,
    cutoff_hours: 2,
  }),
  type({
    lesson_type_id: 'c8',
    kind: 'course',
    duration_min: 60,
    price_iqd: 120000,
    max_places: 6,
    min_places: 2,
    cutoff_hours: 2,
    sessions_count: 4,
  }),
];

describe('what New lesson offers (§5.9)', () => {
  it('kindsOnSale: only the kinds with a type on sale, in C-1 order', () => {
    expect(kindsOnSale(TYPES)).toEqual(['private', 'group', 'course']);
    expect(kindsOnSale([TYPES[2]!, TYPES[0]!])).toEqual(['private', 'course']);
    expect(kindsOnSale([])).toEqual([]);
    expect(typesOfKind(TYPES, 'group').map((t) => t.lesson_type_id)).toEqual(['g90']);
    expect(typesOfKind(TYPES, null)).toEqual([]);
  });

  it('coachesFor: who teaches the type, active first, a paused coach listed to be disabled', () => {
    const coaches = [
      coach({ coach_id: 'paused', status: 'paused' }),
      coach({ coach_id: 'other', lesson_type_ids: ['g90'] }),
      coach({ coach_id: 'sara' }),
    ];
    expect(coachesFor('p60', coaches).map((c) => [c.coach.coach_id, c.paused])).toEqual([
      ['sara', false],
      ['paused', true],
    ]);
    expect(coachesFor(null, coaches)).toEqual([]);
  });

  it("priceFor: the coach's own price once picked, else the type's; null stays null", () => {
    const t = TYPES[0]!;
    expect(priceFor(t, null)).toBe(30000);
    expect(
      priceFor(t, coach({ coach_id: 'c', prices: [{ lesson_type_id: 'p60', price_iqd: 35000 }] })),
    ).toBe(35000);
    expect(
      priceFor(t, coach({ coach_id: 'c', prices: [{ lesson_type_id: 'g90', price_iqd: 1 }] })),
    ).toBe(30000);
    expect(priceFor({ ...t, price_iqd: null }, null)).toBeNull();
    expect(priceFor(null, null)).toBeNull();
  });
});

describe('the grid and local days (C-20, R9)', () => {
  it('gridStarts: 48 starts a day, every one on :00 or :30', () => {
    const starts = gridStarts('2026-10-19', TZ);
    expect(starts).toHaveLength(48);
    expect(starts[0]).toEqual({ time: '00:00', startAt: at('2026-10-19', 0) });
    expect(starts[37]).toEqual({ time: '18:30', startAt: at('2026-10-19', 18, 30) });
  });

  it('initialStart: the pressed time on the grid, else the next grid start', () => {
    expect(initialStart(new Date(at('2026-10-19', 18)), TZ)).toEqual({
      date: '2026-10-19',
      time: '18:00',
    });
    expect(initialStart(new Date(at('2026-10-19', 18, 15)), TZ)).toEqual({
      date: '2026-10-19',
      time: '18:30',
    });
    expect(initialStart(new Date(at('2026-10-19', 23, 45)), TZ)).toEqual({
      date: '2026-10-20',
      time: '00:00',
    });
  });

  it('startOf and localDayWindow read the branch’s zone; malformed input is null', () => {
    expect(startOf('2026-10-19', '18:00', TZ)).toBe('2026-10-19T15:00:00.000Z');
    expect(startOf('2026-10-19', '25:00', TZ)).toBeNull();
    expect(startOf('19/10/2026', '18:00', TZ)).toBeNull();
    expect(localDayWindow('2026-10-19', TZ)).toEqual({
      fromIso: '2026-10-18T21:00:00.000Z',
      toIso: '2026-10-19T21:00:00.000Z',
    });
    expect(localDayWindow('nope', TZ)).toBeNull();
  });
});

describe('slotChoice (private starts from coach_slots)', () => {
  const starts = [
    { start_at: '2026-10-19T15:00:00+00:00' },
    { start_at: '2026-10-19T15:30:00+00:00' },
  ];

  it('pre-selects the pressed time when it is one of the free starts (instants, not strings)', () => {
    expect(slotChoice(starts, '2026-10-19T15:30:00.000Z')).toEqual({
      state: 'pressed',
      startAt: '2026-10-19T15:30:00+00:00',
    });
  });

  it("says the coach isn't free at a pressed time outside them", () => {
    expect(slotChoice(starts, '2026-10-19T17:00:00.000Z')).toEqual({ state: 'notFree' });
  });

  it('nothing pressed: pick; no starts at all: none', () => {
    expect(slotChoice(starts, null)).toEqual({ state: 'pick' });
    expect(slotChoice([], '2026-10-19T15:30:00.000Z')).toEqual({ state: 'none' });
  });
});

describe('cutoffPassed (R47)', () => {
  const start = at('2026-10-19', 18);
  const cut = Date.parse(at('2026-10-19', 16));

  it('passes at the cut-off and after it, not before', () => {
    expect(cutoffAtOf(start, 2)).toBe(at('2026-10-19', 16));
    expect(cutoffPassed(start, 2, cut - 1)).toBe(false);
    expect(cutoffPassed(start, 2, cut)).toBe(true);
    expect(cutoffPassed(start, 2, cut + 60_000)).toBe(true);
  });

  it('a type with no cut-off never has one', () => {
    expect(cutoffAtOf(start, 0)).toBeNull();
    expect(cutoffPassed(start, 0, Date.parse(start))).toBe(false);
    expect(cutoffPassed(start, null, Date.parse(start))).toBe(false);
  });
});

describe('weeklyStarts (a course, §5.9)', () => {
  it('runs a week apart at the same local time, across a month end', () => {
    expect(weeklyStarts('2026-10-19', '18:00', 3, TZ)).toEqual([
      { date: '2026-10-19', time: '18:00' },
      { date: '2026-10-26', time: '18:00' },
      { date: '2026-11-02', time: '18:00' },
    ]);
  });

  it('two sessions and fifty-two', () => {
    expect(weeklyStarts('2026-12-29', '09:30', 2, TZ)).toEqual([
      { date: '2026-12-29', time: '09:30' },
      { date: '2027-01-05', time: '09:30' },
    ]);
    const year = weeklyStarts('2026-10-19', '18:00', 52, TZ);
    expect(year).toHaveLength(52);
    expect(year[51]).toEqual({ date: '2027-10-11', time: '18:00' });
    expect(new Set(year.map((r) => r.time))).toEqual(new Set(['18:00']));
  });

  it('nothing for a malformed start or count', () => {
    expect(weeklyStarts('2026-10-19', '18:00', 0, TZ)).toEqual([]);
    expect(weeklyStarts('2026-10-19', 'soon', 3, TZ)).toEqual([]);
  });
});

describe('startsErrors (COURSE_STARTS_INVALID and the per-start checks)', () => {
  const now = Date.parse(at('2026-10-19', 12));
  const ctx = { count: 3, durationMin: 60, cutoffHours: 2, tz: TZ, nowMs: now };
  const rows = weeklyStarts('2026-10-19', '18:00', 3, TZ);

  it('a clean list passes', () => {
    expect(startsErrors(rows, ctx)).toEqual({ form: null, rows: [null, null, null] });
  });

  it('count: one start per session', () => {
    expect(startsErrors(rows.slice(0, 2), ctx).form).toBe('count');
  });

  it('order: each session after the one before ends', () => {
    const overlapping = [rows[0]!, { date: '2026-10-19', time: '18:30' }, rows[2]!];
    expect(startsErrors(overlapping, ctx)).toEqual({ form: 'order', rows: [null, 'order', null] });
    const backwards = [rows[1]!, rows[0]!, rows[2]!];
    expect(startsErrors(backwards, ctx).form).toBe('order');
  });

  it('span: within a year of the first', () => {
    const long = [rows[0]!, rows[1]!, { date: '2027-10-20', time: '18:00' }];
    expect(startsErrors(long, ctx).form).toBe('span');
    const justInside = [rows[0]!, rows[1]!, { date: '2027-10-19', time: '18:00' }];
    expect(startsErrors(justInside, ctx).form).toBeNull();
  });

  it('per row: off the grid, in the past, missing; session 1 alone takes the cut-off', () => {
    expect(
      startsErrors([{ date: '2026-10-19', time: '18:15' }, rows[1]!, rows[2]!], ctx).rows[0],
    ).toBe('grid');
    expect(
      startsErrors([{ date: '2026-10-19', time: '11:00' }, rows[1]!, rows[2]!], ctx).rows[0],
    ).toBe('past');
    expect(startsErrors([rows[0]!, { date: '', time: '18:00' }, rows[2]!], ctx).rows[1]).toBe(
      'missing',
    );
    // 13:00 today: after now, but inside its two-hour cut-off.
    expect(
      startsErrors([{ date: '2026-10-19', time: '13:00' }, rows[1]!, rows[2]!], ctx).rows[0],
    ).toBe('cutoff');
    // The same start as a later session is fine: only session 1 is judged (R47).
    const laterSessionSoon = startsErrors(
      [
        { date: '2026-10-19', time: '13:00' },
        { date: '2026-10-19', time: '14:00' },
      ],
      { ...ctx, count: 2, cutoffHours: 0 },
    );
    expect(laterSessionSoon).toEqual({ form: null, rows: [null, null] });
  });
});

function draft(over: Partial<StartDraft> = {}): StartDraft {
  return {
    kind: 'private',
    typeId: 'p60',
    coachId: 'sara',
    startAt: at('2026-10-19', 18),
    rows: [],
    titleEn: '',
    titleAr: '',
    customerId: null,
    guestName: 'Ali Hasan',
    guestPhone: '0770 123 4567',
    partySize: 1,
    ...over,
  };
}

describe('startDraftErrors (what blocks Create)', () => {
  const coaches = [
    coach({ coach_id: 'sara', lesson_type_ids: ['p60', 'g90', 'c8'] }),
    coach({ coach_id: 'paused', status: 'paused', lesson_type_ids: ['p60'] }),
  ];
  const ctx = { types: TYPES, coaches, tz: TZ, nowMs: Date.parse(at('2026-10-19', 12)) };

  it('a full private draft passes', () => {
    expect(startDraftErrors(draft(), ctx)).toEqual([]);
  });

  it('kind, type, coach, a paused coach', () => {
    expect(startDraftErrors(draft({ kind: null }), ctx)).toEqual(['kind']);
    expect(startDraftErrors(draft({ typeId: 'g90' }), ctx)).toEqual(['type']);
    expect(startDraftErrors(draft({ coachId: null }), ctx)).toEqual(['coach']);
    expect(startDraftErrors(draft({ coachId: 'paused' }), ctx)).toEqual(['coachPaused']);
  });

  it('private: a start, a student (GUEST_REQUIRED mirror) and a party of 1..max_places', () => {
    expect(startDraftErrors(draft({ startAt: null }), ctx)).toEqual(['start']);
    expect(startDraftErrors(draft({ guestName: '  ' }), ctx)).toEqual(['student']);
    expect(startDraftErrors(draft({ guestName: '', customerId: 'cust-1' }), ctx)).toEqual([]);
    expect(startDraftErrors(draft({ partySize: 5 }), ctx)).toEqual(['party']);
    expect(startDraftErrors(draft({ partySize: 0 }), ctx)).toEqual(['party']);
  });

  it('group: on the grid, not past, not inside its cut-off', () => {
    const g = (startAt: string) =>
      startDraftErrors(draft({ kind: 'group', typeId: 'g90', startAt }), ctx);
    expect(g(at('2026-10-19', 18))).toEqual([]);
    expect(g(at('2026-10-19', 18, 10))).toEqual(['grid']);
    expect(g(at('2026-10-19', 11))).toEqual(['past']);
    expect(g(at('2026-10-19', 13, 30))).toEqual(['cutoff']);
  });

  it('course: its starts and a title within 80 characters', () => {
    const rows = weeklyStarts('2026-10-19', '18:00', 4, TZ);
    const c = (over: Partial<StartDraft>) =>
      startDraftErrors(draft({ kind: 'course', typeId: 'c8', startAt: null, rows, ...over }), ctx);
    expect(c({})).toEqual([]);
    expect(c({ rows: rows.slice(0, 3) })).toEqual(['starts']);
    expect(c({ titleEn: 'x'.repeat(81) })).toEqual(['title']);
  });
});

describe('startArgs (§1.7, §5.7)', () => {
  it('private, a typed student: name and phone, the party, the key; no customer', () => {
    expect(startArgs('private', draft({ partySize: 3 }), 'lesson.book:k1', TZ)).toEqual({
      p_coach_id: 'sara',
      p_lesson_type_id: 'p60',
      p_idempotency_key: 'lesson.book:k1',
      p_start_at: at('2026-10-19', 18),
      p_party_size: 3,
      p_name: 'Ali Hasan',
      p_phone: '0770 123 4567',
    });
  });

  it('private, a picked customer: the customer only; a typed name with no phone sends no phone', () => {
    const picked = startArgs('private', draft({ customerId: 'cust-1' }), 'k', TZ);
    expect(picked.p_customer_id).toBe('cust-1');
    expect(picked).not.toHaveProperty('p_name');
    expect(startArgs('private', draft({ guestPhone: ' ' }), 'k', TZ)).not.toHaveProperty('p_phone');
  });

  it('group: coach, type, start and key only', () => {
    expect(startArgs('group', draft({ kind: 'group', typeId: 'g90' }), 'k', TZ)).toEqual({
      p_coach_id: 'sara',
      p_lesson_type_id: 'g90',
      p_idempotency_key: 'k',
      p_start_at: at('2026-10-19', 18),
    });
  });

  it("course: every start in order and both titles, '' when blank", () => {
    const rows = weeklyStarts('2026-10-19', '18:00', 2, TZ);
    expect(
      startArgs(
        'course',
        draft({ kind: 'course', typeId: 'c8', rows, titleEn: ' Beginners ' }),
        'k',
        TZ,
      ),
    ).toEqual({
      p_coach_id: 'sara',
      p_lesson_type_id: 'c8',
      p_idempotency_key: 'k',
      p_starts: [at('2026-10-19', 18), at('2026-10-26', 18)],
      p_title_en: 'Beginners',
      p_title_ar: '',
    });
  });
});

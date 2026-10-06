import { describe, expect, it } from 'vitest';
import { COACHING_SHAPES, localParts, missingKeys, wallTimeToUtc } from '@touch/core';
import {
  addIntent,
  addsLeftToShow,
  atPrivateCap,
  privateCapAt,
  bookableBranches,
  branchesOff,
  canBookOrCreate,
  canMarkNow,
  checkWindows,
  coachBookIntent,
  coachPhotoUrl,
  courseIntent,
  defaultStart,
  insideCutoff,
  markMode,
  nightOf,
  parseCoachHours,
  parseCoachLesson,
  parseCoachMe,
  parseCoachSchedule,
  parseCoachSlots,
  parseCoachStatements,
  parseCourseCreated,
  reasonValue,
  sameWindows,
  scheduleSections,
  scheduleWindow,
  slotsByNight,
  snapToGrid,
  splitAcrossMidnight,
  startIndexOf,
  startProblem,
  timeOffProblem,
  toHHMM,
  toWindowsJson,
  typesFor,
  weeklyStarts,
  windowIndexOf,
  windowsByWeekday,
  windowsOverlap,
  type CoachMe,
  type CoachSchedule,
  type HoursWindow,
} from '../logic';
import {
  COACH_TZ,
  COACH_VENUE_2_ID,
  COACH_VENUE_ID,
  GROUP_TYPE_ID,
  coachHoursRaw,
  coachLessonRaw,
  coachMeRaw,
  coachMeRetiredRaw,
  coachScheduleRaw,
  coachSlotsRaw,
  coachStatementsRaw,
} from '../../../test/coachFixtures';

const TZ = COACH_TZ;
/** A Baghdad wall time (UTC+3) as an instant. */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return wallTimeToUtc(date, h! * 60 + m!, TZ);
};
const win = (
  weekday: number,
  start: string,
  end: string,
  setBy: 'coach' | 'staff' = 'coach',
): HoursWindow => ({
  id: null,
  weekday,
  start,
  end,
  setBy,
});

describe('the fixtures carry every binding key (R41, R81)', () => {
  it('coach_me, coach_me_retired, coach_schedule, coach_hours_mine, coach_lesson, coach_slots, my_coach_statements', () => {
    expect(missingKeys(coachMeRaw(), COACHING_SHAPES.coach_me)).toEqual([]);
    expect(missingKeys(coachMeRetiredRaw(), COACHING_SHAPES.coach_me_retired)).toEqual([]);
    expect(missingKeys(coachScheduleRaw(), COACHING_SHAPES.coach_schedule)).toEqual([]);
    expect(missingKeys(coachHoursRaw(), COACHING_SHAPES.coach_hours_mine)).toEqual([]);
    expect(missingKeys(coachLessonRaw(), COACHING_SHAPES.coach_lesson)).toEqual([]);
    expect(missingKeys(coachSlotsRaw(), COACHING_SHAPES.coach_slots)).toEqual([]);
    expect(missingKeys(coachStatementsRaw(false), COACHING_SHAPES.my_coach_statements)).toEqual([]);
    expect(missingKeys(coachStatementsRaw(true), COACHING_SHAPES.my_coach_statements)).toEqual([]);
  });
});

describe('parseCoachMe (X9, R45, R56, R61)', () => {
  it('reads the full coach', () => {
    const me = parseCoachMe(coachMeRaw()).coach as CoachMe;
    expect(me.status).toBe('active');
    expect(me.publicAccepted).toBe(true);
    expect(me.branches).toEqual([
      {
        venueId: COACH_VENUE_ID,
        nameEn: 'Touch Padel',
        nameAr: 'تتش بادل',
        timezone: TZ,
        coachingEnabled: true,
        openPrivate: 4,
        openPrivateCap: 10,
      },
    ]);
    expect(me.lessonTypes.map((t) => t.kind)).toEqual(['private', 'group', 'course']);
    expect(me.privateOpen).toBe(4);
    expect(me.privateCap).toBe(10);
    expect(me.addsToday).toBe(3);
    expect(me.addCap).toBe(30);
  });

  it('answers null for a non-coach and the card alone for a retired coach', () => {
    expect(parseCoachMe({ coach: null }).coach).toBeNull();
    expect(parseCoachMe(null).coach).toBeNull();
    expect(parseCoachMe(coachMeRetiredRaw()).coach).toEqual({
      id: expect.any(String),
      status: 'retired',
      displayNameEn: 'Sara Coach',
      displayNameAr: 'سارة المدرّبة',
    });
  });

  it('parses defensively: an unknown status reads as paused, an unknown kind is left out, missing fields fall back', () => {
    const me = parseCoachMe({
      coach: {
        id: 'c',
        status: 'sabbatical',
        lesson_types: [
          { id: 't', kind: 'clinic' },
          { id: 'u', kind: 'group', venue_id: 'v' },
        ],
        branches: [{ venue_id: 'v' }, { name_en: 'no id' }],
      },
    }).coach as CoachMe;
    expect(me.status).toBe('paused');
    expect(me.lessonTypes.map((t) => t.id)).toEqual(['u']);
    expect(me.lessonTypes[0]!.isActive).toBe(false);
    expect(me.branches).toEqual([
      {
        venueId: 'v',
        nameEn: '',
        nameAr: '',
        timezone: 'Asia/Baghdad',
        coachingEnabled: false,
        openPrivate: 0,
        openPrivateCap: 10,
      },
    ]);
    expect(me.publicAccepted).toBe(false);
    expect(me.privateCap).toBe(10);
  });
});

describe('the coach helpers (R16, R45, R56, CD-9)', () => {
  const me = parseCoachMe(coachMeRaw()).coach as CoachMe;
  const off = parseCoachMe(coachMeRaw({}, { coaching_enabled: false })).coach as CoachMe;
  const paused = parseCoachMe(coachMeRaw({ status: 'paused' })).coach as CoachMe;

  it('lists the branches switched off, and books only where coaching is on, while active', () => {
    expect(branchesOff(me)).toEqual([]);
    expect(branchesOff(off).map((b) => b.venueId)).toEqual([COACH_VENUE_ID]);
    expect(bookableBranches(off)).toEqual([]);
    expect(canBookOrCreate(me)).toBe(true);
    expect(canBookOrCreate(off)).toBe(false);
    expect(canBookOrCreate(paused)).toBe(false);
  });

  it('picks the active types of a kind at a branch', () => {
    expect(typesFor(me, COACH_VENUE_ID, ['group']).map((t) => t.id)).toEqual([GROUP_TYPE_ID]);
    expect(typesFor(me, 'elsewhere', ['group'])).toEqual([]);
  });

  it('shows the adds left only at five or fewer, and knows the private cap', () => {
    expect(addsLeftToShow(me)).toBeNull();
    expect(addsLeftToShow({ ...me, addsToday: 26 })).toBe(4);
    expect(addsLeftToShow({ ...me, addsToday: 31 })).toBe(0);
  });

  it('checks the private cap per branch, never against the sum across branches (R56, MB-01)', () => {
    const two = parseCoachMe(
      coachMeRaw({
        branches: [
          {
            venue_id: COACH_VENUE_ID,
            timezone: TZ,
            coaching_enabled: true,
            open_private: 6,
            open_private_cap: 10,
          },
          {
            venue_id: COACH_VENUE_2_ID,
            timezone: TZ,
            coaching_enabled: true,
            open_private: 6,
            open_private_cap: 10,
          },
        ],
        private_open: 12,
        private_cap: 10,
      }),
    ).coach as CoachMe;
    // 6 of 10 and 6 of 10: the summed 12 of 10 is display only.
    expect(atPrivateCap(two, COACH_VENUE_ID)).toBe(false);
    expect(atPrivateCap(two, COACH_VENUE_2_ID)).toBe(false);
    expect(privateCapAt(two, COACH_VENUE_2_ID)).toEqual({ open: 6, cap: 10 });

    const capped = parseCoachMe(
      coachMeRaw({
        branches: [
          {
            venue_id: COACH_VENUE_ID,
            timezone: TZ,
            coaching_enabled: true,
            open_private: 3,
            open_private_cap: 3,
          },
          {
            venue_id: COACH_VENUE_2_ID,
            timezone: TZ,
            coaching_enabled: true,
            open_private: 3,
            open_private_cap: 10,
          },
        ],
      }),
    ).coach as CoachMe;
    // A cap-3 branch at 3 blocks only that branch.
    expect(atPrivateCap(capped, COACH_VENUE_ID)).toBe(true);
    expect(atPrivateCap(capped, COACH_VENUE_2_ID)).toBe(false);
    // A branch the coach is not at, or none picked, blocks nothing.
    expect(atPrivateCap(capped, 'elsewhere')).toBe(false);
    expect(atPrivateCap(capped, null)).toBe(false);
    expect(privateCapAt(capped, null)).toBeNull();
    expect(atPrivateCap(me, COACH_VENUE_ID)).toBe(false);
  });
});

describe('the schedule (X10, guest.md §4.13.2)', () => {
  it('parses and sorts lessons, falling back on unknown enums', () => {
    const s = parseCoachSchedule({
      lessons: [
        { lesson_id: 'b', start_at: '2026-10-02T15:00:00Z', kind: 'clinic', status: 'gone' },
        { lesson_id: 'a', start_at: '2026-10-01T15:00:00Z' },
        { start_at: 'no id' },
      ],
      time_off: [
        { id: 't', starts_at: '2026-10-03T06:00:00Z', ends_at: '2026-10-03T18:00:00Z' },
        { id: 'x' },
      ],
    });
    expect(s.lessons.map((l) => l.lessonId)).toEqual(['a', 'b']);
    expect(s.lessons[1]!.kind).toBe('private');
    expect(s.lessons[1]!.status).toBe('scheduled');
    expect(s.timeOff.map((b) => b.id)).toEqual(['t']);
  });

  it('puts a lesson that starts after midnight in the night before', () => {
    expect(nightOf(at('2026-10-02', '00:30'), TZ)).toBe('2026-10-01');
    expect(nightOf(at('2026-10-02', '09:00'), TZ)).toBe('2026-10-02');
  });

  it('asks for whole local days, from yesterday to fifteen days on (at most 31)', () => {
    const w = scheduleWindow(at('2026-10-01', '15:20'), TZ);
    expect(w.from).toBe(at('2026-09-30', '00:00').toISOString());
    expect(w.to).toBe(at('2026-10-16', '00:00').toISOString());
    expect(scheduleWindow(at('2026-10-01', '23:59'), TZ)).toEqual(w);
  });

  it('builds sections by night: tonight, later, yesterday only with students to mark, time off as a band', () => {
    const lesson = (
      id: string,
      start: Date,
      over: Partial<CoachSchedule['lessons'][number]> = {},
    ) => ({
      lessonId: id,
      venueId: COACH_VENUE_ID,
      kind: 'group' as const,
      courseId: null,
      sessionNo: null,
      sessionsCount: null,
      typeNameEn: '',
      typeNameAr: '',
      titleEn: '',
      titleAr: '',
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 3_600_000).toISOString(),
      status: 'scheduled' as const,
      placesTaken: 1,
      maxPlaces: 8,
      minPlaces: 4,
      cutoffAt: null,
      courtNameEn: '',
      courtNameAr: '',
      unmarked: 0,
      ...over,
    });
    const schedule: CoachSchedule = {
      lessons: [
        lesson('late', at('2026-10-02', '00:30')),
        lesson('tomorrow', at('2026-10-02', '18:00')),
        lesson('done', at('2026-09-30', '18:00')),
        lesson('mark', at('2026-09-30', '20:00'), { unmarked: 2 }),
        lesson('other', at('2026-10-01', '19:00'), { venueId: 'elsewhere' }),
      ],
      timeOff: [
        {
          id: 't',
          startsAt: at('2026-10-04', '09:00').toISOString(),
          endsAt: at('2026-10-05', '12:00').toISOString(),
        },
      ],
      serverNow: null,
    };
    const now = at('2026-10-01', '15:00');
    const all = scheduleSections(schedule, { now, tz: TZ, venueId: null });
    expect(all.map((s) => [s.night, s.offset])).toEqual([
      ['2026-09-30', -1],
      ['2026-10-01', 0],
      ['2026-10-02', 1],
      ['2026-10-04', 3],
      ['2026-10-05', 4],
    ]);
    expect(all[0]!.data.map((i) => i.key)).toEqual(['lesson.mark']);
    expect(all[1]!.data.map((i) => i.key)).toEqual(['lesson.other', 'lesson.late']);
    expect(all[3]!.data[0]!.type).toBe('timeOff');
    const here = scheduleSections(schedule, { now, tz: TZ, venueId: COACH_VENUE_ID });
    expect(here.flatMap((s) => s.data.map((i) => i.key))).not.toContain('lesson.other');
  });

  it('keeps a past lesson still to mark only while its marking window is open (MB-09, CD-11)', () => {
    const start = at('2026-09-30', '20:00');
    const schedule: CoachSchedule = {
      lessons: [
        {
          lessonId: 'mark',
          venueId: COACH_VENUE_ID,
          kind: 'group',
          courseId: null,
          sessionNo: null,
          sessionsCount: null,
          typeNameEn: '',
          typeNameAr: '',
          titleEn: '',
          titleAr: '',
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + 3_600_000).toISOString(),
          status: 'scheduled',
          placesTaken: 1,
          maxPlaces: 8,
          minPlaces: 4,
          cutoffAt: null,
          courtNameEn: '',
          courtNameAr: '',
          unmarked: 2,
        },
      ],
      timeOff: [],
      serverNow: null,
    };
    const keys = (hours: number) =>
      scheduleSections(schedule, {
        now: new Date(start.getTime() + hours * 3_600_000),
        tz: TZ,
        venueId: null,
      }).flatMap((s) => s.data.map((i) => i.key));
    expect(keys(23)).toEqual(['lesson.mark']);
    expect(keys(24)).toEqual([]);
  });
});

describe('hours (CD-10, guest.md §4.13.3)', () => {
  it('reads a stored HH:MM:SS as HH:MM and keeps 24:00', () => {
    expect(toHHMM('09:00:00')).toBe('09:00');
    expect(toHHMM('24:00')).toBe('24:00');
    expect(toHHMM('25:00')).toBeNull();
    const h = parseCoachHours(coachHoursRaw());
    expect(h.branches[0]!.windows.map((w) => [w.weekday, w.start, w.end, w.setBy])).toEqual([
      [0, '09:00', '12:00', 'coach'],
      [2, '17:00', '24:00', 'staff'],
    ]);
    expect(h.timeOff[0]!.reason).toBe('Tournament');
  });

  it('splits a window past midnight across Saturday → Sunday', () => {
    expect(splitAcrossMidnight(6, '22:00', '02:00')).toEqual([
      { weekday: 6, start: '22:00', end: '24:00' },
      { weekday: 0, start: '00:00', end: '02:00' },
    ]);
    expect(splitAcrossMidnight(3, '20:00', '00:00')).toEqual([
      { weekday: 3, start: '20:00', end: '24:00' },
    ]);
    expect(splitAcrossMidnight(3, '09:00', '12:00')).toEqual([
      { weekday: 3, start: '09:00', end: '12:00' },
    ]);
  });

  it('finds overlaps on one weekday, never across weekdays, and lets windows touch', () => {
    expect(windowsOverlap(win(1, '09:00', '12:00'), win(1, '11:30', '13:00'))).toBe(true);
    expect(windowsOverlap(win(1, '09:00', '12:00'), win(1, '12:00', '13:00'))).toBe(false);
    expect(windowsOverlap(win(1, '09:00', '12:00'), win(2, '09:00', '12:00'))).toBe(false);
  });

  it('pre-checks a set: invalid, overlapping here, overlapping another branch', () => {
    expect(checkWindows([win(1, '12:00', '09:00')])).toEqual({ index: 0, kind: 'invalid' });
    expect(checkWindows([win(1, '09:15', '12:00')])).toEqual({ index: 0, kind: 'invalid' });
    expect(checkWindows([win(1, '09:00', '12:00'), win(1, '11:00', '13:00')])).toEqual({
      index: 1,
      kind: 'overlap',
    });
    expect(
      checkWindows(
        [win(1, '09:00', '12:00')],
        [{ venueId: 'b2', windows: [win(1, '10:00', '11:00')] }],
      ),
    ).toEqual({ index: 0, kind: 'overlapElsewhere', venueId: 'b2' });
    expect(checkWindows([win(1, '09:00', '12:00'), win(1, '12:00', '24:00')])).toBeNull();
  });

  it('sends {weekday, start, end} (and the stored names) with 24:00 for until midnight', () => {
    expect(toWindowsJson([win(5, '18:00', '24:00')])).toEqual([
      { weekday: 5, start: '18:00', end: '24:00', start_time: '18:00', end_time: '24:00' },
    ]);
  });

  it('groups by weekday in start order, and compares sets regardless of ids and order', () => {
    const days = windowsByWeekday([
      win(2, '18:00', '20:00'),
      win(2, '09:00', '10:00'),
      win(0, '09:00', '10:00'),
    ]);
    expect(days[2]!.map((w) => w.start)).toEqual(['09:00', '18:00']);
    expect(days[0]!.length).toBe(1);
    expect(
      sameWindows(
        [win(1, '09:00', '10:00'), win(2, '09:00', '10:00')],
        [win(2, '09:00', '10:00', 'staff'), win(1, '09:00', '10:00')],
      ),
    ).toBe(true);
    expect(sameWindows([win(1, '09:00', '10:00')], [win(1, '09:00', '10:30')])).toBe(false);
  });

  it('reads a refusal detail as the window or start it names (R73)', () => {
    expect(windowIndexOf('2')).toBe(2);
    expect(windowIndexOf('3:4')).toBe(3);
    expect(windowIndexOf('time_off')).toBeNull();
    expect(windowIndexOf('p_windows')).toBeNull();
    expect(windowIndexOf(null)).toBeNull();
    expect(startIndexOf('1')).toBe(1);
    expect(startIndexOf('0')).toBeNull();
    expect(startIndexOf('count')).toBeNull();
  });

  it('pre-checks time off', () => {
    const now = at('2026-10-01', '12:00');
    expect(timeOffProblem(at('2026-10-02', '10:00'), at('2026-10-02', '09:00'), now)).toBe('order');
    expect(timeOffProblem(at('2026-09-30', '10:00'), at('2026-10-01', '11:00'), now)).toBe('past');
    expect(timeOffProblem(at('2026-10-02', '10:00'), at('2027-10-05', '10:00'), now)).toBe('long');
    expect(timeOffProblem(at('2026-10-02', '10:00'), at('2026-10-03', '10:00'), now)).toBeNull();
  });
});

describe('starts: the grid, the cut-off and a course’s weeks (C-20, R9, R47, GL-6)', () => {
  it('snaps a picked time to the nearest :00 or :30, local', () => {
    expect(snapToGrid(at('2026-10-01', '10:14'), TZ)).toEqual(at('2026-10-01', '10:00'));
    expect(snapToGrid(at('2026-10-01', '10:16'), TZ)).toEqual(at('2026-10-01', '10:30'));
    expect(snapToGrid(at('2026-10-01', '23:50'), TZ)).toEqual(at('2026-10-02', '00:00'));
  });

  it('judges the cut-off as start − hours ≤ now', () => {
    const now = at('2026-10-01', '16:00');
    expect(insideCutoff(at('2026-10-01', '18:00'), 2, now)).toBe(true);
    expect(insideCutoff(at('2026-10-01', '18:30'), 2, now)).toBe(false);
  });

  it('defaults to the first grid start outside the cut-off', () => {
    const now = at('2026-10-01', '16:10');
    expect(defaultStart(now, 2, TZ)).toEqual(at('2026-10-01', '18:30'));
    expect(defaultStart(at('2026-10-01', '16:00'), 2, TZ)).toEqual(at('2026-10-01', '18:30'));
    expect(defaultStart(now, 0, TZ)).toEqual(at('2026-10-01', '16:30'));
  });

  it('pre-checks a start: grid, past, cut-off', () => {
    const now = at('2026-10-01', '16:00');
    expect(startProblem(at('2026-10-01', '18:15'), { tz: TZ, now })).toBe('grid');
    expect(startProblem(at('2026-10-01', '15:30'), { tz: TZ, now })).toBe('past');
    expect(startProblem(at('2026-10-01', '17:30'), { tz: TZ, now, cutoffHours: 2 })).toBe('cutoff');
    expect(startProblem(at('2026-10-01', '18:30'), { tz: TZ, now, cutoffHours: 2 })).toBeNull();
  });

  it('lists a course’s starts one a week at the same local time', () => {
    const starts = weeklyStarts(at('2026-10-01', '18:00'), 3, TZ);
    expect(starts).toEqual([
      at('2026-10-01', '18:00'),
      at('2026-10-08', '18:00'),
      at('2026-10-15', '18:00'),
    ]);
    expect(starts.every((s) => localParts(s, TZ).minutesOfDay === 18 * 60)).toBe(true);
    expect(weeklyStarts(at('2026-10-01', '18:00'), 0, TZ)).toEqual([]);
  });
});

describe('a lesson’s roster (X11; C-16, CD-11, R44, R54, P13)', () => {
  it('parses the roster and the can flags, and never shows a held row’s phone', () => {
    const d = parseCoachLesson(coachLessonRaw())!;
    expect(d.roster.map((r) => [r.bookedBy, r.paymentMode, r.attendance])).toEqual([
      ['coach', 'desk', null],
      ['guest', 'online', 'attended'],
    ]);
    expect(d.can).toEqual({
      add: true,
      remove: true,
      cancel: false,
      cancelCourse: false,
      reschedule: false,
      mark: true,
    });
    const held = parseCoachLesson({
      ...coachLessonRaw(),
      roster: [
        {
          enrolment_id: 'e',
          name: 'X',
          phone: '+9647700000000',
          status: 'held',
          attendance: 'late',
        },
      ],
    })!;
    expect(held.roster[0]!.phone).toBeNull();
    expect(held.roster[0]!.attendance).toBeNull();
  });

  it('answers null without a lesson, and no permission without `can`', () => {
    expect(parseCoachLesson({ roster: [] })).toBeNull();
    const noCan: Record<string, unknown> = coachLessonRaw();
    delete noCan.can;
    expect(parseCoachLesson(noCan)!.can.mark).toBe(false);
  });

  it('opens the marks from the start until start + 24 h, hidden before, read-only after', () => {
    const start = at('2026-10-01', '18:00');
    const lesson = {
      startAt: start.toISOString(),
      markUntil: new Date(start.getTime() + 24 * 3_600_000).toISOString(),
    };
    expect(canMarkNow(lesson, start)).toBe(true);
    expect(canMarkNow(lesson, new Date(start.getTime() - 1))).toBe(false);
    expect(canMarkNow(lesson, new Date(start.getTime() + 24 * 3_600_000))).toBe(false);
    const detail = {
      lesson: { startAt: lesson.startAt },
      markUntil: lesson.markUntil,
      can: {
        add: false,
        remove: false,
        cancel: false,
        cancelCourse: false,
        reschedule: false,
        mark: true,
      },
    };
    expect(markMode(detail, new Date(start.getTime() - 60_000))).toBe('hidden');
    expect(markMode(detail, new Date(start.getTime() + 60_000))).toBe('edit');
    expect(markMode(detail, new Date(start.getTime() + 25 * 3_600_000))).toBe('readonly');
    expect(
      markMode(
        { ...detail, can: { ...detail.can, mark: false } },
        new Date(start.getTime() + 60_000),
      ),
    ).toBe('readonly');
  });

  it('sends a reason as <code> or <code>: <note>, the note trimmed and capped at 200', () => {
    expect(reasonValue('coach_unavailable', '  ')).toBe('coach_unavailable');
    expect(reasonValue('other', '  rain   on court ')).toBe('other: rain on court');
    expect(reasonValue('other', 'x'.repeat(250))).toBe(`other: ${'x'.repeat(200)}`);
  });
});

describe('statements (X12; C-12, CM-12, R45)', () => {
  it('shows approved and paid statements only, whatever arrives', () => {
    const raw = coachStatementsRaw(true);
    const s = parseCoachStatements({
      ...raw,
      statements: [
        ...raw.statements,
        { ...raw.statements[0], id: 'draft', status: 'draft' },
        { ...raw.statements[0], id: 'void', status: 'void' },
      ],
    });
    expect(s.statements.map((x) => x.id)).toEqual([raw.statements[0]!.id]);
    expect(s.statements[0]!.lines!.length).toBe(1);
    expect(s.statements[0]!.totalIqd).toBe(180000);
    expect(s.months).toEqual(['2026-09-01']);
    expect(s.currentMonth[0]!.coachIqd).toBe(45000);
  });

  it('has no lines on the summaries read', () => {
    expect(parseCoachStatements(coachStatementsRaw(false)).statements[0]!.lines).toBeNull();
  });

  it('reads a missing rate as null, never a made-up 60% (MB-02)', () => {
    const raw = coachStatementsRaw(true);
    const st = raw.statements[0]!;
    const line = st.lines![0]!;
    const one = parseCoachStatements(raw).statements[0]!;
    expect(one.shareBp).toBe(6000);
    expect(one.lines![0]!.shareBp).toBe(6000);
    // No rate at all.
    const none = parseCoachStatements({
      ...raw,
      statements: [{ ...st, share_bp: null, lines: [{ ...line, share_bp: undefined }] }],
    }).statements[0]!;
    expect(none.shareBp).toBeNull();
    expect(none.lines![0]!.shareBp).toBeNull();
    // Mixed rates: the month has none, each line keeps its own.
    const mixed = parseCoachStatements({
      ...raw,
      statements: [
        {
          ...st,
          share_bp: null,
          lines: [line, { ...line, lesson_id: 'l2', share_bp: 5000 }],
        },
      ],
    }).statements[0]!;
    expect(mixed.shareBp).toBeNull();
    expect(mixed.lines!.map((l) => l.shareBp)).toEqual([6000, 5000]);
    // Adjustments only: no rate on the month or the line.
    const adj = parseCoachStatements({
      ...raw,
      statements: [
        {
          ...st,
          share_bp: null,
          lines: [{ ...line, share_bp: null, is_adjustment: true }],
        },
      ],
    }).statements[0]!;
    expect(adj.shareBp).toBeNull();
    expect(adj.lines![0]!.shareBp).toBeNull();
  });
});

describe('free times, photos, write results and intents', () => {
  it('groups coach_slots by night, and reads {off: true}', () => {
    const slots = parseCoachSlots(coachSlotsRaw());
    expect(slots.bookable).toBe(true);
    expect(slotsByNight(slots, TZ).flatMap((n) => n.starts).length).toBe(3);
    expect(parseCoachSlots({ off: true })).toEqual({
      off: true,
      bookable: false,
      durationMin: 0,
      starts: [],
    });
  });

  it('turns only a coaches/<uuid>/<file> path into a photo URL (R43)', () => {
    const path = 'coaches/0f0e0d0c-0b0a-4000-8000-000000000001/a.jpg';
    expect(coachPhotoUrl(path, 'https://x.supabase.co/')).toBe(
      `https://x.supabase.co/storage/v1/object/public/menu-media/${path}`,
    );
    expect(coachPhotoUrl('profiles/abc/a.jpg', 'https://x.supabase.co')).toBeNull();
    expect(coachPhotoUrl(path, '')).toBeNull();
    expect(coachPhotoUrl(null, 'https://x.supabase.co')).toBeNull();
  });

  it('reads a course’s first session from lesson_ids, or from sessions', () => {
    expect(parseCourseCreated({ course_id: 'c', lesson_ids: ['a', 'b'] }).lessonIds).toEqual([
      'a',
      'b',
    ]);
    expect(
      parseCourseCreated({
        course_id: 'c',
        sessions: [
          { session_no: 2, lesson_id: 'b' },
          { session_no: 1, lesson_id: 'a' },
        ],
      }).lessonIds,
    ).toEqual(['a', 'b']);
  });

  it('puts every mutable argument in the intent, so a changed form sends a new key', () => {
    const base = {
      typeId: 't',
      venueId: 'v',
      startAt: 's',
      party: 1,
      name: 'Ali',
      phone: null as string | null,
    };
    expect(coachBookIntent(base)).not.toBe(coachBookIntent({ ...base, party: 2 }));
    expect(coachBookIntent(base)).toBe(coachBookIntent({ ...base, name: ' Ali ' }));
    // MB-07: a changed phone is a new request, so a new key.
    expect(coachBookIntent(base)).not.toBe(coachBookIntent({ ...base, phone: '+9647700000000' }));
    expect(coachBookIntent({ ...base, phone: '+9647700000000' })).not.toBe(
      coachBookIntent({ ...base, phone: '+9647711111111' }),
    );
    const course = { typeId: 't', venueId: 'v', starts: ['a', 'b'], titleEn: '', titleAr: '' };
    expect(courseIntent(course)).toBe('course-new:t|v|a,b||');
    // MB-07: a changed title is a new key; whitespace the server never sees is not.
    expect(courseIntent(course)).not.toBe(courseIntent({ ...course, titleEn: 'Beginners' }));
    expect(courseIntent({ ...course, titleAr: 'مبتدئين' })).toBe(
      courseIntent({ ...course, titleAr: ' مبتدئين ' }),
    );
    expect(addIntent({ targetId: 'l', name: 'A', phone: null })).not.toBe(
      addIntent({ targetId: 'l', name: 'A', phone: '+964' }),
    );
  });
});

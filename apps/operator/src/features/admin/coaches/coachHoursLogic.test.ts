import { describe, expect, it } from 'vitest';
import type { HoursElsewhere } from '../../coaching/lessonPayloads';
import {
  END_OPTIONS,
  START_OPTIONS,
  addWindow,
  copyToEveryDay,
  draftFromHours,
  elsewhereByDay,
  elsewhereOverlaps,
  emptyHours,
  hoursErrors,
  minutesOf,
  overlapWindow,
  removeWindow,
  sameHours,
  setWindow,
  timeOffArgs,
  timeOffErrors,
  toWindows,
  upcomingTimeOff,
  wallClockOf,
  type HoursDraft,
} from './coachHoursLogic';

// operator.md §5.13.3: a coach's weekly hours (CD-10) and time off, and the
// server's HOURS_OVERLAP detail mapped back to the window sent (R73).

const TZ = 'Asia/Baghdad';

function draftWith(days: Record<number, [string, string][]>): HoursDraft {
  const d = emptyHours();
  for (const [day, windows] of Object.entries(days)) {
    d[Number(day)] = windows.map(([start, end]) => ({ start, end }));
  }
  return d;
}

describe('half-hour options (CD-10)', () => {
  it('starts run 00:00..23:30 and ends 00:30..24:00', () => {
    expect(START_OPTIONS[0]).toBe('00:00');
    expect(START_OPTIONS[START_OPTIONS.length - 1]).toBe('23:30');
    expect(START_OPTIONS).toHaveLength(48);
    expect(END_OPTIONS[0]).toBe('00:30');
    expect(END_OPTIONS[END_OPTIONS.length - 1]).toBe('24:00');
    expect(END_OPTIONS).toHaveLength(48);
  });

  it('reads 24:00 as the end of the day, and nothing past it', () => {
    expect(minutesOf('24:00')).toBe(1440);
    expect(minutesOf('24:00:00')).toBe(1440);
    expect(minutesOf('24:30')).toBeNull();
    expect(minutesOf('09:30:00')).toBe(570);
  });
});

describe('draft and windows', () => {
  it('groups the stored windows by weekday (Sunday = 0), each day in start order', () => {
    const d = draftFromHours([
      { weekday: 1, start_time: '17:00:00', end_time: '24:00:00' },
      { weekday: 1, start_time: '09:00:00', end_time: '13:00:00' },
      { weekday: 0, start_time: '10:00', end_time: '12:00' },
    ]);
    expect(d[0]).toEqual([{ start: '10:00', end: '12:00' }]);
    expect(d[1]).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '17:00', end: '24:00' },
    ]);
    expect(toWindows(d)).toEqual([
      { weekday: 0, start: '10:00', end: '12:00' },
      { weekday: 1, start: '09:00', end: '13:00' },
      { weekday: 1, start: '17:00', end: '24:00' },
    ]);
  });

  it('adds a window after the last one, removes and edits by position', () => {
    let d = addWindow(emptyHours(), 2);
    expect(d[2]).toEqual([{ start: '09:00', end: '13:00' }]);
    d = addWindow(d, 2);
    expect(d[2]![1]).toEqual({ start: '13:00', end: '15:00' });
    d = setWindow(d, 2, 1, { end: '24:00' });
    expect(d[2]![1]).toEqual({ start: '13:00', end: '24:00' });
    d = addWindow(d, 2);
    // Never past the end of the day.
    expect(d[2]![2]).toEqual({ start: '23:00', end: '24:00' });
    d = removeWindow(d, 2, 0);
    expect(d[2]).toHaveLength(2);
    expect(d[2]![0]!.start).toBe('13:00');
  });

  it('Copy to every day gives every weekday the same windows', () => {
    const d = copyToEveryDay(
      draftWith({
        3: [
          ['09:00', '13:00'],
          ['17:00', '24:00'],
        ],
        5: [['08:00', '09:00']],
      }),
      3,
    );
    for (const day of d)
      expect(day).toEqual([
        { start: '09:00', end: '13:00' },
        { start: '17:00', end: '24:00' },
      ]);
    expect(sameHours(d, copyToEveryDay(d, 0))).toBe(true);
  });
});

describe('hoursErrors', () => {
  it('accepts a window ending at 24:00', () => {
    expect(hoursErrors(draftWith({ 0: [['17:00', '24:00']] }))).toEqual([]);
  });

  it('refuses an inverted window', () => {
    expect(hoursErrors(draftWith({ 4: [['13:00', '09:00']] }))).toEqual([
      { weekday: 4, position: 0, error: 'order' },
    ]);
    expect(hoursErrors(draftWith({ 4: [['09:00', '09:00']] }))).toEqual([
      { weekday: 4, position: 0, error: 'order' },
    ]);
  });

  it('refuses a window off the half hour', () => {
    expect(hoursErrors(draftWith({ 1: [['09:15', '10:00']] }))).toEqual([
      { weekday: 1, position: 0, error: 'grid' },
    ]);
  });

  it('refuses two windows that overlap on one day, and lets touching ones be', () => {
    expect(
      hoursErrors(
        draftWith({
          2: [
            ['09:00', '13:00'],
            ['12:00', '15:00'],
          ],
        }),
      ),
    ).toEqual([
      { weekday: 2, position: 0, error: 'overlap' },
      { weekday: 2, position: 1, error: 'overlap' },
    ]);
    expect(
      hoursErrors(
        draftWith({
          2: [
            ['09:00', '13:00'],
            ['13:00', '15:00'],
          ],
        }),
      ),
    ).toEqual([]);
    // The same times on different days never clash.
    expect(hoursErrors(draftWith({ 2: [['09:00', '13:00']], 3: [['09:00', '13:00']] }))).toEqual(
      [],
    );
  });
});

describe('other branches', () => {
  const elsewhere: HoursElsewhere[] = [
    {
      venue_id: 'v2',
      venue_name_en: 'Mansour',
      venue_name_ar: 'المنصور',
      weekday: 1,
      start_time: '12:00:00',
      end_time: '16:00:00',
    },
    {
      venue_id: 'v2',
      venue_name_en: 'Mansour',
      venue_name_ar: 'المنصور',
      weekday: 1,
      start_time: '08:00:00',
      end_time: '10:00:00',
    },
  ];

  it('lists them by weekday in start order', () => {
    const by = elsewhereByDay(elsewhere);
    expect(by[1]!.map((w) => w.start_time)).toEqual(['08:00:00', '12:00:00']);
    expect(by[0]).toEqual([]);
  });

  it('an overlap with another branch is a warning naming that branch', () => {
    const clashes = elsewhereOverlaps(
      draftWith({
        1: [
          ['10:00', '13:00'],
          ['16:00', '18:00'],
        ],
      }),
      elsewhere,
    );
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ weekday: 1, position: 0 });
    expect(clashes[0]!.other.start_time).toBe('12:00:00');
    // The same hours on another weekday are fine.
    expect(elsewhereOverlaps(draftWith({ 2: [['10:00', '13:00']] }), elsewhere)).toEqual([]);
  });
});

describe('overlapWindow (R73)', () => {
  const sent = toWindows(
    draftWith({
      0: [['09:00', '12:00']],
      3: [
        ['09:00', '12:00'],
        ['14:00', '18:00'],
      ],
    }),
  );

  it('maps a bare index back to its weekday and its place in the day', () => {
    expect(overlapWindow('2', sent)).toEqual({ kind: 'window', index: 2, weekday: 3, position: 1 });
    expect(overlapWindow('0', sent)).toEqual({ kind: 'window', index: 0, weekday: 0, position: 0 });
  });

  it('reads the "<index>:<weekday>" form', () => {
    expect(overlapWindow('1:3', sent)).toEqual({
      kind: 'window',
      index: 1,
      weekday: 3,
      position: 0,
    });
  });

  it('time_off names the time off, and anything else names nothing', () => {
    expect(overlapWindow('time_off', sent)).toEqual({ kind: 'timeOff' });
    expect(overlapWindow('9', sent)).toBeNull();
    expect(overlapWindow('', sent)).toBeNull();
    expect(overlapWindow(null, sent)).toBeNull();
  });
});

describe('time off', () => {
  it('sends the branch-local times as instants (Baghdad is UTC+3)', () => {
    const args = timeOffArgs(
      {
        fromDate: '2026-10-13',
        fromTime: '09:00',
        toDate: '2026-10-15',
        toTime: '24:00',
        reason: '  Away  ',
      },
      TZ,
    );
    expect(args).toEqual({
      p_starts_at: '2026-10-13T06:00:00.000Z',
      p_ends_at: '2026-10-15T21:00:00.000Z',
      p_reason: 'Away',
    });
  });

  it('checks both ends are set and the end comes after the start', () => {
    expect(
      timeOffErrors(
        { fromDate: '', fromTime: '09:00', toDate: '2026-10-15', toTime: '10:00', reason: '' },
        TZ,
      ),
    ).toBe('needBoth');
    expect(
      timeOffErrors(
        {
          fromDate: '2026-10-15',
          fromTime: '10:00',
          toDate: '2026-10-15',
          toTime: '10:00',
          reason: '',
        },
        TZ,
      ),
    ).toBe('endBeforeStart');
    expect(
      timeOffErrors(
        {
          fromDate: '2026-10-15',
          fromTime: '10:00',
          toDate: '2026-10-14',
          toTime: '24:00',
          reason: '',
        },
        TZ,
      ),
    ).toBe('endBeforeStart');
    expect(
      timeOffArgs({ fromDate: '', fromTime: '09:00', toDate: '', toTime: '10:00', reason: '' }, TZ),
    ).toBeNull();
  });

  it('an end on local midnight reads as 24:00 of the day before', () => {
    expect(wallClockOf('2026-10-15T21:00:00.000Z', TZ, true)).toEqual({
      date: '2026-10-15',
      time: '24:00',
    });
    expect(wallClockOf('2026-10-15T21:00:00.000Z', TZ)).toEqual({
      date: '2026-10-16',
      time: '00:00',
    });
    expect(wallClockOf('2026-10-13T06:00:00.000Z', TZ)).toEqual({
      date: '2026-10-13',
      time: '09:00',
    });
  });

  it('lists time off still to come, earliest first', () => {
    const now = Date.parse('2026-10-10T00:00:00Z');
    const list = [
      {
        id: 'b',
        starts_at: '2026-10-20T06:00:00Z',
        ends_at: '2026-10-21T06:00:00Z',
        reason: '',
        set_by: 'coach',
        set_by_name: null,
      },
      {
        id: 'old',
        starts_at: '2026-10-01T06:00:00Z',
        ends_at: '2026-10-02T06:00:00Z',
        reason: '',
        set_by: 'staff',
        set_by_name: 'Huda',
      },
      {
        id: 'a',
        starts_at: '2026-10-09T06:00:00Z',
        ends_at: '2026-10-11T06:00:00Z',
        reason: '',
        set_by: 'staff',
        set_by_name: 'Huda',
      },
    ];
    expect(upcomingTimeOff(list, now).map((t) => t.id)).toEqual(['a', 'b']);
  });
});

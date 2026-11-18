import { describe, expect, it } from 'vitest';
import type { WeekShift } from '@touch/core/staff/clock';
import {
  between,
  copyDay,
  dayBlocks,
  dayShifts,
  newShift,
  readShifts,
  sameWeek,
  shiftsForSave,
  shiftsRefusal,
  weekIssue,
  weekMinutes,
} from './hoursLogic';

const s = (weekday: number, starts_at: string, ends_at: string, role: string | null = null): WeekShift => ({ weekday, starts_at, ends_at, role });

describe('readShifts', () => {
  it('reads the payload and drops malformed rows', () => {
    const p = readShifts({
      staff_id: 'a',
      roles: ['waiter', 'cashier', 3],
      can_edit: true,
      shifts: [
        { weekday: 2, starts_at: '14:00:00', ends_at: '18:00', role: 'cashier' },
        { weekday: 1, starts_at: '09:00', ends_at: '14:00', role: null },
        { weekday: 9, starts_at: '09:00', ends_at: '10:00' },
        { weekday: 1, starts_at: '9am', ends_at: '10:00' },
      ],
    });
    expect(p.roles).toEqual(['waiter', 'cashier']);
    expect(p.canEdit).toBe(true);
    expect(p.shifts).toEqual([s(1, '09:00', '14:00'), s(2, '14:00', '18:00', 'cashier')]);
    expect(readShifts(null)).toEqual({ staffId: '', roles: [], canEdit: false, shifts: [] });
  });
});

describe('a day of shifts', () => {
  const week = [s(1, '14:00', '18:00', 'cashier'), s(1, '09:00', '14:00'), s(1, '19:00', '23:00'), s(2, '22:00', '06:00')];

  it('orders a day earliest first, keeping each shift index', () => {
    expect(dayShifts(week, 1).map((x) => x.index)).toEqual([1, 0, 2]);
  });

  it('joins touching shifts and names a gap as time off', () => {
    const [a, b, c] = dayShifts(week, 1).map((x) => x.shift);
    expect(between(a!, b!)).toEqual({ kind: 'switch', at: '14:00', roleChanges: true });
    expect(between(b!, c!)).toEqual({ kind: 'gap', from: '18:00', to: '19:00', minutes: 60 });
    expect(between(s(1, '09:00', '12:00'), s(1, '11:00', '13:00'))).toEqual({ kind: 'overlap' });
    expect(between(s(1, '09:00', '12:00'), s(1, '12:00', '13:00'))).toEqual({ kind: 'switch', at: '12:00', roleChanges: false });
  });

  it('summarises a day in blocks', () => {
    expect(dayBlocks(week, 1)).toEqual([
      { starts: '09:00', ends: '18:00', shifts: 2 },
      { starts: '19:00', ends: '23:00', shifts: 1 },
    ]);
    expect(dayBlocks(week, 2)).toEqual([{ starts: '22:00', ends: '06:00', shifts: 1 }]);
  });

  it('counts the week, a night shift past midnight included', () => {
    expect(weekMinutes(week)).toBe((5 + 4 + 4 + 8) * 60);
  });
});

describe('newShift', () => {
  it('starts after the day ends, or at 09:00 on an empty day', () => {
    expect(newShift([], 3)).toEqual(s(3, '09:00', '17:00'));
    expect(newShift([s(3, '09:00', '14:00')], 3)).toEqual(s(3, '14:00', '18:00'));
    expect(newShift([s(3, '18:00', '22:00')], 3)).toEqual(s(3, '22:00', '00:00'));
    expect(newShift([s(3, '22:00', '04:00')], 3)).toEqual(s(3, '09:00', '17:00'));
  });
});

describe('copyDay', () => {
  it('replaces the target days with the source day', () => {
    const week = [s(1, '09:00', '14:00'), s(1, '15:00', '20:00', 'cashier'), s(2, '10:00', '12:00'), s(4, '08:00', '09:00')];
    const out = copyDay(week, 1, [2, 3, 1]);
    expect(out).toEqual([
      s(1, '09:00', '14:00'),
      s(1, '15:00', '20:00', 'cashier'),
      s(2, '09:00', '14:00'),
      s(2, '15:00', '20:00', 'cashier'),
      s(3, '09:00', '14:00'),
      s(3, '15:00', '20:00', 'cashier'),
      s(4, '08:00', '09:00'),
    ]);
  });
});

describe('weekIssue', () => {
  it('passes a good week and points at the bad shift', () => {
    expect(weekIssue([s(1, '09:00', '14:00'), s(1, '14:00', '18:00')])).toBeNull();
    expect(weekIssue([s(1, '09:00', '09:00')])).toEqual({ index: 0, reason: 'empty' });
    expect(weekIssue([s(1, '06:00', '23:00')])).toEqual({ index: 0, reason: 'too_long' });
    expect(weekIssue([s(1, '09:00', '14:00'), s(1, '13:00', '15:00')])).toEqual({ index: 1, reason: 'overlap' });
    // Sunday night runs into Monday morning.
    expect(weekIssue([s(1, '05:00', '08:00'), s(7, '22:00', '06:00')])).toEqual({ index: 1, reason: 'overlap' });
  });

  it('refuses more than 42 shifts', () => {
    const many = Array.from({ length: 43 }, (_, i) => s((i % 7) + 1, `${String(Math.floor(i / 7)).padStart(2, '0')}:00`, `${String(Math.floor(i / 7)).padStart(2, '0')}:30`));
    expect(weekIssue(many)?.reason).toBe('too_many');
  });
});

describe('saving', () => {
  it('sends the main job as null and compares weeks in any order', () => {
    const week = [s(2, '10:00', '12:00', 'waiter'), s(1, '09:00', '10:00', 'cashier')];
    expect(shiftsForSave(week, 'waiter')).toEqual([s(1, '09:00', '10:00', 'cashier'), s(2, '10:00', '12:00')]);
    expect(sameWeek(week, [s(1, '09:00', '10:00', 'cashier'), s(2, '10:00', '12:00')], 'waiter')).toBe(true);
    expect(sameWeek(week, [s(1, '09:00', '10:00', 'cashier')], 'waiter')).toBe(false);
  });

  it('maps the server hints', () => {
    expect(shiftsRefusal('INVALID_ARGUMENT', 'overlap')).toBe('overlap');
    expect(shiftsRefusal('INVALID_ARGUMENT', 'shift_length')).toBe('shift_length');
    expect(shiftsRefusal('INVALID_ARGUMENT', 'role')).toBe('role');
    expect(shiftsRefusal('INVALID_ARGUMENT', 'shifts')).toBe('shifts');
    expect(shiftsRefusal('INVALID_ARGUMENT', null)).toBe('shifts');
    expect(shiftsRefusal('FORBIDDEN', 'staff_id')).toBe('own');
    expect(shiftsRefusal('REF_NOT_FOUND', 'staff_id')).toBe('not_here');
    expect(shiftsRefusal('FORBIDDEN', null)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  attendanceRefusalField,
  attendanceWindow,
  canStepAttendanceForward,
  isAttendanceStale,
  paidInLaterMonth,
  readAttendanceMonth,
  recordedDay,
  ruleVerdict,
  validateAttendance,
  validateRule,
  type AttendanceDraft,
} from './attendanceLogic';

const day = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_date: '2026-10-02',
  late_minutes: 20,
  early_leave_minutes: 0,
  grace_minutes: 15,
  penalty_rule_iqd: 5000,
  penalty_iqd: 5000,
  pay_month: '2026-10-01',
  locked: false,
  note: 'Bus',
  recorded_by_name: 'Omar',
  recorded_at: '2026-10-02T12:00:00Z',
  ...over,
});

const payload = {
  month: '2026-10-01',
  current_month: '2026-10-01',
  today: '2026-10-03',
  window_days: 60,
  rule: { grace_minutes: 15, penalty_iqd: 5000 },
  staff: [{ id: 's1', display_name: 'Yusuf', role: 'barista' }, { display_name: 'no id' }],
  totals: { days: 2, penalty_days: 1, penalties_iqd: 5000, people: 1 },
  people: [
    {
      staff_id: 's1',
      display_name: 'Yusuf',
      role: 'barista',
      is_active: true,
      day_count: 2,
      penalty_days: 1,
      penalties_iqd: 5000,
      late_minutes: 30,
      early_leave_minutes: 0,
      days: [day(), day({ id: 'a2', work_date: '2026-10-01', late_minutes: 10, penalty_iqd: 0, pay_month: '2026-11-01', locked: true })],
    },
  ],
};

describe('readAttendanceMonth', () => {
  it('reads the rule, who may be recorded, the totals and each person’s days', () => {
    const m = readAttendanceMonth(payload);
    expect(m.rule).toEqual({ graceMinutes: 15, penaltyIqd: 5000 });
    expect(m.staff).toEqual([{ id: 's1', displayName: 'Yusuf', role: 'barista' }]);
    expect(m.totals).toEqual({ days: 2, penaltyDays: 1, penaltiesIqd: 5000, people: 1 });
    expect(m.people[0]!.days).toHaveLength(2);
    expect(m.people[0]!.days[1]!.locked).toBe(true);
    expect(m.windowDays).toBe(60);
  });

  it('reads garbage as an empty month with the rule off', () => {
    const m = readAttendanceMonth('nope');
    expect(m.people).toEqual([]);
    expect(m.staff).toEqual([]);
    expect(m.rule).toEqual({ graceMinutes: 0, penaltyIqd: 0 });
    expect(m.windowDays).toBe(60);
  });

  it('finds the day a person already has on a date', () => {
    const m = readAttendanceMonth(payload);
    expect(recordedDay(m, 's1', '2026-10-02')?.id).toBe('a1');
    expect(recordedDay(m, 's1', '2026-10-03')).toBeNull();
    expect(recordedDay(m, 's2', '2026-10-02')).toBeNull();
    expect(recordedDay(m, '', '2026-10-02')).toBeNull();
  });

  it('knows a day that comes off a later month’s wage', () => {
    expect(paidInLaterMonth({ workDate: '2026-10-01', payMonth: '2026-11-01' })).toBe(true);
    expect(paidInLaterMonth({ workDate: '2026-10-02', payMonth: '2026-10-01' })).toBe(false);
    expect(paidInLaterMonth({ workDate: '2026-10-02', payMonth: null })).toBe(false);
  });

  it('never steps past the current month', () => {
    expect(canStepAttendanceForward('2026-09-01', '2026-10-01')).toBe(true);
    expect(canStepAttendanceForward('2026-10-01', '2026-10-01')).toBe(false);
    expect(canStepAttendanceForward(null, '2026-10-01')).toBe(false);
  });
});

describe('ruleVerdict', () => {
  it('is off while the penalty is 0, whatever the minutes', () => {
    expect(ruleVerdict({ graceMinutes: 0, penaltyIqd: 0 }, 300, 300)).toBe('off');
  });

  it('is over only when late + early exceed the grace', () => {
    const rule = { graceMinutes: 15, penaltyIqd: 5000 };
    expect(ruleVerdict(rule, 15, 0)).toBe('within');
    expect(ruleVerdict(rule, 10, 5)).toBe('within');
    expect(ruleVerdict(rule, 10, 6)).toBe('over');
    expect(ruleVerdict(rule, 20, 0)).toBe('over');
    expect(ruleVerdict({ graceMinutes: 0, penaltyIqd: 5000 }, 1, 0)).toBe('over');
  });
});

describe('validateRule', () => {
  it('keeps both settings within 0270’s specs', () => {
    expect(validateRule({ graceMinutes: 15, penaltyIqd: 5000 })).toBeNull();
    expect(validateRule({ graceMinutes: 0, penaltyIqd: 0 })).toBeNull();
    expect(validateRule({ graceMinutes: 721, penaltyIqd: 0 })).toBe('grace');
    expect(validateRule({ graceMinutes: 15, penaltyIqd: null })).toBe('penalty');
    expect(validateRule({ graceMinutes: 15, penaltyIqd: 2_000_001 })).toBe('penalty');
  });
});

describe('validateAttendance', () => {
  const today = '2026-10-03';
  const ok: AttendanceDraft = { staffId: 's1', date: '2026-10-02', late: 20, early: 0, note: '' };

  it('passes a day within the window with some minutes', () => {
    expect(validateAttendance(ok, today)).toEqual([]);
    expect(validateAttendance({ ...ok, date: today }, today)).toEqual([]);
    expect(validateAttendance({ ...ok, date: attendanceWindow(today).min }, today)).toEqual([]);
  });

  it('asks for a person and a date', () => {
    expect(validateAttendance({ ...ok, staffId: '', date: '' }, today)).toEqual([
      { field: 'staffId', code: 'required' },
      { field: 'date', code: 'required' },
    ]);
  });

  it('refuses a day ahead or more than 60 days back', () => {
    expect(validateAttendance({ ...ok, date: '2026-10-04' }, today)).toEqual([{ field: 'date', code: 'dateRange' }]);
    expect(validateAttendance({ ...ok, date: '2026-08-03' }, today)).toEqual([{ field: 'date', code: 'dateRange' }]);
    expect(attendanceWindow(today)).toEqual({ min: '2026-08-04', max: '2026-10-03' });
  });

  it('keeps minutes within 0..720 and never both 0', () => {
    expect(validateAttendance({ ...ok, late: 0, early: 0 }, today)).toEqual([{ field: 'minutes', code: 'bothZero' }]);
    expect(validateAttendance({ ...ok, late: 721 }, today)).toEqual([{ field: 'late', code: 'minutesRange' }]);
    expect(validateAttendance({ ...ok, early: -1 }, today)).toEqual([{ field: 'early', code: 'minutesRange' }]);
    expect(validateAttendance({ ...ok, late: 0, early: 30 }, today)).toEqual([]);
  });

  it('keeps the note to 300 characters', () => {
    expect(validateAttendance({ ...ok, note: 'x'.repeat(300) }, today)).toEqual([]);
    expect(validateAttendance({ ...ok, note: 'x'.repeat(301) }, today)).toEqual([{ field: 'note', code: 'tooLong' }]);
  });
});

describe('attendanceRefusalField', () => {
  it('maps each hint to its field', () => {
    expect(attendanceRefusalField('INVALID_ARGUMENT', 'date')).toBe('date');
    expect(attendanceRefusalField('INVALID_ARGUMENT', 'late_minutes')).toBe('late');
    expect(attendanceRefusalField('INVALID_ARGUMENT', 'early_leave_minutes')).toBe('early');
    expect(attendanceRefusalField('INVALID_ARGUMENT', 'minutes')).toBe('minutes');
    expect(attendanceRefusalField('INVALID_ARGUMENT', 'other')).toBeNull();
    expect(attendanceRefusalField('TEXT_TOO_LONG', 'note')).toBe('note');
    expect(attendanceRefusalField('FORBIDDEN', 'staff_id')).toBe('staffId');
    expect(attendanceRefusalField('WAGE_ALREADY_PAID', null)).toBeNull();
  });

  it('knows the refusals that mean the month moved', () => {
    expect(isAttendanceStale('WAGE_ALREADY_PAID')).toBe(true);
    expect(isAttendanceStale('REF_NOT_FOUND')).toBe(true);
    expect(isAttendanceStale('FORBIDDEN')).toBe(false);
    expect(isAttendanceStale(null)).toBe(false);
  });
});

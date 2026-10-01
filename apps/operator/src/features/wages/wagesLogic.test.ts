import { describe, expect, it } from 'vitest';
import {
  canMarkPaid,
  canStepWageForward,
  canUndoPaid,
  dueWhen,
  fromMonthOptions,
  isWageStale,
  payDayClamps,
  payableIqd,
  readWagesDue,
  readWagesMonth,
  undoReasonIssue,
  unsetPeople,
  validateWageDraft,
  wageRefusalField,
  wageTone,
  wagesDueCount,
} from './wagesLogic';

const line = (over: Record<string, unknown> = {}) => ({
  month: '2026-10-01',
  status: 'due',
  salary_iqd: 750000,
  pay_day: 5,
  rate_from: '2026-09-01',
  next_rate: null,
  due_date: '2026-10-05',
  days_left: 2,
  deductions_iqd: 25000,
  deduction_count: 1,
  penalties_iqd: 10000,
  penalty_days: 2,
  net_iqd: 715000,
  payment: null,
  ...over,
});

describe('readWagesMonth', () => {
  it('reads the month, its totals and each person as the server sent them', () => {
    const m = readWagesMonth({
      month: '2026-10-01',
      current_month: '2026-10-01',
      today: '2026-10-03',
      remind_days: 3,
      totals: { salary_iqd: 750000, deductions_iqd: 25000, penalties_iqd: 10000, net_iqd: 715000, paid_iqd: 0, people: 2, paid: 0, due: 1, overdue: 0, upcoming: 0, unset: 1 },
      people: [
        {
          ...line({ next_rate: { salary_iqd: 800000, pay_day: 31, from: '2026-11-01' }, payment: { id: 'p1', status: 'undone', paid_iqd: 700000, paid_at: '2026-10-02T10:00:00Z', paid_by_name: 'Owner', undone_at: '2026-10-02T11:00:00Z', undone_by_name: 'Owner', undo_reason: 'Wrong person' } }),
          staff_id: 's1',
          display_name: 'Yusuf',
          role: 'barista',
          is_active: true,
          member: true,
          waiting_count: 2,
          deductions: [{ id: 'd1', amount_iqd: 25000, deduction_date: '2026-09-28', reason: 'Broken cup', decided_at: '2026-10-01T09:00:00Z' }, { amount_iqd: 1 }],
          lateness: [{ id: 'a1', work_date: '2026-10-02', late_minutes: 20, early_leave_minutes: 0, grace_minutes: 15, penalty_iqd: 5000, note: null }],
        },
        { ...line({ status: 'unset', salary_iqd: 0, pay_day: null, due_date: null, days_left: null, net_iqd: 0 }), staff_id: 's2', display_name: 'Hasan', role: 'waiter', member: true },
        { display_name: 'no id' },
      ],
    });
    expect(m.month).toBe('2026-10-01');
    expect(m.remindDays).toBe(3);
    expect(m.totals.netIqd).toBe(715000);
    expect(m.totals.unset).toBe(1);
    expect(m.people).toHaveLength(2);
    const [y, h] = m.people;
    expect(y!.status).toBe('due');
    expect(y!.role).toBe('barista');
    expect(y!.nextRate).toEqual({ salaryIqd: 800000, payDay: 31, from: '2026-11-01' });
    expect(y!.payment?.status).toBe('undone');
    expect(y!.waitingCount).toBe(2);
    expect(y!.deductions).toHaveLength(1);
    expect(y!.lateness[0]).toEqual({ id: 'a1', workDate: '2026-10-02', lateMinutes: 20, earlyLeaveMinutes: 0, graceMinutes: 15, penaltyIqd: 5000, note: null });
    expect(h!.payDay).toBeNull();
    expect(h!.daysLeft).toBeNull();
    expect(unsetPeople(m).map((p) => p.staffId)).toEqual(['s2']);
  });

  it('keeps a net below zero as the server sent it', () => {
    const m = readWagesMonth({ people: [{ ...line({ net_iqd: -40000 }), staff_id: 's1' }] });
    expect(m.people[0]!.netIqd).toBe(-40000);
  });

  it('reads garbage as an empty month', () => {
    for (const bad of [null, undefined, 'x', 3, [], { people: 'no' }]) {
      const m = readWagesMonth(bad);
      expect(m.people).toEqual([]);
      expect(m.totals.people).toBe(0);
      expect(m.month).toBeNull();
    }
  });

  it('reads an unknown status as unset', () => {
    expect(readWagesMonth({ people: [{ ...line({ status: 'weird' }), staff_id: 's1' }] }).people[0]!.status).toBe('unset');
  });
});

describe('readWagesDue and wagesDueCount', () => {
  it('reads every month due now or overdue, and counts them', () => {
    const payload = {
      today: '2026-10-03',
      remind_days: 3,
      count: 2,
      overdue_count: 1,
      people: [
        { ...line({ month: '2026-09-01', status: 'overdue', due_date: '2026-09-05', days_left: -28 }), staff_id: 's1', display_name: 'Yusuf', role: 'barista' },
        { ...line(), staff_id: 's1', display_name: 'Yusuf', role: 'barista' },
      ],
    };
    const d = readWagesDue(payload);
    expect(d.count).toBe(2);
    expect(d.overdueCount).toBe(1);
    expect(d.people.map((p) => p.month)).toEqual(['2026-09-01', '2026-10-01']);
    expect(wagesDueCount(payload)).toBe(2);
  });

  it('falls back to the rows when the count is missing, and to 0 on garbage', () => {
    expect(wagesDueCount({ people: [{ ...line(), staff_id: 's1' }] })).toBe(1);
    expect(wagesDueCount(null)).toBe(0);
    expect(wagesDueCount({ count: -3 })).toBe(0);
  });
});

describe('what a line shows and offers', () => {
  it('tones overdue red, due amber, paid green and the rest neutral', () => {
    expect(wageTone('overdue')).toBe('danger');
    expect(wageTone('due')).toBe('warn');
    expect(wageTone('paid')).toBe('success');
    expect(wageTone('upcoming')).toBe('neutral');
    expect(wageTone('unset')).toBe('neutral');
    expect(wageTone('none')).toBe('neutral');
  });

  it('words the pay day from days_left', () => {
    expect(dueWhen(-3)).toEqual({ kind: 'overdue', days: 3 });
    expect(dueWhen(0)).toEqual({ kind: 'today' });
    expect(dueWhen(2)).toEqual({ kind: 'in', days: 2 });
    expect(dueWhen(null)).toBeNull();
  });

  it('offers Mark paid on a set, unpaid month and Undo on a standing payment', () => {
    for (const s of ['due', 'overdue', 'upcoming'] as const) expect(canMarkPaid({ status: s })).toBe(true);
    for (const s of ['paid', 'unset', 'none'] as const) expect(canMarkPaid({ status: s })).toBe(false);
    const pay = { id: 'p', paidIqd: 1, paidAt: null, paidByName: null, undoneAt: null, undoneByName: null, undoReason: null };
    expect(canUndoPaid({ payment: { ...pay, status: 'paid' } })).toBe(true);
    expect(canUndoPaid({ payment: { ...pay, status: 'undone' } })).toBe(false);
    expect(canUndoPaid({ payment: null })).toBe(false);
  });

  it('pays nothing below zero and the net otherwise', () => {
    expect(payableIqd(-5000)).toBe(0);
    expect(payableIqd(0)).toBe(0);
    expect(payableIqd(715000)).toBe(715000);
  });
});

describe('the month stepper and the salary form', () => {
  it('steps forward to next month at most', () => {
    expect(canStepWageForward('2026-10-01', '2026-10-01')).toBe(true);
    expect(canStepWageForward('2026-11-01', '2026-10-01')).toBe(false);
    expect(canStepWageForward('2026-11-01', '2026-11-01')).toBe(true);
    expect(canStepWageForward('2026-12-01', '2026-11-01')).toBe(false);
    expect(canStepWageForward('2027-01-01', '2026-12-01')).toBe(false);
    expect(canStepWageForward(null, '2026-10-01')).toBe(false);
  });

  it('offers this month to three ahead as explicit starts', () => {
    expect(fromMonthOptions('2026-11-01')).toEqual(['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01']);
    expect(fromMonthOptions(null)).toEqual([]);
  });

  it('hints at the short-month clamp past the 28th', () => {
    expect(payDayClamps(28)).toBe(false);
    expect(payDayClamps(29)).toBe(true);
    expect(payDayClamps(31)).toBe(true);
    expect(payDayClamps(null)).toBe(false);
  });

  it('states the salary and pay-day rules before the server refuses', () => {
    expect(validateWageDraft({ salary: 750000, payDay: 5 })).toEqual([]);
    expect(validateWageDraft({ salary: 0, payDay: 31 })).toEqual([]);
    expect(validateWageDraft({ salary: null, payDay: null })).toEqual([
      { field: 'salary', code: 'required' },
      { field: 'payDay', code: 'required' },
    ]);
    expect(validateWageDraft({ salary: 100_000_001, payDay: 0 })).toEqual([
      { field: 'salary', code: 'range' },
      { field: 'payDay', code: 'range' },
    ]);
    expect(validateWageDraft({ salary: 1.5, payDay: 32 })).toEqual([
      { field: 'salary', code: 'range' },
      { field: 'payDay', code: 'range' },
    ]);
  });

  it('maps a refusal to the field it names', () => {
    expect(wageRefusalField('INVALID_AMOUNT', null)).toBe('salary');
    expect(wageRefusalField('INVALID_ARGUMENT', 'pay_day')).toBe('payDay');
    expect(wageRefusalField('INVALID_ARGUMENT', 'month')).toBe('from');
    expect(wageRefusalField('FORBIDDEN', 'staff_id')).toBe('staff');
    expect(wageRefusalField('FORBIDDEN', null)).toBeNull();
    expect(wageRefusalField(null, null)).toBeNull();
  });

  it('requires an undo reason of at most 1000 characters', () => {
    expect(undoReasonIssue('  ')).toBe('required');
    expect(undoReasonIssue('Paid the wrong person')).toBeNull();
    expect(undoReasonIssue('x'.repeat(1000))).toBeNull();
    expect(undoReasonIssue('x'.repeat(1001))).toBe('tooLong');
  });

  it('knows the refusals that mean the month moved', () => {
    for (const c of ['WAGE_ALREADY_PAID', 'WAGE_CHANGED', 'REF_NOT_FOUND', 'INVALID_TRANSITION']) expect(isWageStale(c)).toBe(true);
    for (const c of ['WAGE_NOT_SET', 'FORBIDDEN', null]) expect(isWageStale(c)).toBe(false);
  });
});

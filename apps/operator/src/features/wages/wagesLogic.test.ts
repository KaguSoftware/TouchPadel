import { describe, expect, it } from 'vitest';
import {
  advanceMaxFromHint,
  advanceMonthInRange,
  bonusKind,
  canGiveAdvance,
  canUndoAdvance,
  canMarkPaid,
  canStepWageForward,
  canUndoPaid,
  dueWhen,
  fromMonthOptions,
  isWageStale,
  payDayClamps,
  payableIqd,
  prizeCount,
  readWagesDue,
  readWagesMonth,
  undoReasonIssue,
  unsetPeople,
  validateAdvanceDraft,
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

  it('reads the bonuses a month carries (0333): the sum, the count and every reward, prize-only ones too', () => {
    const m = readWagesMonth({
      totals: { salary_iqd: 750000, deductions_iqd: 0, penalties_iqd: 0, bonuses_iqd: 50000, net_iqd: 800000, paid_iqd: 0 },
      people: [
        {
          ...line({ deductions_iqd: 0, penalties_iqd: 0, bonuses_iqd: 50000, bonus_count: 1, net_iqd: 800000 }),
          staff_id: 's1',
          bonuses: [
            { id: 'e1', earned_month: '2026-09-01', target: 200, reward_iqd: 50000, prize: null },
            { id: 'e2', earned_month: '2026-09-01', target: 300, reward_iqd: 0, prize: 'Dinner for two' },
            { earned_month: '2026-09-01' },
          ],
        },
      ],
    });
    const p = m.people[0]!;
    expect(m.totals.bonusesIqd).toBe(50000);
    expect(p.bonusesIqd).toBe(50000);
    expect(p.bonusCount).toBe(1);
    expect(p.netIqd).toBe(800000);
    expect(p.bonuses).toEqual([
      { id: 'e1', earnedMonth: '2026-09-01', target: 200, rewardIqd: 50000, prize: null },
      { id: 'e2', earnedMonth: '2026-09-01', target: 300, rewardIqd: 0, prize: 'Dinner for two' },
    ]);
    expect(prizeCount(p)).toBe(1);
    expect(p.bonuses.map(bonusKind)).toEqual(['amount', 'prize']);
    expect(bonusKind({ rewardIqd: 1000, prize: 'Cinema tickets' })).toBe('both');
  });

  it('reads the Touch Shop sales rewards a month carries (0355), and none from an older server', () => {
    const m = readWagesMonth({
      totals: { salary_iqd: 500000, bonuses_iqd: 25000 },
      people: [
        {
          ...line({ bonuses_iqd: 25000, bonus_count: 1 }),
          staff_id: 's1',
          shop_rewards: [{ id: 'r1', earned_month: '2026-09-01', sales_iqd: 250000, reward_iqd: 25000 }, { earned_month: '2026-09-01' }],
        },
        { ...line(), staff_id: 's2' },
      ],
    });
    expect(m.people[0]!.shopRewards).toEqual([{ id: 'r1', earnedMonth: '2026-09-01', salesIqd: 250000, rewardIqd: 25000 }]);
    expect(m.people[0]!.bonusesIqd).toBe(25000);
    expect(m.people[1]!.shopRewards).toEqual([]);
  });

  it('reads a line from before 0333 as no bonuses, and no bonuses total as absent rather than 0', () => {
    const m = readWagesMonth({ totals: { salary_iqd: 1 }, people: [{ ...line(), staff_id: 's1' }] });
    expect(m.totals.bonusesIqd).toBeNull();
    expect(m.people[0]!.bonusesIqd).toBe(0);
    expect(m.people[0]!.bonusCount).toBe(0);
    expect(m.people[0]!.bonuses).toEqual([]);
    expect(m.people[0]!.bonusOnly).toBe(false);
  });

  it('reads a bonus-only month for someone who left (0333)', () => {
    const m = readWagesMonth({
      people: [{ ...line({ salary_iqd: 0, bonuses_iqd: 30000, bonus_count: 1, bonus_only: true, net_iqd: 30000 }), staff_id: 's1', member: false }],
    });
    expect(m.people[0]!.bonusOnly).toBe(true);
    expect(m.people[0]!.salaryIqd).toBe(0);
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
    for (const s of ['due', 'overdue', 'upcoming'] as const) expect(canMarkPaid({ status: s, bonusesIqd: 0 })).toBe(true);
    for (const s of ['paid', 'unset', 'none'] as const) expect(canMarkPaid({ status: s, bonusesIqd: 0 })).toBe(false);
    // No salary but a reward bonus: the bonus is paid alone (0333).
    for (const s of ['unset', 'none'] as const) expect(canMarkPaid({ status: s, bonusesIqd: 25000 })).toBe(true);
    expect(canMarkPaid({ status: 'paid', bonusesIqd: 25000 })).toBe(false);
    const pay = { id: 'p', paidIqd: 1, advancesIqd: 0, paidFrom: null, paidAt: null, paidByName: null, undoneAt: null, undoneByName: null, undoReason: null };
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

describe('advances (0344)', () => {
  it('reads the advances, what is still owed and what Mark paid hands over, as the server sent them', () => {
    const m = readWagesMonth({
      month: '2026-10-01',
      totals: { net_iqd: 715000, advances_iqd: 100000, to_pay_iqd: 615000, paid_iqd: 0 },
      people: [
        {
          ...line({
            advances_iqd: 100000,
            advance_count: 2,
            owed_iqd: 615000,
            to_pay_iqd: 615000,
            advances: [
              { id: 'v1', amount_iqd: 60000, paid_from: 'safe', note: 'Rent', given_at: '2026-10-03T10:00:00Z', given_by_name: 'Majed' },
              { id: 'v2', amount_iqd: 40000, paid_from: 'bank', note: null, given_at: '2026-10-04T10:00:00Z', given_by_name: null },
              { id: 'v3', amount_iqd: 1, paid_from: 'cheque' },
              { amount_iqd: 1, paid_from: 'safe' },
            ],
          }),
          staff_id: 's1',
          display_name: 'Yusuf',
        },
      ],
    });
    const [y] = m.people;
    expect(y!.advancesIqd).toBe(100000);
    expect(y!.advanceCount).toBe(2);
    expect(y!.owedIqd).toBe(615000);
    expect(y!.toPayIqd).toBe(615000);
    expect(y!.advances).toEqual([
      { id: 'v1', amountIqd: 60000, paidFrom: 'safe', note: 'Rent', givenAt: '2026-10-03T10:00:00Z', givenByName: 'Majed' },
      { id: 'v2', amountIqd: 40000, paidFrom: 'bank', note: null, givenAt: '2026-10-04T10:00:00Z', givenByName: null },
    ]);
    expect(m.totals.advancesIqd).toBe(100000);
    expect(m.totals.toPayIqd).toBe(615000);
  });

  it('keeps owed below zero as sent, with nothing to pay', () => {
    const [y] = readWagesMonth({ people: [{ ...line({ advances_iqd: 800000, owed_iqd: -85000, to_pay_iqd: 0 }), staff_id: 's1' }] }).people;
    expect(y!.owedIqd).toBe(-85000);
    expect(y!.toPayIqd).toBe(0);
  });

  it('reads the payment snapshot: the advances and where the money came from', () => {
    const [y] = readWagesMonth({
      people: [
        {
          ...line({
            status: 'paid',
            owed_iqd: 0,
            to_pay_iqd: 0,
            payment: { id: 'p1', status: 'paid', paid_iqd: 615000, advances_iqd: 100000, paid_from: 'safe', paid_at: null, paid_by_name: null, undone_at: null, undone_by_name: null, undo_reason: null },
          }),
          staff_id: 's1',
        },
      ],
    }).people;
    expect(y!.payment).toMatchObject({ paidIqd: 615000, advancesIqd: 100000, paidFrom: 'safe' });
    const [old] = readWagesMonth({ people: [{ ...line({ status: 'paid', payment: { id: 'p0', status: 'paid', paid_iqd: 1 } }), staff_id: 's1' }] }).people;
    expect(old!.payment).toMatchObject({ advancesIqd: 0, paidFrom: null });
  });

  it('reads a line from before 0344 as no advances: owed is the net, to pay the net or nothing', () => {
    const [y, neg, paid] = readWagesMonth({
      people: [
        { ...line(), staff_id: 's1' },
        { ...line({ net_iqd: -5000 }), staff_id: 's2' },
        { ...line({ status: 'paid' }), staff_id: 's3' },
      ],
    }).people;
    expect([y!.advancesIqd, y!.advanceCount, y!.advances, y!.owedIqd, y!.toPayIqd]).toEqual([0, 0, [], 715000, 715000]);
    expect([neg!.owedIqd, neg!.toPayIqd]).toEqual([-5000, 0]);
    expect([paid!.owedIqd, paid!.toPayIqd]).toEqual([0, 0]);
    expect(readWagesMonth({}).totals.advancesIqd).toBe(0);
  });

  it('offers Give advance on an open month with a salary that still owes something', () => {
    const base = { status: 'due' as const, owedIqd: 100000, bonusOnly: false, month: '2026-10-01' };
    for (const status of ['due', 'overdue', 'upcoming'] as const) expect(canGiveAdvance({ ...base, status })).toBe(true);
    for (const status of ['paid', 'unset', 'none'] as const) expect(canGiveAdvance({ ...base, status })).toBe(false);
    expect(canGiveAdvance({ ...base, owedIqd: 0 })).toBe(false);
    expect(canGiveAdvance({ ...base, owedIqd: -1 })).toBe(false);
    expect(canGiveAdvance({ ...base, bonusOnly: true })).toBe(false);
    // The server takes last month to next month.
    expect(canGiveAdvance(base, '2026-10-01')).toBe(true);
    expect(canGiveAdvance({ ...base, month: '2026-09-01' }, '2026-10-01')).toBe(true);
    expect(canGiveAdvance({ ...base, month: '2026-11-01' }, '2026-10-01')).toBe(true);
    expect(canGiveAdvance({ ...base, month: '2026-08-01' }, '2026-10-01')).toBe(false);
    expect(canGiveAdvance({ ...base, month: '2026-12-01' }, '2026-10-01')).toBe(false);
    expect(advanceMonthInRange('2020-01-01', null)).toBe(true);
  });

  it('takes an advance back only while its month is open', () => {
    expect(canUndoAdvance({ status: 'due' })).toBe(true);
    expect(canUndoAdvance({ status: 'paid' })).toBe(false);
  });

  it('states the advance rules before the server refuses', () => {
    expect(validateAdvanceDraft({ amount: null, note: '' }, 100000)).toEqual([{ field: 'amount', code: 'required' }]);
    expect(validateAdvanceDraft({ amount: 0, note: '' }, 100000)).toEqual([{ field: 'amount', code: 'positive' }]);
    expect(validateAdvanceDraft({ amount: 100001, note: '' }, 100000)).toEqual([{ field: 'amount', code: 'tooLarge' }]);
    expect(validateAdvanceDraft({ amount: 100000, note: '  Rent  ' }, 100000)).toEqual([]);
    expect(validateAdvanceDraft({ amount: 1, note: 'x'.repeat(301) }, 100000)).toEqual([{ field: 'note', code: 'tooLong' }]);
    expect(validateAdvanceDraft({ amount: 1, note: 'ع'.repeat(300) }, 100000)).toEqual([]);
  });

  it('reads the most that may still be given from WAGE_ADVANCE_TOO_LARGE', () => {
    expect(advanceMaxFromHint('85000')).toBe(85000);
    expect(advanceMaxFromHint('0')).toBe(0);
    expect(advanceMaxFromHint(null)).toBeNull();
    expect(advanceMaxFromHint('amount')).toBeNull();
  });
});

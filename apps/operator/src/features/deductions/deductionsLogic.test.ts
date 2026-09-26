import { describe, expect, it } from 'vitest';
import {
  AMOUNT_MAX,
  canStepForward,
  dateWindow,
  decisionIssue,
  deductionTone,
  deductionsWaitingCount,
  onlyManagerDecides,
  isStaleRefusal,
  proposeRefusalField,
  readDeductionTargets,
  readDeductionsMonth,
  readDeductionsPage,
  validateProposal,
  waitingAction,
} from './deductionsLogic';

// /deductions, pure (wave5-addendum-2026-09-25 §2.5, §5.2): the readers take
// each payload as app.deductions_page / deductions_month / deduction_targets
// return it, and the propose form states every server rule first.

const pageRow = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  staff_id: 's-yusuf',
  staff_name: 'Yusuf',
  staff_role: 'barista',
  amount_iqd: 25000,
  deduction_date: '2026-09-20',
  pay_month: null,
  dated_earlier: false,
  reason: 'Late three times this week',
  status: 'waiting',
  proposed_by_name: 'Bareq',
  proposed_by_role: 'head_barista',
  proposed_at: '2026-09-20T09:00:00Z',
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  cancelled_by_name: null,
  cancelled_at: null,
  cancel_reason: null,
  can_decide: true,
  can_cancel: false,
  ...over,
});

describe('app.deductions_page', () => {
  it('reads each row as returned, and the waiting count is the rail badge', () => {
    const payload = { deductions: [pageRow()], waiting_count: 3, total: 7 };
    const page = readDeductionsPage(payload);
    expect(page.waitingCount).toBe(3);
    expect(page.total).toBe(7);
    expect(page.rows[0]).toMatchObject({
      id: 'd1',
      staffName: 'Yusuf',
      staffRole: 'barista',
      amountIqd: 25000,
      deductionDate: '2026-09-20',
      payMonth: null,
      status: 'waiting',
      proposedByRole: 'head_barista',
      canDecide: true,
      canCancel: false,
    });
    expect(deductionsWaitingCount(payload)).toBe(3);
  });

  it('reads nothing from a missing or broken payload, and an unknown role or status safely', () => {
    expect(readDeductionsPage(undefined)).toEqual({ rows: [], waitingCount: 0, total: 0 });
    expect(readDeductionsPage({ deductions: [{ id: 5 }, 'x', null] }).rows).toEqual([]);
    const odd = readDeductionsPage({ deductions: [pageRow({ staff_role: 'pilot', status: 'paid', waiting_count: '2' })] }).rows[0]!;
    expect(odd.staffRole).toBeNull();
    expect(odd.status).toBe('waiting');
    expect(deductionsWaitingCount({ waiting_count: '4' })).toBe(4);
    expect(deductionsWaitingCount({ waiting_count: -1 })).toBe(0);
  });

  it('says a manager decides the owner’s own proposal, and another manager or the owner anyone else’s', () => {
    expect(onlyManagerDecides('owner')).toBe(true);
    expect(onlyManagerDecides('manager')).toBe(false);
    expect(onlyManagerDecides('head_chef')).toBe(false);
    expect(onlyManagerDecides(null)).toBe(false);
  });

  it('leaves the viewer’s own waiting proposals out of the count to decide', () => {
    // A manager proposed one of the three: he can decide two.
    const payload = {
      deductions: [pageRow({ id: 'a' }), pageRow({ id: 'b' }), pageRow({ id: 'own', can_decide: false })],
      waiting_count: 3,
      total: 3,
    };
    expect(deductionsWaitingCount(payload)).toBe(2);
    // Only his own waits: nothing to decide, and never below zero.
    expect(deductionsWaitingCount({ deductions: [pageRow({ can_decide: false })], waiting_count: 1 })).toBe(0);
    expect(deductionsWaitingCount({ deductions: [pageRow({ can_decide: false })], waiting_count: 0 })).toBe(0);
  });

  it('offers Approve and Decline when the viewer may decide, Withdraw on their own proposal, nothing once settled', () => {
    expect(waitingAction({ status: 'waiting', canDecide: true })).toBe('decide');
    // The page leaves out rows about the viewer (F6), so a waiting row they
    // cannot decide is one they proposed.
    expect(waitingAction({ status: 'waiting', canDecide: false })).toBe('withdraw');
    for (const s of ['approved', 'declined', 'withdrawn', 'cancelled'] as const) {
      expect(waitingAction({ status: s, canDecide: true }), s).toBeNull();
    }
  });

  it('colours a status by what it means, never by colour alone (the badge carries the word)', () => {
    expect(deductionTone('waiting')).toBe('warn');
    expect(deductionTone('approved')).toBe('success');
    expect(deductionTone('declined')).toBe('danger');
    expect(deductionTone('withdrawn')).toBe('neutral');
    expect(deductionTone('cancelled')).toBe('neutral');
  });
});

describe('app.deductions_month', () => {
  const month = {
    month: '2026-09-01',
    totals: { approved_iqd: 75000, approved_count: 2, waiting_iqd: 10000, waiting_count: 1, people: 2 },
    people: [
      {
        staff_id: 's-yusuf',
        display_name: 'Yusuf',
        role: 'barista',
        is_active: true,
        approved_iqd: 50000,
        approved_count: 1,
        waiting_iqd: 10000,
        waiting_count: 1,
        deductions: [
          { id: 'd1', amount_iqd: 50000, deduction_date: '2026-08-30', dated_earlier: true, reason: 'Broken grinder', status: 'approved', proposed_by_name: 'Bareq', decided_by_name: 'Omar', decided_at: '2026-09-02T10:00:00Z' },
          { id: 'd2', amount_iqd: 20000, deduction_date: '2026-09-05', dated_earlier: false, reason: 'Late', status: 'cancelled', proposed_by_name: 'Bareq', decided_by_name: 'Omar', decided_at: '2026-09-06T10:00:00Z' },
        ],
      },
      { staff_id: 's-left', display_name: 'Ali', role: 'chef', is_active: false, approved_iqd: 25000, approved_count: 1, waiting_iqd: 0, waiting_count: 0, deductions: [] },
    ],
  };

  it('reads the server’s totals and people, and never adds anything up itself', () => {
    const m = readDeductionsMonth(month);
    expect(m.month).toBe('2026-09-01');
    expect(m.totals).toEqual({ approvedIqd: 75000, approvedCount: 2, waitingIqd: 10000, waitingCount: 1, people: 2 });
    expect(m.people.map((p) => [p.displayName, p.isActive, p.approvedIqd])).toEqual([
      ['Yusuf', true, 50000],
      ['Ali', false, 25000],
    ]);
    // The cancelled row is listed but the person's approved figure is the server's (it left the total).
    expect(m.people[0]!.deductions.map((d) => [d.id, d.status, d.datedEarlier])).toEqual([
      ['d1', 'approved', true],
      ['d2', 'cancelled', false],
    ]);
  });

  it('reads an empty month', () => {
    expect(readDeductionsMonth({ month: '2026-07-01', totals: {}, people: [] })).toEqual({
      month: '2026-07-01',
      totals: { approvedIqd: 0, approvedCount: 0, waitingIqd: 0, waitingCount: 0, people: 0 },
      people: [],
    });
  });

  it('never steps past the month the server calls current', () => {
    expect(canStepForward('2026-08-01', '2026-09-01')).toBe(true);
    expect(canStepForward('2026-09-01', '2026-09-01')).toBe(false);
    expect(canStepForward(null, '2026-09-01')).toBe(false);
    expect(canStepForward('2026-08-01', null)).toBe(false);
  });
});

describe('the propose form', () => {
  const today = '2026-09-26';
  const good = { staffId: 's-yusuf', amount: 25000, date: '2026-09-20', reason: 'Late three times' };

  it('lists the people app.deduction_targets offers', () => {
    expect(readDeductionTargets({ staff: [{ id: 'a', display_name: 'Yusuf', role: 'barista' }, { display_name: 'no id' }] })).toEqual([
      { id: 'a', displayName: 'Yusuf', role: 'barista' },
    ]);
    expect(readDeductionTargets(null)).toEqual([]);
  });

  it('takes the 60 days up to the venue’s business date', () => {
    expect(dateWindow(today)).toEqual({ min: '2026-07-28', max: '2026-09-26' });
    expect(dateWindow('2026-03-01')).toEqual({ min: '2025-12-31', max: '2026-03-01' });
  });

  it('passes a good proposal and names every field the server would refuse', () => {
    expect(validateProposal(good, today)).toEqual([]);
    expect(validateProposal({ staffId: '', amount: null, date: '', reason: '  ' }, today)).toEqual([
      { field: 'staffId', code: 'required' },
      { field: 'amount', code: 'required' },
      { field: 'date', code: 'required' },
      { field: 'reason', code: 'required' },
    ]);
    expect(validateProposal({ ...good, amount: 0 }, today)).toEqual([{ field: 'amount', code: 'amountRange' }]);
    expect(validateProposal({ ...good, amount: AMOUNT_MAX + 1 }, today)).toEqual([{ field: 'amount', code: 'amountRange' }]);
    expect(validateProposal({ ...good, amount: AMOUNT_MAX }, today)).toEqual([]);
    expect(validateProposal({ ...good, amount: 1.5 }, today)).toEqual([{ field: 'amount', code: 'amountRange' }]);
    expect(validateProposal({ ...good, date: '2026-07-27' }, today)).toEqual([{ field: 'date', code: 'dateRange' }]);
    expect(validateProposal({ ...good, date: '2026-07-28' }, today)).toEqual([]);
    expect(validateProposal({ ...good, date: '2026-09-27' }, today)).toEqual([{ field: 'date', code: 'dateRange' }]);
  });

  it('counts the reason in characters, as Postgres does, Arabic included', () => {
    expect(validateProposal({ ...good, reason: 'ت'.repeat(500) }, today)).toEqual([]);
    expect(validateProposal({ ...good, reason: 'ت'.repeat(501) }, today)).toEqual([{ field: 'reason', code: 'tooLong' }]);
  });

  it('marks the field a server refusal names', () => {
    expect(proposeRefusalField('INVALID_AMOUNT', null)).toBe('amount');
    expect(proposeRefusalField('INVALID_ARGUMENT', 'date')).toBe('date');
    expect(proposeRefusalField('TEXT_TOO_LONG', 'reason')).toBe('reason');
    expect(proposeRefusalField('TEXT_REQUIRED', 'reason')).toBe('reason');
    expect(proposeRefusalField('FORBIDDEN', 'staff_id')).toBe('staffId');
    expect(proposeRefusalField('FORBIDDEN', null)).toBeNull();
    expect(proposeRefusalField(null, null)).toBeNull();
  });
});

describe('a decision’s note', () => {
  it('is optional on an approval and the reason on a decline, at most 1000 characters', () => {
    expect(decisionIssue(true, '')).toBeNull();
    expect(decisionIssue(false, '   ')).toBe('required');
    expect(decisionIssue(false, 'Not on shift that day')).toBeNull();
    expect(decisionIssue(true, 'x'.repeat(1001))).toBe('tooLong');
    expect(decisionIssue(false, 'x'.repeat(1000))).toBeNull();
  });
});

describe('a refusal that means the list is out of date', () => {
  it('refetches after “already decided”, “gone” and “not approved any more”, and after nothing else', () => {
    for (const code of ['SUBMISSION_DECIDED', 'REF_NOT_FOUND', 'INVALID_TRANSITION']) expect(isStaleRefusal(code), code).toBe(true);
    for (const code of ['FORBIDDEN', 'CANNOT_DECIDE_OWN', 'REASON_REQUIRED', 'NETWORK']) expect(isStaleRefusal(code), code).toBe(false);
    expect(isStaleRefusal(null)).toBe(false);
  });
});

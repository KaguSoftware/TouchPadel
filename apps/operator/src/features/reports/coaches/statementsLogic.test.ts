import { describe, expect, it } from 'vitest';
import type { StatementCan, StatementRow } from '../../coaching/lessonPayloads';
import { STATEMENTS_ROOT } from '../../coaching/useCoaching';
import { statementsKey } from './statementKeys';
import {
  addMonths,
  canStepForward,
  hasCoachPayWork,
  isOtherBranch,
  isPinRefusal,
  lineLessonParts,
  looksLikeCardNumber,
  maybeNegativeMoneyText,
  missingRows,
  moneyText,
  monthParam,
  orderStatements,
  referenceErrors,
  showsBranchColumn,
  shownMonth,
  signedMoneyText,
  statementActions,
  statementCounts,
  statementTone,
  stepMonth,
  textErrorKey,
  totalsFigures,
  voidReasonErrors,
} from './statementsLogic';

// Coach pay (coaching operator.md §5.16, §5.21): the rules the screen draws
// from. Every figure is the server's; these only read and order it.

const plain = (s: string) => s.replace(/[⁦-⁩‎‏]/g, '');

const RAIL = 'venue-a';

function row(over: Partial<StatementRow> = {}): StatementRow {
  return {
    statement_id: 's1',
    coach_id: 'c1',
    coach_name_en: 'Sara',
    coach_name_ar: 'سارة',
    venue_id: RAIL,
    venue_name_en: 'Mansour',
    venue_name_ar: 'المنصور',
    status: 'draft',
    lessons_count: 4,
    collected_iqd: 200000,
    court_share_iqd: 40000,
    coach_iqd: 96000,
    adjustments_iqd: 0,
    total_iqd: 96000,
    payable_iqd: 96000,
    drafted_at: '2026-10-01T00:05:00Z',
    refreshed_at: null,
    approved_at: null,
    approved_by_name: null,
    paid_at: null,
    paid_by_name: null,
    paid_reference: null,
    voided_at: null,
    void_reason: null,
    ...over,
  };
}

const ALL: StatementCan = { refresh: true, approve: true, void: true, mark_paid: true };
const NONE: StatementCan = { refresh: false, approve: false, void: false, mark_paid: false };
const SETTLE = { settleCoaches: true };

const keys = (plan: ReturnType<typeof statementActions>) => plan.actions.map((a) => a.key);

describe('statementActions (R4, R21, R59, R70, CM-11)', () => {
  it('a draft: Recount, Approve (no PIN), Void (no PIN)', () => {
    const plan = statementActions({ statement: row(), can: ALL }, SETTLE, RAIL);
    expect(plan.readOnly).toBeNull();
    expect(plan.actions).toEqual([
      { key: 'recount', pin: false, blocked: null },
      { key: 'approve', pin: false, blocked: null },
      { key: 'void', pin: false, blocked: null },
    ]);
  });

  it('approved: Mark paid and Void, both behind a manager PIN', () => {
    const plan = statementActions(
      { statement: row({ status: 'approved' }), can: ALL },
      SETTLE,
      RAIL,
    );
    expect(plan.actions).toEqual([
      { key: 'markPaid', pin: true, blocked: null },
      { key: 'void', pin: true, blocked: null },
    ]);
  });

  it('a void statement offers Redraft; a paid one nothing', () => {
    expect(
      keys(statementActions({ statement: row({ status: 'void' }), can: ALL }, SETTLE, RAIL)),
    ).toEqual(['redraft']);
    const paid = statementActions({ statement: row({ status: 'paid' }), can: NONE }, SETTLE, RAIL);
    expect(paid).toEqual({ readOnly: null, actions: [] });
  });

  it('below zero, Mark paid is offered but off; Void is not', () => {
    const plan = statementActions(
      { statement: row({ status: 'approved', total_iqd: -12000 }), can: ALL },
      SETTLE,
      RAIL,
    );
    expect(plan.actions).toEqual([
      { key: 'markPaid', pin: true, blocked: 'negative' },
      { key: 'void', pin: true, blocked: null },
    ]);
  });

  it('without settleCoaches nothing is offered', () => {
    expect(
      statementActions({ statement: row(), can: ALL }, { settleCoaches: false }, RAIL),
    ).toEqual({
      readOnly: 'noCapability',
      actions: [],
    });
  });

  it("another branch's row is read-only under All branches (R21)", () => {
    const plan = statementActions(
      { statement: row({ venue_id: 'venue-b' }), can: ALL },
      SETTLE,
      RAIL,
    );
    expect(plan).toEqual({ readOnly: 'otherBranch', actions: [] });
    // No rail branch known (one branch): every row is this branch's.
    expect(
      statementActions({ statement: row({ venue_id: 'venue-b' }), can: ALL }, SETTLE, null)
        .readOnly,
    ).toBeNull();
  });

  it("the caller's own statement: every can false on a live statement (CM-11)", () => {
    expect(statementActions({ statement: row(), can: NONE }, SETTLE, RAIL).readOnly).toBe(
      'ownStatement',
    );
    expect(
      statementActions({ statement: row({ status: 'approved' }), can: NONE }, SETTLE, RAIL)
        .readOnly,
    ).toBe('ownStatement');
  });

  it('follows each can flag, and the status alone before the detail has loaded', () => {
    const plan = statementActions(
      { statement: row(), can: { refresh: true, approve: false, void: true, mark_paid: false } },
      SETTLE,
      RAIL,
    );
    expect(keys(plan)).toEqual(['recount', 'void']);
    expect(
      keys(statementActions({ statement: row({ status: 'approved' }), can: null }, SETTLE, RAIL)),
    ).toEqual(['markPaid', 'void']);
  });
});

describe('referenceErrors / voidReasonErrors (R49, R74, Addition 18)', () => {
  it('refuses a card typed in groups, and any 12-digit run', () => {
    expect(referenceErrors('4111 1111 1111 1111')).toBe('cardNumber');
    expect(referenceErrors('4111-1111-1111-1111')).toBe('cardNumber');
    expect(referenceErrors('4111.1111.1111.1111')).toBe('cardNumber');
    expect(referenceErrors('Transfer 123456789012')).toBe('cardNumber');
    expect(referenceErrors('٤١١١٢٢٢٢٣٣٣٣')).toBe('cardNumber');
  });

  it('accepts an 11-digit run and ordinary references', () => {
    expect(referenceErrors('12345678901')).toBeNull();
    expect(referenceErrors('Receipt 4471')).toBeNull();
    expect(referenceErrors('Cash to Sara, 2 Oct')).toBeNull();
    expect(looksLikeCardNumber('1234 5678 901')).toBe(false);
  });

  it('needs 1..80 characters for a reference and 1..200 for a reason', () => {
    expect(referenceErrors('   ')).toBe('required');
    expect(referenceErrors('x'.repeat(80))).toBeNull();
    expect(referenceErrors('x'.repeat(81))).toBe('tooLong');
    expect(voidReasonErrors('')).toBe('required');
    expect(voidReasonErrors('x'.repeat(200))).toBeNull();
    expect(voidReasonErrors('x'.repeat(201))).toBe('tooLong');
    expect(voidReasonErrors('card 5555 5555 5555 4444')).toBe('cardNumber');
  });

  it('words each error', () => {
    expect(textErrorKey('cardNumber', 'reference')).toBe('ws.coaching.errors.cardNumber');
    expect(textErrorKey('required', 'reference')).toBe(
      'ws.coaching.coachPay.fieldErrors.referenceRequired',
    );
    expect(textErrorKey('required', 'reason')).toBe(
      'ws.coaching.coachPay.fieldErrors.reasonRequired',
    );
    expect(textErrorKey('tooLong', 'reason')).toBe('ws.coaching.coachPay.fieldErrors.tooLong');
  });
});

describe('the month stepper', () => {
  it('reads only a first-of-month ?month=', () => {
    expect(monthParam('2026-09-01')).toBe('2026-09-01');
    expect(monthParam('2026-09-15')).toBeNull();
    expect(monthParam(42)).toBeNull();
    expect(monthParam(undefined)).toBeNull();
  });

  it('never shows a month past the current one', () => {
    expect(shownMonth(null, '2026-10-01')).toBe('2026-10-01');
    expect(shownMonth('2026-08-01', '2026-10-01')).toBe('2026-08-01');
    expect(shownMonth('2027-01-01', '2026-10-01')).toBe('2026-10-01');
    expect(canStepForward('2026-10-01', '2026-10-01')).toBe(false);
    expect(canStepForward('2026-09-01', '2026-10-01')).toBe(true);
    expect(canStepForward(null, '2026-10-01')).toBe(false);
  });

  it('steps across a year, and lands on "this month" with no month', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(stepMonth('2026-10-01', -1, '2026-10-01')).toBe('2026-09-01');
    expect(stepMonth('2026-09-01', 1, '2026-10-01')).toBeNull();
    expect(stepMonth('2026-07-01', 1, '2026-10-01')).toBe('2026-08-01');
  });
});

describe('rows, branches and the missing lines', () => {
  it('orders the rail branch first, then drafts, approved, paid, void, then by name', () => {
    const rows = [
      row({ statement_id: 'a', status: 'paid', coach_name_en: 'Ali' }),
      row({ statement_id: 'b', status: 'draft', coach_name_en: 'Zaid' }),
      row({ statement_id: 'c', status: 'approved', coach_name_en: 'Ali' }),
      row({ statement_id: 'd', status: 'draft', coach_name_en: 'Hiba', venue_id: 'venue-b' }),
      row({ statement_id: 'e', status: 'draft', coach_name_en: 'Ali' }),
      row({ statement_id: 'f', status: 'void', coach_name_en: 'Ali' }),
    ];
    expect(orderStatements(rows, 'en', RAIL).map((r) => r.statement_id)).toEqual([
      'e',
      'b',
      'c',
      'a',
      'f',
      'd',
    ]);
  });

  it('shows the branch column only when a row is another branch’s', () => {
    expect(showsBranchColumn([row()], RAIL)).toBe(false);
    expect(showsBranchColumn([row(), row({ venue_id: 'venue-b' })], RAIL)).toBe(true);
    expect(isOtherBranch(row({ venue_id: null }), RAIL)).toBe(false);
  });

  it('words a missing coach by the reason the server gives', () => {
    const rows = missingRows(
      [
        {
          coach_id: 'c2',
          coach_name_en: 'Omar',
          coach_name_ar: 'عمر',
          venue_id: RAIL,
          reason: 'not_drafted',
        },
        {
          coach_id: 'c3',
          coach_name_en: 'Lina',
          coach_name_ar: '',
          venue_id: RAIL,
          reason: 'older_draft',
        },
      ],
      'ar',
    );
    expect(rows.map((r) => [r.coach, r.textKey])).toEqual([
      ['عمر', 'ws.coaching.coachPay.missing.not_drafted'],
      // An Arabic name left blank falls back to the English one.
      ['Lina', 'ws.coaching.coachPay.missing.older_draft'],
    ]);
  });

  it('counts drafts to approve and approved statements to pay (the Financial card)', () => {
    const counts = statementCounts([
      row(),
      row({ status: 'draft' }),
      row({ status: 'approved' }),
      row({ status: 'paid' }),
    ]);
    expect(counts).toEqual({ toApprove: 2, toPay: 1 });
    expect(hasCoachPayWork(counts)).toBe(true);
    expect(
      hasCoachPayWork(statementCounts([row({ status: 'paid' }), row({ status: 'void' })])),
    ).toBe(false);
  });

  it('lays the band out in the order of §5.16, figures as sent', () => {
    const band = totalsFigures({
      statements: 3,
      collected_iqd: 500000,
      court_share_iqd: 60000,
      coach_iqd: 264000,
      adjustments_iqd: -6000,
      total_iqd: 258000,
      payable_iqd: 258000,
      approved_unpaid_iqd: 100000,
      unpaid_iqd: 158000,
      paid_iqd: null,
    });
    expect(band.map((f) => [f.key, f.value])).toEqual([
      ['collected', 500000],
      ['courtShare', 60000],
      ['coachShare', 264000],
      ['adjustments', -6000],
      ['toPay', 258000],
      ['approvedUnpaid', 100000],
      ['paid', null],
    ]);
  });
});

describe('figures as printed', () => {
  it('never turns a missing figure into zero', () => {
    expect(moneyText(null, 'en')).toBe('—');
    expect(signedMoneyText(null, 'en')).toBe('—');
    expect(maybeNegativeMoneyText(null, 'en')).toBe('—');
    expect(moneyText(96000, 'en')).toBe('96,000 IQD');
  });

  it('signs adjustments and keeps them left to right', () => {
    expect(plain(signedMoneyText(5000, 'en'))).toBe('+5,000 IQD');
    expect(plain(signedMoneyText(-5000, 'en'))).toMatch(/^-5,000 IQD$/);
    expect(signedMoneyText(0, 'en')).toBe('0 IQD');
    expect(signedMoneyText(-5000, 'ar')).toMatch(/^⁦.*⁩$/);
  });

  it('gives each status its badge tone', () => {
    expect(['draft', 'approved', 'paid', 'void'].map(statementTone)).toEqual([
      'neutral',
      'info',
      'success',
      'neutral',
    ]);
  });

  it('names a line by its kind, and a course session by its title and number', () => {
    expect(
      lineLessonParts(
        {
          kind: 'group',
          type_name_en: 'Beginners',
          type_name_ar: 'مبتدئون',
          course_title_en: null,
          course_title_ar: null,
          session_no: null,
        },
        'en',
      ),
    ).toEqual({
      kindKey: 'ws.coaching.common.kindShort.group',
      name: 'Beginners',
      sessionNo: null,
    });
    expect(
      lineLessonParts(
        {
          kind: 'course',
          type_name_en: 'Course 8',
          type_name_ar: 'دورة',
          course_title_en: 'Autumn',
          course_title_ar: '',
          session_no: 3,
        },
        'ar',
      ),
    ).toEqual({ kindKey: 'ws.coaching.common.kindShort.course', name: 'دورة', sessionNo: 3 });
  });
});

describe('isPinRefusal and the list key', () => {
  it('keeps a PIN refusal on the PIN prompt, sends anything else back to the form', () => {
    expect(isPinRefusal({ code: 'PIN_INVALID' })).toBe(true);
    expect(isPinRefusal({ code: 'PIN_LOCKED' })).toBe(true);
    expect(isPinRefusal({ code: 'STATEMENT_NOT_APPROVED' })).toBe(false);
    expect(isPinRefusal(null)).toBe(false);
  });

  it('keys the list under the reports root, one key per month (§5.4)', () => {
    expect(statementsKey(null)).toEqual(['reports', 'report_coach_statements', 'current']);
    expect(statementsKey('2026-09-01')).toEqual([
      'reports',
      'report_coach_statements',
      '2026-09-01',
    ]);
    expect(statementsKey(null).slice(0, 2)).toEqual([...STATEMENTS_ROOT]);
  });
});

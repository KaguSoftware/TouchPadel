import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from '@touch/core';
import { staffKeys } from '../../keys';
import { staffIdemKey } from '../../../../lib/idempotency';
import {
  DEDUCT_ROLES,
  addDays,
  canWithdraw,
  decidableWaiting,
  decidedByManagerOnly,
  deductionArgs,
  deductionsAccess,
  emptyDeductionDraft,
  initialView,
  monthOf,
  shiftMonth,
  stepMonth,
  validateDeduction,
  venueBusinessToday,
} from '../logic';

/**
 * Pay deductions as rules (wave5-addendum-2026-09-25 §2.5, §5.3). DEDUCT
 * mirrors propose_deduction's guard (0197); the checks mirror its caps.
 */
const TODAY = '2026-09-26';

describe('who proposes', () => {
  it('is DEDUCT: the two heads and management, and nobody else', () => {
    expect([...DEDUCT_ROLES].sort()).toEqual(['head_barista', 'head_chef', 'manager', 'owner']);
    for (const role of STAFF_ROLES) {
      expect(deductionsAccess(role).proposes, role).toBe(DEDUCT_ROLES.includes(role));
      expect(deductionsAccess(role).mgmt, role).toBe(role === 'manager' || role === 'owner');
      // Nobody proposes against an owner (deduction_targets), so an owner has no record of their own.
      expect(deductionsAccess(role).hasOwn, role).toBe(role !== 'owner');
    }
  });

  it('opens a proposer on proposing unless the link asks for their own, and everyone else on theirs', () => {
    expect(initialView('head_barista', undefined)).toBe('propose');
    expect(initialView('head_barista', 'mine')).toBe('mine');
    expect(initialView('owner', 'propose')).toBe('propose');
    expect(initialView('owner', 'mine')).toBe('propose');
    expect(initialView('manager', 'mine')).toBe('mine');
    expect(initialView('barista', undefined)).toBe('mine');
    expect(initialView('waiter', 'propose')).toBe('mine');
  });
});

describe('a proposal', () => {
  const ok = { staffId: 's-1', amount: '25,000', date: TODAY, reason: 'Late twice' };

  it('starts empty, dated today', () => {
    expect(emptyDeductionDraft(TODAY)).toEqual({
      staffId: null,
      amount: '',
      date: TODAY,
      reason: '',
    });
  });

  it('passes when every field is right, and sends whole dinars and the ISO day', () => {
    expect(validateDeduction(ok, TODAY)).toEqual([]);
    expect(
      deductionArgs({ ...ok, amount: '٢٥٠٠٠', date: '2026/9/20', reason: '  Late twice  ' }, 'v-1'),
    ).toEqual({
      p_staff_id: 's-1',
      p_amount_iqd: 25000,
      p_date: '2026-09-20',
      p_reason: 'Late twice',
      p_venue_id: 'v-1',
    });
  });

  it('needs a person, an amount, a day and a reason', () => {
    const issues = validateDeduction(emptyDeductionDraft(''), TODAY);
    expect(issues).toEqual([
      { field: 'staffId', code: 'required' },
      { field: 'amount', code: 'required' },
      { field: 'date', code: 'required' },
      { field: 'reason', code: 'required' },
    ]);
  });

  it('keeps the amount between 1 and 2,000,000 IQD (INVALID_AMOUNT)', () => {
    expect(validateDeduction({ ...ok, amount: '0' }, TODAY)).toEqual([
      { field: 'amount', code: 'invalid' },
    ]);
    expect(validateDeduction({ ...ok, amount: '12.5' }, TODAY)).toEqual([
      { field: 'amount', code: 'invalid' },
    ]);
    expect(validateDeduction({ ...ok, amount: '2,000,000' }, TODAY)).toEqual([]);
    expect(validateDeduction({ ...ok, amount: '2000001' }, TODAY)).toEqual([
      { field: 'amount', code: 'tooMuch' },
    ]);
  });

  it('dates it within the 60 days up to today (INVALID_ARGUMENT hint date)', () => {
    expect(validateDeduction({ ...ok, date: '2026-09-27' }, TODAY)).toEqual([
      { field: 'date', code: 'future' },
    ]);
    expect(validateDeduction({ ...ok, date: addDays(TODAY, -60) }, TODAY)).toEqual([]);
    expect(validateDeduction({ ...ok, date: addDays(TODAY, -61) }, TODAY)).toEqual([
      { field: 'date', code: 'tooOld' },
    ]);
    expect(validateDeduction({ ...ok, date: '2026-02-30' }, TODAY)).toEqual([
      { field: 'date', code: 'invalid' },
    ]);
  });

  it('keeps the reason to 500 characters', () => {
    expect(validateDeduction({ ...ok, reason: 'x'.repeat(500) }, TODAY)).toEqual([]);
    expect(validateDeduction({ ...ok, reason: 'x'.repeat(501) }, TODAY)).toEqual([
      { field: 'reason', code: 'tooLong' },
    ]);
  });

  it('can be withdrawn only while it waits', () => {
    expect(canWithdraw({ status: 'waiting' })).toBe(true);
    for (const status of ['approved', 'declined', 'withdrawn', 'cancelled'] as const) {
      expect(canWithdraw({ status }), status).toBe(false);
    }
  });
});

describe('days and months', () => {
  it('count by the calendar across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-26', -60)).toBe('2026-07-28');
    expect(monthOf('2026-08-30')).toBe('2026-08-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('step back to a named month, and forward to the current one as null (the venue’s own)', () => {
    expect(stepMonth('2026-07-01', '2026-09-01', 1)).toBe('2026-08-01');
    expect(stepMonth('2026-08-01', '2026-09-01', 1)).toBeNull();
    expect(stepMonth('2026-09-01', '2026-09-01', 1)).toBeNull();
  });
});

describe('keys', () => {
  it('stay under the staff root, one entry per month', () => {
    expect(staffKeys.myDeductions('v', 'current')).toEqual([
      'staff',
      'myDeductions',
      'v',
      'current',
    ]);
    expect(staffKeys.myDeductions('v', '2026-08-01')[0]).toBe('staff');
    expect(staffKeys.deductionTargets('v')[0]).toBe('staff');
    expect(staffKeys.mutation('deduction.withdraw')).toEqual([
      'staff',
      'mutation',
      'deduction.withdraw',
    ]);
  });

  it('mint a proposal key as MOBILE:staff.deduction:<ulid>', () => {
    expect(staffIdemKey('deduction')).toMatch(/^MOBILE:staff\.deduction:[0-9A-HJKMNP-TV-Z]{26}$/);
  });
});

describe('management’s count, the business day and who decides', () => {
  it('leaves the viewer’s own waiting proposals out of the count to decide', () => {
    const page = {
      waiting_count: 3,
      deductions: [
        { status: 'waiting', can_decide: true },
        { status: 'waiting', can_decide: true },
        { status: 'waiting', can_decide: false },
      ],
    };
    expect(decidableWaiting(page)).toBe(2);
    expect(
      decidableWaiting({
        waiting_count: 1,
        deductions: [{ status: 'waiting', can_decide: false }],
      }),
    ).toBe(0);
    expect(decidableWaiting(undefined)).toBe(0);
  });

  it('dates a proposal on the venue’s business day, which starts at 04:00 (0165)', () => {
    // 01:00 in Baghdad (UTC+3) on the 27th is still the 26th's business day.
    expect(venueBusinessToday(new Date('2026-09-26T22:00:00Z'))).toBe('2026-09-26');
    // 05:00 in Baghdad on the 27th is the 27th.
    expect(venueBusinessToday(new Date('2026-09-27T02:00:00Z'))).toBe('2026-09-27');
  });

  it('says a manager decides an owner’s proposal, and a manager or the owner anyone else’s', () => {
    expect(decidedByManagerOnly('owner')).toBe(true);
    expect(decidedByManagerOnly('manager')).toBe(false);
    expect(decidedByManagerOnly('head_chef')).toBe(false);
  });
});

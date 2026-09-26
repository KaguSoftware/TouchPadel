/**
 * Pay deductions as rules (wave5-addendum-2026-09-25 §2.5, §5.3): who
 * proposes, the proposal as a draft with its checks and RPC arguments, and the
 * month the "Yours" view steps through. The server keeps the caps and the
 * guards (0197); these catch a bad field before the round trip.
 *
 * PURE (vitest): no react-native, no client.
 */
import { businessDayOf, parseTypedAmount, parseTypedDate, type StaffRole } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import type { DeductionStatus, ProposeDeductionArgs } from './api';

/**
 * DEDUCT (§2.0): the roles `propose_deduction`, `deduction_targets` and
 * `my_deduction_proposals` admit. Everyone else reads only their own.
 */
export const DEDUCT_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'manager', 'owner'];

const MGMT: readonly StaffRole[] = ['manager', 'owner'];

/** Server caps (0197). */
export const DEDUCTION_CAPS = {
  amountMax: 2_000_000,
  reason: 500,
  /** A deduction is dated within the 60 days up to the venue's business date. */
  daysBack: 60,
} as const;

export type DeductionsView = 'propose' | 'mine';

export interface DeductionsAccess {
  /** Proposes, and reads their own proposals. */
  proposes: boolean;
  /** Management: told how many wait for a decision on the operator. */
  mgmt: boolean;
  /**
   * Can have deductions of their own. Nobody can propose one against an
   * owner (deduction_targets leaves owners out), so an owner has no "Yours".
   */
  hasOwn: boolean;
}

export function deductionsAccess(role: StaffRole): DeductionsAccess {
  return {
    proposes: DEDUCT_ROLES.includes(role),
    mgmt: MGMT.includes(role),
    hasOwn: role !== 'owner',
  };
}

/**
 * The view a page opens on. `?view=mine` (the requests page's "My
 * deductions" row) opens on the person's own; a proposer otherwise opens on
 * proposing, and anyone who cannot propose only ever sees their own. An
 * owner has no own deductions, so always proposes.
 */
/**
 * Who decides the viewer's proposal: never its proposer (CANNOT_DECIDE_OWN,
 * 0197), so an owner's goes to a manager, and everyone else's to a manager or
 * the owner.
 */
export function decidedByManagerOnly(role: StaffRole): boolean {
  return role === 'owner';
}

export function initialView(role: StaffRole, param: string | undefined): DeductionsView {
  const access = deductionsAccess(role);
  if (!access.proposes) return 'mine';
  return param === 'mine' && access.hasOwn ? 'mine' : 'propose';
}

// ── Days and months ─────────────────────────────────────────────────────────

/**
 * The hour the venue's business day starts at: the server's default for
 * `analytics_business_day_start_hour` (0165 app.venue_business_date), which
 * propose_deduction checks the date against.
 */
export const VENUE_DAY_START_HOUR = 4;

/**
 * Today on the venue's business calendar: before 04:00 it is still the day
 * before, so a late-night proposal's default date is one the server accepts.
 */
export function venueBusinessToday(now: Date = new Date()): string {
  return businessDayOf(now, VENUE_DAY_START_HOUR, VENUE_TZ);
}

/** `YYYY-MM-DD` plus `days` (negative goes back), by the calendar, never a clock. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + days));
  return at.toISOString().slice(0, 10);
}

/** The first day of the month `day` is in. */
export function monthOf(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the month `delta` months from `month`'s. */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return at.toISOString().slice(0, 10);
}

/**
 * The month the "Yours" view asks for after a step. `null` is the venue's
 * current month (the RPC's own default), so the page never asks the phone's
 * calendar which month it is at the venue; a step that reaches the current
 * month or past it comes back to `null`.
 */
export function stepMonth(shown: string, current: string, delta: number): string | null {
  const next = shiftMonth(shown, delta);
  return next >= current ? null : next;
}

// ── The proposal ────────────────────────────────────────────────────────────

export interface DeductionDraft {
  staffId: string | null;
  amount: string;
  date: string;
  reason: string;
}

export type DeductionField = 'staffId' | 'amount' | 'date' | 'reason';
export type DeductionIssueCode =
  'required' | 'invalid' | 'tooLong' | 'tooMuch' | 'future' | 'tooOld';

export interface DeductionIssue {
  field: DeductionField;
  code: DeductionIssueCode;
}

/** A new proposal: nobody chosen, dated today. */
export function emptyDeductionDraft(today: string): DeductionDraft {
  return { staffId: null, amount: '', date: today, reason: '' };
}

/**
 * Check a proposal; an empty list means it can be sent. `today` is the
 * venue's business day (venueBusinessToday); the server checks it again.
 */
export function validateDeduction(draft: DeductionDraft, today: string): DeductionIssue[] {
  const issues: DeductionIssue[] = [];
  if (!draft.staffId) issues.push({ field: 'staffId', code: 'required' });

  if (!draft.amount.trim()) issues.push({ field: 'amount', code: 'required' });
  else {
    const amount = parseTypedAmount(draft.amount);
    if (amount === null) issues.push({ field: 'amount', code: 'invalid' });
    else if (amount > DEDUCTION_CAPS.amountMax) issues.push({ field: 'amount', code: 'tooMuch' });
  }

  if (!draft.date.trim()) issues.push({ field: 'date', code: 'required' });
  else {
    const day = parseTypedDate(draft.date);
    if (!day) issues.push({ field: 'date', code: 'invalid' });
    else if (day > today) issues.push({ field: 'date', code: 'future' });
    else if (day < addDays(today, -DEDUCTION_CAPS.daysBack))
      issues.push({ field: 'date', code: 'tooOld' });
  }

  const reason = draft.reason.trim();
  if (!reason) issues.push({ field: 'reason', code: 'required' });
  else if (reason.length > DEDUCTION_CAPS.reason) issues.push({ field: 'reason', code: 'tooLong' });
  return issues;
}

/** The RPC's arguments from a draft that passed `validateDeduction`. */
export function deductionArgs(draft: DeductionDraft, venueId: string): ProposeDeductionArgs {
  return {
    p_staff_id: draft.staffId ?? '',
    p_amount_iqd: parseTypedAmount(draft.amount) ?? 0,
    p_date: parseTypedDate(draft.date) ?? draft.date,
    p_reason: draft.reason.trim(),
    p_venue_id: venueId,
  };
}

// ── Lists ───────────────────────────────────────────────────────────────────

export type DeductionTone = 'good' | 'warn' | 'bad' | 'plain';

/** A deduction's status as a tag: waiting needs someone, approved counts, declined and cancelled do not. */
export const DEDUCTION_TONE: Record<DeductionStatus, DeductionTone> = {
  waiting: 'warn',
  approved: 'good',
  declined: 'bad',
  withdrawn: 'plain',
  cancelled: 'plain',
};

/**
 * How many waiting deductions the viewer can decide. `deductions_page`'s
 * `waiting_count` counts the viewer's own proposals too, which they cannot
 * decide (CANNOT_DECIDE_OWN), so the waiting rows the page marks
 * `can_decide: false` come off. Read from the first page (50 rows); an own
 * proposal past it is still counted, which only ever overstates.
 */
export function decidableWaiting(
  page:
    | { waiting_count?: number; deductions?: readonly { status: string; can_decide?: boolean }[] }
    | undefined,
): number {
  if (!page) return 0;
  const own = (page.deductions ?? []).filter(
    (d) => d.status === 'waiting' && d.can_decide === false,
  ).length;
  return Math.max(0, (page.waiting_count ?? 0) - own);
}

/** Only a waiting proposal can be taken back (withdraw_deduction). */
export function canWithdraw(proposal: { status: DeductionStatus }): boolean {
  return proposal.status === 'waiting';
}

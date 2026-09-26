/**
 * Pure helpers for /deductions (wave5-addendum-2026-09-25 §2.5, §5.2): the
 * readers of app.deductions_page, app.deductions_month, app.deduction_targets
 * and app.my_deduction_proposals, the propose form's rules, and what a row
 * offers the person looking at it. Every reader takes the payload as returned
 * (the shared QK key holds it that way) and reads it defensively.
 *
 * Nothing here computes money: every amount and total is the server's.
 */
import type { StaffRole } from '../../lib/auth';
import type { Tone } from '../../components/kit';
import { isObject, list, num, role, str } from '../roleExtras/roleExtrasLogic';
import { addDays } from './venueDate';

export const DEDUCTION_STATUSES = ['waiting', 'approved', 'declined', 'withdrawn', 'cancelled'] as const;
export type DeductionStatus = (typeof DEDUCTION_STATUSES)[number];

/** The page's three tabs (§5.2): Waiting and All read app.deductions_page, Month app.deductions_month. */
export const DEDUCTION_TABS = ['waiting', 'month', 'all'] as const;
export type DeductionTab = (typeof DEDUCTION_TABS)[number];

export const DEDUCTIONS_PAGE_SIZE = 50;

/** The server's limits (0197: salary_deductions CHECKs and propose_deduction). */
export const AMOUNT_MIN = 1;
export const AMOUNT_MAX = 2_000_000;
export const REASON_MAX = 500;
export const NOTE_MAX = 1000;
export const DATE_WINDOW_DAYS = 60;

const statusOf = (v: unknown): DeductionStatus => ((DEDUCTION_STATUSES as readonly unknown[]).includes(v) ? (v as DeductionStatus) : 'waiting');
const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));

// ---------------------------------------------------------------------------
// app.deductions_page
// ---------------------------------------------------------------------------

export interface DeductionRow {
  id: string;
  staffId: string;
  staffName: string;
  staffRole: StaffRole | null;
  amountIqd: number;
  deductionDate: string;
  payMonth: string | null;
  /** Happened in a month before the one it is paid in (V16). */
  datedEarlier: boolean;
  reason: string;
  status: DeductionStatus;
  proposedByName: string | null;
  proposedByRole: StaffRole | null;
  proposedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  canDecide: boolean;
  canCancel: boolean;
}

export interface DeductionsPage {
  rows: DeductionRow[];
  waitingCount: number;
  total: number;
}

export function readDeductionsPage(payload: unknown): DeductionsPage {
  const p = isObject(payload) ? payload : {};
  const rows = list(p.deductions)
    .filter((r) => typeof r.id === 'string')
    .map(
      (r): DeductionRow => ({
        id: str(r.id) ?? '',
        staffId: str(r.staff_id) ?? '',
        staffName: str(r.staff_name) ?? '',
        staffRole: role(r.staff_role),
        amountIqd: num(r.amount_iqd) ?? 0,
        deductionDate: str(r.deduction_date) ?? '',
        payMonth: str(r.pay_month),
        datedEarlier: r.dated_earlier === true,
        reason: str(r.reason) ?? '',
        status: statusOf(r.status),
        proposedByName: str(r.proposed_by_name),
        proposedByRole: role(r.proposed_by_role),
        proposedAt: str(r.proposed_at),
        decidedByName: str(r.decided_by_name),
        decidedAt: str(r.decided_at),
        decisionNote: str(r.decision_note),
        cancelledByName: str(r.cancelled_by_name),
        cancelledAt: str(r.cancelled_at),
        cancelReason: str(r.cancel_reason),
        canDecide: r.can_decide === true,
        canCancel: r.can_cancel === true,
      }),
    );
  return { rows, waitingCount: count(p.waiting_count), total: count(p.total) };
}

/**
 * The rail badge, the Waiting tab, /ops and Observe: waiting deductions the
 * viewer can decide. `waiting_count` counts the viewer's own proposals too,
 * which only they may withdraw (CANNOT_DECIDE_OWN), so the waiting rows the
 * page marks `can_decide: false` come off it. Read from the first page (50
 * rows); an own proposal past it is still counted, which only overstates.
 */
export function deductionsWaitingCount(payload: unknown): number {
  const page = readDeductionsPage(payload);
  const own = page.rows.filter((r) => r.status === 'waiting' && !r.canDecide).length;
  return Math.max(0, page.waitingCount - own);
}

/**
 * What a waiting row offers the viewer. The page leaves out every row whose
 * person is the viewer (F6), so a waiting row they cannot decide is one they
 * proposed themselves, which only they may withdraw.
 */
/**
 * Who decides a proposal, as its copy says: never its proposer
 * (CANNOT_DECIDE_OWN, 0197), so an owner's goes to a manager, and anyone
 * else's to another manager or the owner.
 */
export function onlyManagerDecides(proposerRole: StaffRole | null | undefined): boolean {
  return proposerRole === 'owner';
}

export function waitingAction(row: Pick<DeductionRow, 'status' | 'canDecide'>): 'decide' | 'withdraw' | null {
  if (row.status !== 'waiting') return null;
  return row.canDecide ? 'decide' : 'withdraw';
}

/** Waiting is amber, approved green, declined red; withdrawn and cancelled are neutral (they count for nothing). */
export function deductionTone(status: DeductionStatus): Tone {
  switch (status) {
    case 'waiting':
      return 'warn';
    case 'approved':
      return 'success';
    case 'declined':
      return 'danger';
    default:
      return 'neutral';
  }
}

// ---------------------------------------------------------------------------
// app.deductions_month
// ---------------------------------------------------------------------------

export interface MonthDeduction {
  id: string;
  amountIqd: number;
  deductionDate: string;
  datedEarlier: boolean;
  reason: string;
  status: DeductionStatus;
  proposedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
}

export interface MonthPerson {
  staffId: string;
  displayName: string;
  role: StaffRole | null;
  isActive: boolean;
  approvedIqd: number;
  approvedCount: number;
  waitingIqd: number;
  waitingCount: number;
  deductions: MonthDeduction[];
}

export interface DeductionsMonth {
  /** 'YYYY-MM-01', the month the server read. */
  month: string | null;
  totals: { approvedIqd: number; approvedCount: number; waitingIqd: number; waitingCount: number; people: number };
  people: MonthPerson[];
}

export function readDeductionsMonth(payload: unknown): DeductionsMonth {
  const p = isObject(payload) ? payload : {};
  const t = isObject(p.totals) ? p.totals : {};
  return {
    month: str(p.month),
    totals: {
      approvedIqd: num(t.approved_iqd) ?? 0,
      approvedCount: count(t.approved_count),
      waitingIqd: num(t.waiting_iqd) ?? 0,
      waitingCount: count(t.waiting_count),
      people: count(t.people),
    },
    people: list(p.people)
      .filter((r) => typeof r.staff_id === 'string')
      .map((r) => ({
        staffId: str(r.staff_id) ?? '',
        displayName: str(r.display_name) ?? '',
        role: role(r.role),
        isActive: r.is_active !== false,
        approvedIqd: num(r.approved_iqd) ?? 0,
        approvedCount: count(r.approved_count),
        waitingIqd: num(r.waiting_iqd) ?? 0,
        waitingCount: count(r.waiting_count),
        deductions: list(r.deductions)
          .filter((d) => typeof d.id === 'string')
          .map((d) => ({
            id: str(d.id) ?? '',
            amountIqd: num(d.amount_iqd) ?? 0,
            deductionDate: str(d.deduction_date) ?? '',
            datedEarlier: d.dated_earlier === true,
            reason: str(d.reason) ?? '',
            status: statusOf(d.status),
            proposedByName: str(d.proposed_by_name),
            decidedByName: str(d.decided_by_name),
            decidedAt: str(d.decided_at),
          })),
      })),
  };
}

/**
 * The month stepper never passes the current month: nothing is paid in a
 * month that has not started. `current` is the month the server answered for
 * "this month" (the venue's business month), not the browser's calendar.
 */
export function canStepForward(shown: string | null, current: string | null): boolean {
  return shown !== null && current !== null && shown < current;
}

// ---------------------------------------------------------------------------
// app.deduction_targets, app.my_deduction_proposals
// ---------------------------------------------------------------------------

export interface DeductionTarget {
  id: string;
  displayName: string;
  role: StaffRole | null;
}

export function readDeductionTargets(payload: unknown): DeductionTarget[] {
  const p = isObject(payload) ? payload : {};
  return list(p.staff)
    .filter((s) => typeof s.id === 'string')
    .map((s) => ({ id: str(s.id) ?? '', displayName: str(s.display_name) ?? '', role: role(s.role) }));
}

// ---------------------------------------------------------------------------
// The propose form
// ---------------------------------------------------------------------------

export interface ProposeDraft {
  staffId: string;
  amount: number | null;
  /** 'YYYY-MM-DD', when it happened. */
  date: string;
  reason: string;
}

export type ProposeField = 'staffId' | 'amount' | 'date' | 'reason';
export type ProposeIssueCode = 'required' | 'amountRange' | 'dateRange' | 'tooLong';
export interface ProposeIssue {
  field: ProposeField;
  code: ProposeIssueCode;
}

/** The dates a deduction may carry: the 60 days up to the venue's business date (0197). */
export function dateWindow(today: string): { min: string; max: string } {
  return { min: addDays(today, -DATE_WINDOW_DAYS), max: today };
}

/** Every rule the server applies, stated before it refuses. Text length counts characters, as Postgres does. */
export function validateProposal(d: ProposeDraft, today: string): ProposeIssue[] {
  const issues: ProposeIssue[] = [];
  if (d.staffId === '') issues.push({ field: 'staffId', code: 'required' });
  if (d.amount === null) issues.push({ field: 'amount', code: 'required' });
  else if (!Number.isInteger(d.amount) || d.amount < AMOUNT_MIN || d.amount > AMOUNT_MAX) issues.push({ field: 'amount', code: 'amountRange' });
  const { min, max } = dateWindow(today);
  if (d.date === '') issues.push({ field: 'date', code: 'required' });
  else if (d.date < min || d.date > max) issues.push({ field: 'date', code: 'dateRange' });
  const reason = d.reason.trim();
  if (reason === '') issues.push({ field: 'reason', code: 'required' });
  else if ([...reason].length > REASON_MAX) issues.push({ field: 'reason', code: 'tooLong' });
  return issues;
}

/** The field a server refusal names, so the form marks it (the hints of app.propose_deduction). */
export function proposeRefusalField(code: string | null, hint: string | null): ProposeField | null {
  if (code === 'INVALID_AMOUNT') return 'amount';
  if (code === 'INVALID_ARGUMENT' && hint === 'date') return 'date';
  if ((code === 'TEXT_REQUIRED' || code === 'TEXT_TOO_LONG') && hint === 'reason') return 'reason';
  if (code === 'FORBIDDEN' && hint === 'staff_id') return 'staffId';
  return null;
}

/** A decision's note: optional on an approval, the reason on a decline (REASON_REQUIRED), at most 1000. */
export function decisionIssue(approve: boolean, note: string): 'required' | 'tooLong' | null {
  const n = note.trim();
  if (!approve && n === '') return 'required';
  if ([...n].length > NOTE_MAX) return 'tooLong';
  return null;
}

// ---------------------------------------------------------------------------
// A refusal that means the list is out of date
// ---------------------------------------------------------------------------

/**
 * The refusals that mean someone else got there first: decided, withdrawn,
 * reviewed, superseded or gone. The screen keeps the message on show and
 * refetches, so the row beside it says what happened (shared by /deductions,
 * /incidents and the content sheet).
 */
export const STALE_REFUSALS: ReadonlySet<string> = new Set(['SUBMISSION_DECIDED', 'REF_NOT_FOUND', 'INVALID_TRANSITION']);

export function isStaleRefusal(code: string | null): boolean {
  return code !== null && STALE_REFUSALS.has(code);
}

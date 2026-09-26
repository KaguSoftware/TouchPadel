/**
 * Pay deductions on the staff phone (wave5-addendum-2026-09-25 §2.5, §5.3;
 * migration 0197): a head proposes one for a member of their team, and
 * management for anyone at the venue; every role reads its own approved and
 * cancelled ones by month. Deciding is on the operator only (§8 Q8), so the
 * phone never calls decide_deduction or cancel_deduction.
 *
 * Each query stores the RPC's result as it comes, as supplies/api.ts does.
 */
import { staffRpc, type StaffRpcName } from '../api';
import { decidableWaiting } from './logic';

/**
 * Wave-5 RPCs that STAFF_RPCS in ../api.ts (lane B's list) does not name.
 * Widened here, as marketing/api.ts widens its role-spec ones.
 */
type DeductionRpc =
  | 'deduction_targets'
  | 'propose_deduction'
  | 'withdraw_deduction'
  | 'my_deductions'
  | 'my_deduction_proposals'
  | 'deductions_page';

function call<T>(fn: DeductionRpc, args: Record<string, unknown>): Promise<T> {
  return staffRpc<T>(fn as unknown as StaffRpcName, args);
}

/** salary_deductions.status (0197). */
export type DeductionStatus = 'waiting' | 'approved' | 'declined' | 'withdrawn' | 'cancelled';

// ── Who the caller may propose for ──────────────────────────────────────────

export interface DeductionTarget {
  id: string;
  display_name: string;
  role: string;
}

export interface DeductionTargets {
  staff: DeductionTarget[];
}

/** A head's own team (never a head, never themselves); management: every active non-owner but themselves. */
export function fetchDeductionTargets(venueId: string): Promise<DeductionTargets> {
  return call<DeductionTargets>('deduction_targets', { p_venue_id: venueId });
}

// ── Propose, withdraw ───────────────────────────────────────────────────────

export interface ProposeDeductionArgs {
  p_staff_id: string;
  p_amount_iqd: number;
  p_date: string;
  p_reason: string;
  p_venue_id: string;
}

export function proposeDeduction(
  args: ProposeDeductionArgs,
  key: string,
): Promise<{ id: string; status: DeductionStatus }> {
  return call('propose_deduction', { ...args, p_idempotency_key: key });
}

/** The proposer takes back a waiting one. State-idempotent: no key. */
export function withdrawDeduction(id: string): Promise<{ status: DeductionStatus }> {
  return call('withdraw_deduction', { p_id: id });
}

// ── The proposer's own proposals ────────────────────────────────────────────

export interface DeductionProposal {
  id: string;
  staff_name: string;
  staff_role: string;
  amount_iqd: number;
  deduction_date: string;
  reason: string;
  status: DeductionStatus;
  proposed_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

export interface MyDeductionProposals {
  proposals: DeductionProposal[];
}

export function fetchMyDeductionProposals(venueId: string): Promise<MyDeductionProposals> {
  return call<MyDeductionProposals>('my_deduction_proposals', { p_venue_id: venueId, p_limit: 30 });
}

// ── The person's own ────────────────────────────────────────────────────────

/** One of the caller's own: approved or cancelled only, never who proposed it (§2.5.2). */
export interface MyDeduction {
  id: string;
  amount_iqd: number;
  deduction_date: string;
  /** It happened in a month before the one it counts in (V16). */
  dated_earlier: boolean;
  reason: string;
  status: Extract<DeductionStatus, 'approved' | 'cancelled'>;
  decided_at: string | null;
}

export interface MyDeductions {
  /** The first day of the month read, `YYYY-MM-DD`. */
  month: string;
  /** The approved ones' sum; a cancelled one is in no total. */
  total_iqd: number;
  deductions: MyDeduction[];
}

/** `month` null reads the venue's current business month. */
export function fetchMyDeductions(venueId: string, month: string | null): Promise<MyDeductions> {
  return call<MyDeductions>('my_deductions', { p_venue_id: venueId, p_month: month });
}

// ── Management: how many wait for a decision on the operator ────────────────

export interface DeductionsWaiting {
  waiting_count: number;
}

/**
 * How many waiting deductions the viewer can decide, for the line that sends
 * management to the operator. The first page is read so the viewer's own
 * proposals come off the count (decidableWaiting); no row is shown, since
 * the phone decides nothing.
 */
export async function fetchDeductionsWaiting(venueId: string): Promise<DeductionsWaiting> {
  const page = await call<{
    waiting_count?: number;
    deductions?: { status: string; can_decide?: boolean }[];
  }>('deductions_page', {
    p_venue_id: venueId,
    p_filter: 'waiting',
    p_limit: 50,
  });
  return { waiting_count: decidableWaiting(page) };
}

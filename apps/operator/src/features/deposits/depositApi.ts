/**
 * The staff side of the online deposit (Qi Card), build-contracts-2026-09-27 §2.3.
 *
 * TYPING NOTE: migration 0242 lands these RPCs while this screen is built, and
 * `packages/db/src/types.gen.ts` is regenerated after it, so `appRpc` refuses
 * the names at compile time until then. `depositRpc` widens the name and goes
 * through `appRpc` itself, so the PIN-gated path (verify_manager_pin first)
 * and the error mapping are the ones every other write uses. Once `db:types`
 * carries them, each call can become `appRpc(...)` with no other change.
 */
import { appRpc, type AppFunctionName } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';

export type DepositRpcName =
  | 'deposit_settings'
  | 'set_deposit_settings'
  | 'deposit_attention'
  | 'deposit_refund_retry'
  | 'deposit_refund_manual'
  | 'deposit_refund_request';

export function depositRpc<T>(fn: DepositRpcName, args: Record<string, unknown> = {}): Promise<T> {
  return appRpc<T>(fn as string as AppFunctionName, args);
}

// ---------------------------------------------------------------------------
// Shapes (contract §2.3)
// ---------------------------------------------------------------------------

export type DepositMode = 'off' | 'optional' | 'required';
export const DEPOSIT_MODES: readonly DepositMode[] = ['off', 'optional', 'required'];

/** app.deposit_settings / app.set_deposit_settings. */
export interface DepositSettings {
  venue_id: string;
  deposit_mode: DepositMode;
  deposit_percent_bp: number;
  deposit_min_iqd: number;
  deposit_max_iqd: number | null;
  deposit_window_seconds: number;
  deposit_forfeit_no_show: boolean;
}

export type DepositStatus =
  | 'created'
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'refund_pending'
  | 'refunded'
  | 'refund_failed';

export type RefundReason =
  | 'guest_cancel'
  | 'staff_cancel'
  | 'no_show'
  | 'slot_lost'
  | 'venue_offline'
  | 'amount_mismatch'
  | 'duplicate_success'
  | 'manual'
  | 'staff_refund'
  // Open matches (operator.md §5.17): a ticket purchase's refunds.
  | 'ticket_cashout'
  | 'account_deleted';

export const REFUND_REASONS: readonly RefundReason[] = [
  'guest_cancel',
  'staff_cancel',
  'no_show',
  'slot_lost',
  'venue_offline',
  'amount_mismatch',
  'duplicate_success',
  'manual',
  'staff_refund',
  'ticket_cashout',
  'account_deleted',
];

/**
 * One row of app.deposit_attention. Since 0258 it also lists open-match
 * ticket purchases whose cash-out or account-deletion refund failed, at every
 * branch (chain money, money.md §5.10): `purpose = 'ticket'`, no reservation.
 */
export interface DepositAttentionRow {
  id: string;
  request_id: string;
  reservation_id: string | null;
  /** `deposit` or `ticket` (0258); absent from an older server, which lists deposits only. */
  purpose?: 'deposit' | 'ticket' | string | null;
  /** A ticket purchase's number of tickets. */
  ticket_count?: number | null;
  /** The payer (booking_payments.guest_id), for Open customer. */
  customer_id?: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  amount_iqd: number;
  refund_amount_iqd: number | null;
  status: DepositStatus;
  refund_reason: RefundReason | string | null;
  refund_requested_at: string | null;
  refund_attempts: number | null;
  succeeded_at: string | null;
  sandbox: boolean;
  court_name_en: string | null;
  court_name_ar: string | null;
  start_at: string | null;
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------

/** Feature-private keys (CLAUDE.md "Queries"): nothing outside deposits invalidates them. */
export const depositSettingsKey = (branchId: string | null) => ['depositSettings', branchId ?? ''] as const;
export const depositAttentionKey = (branchId: string | null) => ['depositAttention', branchId ?? ''] as const;

export function fetchDepositSettings(venueId: string | null): Promise<DepositSettings> {
  return depositRpc<DepositSettings>('deposit_settings', { p_venue_id: venueId });
}

export function saveDepositSettings(patch: Record<string, unknown>, venueId: string | null): Promise<DepositSettings> {
  return depositRpc<DepositSettings>('set_deposit_settings', { p_patch: patch, p_venue_id: venueId });
}

export async function fetchDepositAttention(venueId: string | null): Promise<DepositAttentionRow[]> {
  const rows = await depositRpc<DepositAttentionRow[] | null>('deposit_attention', { p_venue_id: venueId });
  return Array.isArray(rows) ? rows : [];
}

export function retryDepositRefund(paymentId: string): Promise<unknown> {
  return depositRpc('deposit_refund_retry', { p_payment_id: paymentId });
}

/** The whole deposit back to the guest (no amount: the contract's full refund). */
export function requestDepositRefund(paymentId: string): Promise<unknown> {
  return depositRpc('deposit_refund_request', { p_payment_id: paymentId });
}

/**
 * "Settled another way", behind the manager PIN. deposit_refund_manual is in
 * PIN_GATED_RPCS (0242), so appRpc proves the PIN to verify_manager_pin on its
 * own round trip first and the RPC spends that grant (0115): the attempt
 * commits and the lockout counts whatever the write does next. The device is
 * this station, as on every till money write.
 */
export function settleDepositManually(paymentId: string, pin: string, note: string): Promise<unknown> {
  return depositRpc('deposit_refund_manual', { p_payment_id: paymentId, p_pin: pin, p_note: note, p_device_id: deviceId() });
}

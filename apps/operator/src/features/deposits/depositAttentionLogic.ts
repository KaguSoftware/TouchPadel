/**
 * "Online refunds needing attention" (contract §2.3 app.deposit_attention):
 * which situation each row is in, which actions fit it, and the order a
 * manager should see them in. Pure, so the rules are tested without a screen.
 *
 * The server lists three kinds of row, and each has exactly one way forward:
 *
 *   refund_failed               → Retry, or Settled another way (manager PIN)
 *   refund_pending over a day   → nothing to press: Qi may still answer, and
 *                                 the server retries it and moves it to
 *                                 refund_failed if it keeps failing. R23 (open
 *                                 matches build contracts §1.12): "Settled
 *                                 another way" only from refund_failed, for
 *                                 deposits and tickets alike, because a Qi
 *                                 refund already on its way would pay twice.
 *   succeeded, booking not live → Refund to the guest (app.deposit_refund_request,
 *                                 the whole deposit; the partial refund is not
 *                                 offered here)
 *
 * A ticket row (`purpose = 'ticket'`, open matches §5.17) is a ticket
 * purchase's cash-out or account-deletion refund: chain money, so any branch
 * can settle it; it has no booking and opens the customer instead.
 */
import type { MessageKey } from '@touch/i18n';
import { REFUND_REASONS, type DepositAttentionRow, type RefundReason } from './depositApi';

export type AttentionKind = 'refundFailed' | 'refundSlow' | 'paidNotLive';

export function attentionKindOf(row: Pick<DepositAttentionRow, 'status'>): AttentionKind {
  if (row.status === 'refund_failed') return 'refundFailed';
  if (row.status === 'refund_pending') return 'refundSlow';
  return 'paidNotLive';
}

export interface AttentionActions {
  retry: boolean;
  settle: boolean;
  refund: boolean;
}

/** What the server will accept for this row now (anything else is PAYMENT_STATE). R23: settle only a failed refund. */
export function attentionActions(row: Pick<DepositAttentionRow, 'status'>): AttentionActions {
  return {
    retry: row.status === 'refund_failed',
    settle: row.status === 'refund_failed',
    refund: row.status === 'succeeded',
  };
}

/** The one-line hint under a row's status: a slow refund now says it is waiting on Qi, not what to press (R23). */
export function attentionHintKey(kind: AttentionKind): MessageKey {
  if (kind === 'refundSlow') return 'ws.matches.ops.refundSlowHint';
  return `ws.manager.onlineRefunds.kind.${kind}.hint`;
}

/** An open-match ticket purchase's refund (0258), not a booking deposit. */
export function isTicketRow(row: Pick<DepositAttentionRow, 'purpose'>): boolean {
  return row.purpose === 'ticket';
}

const TICKET_REFUND_REASONS: readonly RefundReason[] = ['ticket_cashout', 'account_deleted'];

/** A known reason's words: the two ticket reasons are worded with open matches, the rest with online refunds. */
export function refundReasonKey(reason: RefundReason): MessageKey {
  return TICKET_REFUND_REASONS.includes(reason)
    ? `ws.matches.ops.refundReason.${reason as 'ticket_cashout' | 'account_deleted'}`
    : `ws.manager.onlineRefunds.reasons.${reason as Exclude<RefundReason, 'ticket_cashout' | 'account_deleted'>}`;
}

/** The amount at stake: what is being refunded when a refund was asked for, else what was paid. */
export function attentionAmount(row: Pick<DepositAttentionRow, 'amount_iqd' | 'refund_amount_iqd' | 'status'>): number {
  if (row.status !== 'succeeded' && row.refund_amount_iqd != null) return row.refund_amount_iqd;
  return row.amount_iqd;
}

/** When the row started waiting: the refund request, or the payment for a paid row. */
export function attentionSince(row: Pick<DepositAttentionRow, 'refund_requested_at' | 'succeeded_at' | 'status'>): string | null {
  if (row.status === 'succeeded') return row.succeeded_at;
  return row.refund_requested_at ?? row.succeeded_at;
}

/** A reason the catalog has words for, or null (an unknown one is not printed raw). */
export function knownRefundReason(reason: string | null | undefined): RefundReason | null {
  return reason && (REFUND_REASONS as readonly string[]).includes(reason) ? (reason as RefundReason) : null;
}

const KIND_ORDER: Record<AttentionKind, number> = { refundFailed: 0, paidNotLive: 1, refundSlow: 2 };

/**
 * Failed refunds first (the guest is owed money and nothing is moving), then
 * paid bookings that are no longer on, then slow refunds; oldest first within
 * each, since the longest wait is the likeliest complaint.
 */
export function sortAttention<T extends Pick<DepositAttentionRow, 'id' | 'status' | 'refund_requested_at' | 'succeeded_at'>>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const k = KIND_ORDER[attentionKindOf(a)] - KIND_ORDER[attentionKindOf(b)];
    if (k !== 0) return k;
    const sa = attentionSince(a) ?? '';
    const sb = attentionSince(b) ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Whether the list is worth a panel. The owner's Financial home shows it,
 * empty state included, once deposits are switched on; a club that never
 * turned them on is not shown a list about them. The manager's Today shows it
 * only when something waits (it is a to-do list). A row always wins: a refund
 * stuck from before deposits were switched off still needs a person.
 */
export function showAttentionPanel(input: { rows: number | null; mode: string | null; hideWhenEmpty: boolean }): boolean {
  if (input.rows != null && input.rows > 0) return true;
  if (input.hideWhenEmpty) return false;
  return input.mode != null && input.mode !== 'off';
}

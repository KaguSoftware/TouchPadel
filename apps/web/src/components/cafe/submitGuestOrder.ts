import type { MessageKey } from '@touch/i18n';
import { appRpc, rpcErrorKey, shouldRefreshMenu } from '@/lib/appRpc';
import { toOrderPayload, type BasketLine } from '@/lib/cafe/basket';
import type { BrowserSupabase } from '@/lib/supabase/client';

/**
 * `app.create_guest_order` (0015/0030/0032) with the PERSISTED idempotency key
 * — a retry after a dropped response must never create a second order.
 *
 * Kept out of CafeApp so the orchestrator stays overlay state only, and so the
 * error taxonomy has one home: the caller reacts to `kind`, not to raw codes.
 */
export type SubmitResult =
  | { kind: 'ok'; orderId: string; duplicate: boolean }
  | { kind: 'expired'; code: string }
  | { kind: 'degraded'; code: string; messageKey: MessageKey }
  /** the basket is stale: refresh the menu + reconcile before retrying */
  | { kind: 'stale'; code: string; messageKey: MessageKey }
  | { kind: 'error'; code: string; messageKey: MessageKey };

export async function submitGuestOrder(
  supabase: BrowserSupabase,
  lines: readonly BasketLine[],
  note: string,
  idempotencyKey: string,
): Promise<SubmitResult> {
  // `app.create_guest_order` (jsonb, text, text) has no order-level note
  // parameter — notes live on order_items (0015). The guest's single "note for
  // the waiter" therefore rides on the FIRST line, which is what the KDS
  // ticket and the Telegram message both print at the top of the order.
  const items = toOrderPayload(lines) as { notes?: string }[];
  const trimmed = note.trim();
  if (trimmed && items.length > 0) {
    const first = items[0]!;
    first.notes = first.notes ? `${trimmed} — ${first.notes}` : trimmed;
  }
  const { data, error } = await appRpc(supabase, 'create_guest_order', {
    p_items: items as never,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    const code = error.message?.trim() ?? '';
    const messageKey = rpcErrorKey(error);
    if (code === 'SESSION_EXPIRED') return { kind: 'expired', code };
    if (code === 'DEGRADED_LOCKOUT') return { kind: 'degraded', code, messageKey };
    if (shouldRefreshMenu(code)) return { kind: 'stale', code, messageKey };
    return { kind: 'error', code: code || 'UNKNOWN', messageKey };
  }

  const row = (data ?? {}) as { order_id?: string; duplicate?: boolean };
  return { kind: 'ok', orderId: row.order_id ?? '', duplicate: row.duplicate === true };
}

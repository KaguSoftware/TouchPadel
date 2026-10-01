import { PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { errorMessageKey, type ErrorOverrides, type MessageKey } from '@touch/i18n';
import { DEFAULT_REQUEST_TIMEOUT_MS, RequestTimeoutError, normalizeTimeout, startDeadline } from '@touch/core';

export interface AppRpcOptions {
  /** Override the deadline (ms); null for none. Default 15 s. */
  timeoutMs?: number | null;
}

/**
 * All business writes go through SECURITY DEFINER RPCs in schema `app`
 * (exposed via the API config — mirrors packages/db/tests/helpers.ts appRpc).
 *
 * Every call has a deadline (15 s unless the call site says otherwise). It
 * had none: a guest whose order went out on a dying connection watched the
 * Send button spin forever. A miss answers like any other failure, `{ error }`
 * — its message 'TimeoutError: Request timed out after … ms' maps to
 * errors.generic — so every caller's existing error path handles it.
 */
export async function appRpc<Fn extends keyof Database['app']['Functions'] & string>(
  client: SupabaseClient<Database>,
  fn: Fn,
  args?: Database['app']['Functions'][Fn]['Args'],
  opts: AppRpcOptions = {},
) {
  const call = client.schema('app').rpc(fn, args as never);
  const ms = normalizeTimeout(opts.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
  // A test double hands back a bare promise; only the real builder is abortable.
  if (ms === null || typeof (call as { abortSignal?: unknown }).abortSignal !== 'function') return await call;
  const deadline = startDeadline(ms);
  try {
    const answer = await call.abortSignal(deadline.signal);
    if (!answer.error || !deadline.timedOut()) return answer;
    const timeout = new RequestTimeoutError(ms, fn);
    // postgrest-js reports the abort as `AbortError: …`; say what it was.
    return {
      ...answer,
      error: new PostgrestError({ message: `${timeout.name}: ${timeout.message}`, details: '', hint: '', code: '' }),
    } as typeof answer;
  } finally {
    deadline.clear();
  }
}

/**
 * RPC failures raise `raise exception '<CODE>'` (errcode P0001) — the code IS
 * the PostgrestError message. The codes, their lines and the matching rule are
 * the one error catalogue (`ERROR_CODE_KEYS` / `errorMessageKey` in
 * packages/i18n/src/errors.ts), shared with the operator and the phone; this
 * map holds only the guest site's own words, consulted first. A new code goes
 * into the catalogue with its line in both catalogs.
 */
const WEB_OVERRIDES = {
  TOKEN_INVALID: 'cafe.invalidQr',
  AUTH_REQUIRED: 'cafe.invalidQr', // anonymous sign-in failed / raced — rescan restarts the boot
  DEGRADED_LOCKOUT: 'degraded.orderingRefused',
  CAFE_CLOSED: 'cafe.cafeClosed',
  EMPTY_ORDER: 'cafe.basketEmpty',
  ITEM_UNAVAILABLE: 'cafe.itemUnavailable', // also sold_out (0030)
  ITEM_NOT_FOUND: 'cafe.itemUnavailable',
  VARIANT_NOT_FOUND: 'cafe.itemUnavailable',
  SHOP_ITEM_NOT_ORDERABLE: 'cafe.itemUnavailable', // 0146: a shop item on a table order
  MODIFIER_INVALID: 'cafe.itemUnavailable', // incl. picks from non-revealed groups (0030)
  MODIFIER_SELECTION: 'errors.validation',
  INVALID_QTY: 'errors.validation',
  TABLE_NOT_FOUND: 'cafe.invalidQr',
  ALREADY_NOTIFIED: 'cafe.waiterAlreadyCalled',
  CALL_COOLDOWN: 'cafe.waiterAlreadyCalled',
  BELL_DISABLED: 'cafe.bellDisabled', // 0032: table bell switched off
  SLOT_TAKEN: 'booking.slotTaken',
  PIN_INVALID: 'auth.pinInvalid',
  FORBIDDEN: 'errors.forbidden',
  // 0038: the idempotency key we sent belongs to someone else's order. Not
  // actionable for the guest — retrying mints a fresh key.
  IDEMPOTENCY_CONFLICT: 'errors.generic',
  // Multi-venue (0217): a row of another branch than the guest session's — for
  // a guest, a basket line left over from another branch's menu. Re-read the
  // menu (REFRESH_MENU_CODES) and drop it, like any item that went away.
  VENUE_MISMATCH: 'cafe.itemUnavailable',
  // 0125: the server could not tell which branch; not actionable for a guest.
  // Guest writes resolve the branch from the session, so this is defensive.
  VENUE_REQUIRED: 'errors.generic',
  // Internal checks of the writers create_guest_order and raise_waiter_call
  // call (the notification kind, a promotion's percentage, the referenced row):
  // nothing a guest did or can fix, so not the staff line either.
  INVALID_KIND: 'errors.generic',
  INVALID_PCT: 'errors.generic',
  REF_NOT_FOUND: 'errors.generic',
} as const satisfies ErrorOverrides;

/**
 * Map a Postgrest/RPC error to a translatable message key (never throws): the
 * guest site's word for the code, else the catalogue's, else the SQLSTATE's
 * (a unique violation, a timeout), else errors.generic.
 */
export function rpcErrorKey(error: { message?: string } | null | undefined): MessageKey {
  return errorMessageKey(error, { overrides: WEB_OVERRIDES });
}

/** True when the error is the given raise code. */
export function isRpcError(error: { message?: string } | null | undefined, code: string): boolean {
  return error?.message?.trim() === code;
}

/** Codes that mean the basket is stale — refresh the menu and reconcile before retrying. */
const REFRESH_MENU_CODES = new Set([
  'ITEM_UNAVAILABLE',
  'VARIANT_NOT_FOUND',
  'SHOP_ITEM_NOT_ORDERABLE',
  'MODIFIER_INVALID',
  'MODIFIER_SELECTION',
  'VENUE_MISMATCH',
]);

export function shouldRefreshMenu(code: string | null | undefined): boolean {
  return Boolean(code && REFRESH_MENU_CODES.has(code.trim()));
}

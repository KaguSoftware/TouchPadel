import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { MessageKey } from '@touch/i18n';

/**
 * All business writes go through SECURITY DEFINER RPCs in schema `app`
 * (exposed via the API config — mirrors packages/db/tests/helpers.ts appRpc).
 */
export function appRpc<Fn extends keyof Database['app']['Functions'] & string>(
  client: SupabaseClient<Database>,
  fn: Fn,
  args?: Database['app']['Functions'][Fn]['Args'],
) {
  return client.schema('app').rpc(fn, args as never);
}

/**
 * RPC failures raise `raise exception '<CODE>'` (errcode P0001) — the code IS
 * the PostgrestError message. Source of truth: migration SQL (0008/0013–0016/0021).
 */
const RPC_ERROR_KEYS: Record<string, MessageKey> = {
  TOKEN_INVALID: 'cafe.invalidQr',
  AUTH_REQUIRED: 'cafe.invalidQr', // anonymous sign-in failed / raced — rescan restarts the boot
  SESSION_EXPIRED: 'errors.sessionTableExpired',
  DEGRADED_LOCKOUT: 'degraded.orderingRefused',
  CAFE_CLOSED: 'cafe.cafeClosed',
  EMPTY_ORDER: 'cafe.basketEmpty',
  ITEM_UNAVAILABLE: 'cafe.itemUnavailable', // also sold_out (0030)
  ITEM_NOT_FOUND: 'cafe.itemUnavailable',
  VARIANT_NOT_FOUND: 'cafe.itemUnavailable',
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
};

/** Map a Postgrest/RPC error to a translatable message key (never throws). */
export function rpcErrorKey(error: { message?: string } | null | undefined): MessageKey {
  const code = error?.message?.trim();
  return (code && RPC_ERROR_KEYS[code]) || 'errors.generic';
}

/** True when the error is the given raise code. */
export function isRpcError(error: { message?: string } | null | undefined, code: string): boolean {
  return error?.message?.trim() === code;
}

/** Codes that mean the basket is stale — refresh the menu and reconcile before retrying. */
const REFRESH_MENU_CODES = new Set([
  'ITEM_UNAVAILABLE',
  'VARIANT_NOT_FOUND',
  'MODIFIER_INVALID',
  'MODIFIER_SELECTION',
]);

export function shouldRefreshMenu(code: string | null | undefined): boolean {
  return Boolean(code && REFRESH_MENU_CODES.has(code.trim()));
}

/**
 * Server error code -> i18n message key. Codes come from the migration SQL
 * (`raise exception 'CODE'`); anything unmapped falls back to errors.generic.
 */
import type { MessageKey } from '@touch/i18n';
import { AppRpcError } from './appRpc';
import { EdgeError } from './edge';

/** Codes with a dedicated op.errors.* message (kept in BOTH catalogs). */
export const MAPPED_CODES: ReadonlySet<string> = new Set([
  'SLOT_TAKEN',
  'DEGRADED_LOCKOUT',
  'PIN_INVALID',
  'PIN_LOCKED',
  'FORBIDDEN',
  'AUTH_REQUIRED',
  'ALREADY_NOTIFIED',
  'NO_OPEN_DAY',
  'PREVIOUS_DAY_OPEN',
  'DAY_OPEN_TABS',
  'DAY_UNSYNCED',
  'TAB_NOT_OPEN',
  'TAB_NOT_FOUND',
  'TAB_MERGED',
  'TENDER_SHORT',
  'ALREADY_PAID',
  'INVALID_AMOUNT',
  'ITEM_UNAVAILABLE',
  'EMPTY_ORDER',
  'MODIFIER_SELECTION',
  'INVALID_TRANSITION',
  'HOLD_EXPIRED',
  'NO_RATE',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
  'INVALID_TIME_RANGE',
  'GUEST_REQUIRED',
  'INVALID_RANGE',
  'CANCELLATION_WINDOW',
  'RESERVATION_NOT_FOUND',
  'REASON_REQUIRED',
  'INVALID_VALUE',
  'INVALID_PRICES',
  'INVALID_DAYS',
  'INVALID_HOURS',
  'INVALID_FLOAT',
  'INVALID_COUNT',
  'INVALID_PRICE',
  'INVALID_QTY',
  'CAFE_CLOSED',
  'TICKET_NOT_FOUND',
  'ITEM_NOT_FOUND',
  'ITEM_VOIDED',
  'INVALID_DURATION',
  'SLOT_IN_PAST',
  'COURT_NOT_FOUND',
  'TABLE_NOT_FOUND',
  'TAB_ANCHOR_REQUIRED',
  'NOT_MOVABLE',
  'NOT_EXTENDABLE',
  'NOT_CANCELLABLE',
  'INVALID_SPLIT_COUNT',
  // Cafe rebuild (migrations 0027-0034).
  'INVALID_HIGHLIGHT',
  'HOOK_TOO_LONG',
  'HOOK_PAIR_MISMATCH',
  'PHOTO_BLUR_TOO_LONG',
  'INVALID_SOLD_OUT',
  'INVALID_PHOTO_PATH',
  'INVALID_COST',
  'CATEGORY_NOT_FOUND',
  'VARIANT_NOT_FOUND',
  'MODIFIER_INVALID',
  'MODIFIER_NOT_FOUND',
  'GROUP_NOT_FOUND',
  'REVEAL_SELF',
  'REVEAL_DEPTH',
  'SELF_SUGGESTION',
  'UNKNOWN_SETTING',
  'INVALID_SETTING_VALUE',
  'INVALID_PCT',
  'TABLE_NUMBER_TAKEN',
  'INVALID_TABLE_NUMBER',
  'INVALID_COOLDOWN',
  'BELL_DISABLED',
  'CALL_COOLDOWN',
  'CALL_NOT_FOUND',
  'TOKEN_INVALID',
  'TELEGRAM_NOT_CONFIGURED',
  'OUTBOX_NOT_FOUND',
  'INVALID_KIND',
  'REF_NOT_FOUND',
  'REF_REQUIRED',
  'ACTOR_REQUIRED',
  'INVALID_ACTION',
  'VOID_REQUIRES_REFUND',
  'INVALID_ARGUMENT',
  'REJECTION_NOT_FOUND',
  // Courts admin (0062).
  'INVALID_DURATIONS',
  'COURT_HAS_FUTURE_RESERVATIONS',
  'NAME_REQUIRED',
  // Stock admin (0063) + counts (0019).
  'UNIT_LOCKED',
  'KIND_LOCKED',
  'INVALID_YIELD',
  'INVALID_WASTE_ALLOWANCE',
  'INVALID_PACK',
  'INGREDIENT_NOT_FOUND',
  'INVALID_TARGET',
  'RECIPE_CYCLE',
  'COUNT_IN_PROGRESS',
  'COUNT_NOT_FOUND',
  'COUNT_FINALIZED',
  'COUNT_LINE_NOT_FOUND',
  'BATCH_NOT_FOUND',
  'NOT_EXPIRED',
  // Edge-function client codes (lib/edge.ts), prefixed to keep them apart from SQL codes.
  'EDGE_NOT_CONFIGURED',
  'EDGE_FORBIDDEN',
  'EDGE_AUTH_REQUIRED',
  'EDGE_UPSTREAM',
  'EDGE_RATE_LIMITED',
  'EDGE_UNKNOWN',
]);

/** Map a raw server code to a message key. */
export function errorCodeToMessageKey(code: string): MessageKey {
  if (MAPPED_CODES.has(code)) return `op.errors.${code}` as MessageKey;
  return 'errors.generic';
}

/** Map any thrown value (AppRpcError, EdgeError, network failure, …) to a message key. */
export function errorToMessageKey(error: unknown): MessageKey {
  if (error instanceof AppRpcError) return errorCodeToMessageKey(error.code);
  if (error instanceof EdgeError) return errorCodeToMessageKey(`EDGE_${error.code}`);
  if (error instanceof TypeError) return 'errors.network'; // fetch failure
  return 'errors.generic';
}

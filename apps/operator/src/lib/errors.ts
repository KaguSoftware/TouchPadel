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
  // Renderer-minted: leaving a locked station with your own manager PIN
  // (Quit / Exit forced full screen, __root.tsx proveLeavePin).
  'PIN_OWN',
  // 0115: a money RPC reached without a fresh verify_manager_pin grant. appRpc
  // verifies first, so a user sees this only after a very slow round trip.
  'PIN_GRANT_REQUIRED',
  // 0120: refunds and the other queued money corrections (item 9 / C3).
  'REFUND_EXCEEDS_PAYMENT',
  'PAYMENT_NOT_FOUND',
  'ITEM_NOT_ON_TAB',
  'IDEMPOTENCY_CONFLICT',
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
  'TAB_NOT_EMPTY',
  'TAB_DAY_MISMATCH',
  'TENDER_SHORT',
  'ALREADY_PAID',
  // Renderer-minted: touch:resolve-queue-row refused (day-close dismiss).
  'QUEUE_ROW_NOT_RESOLVABLE',
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
  // 0150: a move whose START would land before now. The desk no longer offers
  // one, so this is the wall behind the wall (and the offline replay's answer).
  'RESERVATION_IN_PAST',
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
  // Courts admin (0062) + delete (0074).
  'INVALID_DURATIONS',
  'COURT_HAS_FUTURE_RESERVATIONS',
  'INVALID_ACTIVE_WINDOW',
  // CourtsAdmin intercepts this via courtUsageFromError to show the counts and
  // offer Deactivate, so this string is the net under that path, not the path.
  'COURT_IN_USE',
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
  // Staff requests (0072).
  'REQUEST_NOT_PENDING',
  'CANNOT_DECIDE_OWN',
  'REQUEST_ALREADY_PENDING',
  'BAD_KIND',
  'BAD_STATUS',
  // Marketing (0073).
  'BAD_TRANSITION',
  'CAMPAIGN_LOCKED',
  'BAD_CHANNEL',
  'BAD_RULE',
  'BODY_REQUIRED',
  'START_REQUIRED',
  'REQUEST_NOT_FOUND',
  'CAMPAIGN_NOT_FOUND',
  'AUDIENCE_NOT_FOUND',
  // Staff breaks (0105).
  'BREAK_ALREADY_OPEN',
  'BREAK_ALLOWANCE_USED',
  'BREAK_NOT_OPEN',
  'COVER_NOT_ALLOWED',
  'INVALID_STATION',
  'NO_PIN_SET',
  // 0125/0130 (multi-venue slice 1) — the venue could not be resolved for this
  // write, and a station beat in that could not be filed to any venue. Both are
  // unreachable on a one-venue project; the mapping lands with the migration so
  // the first two-venue day is not the day the operator shows errors.generic.
  'VENUE_REQUIRED',
  'STATION_UNKNOWN',
  // Desk payment (0106).
  'BOOKING_TAB_OPEN',
  'BOOKING_TAB_DONOR',
  'RESERVATION_NOT_LIVE',
  'TOTAL_CHANGED',
  'NOT_ZERO',
  'REFUND_DUE',
  'TAB_EMPTY',
  // Touch Shop (0145/0146).
  'CATEGORY_NOT_EMPTY',
  'NOT_SHOP_CATEGORY',
  'BARCODE_TAKEN',
  'SKU_TAKEN',
  'SUPPLIER_EXISTS',
  'SUPPLIER_NOT_FOUND',
  'LABEL_REQUIRED',
  'MIXED_BASKET',
  'SHOP_ITEM_NOT_ORDERABLE',
  // Protocols and the staff phone (build-contracts-2026-09-23).
  // Strings in catalogs/opErrors.protocols.*.ts; the phone maps the same codes
  // (CODE_TO_KEY in apps/mobile) except the four menu and price writer codes.
  'PROTOCOL_NOT_FOUND',
  'PROTOCOL_NOT_READY',
  'PROTOCOL_CLOSED',
  'STEP_NOT_OPEN',
  'STEP_CLOSED',
  'STEP_NOT_OPTIONAL',
  'NOT_STEP_ACTOR',
  'NOT_DECIDER',
  'SUBMISSION_DECIDED',
  'SEND_BACK_TARGET_INVALID',
  'RECORD_INVALID',
  'TEXT_BOTH_LANGUAGES_REQUIRED',
  'TEXT_REQUIRED',
  'TEXT_TOO_LONG',
  'TEMPLATE_CHANGED',
  'PROTOCOL_ORDER_INVALID',
  'PROTOCOL_STEP_FIXED',
  'LIST_TOO_LONG',
  'INVALID_ROLE',
  'PHOTO_PATH_INVALID',
  'UPLOAD_LIMIT',
  'PRICE_TARGET_CHANGED',
  'RELEASE_NOT_READY',
  'NOTE_WINDOW_CLOSED',
  'SPONSOR_DETAILS_REQUIRED',
  'CANDIDATE_NOT_FOUND',
  'HIRE_ROLE_MISMATCH',
  'CHECKLIST_NOT_FOUND',
  'SHOPPING_ITEM_NOT_OPEN',
  'PURCHASE_NOT_FOUND',
  'PURCHASE_ALREADY_RECEIVED',
  'SHOPPING_LABEL_REQUIRED',
  'CAMPAIGN_DRAFT_LOCKED',
  'BLOCK_RANGE_INVALID',
  // The menu and price writers' refusals: upsert_menu_item, upsert_variant,
  // upsert_modifier, the promotion and rate writers, set_cafe_setting.
  'ITEM_IN_RELEASE',
  'PRICE_VIA_PROTOCOL',
  'ITEM_VIA_RELEASE',
  'LAUNCH_VIA_PROTOCOL',
  // Existing codes keyed for the first time. The Staff page keeps its own
  // words for ROLE_RETIRED and EMAIL_IN_USE (staffModel.ts staffRefusal).
  'NOT_PREPARED',
  'NO_RECIPE',
  'ROLE_RETIRED',
  'PROMOTION_NOT_FOUND',
  'INVALID_WEEKDAYS',
  'CODE_TAKEN',
  'EMAIL_IN_USE',
  // Role spec (lane J): decide_recipe_change's approve, both maps.
  'RECIPE_CHANGED',
  // Wave 5 (wave5-addendum-2026-09-25 §3). Strings in catalogs/opErrors.protocols.*.ts.
  // The stores (both maps): transfer_stock, and receive_delivery_internal, which
  // Goods in, the driver receipt and log_stock reach.
  'TRANSFER_SHORT',
  'STORE_BEING_COUNTED',
  // Till shifts (operator only: the phone never calls a till-shift RPC, M7).
  'TILL_SHIFT_ALREADY_OPEN',
  'TILL_SHIFT_STATION_BUSY',
  'TILL_SHIFT_NOT_FOUND',
  'TILL_SHIFT_CLOSED',
  'TILL_SHIFT_NOT_YOURS',
  'TILL_SHIFT_WRONG_STATION',
  'TILL_SHIFT_UNSYNCED',
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

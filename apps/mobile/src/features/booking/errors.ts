/**
 * RPC error -> i18n message-key mapping. PURE (no RN / supabase imports) so it
 * is unit-tested under plain node.
 *
 * The app.* RPCs raise `raise exception 'CODE'` (errcode P0001); PostgREST
 * surfaces CODE as the error message. Source of truth for codes: migrations
 * 0008 (reservations), 0021 (degraded re-issue of confirm_booking).
 */
import type { MessageKey } from '@touch/i18n';
import { errorMessageOf, isTransportError } from '../../lib/network';

const CODE_TO_KEY = {
  SLOT_TAKEN: 'booking.slotTaken',
  // 0026 wired app.assert_bookable into hold_slot ahead of every other gate, but
  // neither client ever mapped its two codes — both rendered 'Something went
  // wrong', which is the opposite of what SOW L319 (opening hours / closed days)
  // asks the guest to be told.
  CLOSED_DATE: 'booking.closedDate',
  OUTSIDE_HOURS: 'booking.outsideHours',
  HOLD_EXPIRED: 'booking.holdExpired',
  HOLD_NOT_FOUND: 'errors.notFound',
  // 0048/C1 + 0058. These three were raised by app.hold_slot from the day it
  // was hardened and mapped by nobody, so the phone showed "Something went
  // wrong" for three refusals the guest can actually act on — the hold cap in
  // particular, which is what a guest hits after backing out of Review a few
  // times. NOT_A_HOLD comes from app.release_hold.
  HOLD_QUOTA_EXCEEDED: 'booking.holdQuota',
  BEYOND_HORIZON: 'booking.beyondHorizon',
  ACCOUNT_REQUIRED: 'booking.accountRequired',
  NOT_A_HOLD: 'booking.notAHold',
  RESERVATION_NOT_FOUND: 'errors.notFound',
  COURT_NOT_FOUND: 'errors.notFound',
  DEGRADED_LOCKOUT: 'degraded.bookingRefusedShort',
  CANCELLATION_WINDOW: 'booking.cancellationWindow',
  NOT_CANCELLABLE: 'booking.notCancellable',
  INVALID_DURATION: 'errors.validation',
  INVALID_RANGE: 'errors.validation',
  GUEST_REQUIRED: 'errors.validation',
  // 0059: confirm_booking refuses a guest whose profile has no phone (spec 05.3).
  // Review routes this code to the complete-profile screen; the text is the backstop.
  PHONE_REQUIRED: 'auth.profileIncompleteNotice',
  SLOT_IN_PAST: 'booking.slotInPast',
  NO_RATE: 'booking.noRate',
  // 0117 (C5): the hold carries the quoted price; a rule edited underneath it
  // refuses the confirm instead of charging an amount the guest never saw.
  PRICE_CHANGED: 'booking.priceChanged',
  AUTH_REQUIRED: 'auth.sessionExpired',
  FORBIDDEN: 'errors.forbidden',
  PIN_INVALID: 'auth.pinInvalid',
  PIN_LOCKED: 'errors.tooManyRequests',
  // Protocols and the staff phone (build-contracts-2026-09-23 §3). The staff
  // pages read the operator's op.errors.* strings, so a message is written once
  // for both apps (catalogs/opErrors.protocols.*.ts). The four menu and price
  // writer codes are not here: the phone never calls those writers.
  PROTOCOL_NOT_FOUND: 'op.errors.PROTOCOL_NOT_FOUND',
  PROTOCOL_NOT_READY: 'op.errors.PROTOCOL_NOT_READY',
  PROTOCOL_CLOSED: 'op.errors.PROTOCOL_CLOSED',
  STEP_NOT_OPEN: 'op.errors.STEP_NOT_OPEN',
  STEP_CLOSED: 'op.errors.STEP_CLOSED',
  STEP_NOT_OPTIONAL: 'op.errors.STEP_NOT_OPTIONAL',
  NOT_STEP_ACTOR: 'op.errors.NOT_STEP_ACTOR',
  NOT_DECIDER: 'op.errors.NOT_DECIDER',
  SUBMISSION_DECIDED: 'op.errors.SUBMISSION_DECIDED',
  SEND_BACK_TARGET_INVALID: 'op.errors.SEND_BACK_TARGET_INVALID',
  RECORD_INVALID: 'op.errors.RECORD_INVALID',
  TEXT_BOTH_LANGUAGES_REQUIRED: 'op.errors.TEXT_BOTH_LANGUAGES_REQUIRED',
  TEXT_REQUIRED: 'op.errors.TEXT_REQUIRED',
  TEXT_TOO_LONG: 'op.errors.TEXT_TOO_LONG',
  TEMPLATE_CHANGED: 'op.errors.TEMPLATE_CHANGED',
  PROTOCOL_ORDER_INVALID: 'op.errors.PROTOCOL_ORDER_INVALID',
  PROTOCOL_STEP_FIXED: 'op.errors.PROTOCOL_STEP_FIXED',
  LIST_TOO_LONG: 'op.errors.LIST_TOO_LONG',
  INVALID_ROLE: 'op.errors.INVALID_ROLE',
  PHOTO_PATH_INVALID: 'op.errors.PHOTO_PATH_INVALID',
  UPLOAD_LIMIT: 'op.errors.UPLOAD_LIMIT',
  PRICE_TARGET_CHANGED: 'op.errors.PRICE_TARGET_CHANGED',
  RELEASE_NOT_READY: 'op.errors.RELEASE_NOT_READY',
  NOTE_WINDOW_CLOSED: 'op.errors.NOTE_WINDOW_CLOSED',
  SPONSOR_DETAILS_REQUIRED: 'op.errors.SPONSOR_DETAILS_REQUIRED',
  CANDIDATE_NOT_FOUND: 'op.errors.CANDIDATE_NOT_FOUND',
  HIRE_ROLE_MISMATCH: 'op.errors.HIRE_ROLE_MISMATCH',
  CHECKLIST_NOT_FOUND: 'op.errors.CHECKLIST_NOT_FOUND',
  SHOPPING_ITEM_NOT_OPEN: 'op.errors.SHOPPING_ITEM_NOT_OPEN',
  PURCHASE_NOT_FOUND: 'op.errors.PURCHASE_NOT_FOUND',
  PURCHASE_ALREADY_RECEIVED: 'op.errors.PURCHASE_ALREADY_RECEIVED',
  SHOPPING_LABEL_REQUIRED: 'op.errors.SHOPPING_LABEL_REQUIRED',
  CAMPAIGN_DRAFT_LOCKED: 'op.errors.CAMPAIGN_DRAFT_LOCKED',
  BLOCK_RANGE_INVALID: 'op.errors.BLOCK_RANGE_INVALID',
  // Existing codes keyed for the first time.
  NOT_PREPARED: 'op.errors.NOT_PREPARED',
  NO_RECIPE: 'op.errors.NO_RECIPE',
  ROLE_RETIRED: 'op.errors.ROLE_RETIRED',
  PROMOTION_NOT_FOUND: 'op.errors.PROMOTION_NOT_FOUND',
  INVALID_WEEKDAYS: 'op.errors.INVALID_WEEKDAYS',
  CODE_TAKEN: 'op.errors.CODE_TAKEN',
  // staff-admin's body code, for the add-staff form.
  EMAIL_IN_USE: 'op.errors.EMAIL_IN_USE',
  // Existing codes the staff pages can meet, on their existing operator
  // strings. hold_slot and confirm_booking also raise INVALID_ARGUMENT and
  // IDEMPOTENCY_CONFLICT, so a guest now reads these two instead of
  // errors.generic; IDEMPOTENCY_CONFLICT was reworded to name no screen.
  INVALID_TRANSITION: 'op.errors.INVALID_TRANSITION',
  REASON_REQUIRED: 'op.errors.REASON_REQUIRED',
  CANNOT_DECIDE_OWN: 'op.errors.CANNOT_DECIDE_OWN',
  IDEMPOTENCY_CONFLICT: 'op.errors.IDEMPOTENCY_CONFLICT',
  VENUE_REQUIRED: 'op.errors.VENUE_REQUIRED',
  VENUE_MISMATCH: 'op.errors.VENUE_MISMATCH',
  INVALID_QTY: 'op.errors.INVALID_QTY',
  INVALID_PRICE: 'op.errors.INVALID_PRICE',
  INVALID_AMOUNT: 'op.errors.INVALID_AMOUNT',
  INVALID_ARGUMENT: 'op.errors.INVALID_ARGUMENT',
  INVALID_VALUE: 'op.errors.INVALID_VALUE',
  INGREDIENT_NOT_FOUND: 'op.errors.INGREDIENT_NOT_FOUND',
  VARIANT_NOT_FOUND: 'op.errors.VARIANT_NOT_FOUND',
  CATEGORY_NOT_FOUND: 'op.errors.CATEGORY_NOT_FOUND',
  CAMPAIGN_NOT_FOUND: 'op.errors.CAMPAIGN_NOT_FOUND',
  BAD_CHANNEL: 'op.errors.BAD_CHANNEL',
  REQUEST_ALREADY_PENDING: 'op.errors.REQUEST_ALREADY_PENDING',
  REQUEST_NOT_PENDING: 'op.errors.REQUEST_NOT_PENDING',
  REQUEST_NOT_FOUND: 'op.errors.REQUEST_NOT_FOUND',
  BAD_KIND: 'op.errors.BAD_KIND',
  REF_NOT_FOUND: 'op.errors.REF_NOT_FOUND',
  NAME_REQUIRED: 'op.errors.NAME_REQUIRED',
  ITEM_NOT_FOUND: 'errors.notFound',
  // Role spec (lane J, recipe_change_requests): the owner's approve on the
  // phone, and set_recipe's cycle check it runs.
  RECIPE_CHANGED: 'op.errors.RECIPE_CHANGED',
  RECIPE_CYCLE: 'op.errors.RECIPE_CYCLE',
  // Wave 5 (wave5-addendum-2026-09-25 §3, §5.3). Moving stock (transfer_stock) and
  // adding to it (log_stock). The till-shift codes stay operator only (M7).
  TRANSFER_SHORT: 'op.errors.TRANSFER_SHORT',
  STORE_BEING_COUNTED: 'op.errors.STORE_BEING_COUNTED',
  // submit_stock_count. op.errors.COUNT_IN_PROGRESS says "finalize it first",
  // which only a manager on the operator can do, so the phone says its own (V11).
  COUNT_IN_PROGRESS: 'staff.stores.countWaiting',
  // ack_waiter_call and resolve_waiter_call (0194, §2.1.8): the waiter answers
  // guests' calls on the phone, and a call at another venue or one that is gone
  // is CALL_NOT_FOUND. The operator already maps it.
  CALL_NOT_FOUND: 'op.errors.CALL_NOT_FOUND',
} as const satisfies Record<string, MessageKey>;

export type RpcErrorCode = keyof typeof CODE_TO_KEY;

/**
 * Codes longest-first, so a code that is a substring of another can never win
 * by accident. Previously this iterated in object-literal order, which meant
 * the mapping silently depended on how the keys happened to be typed.
 */
const CODES_BY_LENGTH = (Object.keys(CODE_TO_KEY) as RpcErrorCode[]).sort(
  (a, b) => b.length - a.length,
);

/** Extract a known RPC error code from a raw error message, or null. */
export function rpcErrorCode(message: string | null | undefined): RpcErrorCode | null {
  if (!message) return null;
  const trimmed = message.trim();
  // Exact match first — the common case, and immune to substring collisions.
  for (const code of CODES_BY_LENGTH) if (trimmed === code) return code;
  // Then embedded ("... raised SLOT_TAKEN ..."), longest code wins.
  for (const code of CODES_BY_LENGTH) if (trimmed.includes(code)) return code;
  return null;
}

/** True when the failure is the degraded-mode refusal (venue trading offline). */
export function isDegradedRefusal(message: string | null | undefined): boolean {
  return rpcErrorCode(message) === 'DEGRADED_LOCKOUT';
}

/**
 * Map any thrown error (RPC failure, network failure) to an i18n key.
 * Degraded refusals map to the SHORT variant; screens that know the venue
 * phone should detect isDegradedRefusal() and render degraded.bookingRefused
 * with {phone} instead.
 */
export function mapErrorToKey(err: unknown): MessageKey {
  const code = rpcErrorCode(errorMessageOf(err));
  if (code) return CODE_TO_KEY[code];
  // errors.network is reserved for genuine transport failures (lib/network.ts).
  // The old test, /network|fetch|timeout|abort/i over the whole message, also
  // matched a statement timeout or a PostgREST hint that mentioned fetch — so
  // real backend errors on the phone read as "no internet".
  if (isTransportError(err)) return 'errors.network';
  return 'errors.generic';
}

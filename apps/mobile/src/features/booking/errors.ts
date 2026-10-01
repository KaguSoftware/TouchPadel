/**
 * RPC error -> i18n message-key mapping for the phone. PURE (no RN / supabase
 * imports) so it is unit-tested under plain node.
 *
 * The codes, their lines and the matching rule are the one error catalogue
 * (`ERROR_CODE_KEYS` and `errorMessageKey` in packages/i18n/src/errors.ts),
 * shared with the operator and the web: exact code, then a code word inside a
 * longer message (GoTrue and edge wrappers), then the SQLSTATE of a native
 * Postgres error, then the network line for a transport failure, else the
 * generic line. This file keeps only what the phone says differently.
 *
 * A new code goes into the catalogue with its line in both catalogs;
 * `check-error-codes` (root `pnpm security`) fails on a raised code it lacks.
 */
import {
  errorCode,
  errorMessageKey,
  type ErrorCode,
  type ErrorOverrides,
  type MessageKey,
} from '@touch/i18n';
import { isTransportError } from '../../lib/network';

/** The phone's own words where the catalogue's (the staff line) would be wrong for a guest or a staff-phone screen. */
const MOBILE_OVERRIDES = {
  // The guest's booking lines (booking.*, degraded.*).
  SLOT_TAKEN: 'booking.slotTaken',
  // 0026 wired app.assert_bookable into hold_slot ahead of every other gate:
  // what SOW L319 (opening hours / closed days) asks the guest to be told.
  CLOSED_DATE: 'booking.closedDate',
  OUTSIDE_HOURS: 'booking.outsideHours',
  HOLD_EXPIRED: 'booking.holdExpired',
  RESERVATION_NOT_FOUND: 'errors.notFound',
  COURT_NOT_FOUND: 'errors.notFound',
  DEGRADED_LOCKOUT: 'degraded.bookingRefusedShort',
  CANCELLATION_WINDOW: 'booking.cancellationWindow',
  NOT_CANCELLABLE: 'booking.notCancellable',
  INVALID_DURATION: 'errors.validation',
  INVALID_RANGE: 'errors.validation',
  GUEST_REQUIRED: 'errors.validation',
  SLOT_IN_PAST: 'booking.slotInPast',
  NO_RATE: 'booking.noRate',
  AUTH_REQUIRED: 'auth.sessionExpired',
  FORBIDDEN: 'errors.forbidden',
  PIN_INVALID: 'auth.pinInvalid',
  PIN_LOCKED: 'errors.tooManyRequests',
  ITEM_NOT_FOUND: 'errors.notFound',
  // R6 (open matches): a staff request and a match request both raise it, so
  // the phone reads one neutral line for either.
  REQUEST_NOT_FOUND: 'errors.requestGone',
  // submit_stock_count. op.errors.COUNT_IN_PROGRESS says "finalize it first",
  // which only a manager on the operator can do, so the phone says its own (V11).
  COUNT_IN_PROGRESS: 'staff.stores.countWaiting',
  // The online deposit (build-contracts-2026-09-27 §2.5): the guest's payment.
  PAYMENT_NOT_FOUND: 'deposit.errors.paymentNotFound',
  // R6: the payment edge functions answer a retryable database error with
  // RETRY_LATER; the guest reads it as the provider being briefly unavailable.
  RETRY_LATER: 'deposit.errors.providerUnavailable',
  // Place an order (0251): place_floor_order and the till's own line checks it
  // runs. A tab the till closed, merged or never had reads as "pick another",
  // and no open day as "once the till opens the day": what the waiter can do.
  NO_OPEN_DAY: 'staff.floor.tables.dayClosed',
  DAY_CLOSED: 'staff.floor.menu.tabGone',
  TAB_NOT_OPEN: 'staff.floor.menu.tabGone',
  TAB_NOT_FOUND: 'staff.floor.menu.tabGone',
  TAB_MERGED: 'staff.floor.menu.tabGone',
  EMPTY_ORDER: 'staff.floor.review.issues.empty',
  // Open matches (docs/design/open-matches/guest.md §4.22): the guest's lines
  // for the codes the desk also meets (the desk reads op.errors.*). Exact codes
  // match first, so MATCH_FULL never shadows MATCH_SLOT_FULL.
  MATCHES_OFF: 'matches.errors.off',
  MATCH_BANNED: 'matches.errors.banned',
  MATCH_NOT_FOUND: 'matches.errors.notFound',
  MATCH_FULL: 'matches.errors.full',
  MATCH_SLOT_FULL: 'matches.errors.slotFull',
  // The detail (minutes of notice) has its own line, matches.errors.tooLateAt,
  // for the screen that reads it.
  MATCH_TOO_LATE: 'matches.errors.tooLate',
  MATCH_SEAT_LIMIT: 'matches.errors.seatLimit',
  MATCH_ALREADY_IN: 'matches.errors.alreadyIn',
  MATCH_GENDER_MISMATCH: 'matches.errors.genderMismatch',
  SEAT_NOT_FOUND: 'matches.errors.seatNotFound',
} as const satisfies ErrorOverrides;

export type RpcErrorCode = ErrorCode;

/** Extract a known error code from a raw error message (exact, then a code word inside it), or null. */
export function rpcErrorCode(message: string | null | undefined): RpcErrorCode | null {
  return errorCode(message);
}

/**
 * A refusal's detail (build contracts §1.11, guest.md §4.22): PostgREST's
 * `details` string (`raise … using detail`), or an edge refusal's `detail`
 * (`{error, detail}`, `DepositEdgeError.detail`). Null when there is none.
 */
export function rpcErrorDetail(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const o = err as { details?: unknown; detail?: unknown };
  if (typeof o.details === 'string' && o.details.trim()) return o.details.trim();
  if (typeof o.detail === 'string' && o.detail.trim()) return o.detail.trim();
  return null;
}

/** True when the failure is the degraded-mode refusal (venue trading offline). */
export function isDegradedRefusal(message: string | null | undefined): boolean {
  return rpcErrorCode(message) === 'DEGRADED_LOCKOUT';
}

/**
 * Map any thrown error (RPC failure, edge refusal, network failure) to an i18n
 * key. Degraded refusals map to the SHORT variant; screens that know the venue
 * phone should detect isDegradedRefusal() and render degraded.bookingRefused
 * with {phone} instead.
 *
 * errors.network is reserved for genuine transport failures (lib/network.ts):
 * the old test, /network|fetch|timeout|abort/i over the whole message, also
 * matched a statement timeout or a PostgREST hint that mentioned fetch, so real
 * backend errors on the phone read as "no internet".
 */
export function mapErrorToKey(err: unknown): MessageKey {
  return errorMessageKey(err, { overrides: MOBILE_OVERRIDES, isTransport: isTransportError });
}

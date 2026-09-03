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
  AUTH_REQUIRED: 'auth.sessionExpired',
  FORBIDDEN: 'errors.forbidden',
  PIN_INVALID: 'auth.pinInvalid',
  PIN_LOCKED: 'errors.tooManyRequests',
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

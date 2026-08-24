/**
 * RPC error -> i18n message-key mapping. PURE (no RN / supabase imports) so it
 * is unit-tested under plain node.
 *
 * The app.* RPCs raise `raise exception 'CODE'` (errcode P0001); PostgREST
 * surfaces CODE as the error message. Source of truth for codes: migrations
 * 0008 (reservations), 0021 (degraded re-issue of confirm_booking).
 */
import type { MessageKey } from '@touch/i18n';

const CODE_TO_KEY = {
  SLOT_TAKEN: 'booking.slotTaken',
  HOLD_EXPIRED: 'booking.holdExpired',
  HOLD_NOT_FOUND: 'errors.notFound',
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
} as const satisfies Record<string, MessageKey>;

export type RpcErrorCode = keyof typeof CODE_TO_KEY;

/** Extract a known RPC error code from a raw error message, or null. */
export function rpcErrorCode(message: string | null | undefined): RpcErrorCode | null {
  if (!message) return null;
  for (const code of Object.keys(CODE_TO_KEY) as RpcErrorCode[]) {
    // Codes surface either verbatim or embedded ("... SLOT_TAKEN ...").
    if (message === code || message.includes(code)) return code;
  }
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
  const message =
    typeof err === 'string' ? err : err instanceof Error ? err.message : messageOf(err);
  const code = rpcErrorCode(message);
  if (code) return CODE_TO_KEY[code];
  if (message && /network|fetch|timeout|abort/i.test(message)) return 'errors.network';
  return 'errors.generic';
}

function messageOf(err: unknown): string | null {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message: unknown }).message;
    return typeof m === 'string' ? m : null;
  }
  return null;
}

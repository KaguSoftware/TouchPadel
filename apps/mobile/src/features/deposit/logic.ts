/**
 * The online deposit, decided in one PURE module (no RN / expo / supabase
 * imports, so vitest runs it under plain node).
 *
 * Binding shapes: docs/design/payments/build-contracts-2026-09-27.md §2.2 and §3.
 * The screen table: qi-deposit-plan-2026-09-20.md §5.3.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: the app never decides a payment. It
 * renders what `deposit-status` said, exactly one screen per answer, and a
 * failed REQUEST is never read as a failed PAYMENT. `screenFor` below is the
 * whole of that mapping, exhaustive over every status the server can send, and
 * `__tests__/logic.test.ts` walks every one of them.
 */
import type { BookingRow } from '../booking/logic';
import { isTransportError } from '../../lib/network';

// ── Server vocabulary ───────────────────────────────────────────────────────

export type DepositMode = 'off' | 'optional' | 'required';

/** Every `booking_payments.status` (contract §2.1). */
export const PAYMENT_STATUSES = [
  'created',
  'pending',
  'succeeded',
  'failed',
  'expired',
  'refund_pending',
  'refunded',
  'refund_failed',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** What `failed` carries (contract §2.1). */
export const FAILURE_CODES = ['declined', 'auth_failed', 'bank_error', 'cancelled'] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

/** Refund reasons that mean "the booking never happened", not "you cancelled it". */
const SLOT_LOST_REASONS = new Set(['slot_lost', 'venue_offline', 'amount_mismatch']);

/** A reservation the server still counts as a booking the guest will play. */
const LIVE_BOOKING = new Set(['confirmed']);
/** A booking that happened (or was closed) after it was paid for. */
const SETTLED_BOOKING = new Set(['arrived', 'completed', 'no_show']);

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** An integer IQD amount, whether jsonb sent a number or PostgREST a numeric string. */
function int(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

const modeOf = (v: unknown): DepositMode =>
  v === 'optional' || v === 'required' ? v : 'off';

/**
 * What a `booking_payments` row pays for (open matches, money.md §5.5): a
 * court deposit, or open-match tickets (docs/design/open-matches/guest.md
 * §4.10.4). A row from before 0259, or any value this build does not know, is
 * a deposit.
 */
export type PaymentPurpose = 'deposit' | 'ticket';

// ── app.deposit_quote ───────────────────────────────────────────────────────

export interface ActiveAttempt {
  ref: string;
  status: string;
  formUrl: string | null;
  deadlineAt: string | null;
}

export interface DepositQuote {
  mode: DepositMode;
  depositIqd: number;
  priceIqd: number;
  restIqd: number;
  windowSeconds: number;
  /** The live attempt on this hold, when one is already running. */
  active: ActiveAttempt | null;
}

/**
 * Parse app.deposit_quote. Tolerant by design: anything it cannot read is
 * "off", which is today's Confirm button — the one outcome that never asks a
 * guest for money on a figure the app did not understand.
 */
export function parseDepositQuote(json: unknown): DepositQuote {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const depositIqd = int(o.deposit_iqd) ?? 0;
  const priceIqd = int(o.price_iqd) ?? 0;
  // Mode and amount travel together: a mode with a zero deposit is off.
  const mode = depositIqd > 0 ? modeOf(o.deposit_mode) : 'off';
  const a = o.active && typeof o.active === 'object' ? (o.active as Record<string, unknown>) : null;
  const ref = a ? str(a.request_id) : null;
  return {
    mode,
    depositIqd: mode === 'off' ? 0 : depositIqd,
    priceIqd,
    restIqd: mode === 'off' ? priceIqd : (int(o.rest_iqd) ?? Math.max(priceIqd - depositIqd, 0)),
    windowSeconds: int(o.window_seconds) ?? 900,
    active:
      a && ref
        ? {
            ref,
            status: str(a.status) ?? 'pending',
            formUrl: str(a.form_url),
            deadlineAt: str(a.deadline_at),
          }
        : null,
  };
}

/** What Review offers, from the quote query. */
export type ReviewPayment =
  | { kind: 'loading' }
  | { kind: 'off' }
  | {
      kind: 'optional' | 'required';
      depositIqd: number;
      restIqd: number;
      priceIqd: number;
      /** A payment already running on this hold: the button says "Continue payment". */
      activeRef: string | null;
    };

/**
 * Review's payment choice.
 *
 * A quote that FAILED is `off`, not an error screen: an older server has no
 * `deposit_quote`, a flaky one should not block a booking, and if the venue
 * really does require a deposit, `confirm_booking` refuses DEPOSIT_REQUIRED and
 * Review refetches the quote into the pay-only layout (plan §10 row 44).
 */
export function reviewPayment(quote: DepositQuote | undefined, failed: boolean): ReviewPayment {
  if (!quote) return failed ? { kind: 'off' } : { kind: 'loading' };
  if (quote.mode === 'off') return { kind: 'off' };
  return {
    kind: quote.mode,
    depositIqd: quote.depositIqd,
    restIqd: quote.restIqd,
    priceIqd: quote.priceIqd,
    activeRef: quote.active?.ref ?? null,
  };
}

// ── deposit-begin ───────────────────────────────────────────────────────────

export interface DepositBegin {
  ref: string;
  formUrl: string;
  amountIqd: number | null;
  deadlineAt: string | null;
}

/** Parse deposit-begin's 200. Throws when there is no attempt to follow. */
export function parseDepositBegin(json: unknown): DepositBegin {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const ref = str(o.request_id);
  const formUrl = str(o.form_url);
  if (!ref || !formUrl) throw new Error('MALFORMED_DEPOSIT_BEGIN');
  return { ref, formUrl, amountIqd: int(o.amount_iqd), deadlineAt: str(o.deadline_at) };
}

// ── deposit-status ──────────────────────────────────────────────────────────

export interface PaymentReservation {
  id: string | null;
  kind: string | null;
  status: string | null;
  courtId: string | null;
  startAt: string | null;
  endAt: string | null;
  venueId: string | null;
}

export interface DepositStatus {
  ref: string;
  /** Null when the server sent a status this build has never heard of. */
  status: PaymentStatus | null;
  failureCode: FailureCode | null;
  amountIqd: number | null;
  priceIqd: number | null;
  restIqd: number | null;
  deadlineAt: string | null;
  formUrl: string | null;
  refundReason: string | null;
  refundAmountIqd: number | null;
  refundedAt: string | null;
  sandbox: boolean;
  depositMode: DepositMode;
  attemptsLeft: number;
  holdLive: boolean;
  reservation: PaymentReservation | null;
  serverNow: string | null;
  /**
   * Absent means `deposit`: `parseDepositStatus` always sets it, and a status
   * built anywhere else (a test's fixture, a pre-0259 shape) is one.
   */
  purpose?: PaymentPurpose;
  /** A ticket purchase's count (1..3); null on a deposit. */
  ticketCount?: number | null;
  /** A ticket purchase's price per ticket; null on a deposit. */
  unitPriceIqd?: number | null;
}

/** Parse deposit-status's 200 (the `deposit_status` jsonb). Throws without a ref. */
export function parseDepositStatus(json: unknown): DepositStatus {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const ref = str(o.request_id);
  if (!ref) throw new Error('MALFORMED_DEPOSIT_STATUS');
  const r = o.reservation && typeof o.reservation === 'object'
    ? (o.reservation as Record<string, unknown>)
    : null;
  return {
    ref,
    status: oneOf(PAYMENT_STATUSES, o.status),
    failureCode: oneOf(FAILURE_CODES, o.failure_code),
    amountIqd: int(o.amount_iqd),
    priceIqd: int(o.price_iqd),
    restIqd: int(o.rest_iqd),
    deadlineAt: str(o.deadline_at),
    formUrl: str(o.form_url),
    refundReason: str(o.refund_reason),
    refundAmountIqd: int(o.refund_amount_iqd),
    refundedAt: str(o.refunded_at),
    sandbox: o.sandbox === true,
    depositMode: modeOf(o.deposit_mode),
    attemptsLeft: int(o.attempts_left) ?? 0,
    holdLive: o.hold_live === true,
    reservation: r
      ? {
          id: str(r.id),
          kind: str(r.kind),
          status: str(r.status),
          courtId: str(r.court_id),
          startAt: str(r.start_at),
          endAt: str(r.end_at),
          venueId: str(r.venue_id),
        }
      : null,
    serverNow: str(o.server_now),
    purpose: o.purpose === 'ticket' ? 'ticket' : 'deposit',
    ticketCount: int(o.ticket_count),
    unitPriceIqd: int(o.unit_price_iqd),
  };
}

/** A ticket purchase, not a deposit (§4.10.4): no hold, no reservation, no desk. */
export function isTicketPayment(s: Pick<DepositStatus, 'purpose'> | null | undefined): boolean {
  return s?.purpose === 'ticket';
}

/**
 * The hold a new attempt or a pay-at-desk confirm acts on.
 *
 * The status payload names the payment's reservation, not the hold it began
 * on (contract §2.2 carries no `hold_id`). While the hold is live the two are
 * the same row, which is the only time either action is offered; `fallback` is
 * the id the app saved when it began the payment.
 */
export function holdIdOf(s: DepositStatus, fallback: string | null): string | null {
  if (!s.holdLive) return null;
  if (s.reservation?.kind === 'hold' && s.reservation.id) return s.reservation.id;
  return fallback;
}

// ── Edge refusals ───────────────────────────────────────────────────────────

/**
 * A refused deposit-begin / deposit-status / ticket-begin call. The message IS
 * the body's code, as a PostgREST refusal's is, so `mapErrorToKey`, the
 * telemetry and the query client's retry policy all read it the same way.
 * `detail` is the body's `detail` when the SQL refusal carried one
 * (`TICKET_COUNT_INVALID` `wallet_limit`, guest.md §4.10.2); `rpcErrorDetail`
 * (features/booking/errors.ts) reads it.
 */
export class DepositEdgeError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(code: string | null, status: number | null, detail: string | null = null) {
    super(code ?? 'edge function failed');
    this.name = 'DepositEdgeError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** The `error` of an edge function's JSON body (`{error:'CODE'}`), or null. */
export function bodyErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

/** The `detail` of an edge function's refusal body (`{error, detail}`), or null. */
export function bodyErrorDetail(body: unknown): string | null {
  if (body && typeof body === 'object' && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === 'string' && detail.trim()) return detail.trim();
  }
  return null;
}

/**
 * Where a refused `ticket-begin` sends the guest (guest.md §4.10.1):
 *  phone            /complete-profile?returnTo=back
 *  terms            /accept-terms, or `matches.errors.updateApp` on a build whose
 *                   terms are already accepted (the screen reads the consent)
 *  walletLimit      `matches.errors.walletLimit` (TICKET_COUNT_INVALID `wallet_limit`)
 *  tooManyAttempts  `matches.tickets.tooManyAttempts` (the deposit's own line
 *                   names a slot, which a ticket has not)
 *  inline           the refusal's own copy, through `mapErrorToKey`
 */
export type TicketBeginRefusal = 'phone' | 'terms' | 'walletLimit' | 'tooManyAttempts' | 'inline';

export function ticketBeginRefusalOf(err: unknown): TicketBeginRefusal {
  if (!(err instanceof DepositEdgeError)) return 'inline';
  switch (err.code) {
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'TOO_MANY_ATTEMPTS':
      return 'tooManyAttempts';
    case 'TICKET_COUNT_INVALID':
      return err.detail === 'wallet_limit' ? 'walletLimit' : 'inline';
    default:
      return 'inline';
  }
}

/** How a status fetch failed, as far as the screen is concerned. */
export type FetchFailure = 'not_found' | 'transport' | 'other';

/**
 * Sort a failed status fetch. A foreign ref and an unknown one both answer
 * PAYMENT_NOT_FOUND; a garbage ref (a mangled link) never reaches SQL and is
 * refused BAD_REQUEST by the edge function, which is the same "nothing here".
 */
export function fetchFailureOf(err: unknown): FetchFailure | null {
  if (!err) return null;
  if (err instanceof DepositEdgeError) {
    if (err.code === 'PAYMENT_NOT_FOUND' || err.code === 'BAD_REQUEST') return 'not_found';
    return 'other';
  }
  const message = err && typeof err === 'object' && 'message' in err
    ? (err as { message: unknown }).message
    : null;
  if (message === 'PAYMENT_NOT_FOUND') return 'not_found';
  return isTransportError(err) ? 'transport' : 'other';
}

// ── The one screen ──────────────────────────────────────────────────────────

export type PayScreen =
  /** Nothing known yet: the first answer is on its way. */
  | { kind: 'loading' }
  /** The status could not be read at all, and not because of the connection. */
  | { kind: 'error' }
  /** PAYMENT_NOT_FOUND: an unknown ref, someone else's, or a mangled link. */
  | { kind: 'notFound' }
  /** created / pending, window still open. */
  | { kind: 'checking' }
  /** Past the window and still unsettled, or an answer this build cannot read. */
  | { kind: 'stillChecking' }
  /** succeeded and the booking is confirmed: the success screen takes over. */
  | { kind: 'confirmed' }
  /** succeeded on a booking that has since been played or closed. */
  | { kind: 'paid' }
  /** succeeded on a ticket purchase: `count` tickets are in the wallet (§4.10.4). */
  | { kind: 'ticketsBought'; count: number }
  | {
      kind: 'failed';
      reason: FailureCode | null;
      holdLive: boolean;
      /** A new attempt on the same hold is allowed. */
      canRetry: boolean;
      /** Optional mode: confirm now and pay everything at the desk. */
      canPayAtDesk: boolean;
      /** The hold is live but every attempt is spent. */
      outOfAttempts: boolean;
    }
  | { kind: 'expired' }
  /** refund_pending because the slot could not be kept (slot_lost, venue_offline, amount_mismatch). */
  | { kind: 'slotLost' }
  /** refund_pending for any other reason (a cancellation, a duplicate charge, the desk). */
  | { kind: 'refundPending' }
  | { kind: 'refunded' }
  | { kind: 'refundFailed' };

export type PayScreenKind = PayScreen['kind'];

export interface ScreenInput {
  /** The last answer the server gave, kept across failed polls. */
  status: DepositStatus | null;
  /** How the latest fetch failed, if it did. */
  failure: FetchFailure | null;
  /** Now, on the SERVER's clock (see `serverNowMs`). */
  nowMs: number;
}

/**
 * THE mapping: server state → exactly one screen (plan §5.3).
 *
 * A transport failure never changes the screen: with an answer in hand the
 * guest keeps seeing it (and the offline banner), without one they keep seeing
 * the spinner. Only the server can say `failed`.
 */
export function screenFor({ status, failure, nowMs }: ScreenInput): PayScreen {
  if (failure === 'not_found') return { kind: 'notFound' };
  if (!status) return failure === 'other' ? { kind: 'error' } : { kind: 'loading' };

  const s = status.status;
  if (s === null) return { kind: 'stillChecking' };
  // A ticket has no reservation, so the deposit switch below would read its
  // success as "still checking" for ever: it is decided first (§4.10.4).
  if (status.purpose === 'ticket') return ticketScreenFor(status, s, nowMs);
  switch (s) {
    case 'created':
    case 'pending':
      return openScreen(status, nowMs);
    case 'succeeded': {
      const r = status.reservation;
      if (r?.kind === 'booking' && r.status && LIVE_BOOKING.has(r.status)) return { kind: 'confirmed' };
      if (r?.kind === 'booking' && r.status && SETTLED_BOOKING.has(r.status)) return { kind: 'paid' };
      // A cancelled booking's deposit is moved to refund_pending by the
      // reservations trigger; this is the instant before it lands.
      if (r?.status === 'cancelled') return { kind: 'refundPending' };
      // Succeeded without a booking is exactly what the server never leaves
      // standing (plan §3.2): wait for it rather than claim either outcome.
      return { kind: 'stillChecking' };
    }
    case 'failed': {
      const canRetry = status.holdLive && status.attemptsLeft > 0;
      return {
        kind: 'failed',
        reason: status.failureCode,
        holdLive: status.holdLive,
        canRetry,
        canPayAtDesk: status.holdLive && status.depositMode === 'optional',
        outOfAttempts: status.holdLive && status.attemptsLeft <= 0,
      };
    }
    case 'expired':
      return { kind: 'expired' };
    case 'refund_pending':
      // Only a reason that says so earns "we couldn't keep that slot"; an
      // unnamed one gets the sentence that is true of every refund.
      return status.refundReason !== null && SLOT_LOST_REASONS.has(status.refundReason)
        ? { kind: 'slotLost' }
        : { kind: 'refundPending' };
    case 'refunded':
      return { kind: 'refunded' };
    case 'refund_failed':
      return { kind: 'refundFailed' };
    default: {
      // A status added to PAYMENT_STATUSES without a screen fails to compile here.
      const unreachable: never = s;
      return unreachable;
    }
  }
}

/** The window still open reads checking; past it and still unsettled, still checking. */
function openScreen(status: DepositStatus, nowMs: number): PayScreen {
  const deadline = status.deadlineAt ? Date.parse(status.deadlineAt) : NaN;
  return Number.isFinite(deadline) && nowMs > deadline ? { kind: 'stillChecking' } : { kind: 'checking' };
}

/**
 * The ticket half of `screenFor` (guest.md §4.10.4). No hold is ever live, so
 * a failure can only be tried again (while attempts are left) or left, never
 * paid at the desk; and a refund is never `slotLost`: `amount_mismatch` is in
 * SLOT_LOST_REASONS, and it is the one refund a fresh purchase can show.
 */
function ticketScreenFor(status: DepositStatus, s: PaymentStatus, nowMs: number): PayScreen {
  switch (s) {
    case 'created':
    case 'pending':
      return openScreen(status, nowMs);
    case 'succeeded':
      return { kind: 'ticketsBought', count: Math.max(0, status.ticketCount ?? 0) };
    case 'failed':
      return {
        kind: 'failed',
        reason: status.failureCode,
        holdLive: false,
        canRetry: status.attemptsLeft > 0,
        canPayAtDesk: false,
        outOfAttempts: status.attemptsLeft <= 0,
      };
    case 'expired':
      return { kind: 'expired' };
    case 'refund_pending':
      return { kind: 'refundPending' };
    case 'refunded':
      return { kind: 'refunded' };
    case 'refund_failed':
      return { kind: 'refundFailed' };
    default: {
      const unreachable: never = s;
      return unreachable;
    }
  }
}

/** Screens whose payment is still open: the screen polls, and the pending pointer stays. */
const OPEN_SCREENS = new Set<PayScreenKind>(['loading', 'checking', 'stillChecking', 'error']);

/** The payment has moved on for good: forget the pending pointer (contract §4). */
export function isTerminalScreen(kind: PayScreenKind): boolean {
  return !OPEN_SCREENS.has(kind);
}

/** Screens that keep asking the server. */
export function isPollingScreen(kind: PayScreenKind): boolean {
  return kind === 'loading' || kind === 'checking' || kind === 'stillChecking';
}

/** The failure line on the "didn't go through" screen. */
export function failureTextKey(
  reason: FailureCode | null,
):
  | 'deposit.failedDeclined'
  | 'deposit.failedAuth'
  | 'deposit.failedBank'
  | 'deposit.failedCancelled'
  | 'deposit.failedUnknown' {
  switch (reason) {
    case 'declined':
      return 'deposit.failedDeclined';
    case 'auth_failed':
      return 'deposit.failedAuth';
    case 'bank_error':
      return 'deposit.failedBank';
    case 'cancelled':
      return 'deposit.failedCancelled';
    default:
      return 'deposit.failedUnknown';
  }
}

// ── Polling ─────────────────────────────────────────────────────────────────

export const FAST_POLL_MS = 2_000;
export const SLOW_POLL_MS = 5_000;
/** How long the screen polls fast after it opens. */
export const FAST_PHASE_MS = 60_000;
/** How long past the deadline it keeps polling before it leaves the rest to push. */
export const AFTER_DEADLINE_MS = 60_000;
/**
 * The cap when no deadline is known yet: the longest window the owner can set
 * (1800 s, contract §2.3) past the fast phase.
 */
export const NO_DEADLINE_CAP_MS = FAST_PHASE_MS + 1_800_000;

/**
 * The next poll, or `false` to stop (contract §4): every 2 s for the first
 * 60 s, then every 5 s until deadline + 60 s, then nothing (push and the
 * foreground refetch take over). All times in ms; `nowMs` and `deadlineMs` on
 * the same clock.
 */
export function pollDelayMs({
  startedAtMs,
  nowMs,
  deadlineMs,
}: {
  startedAtMs: number;
  nowMs: number;
  deadlineMs: number | null;
}): number | false {
  const stopAt =
    deadlineMs !== null && Number.isFinite(deadlineMs)
      ? deadlineMs + AFTER_DEADLINE_MS
      : startedAtMs + NO_DEADLINE_CAP_MS;
  if (nowMs >= stopAt) return false;
  return nowMs - startedAtMs < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

/**
 * Now on the server's clock: the last answer's `server_now`, moved on by the
 * time since it arrived. A phone whose clock is minutes off would otherwise
 * call a live window "still checking", or a dead one "checking".
 */
export function serverNowMs(
  serverNow: string | null,
  receivedAtMs: number,
  deviceNowMs: number,
): number {
  const at = serverNow ? Date.parse(serverNow) : NaN;
  if (!Number.isFinite(at) || !receivedAtMs) return deviceNowMs;
  return at + (deviceNowMs - receivedAtMs);
}

/** Whole seconds left before `deadlineAt`, on the given clock; null when unknown. */
export function secondsLeft(deadlineAt: string | null, nowMs: number): number | null {
  const at = deadlineAt ? Date.parse(deadlineAt) : NaN;
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - nowMs) / 1000));
}

// ── My reservations (app.my_reservations, contract §2.2) ────────────────────

const OPEN_PAYMENT = new Set(['created', 'pending']);

/**
 * The attempt to finish on a hold whose payment is still open, or null.
 * Only a HOLD: a confirmed booking has nothing left to pay online.
 */
export function openPaymentRef(row: BookingRow): string | null {
  if (row.kind !== 'hold' || row.status !== 'pending') return null;
  if (!row.payment_status || !OPEN_PAYMENT.has(row.payment_status)) return null;
  return row.payment_ref ?? null;
}

/**
 * What was paid online and what is left for the desk, on a booking with a
 * deposit. Null without one. The rest is the server's `court_remaining_iqd`
 * (it already nets the deposit off, contract §2.3); never computed here when
 * the server sent it.
 */
export function onlinePaymentOf(row: BookingRow): { paid: number; rest: number } | null {
  const paid = int(row.online_paid_iqd);
  if (paid === null || paid <= 0) return null;
  const remaining = int(row.court_remaining_iqd);
  const price = int(row.price_iqd);
  const rest = remaining ?? (price !== null ? Math.max(price - paid, 0) : 0);
  return { paid, rest };
}

/** A refund line under a booking whose deposit went (or is going) back. */
export function refundNoteKey(
  row: BookingRow,
): 'deposit.refundPendingNote' | 'deposit.refundedNote' | 'deposit.refundFailedNote' | null {
  switch (row.payment_status) {
    case 'refund_pending':
      return 'deposit.refundPendingNote';
    case 'refunded':
      return 'deposit.refundedNote';
    case 'refund_failed':
      return 'deposit.refundFailedNote';
    default:
      return null;
  }
}

/** The fuller sentence the booking detail shows for the same three states. */
export function refundDetailKey(
  row: BookingRow,
): 'deposit.refundPendingDetail' | 'deposit.refundedDetail' | 'deposit.refundFailedDetail' | null {
  switch (row.payment_status) {
    case 'refund_pending':
      return 'deposit.refundPendingDetail';
    case 'refunded':
      return 'deposit.refundedDetail';
    case 'refund_failed':
      return 'deposit.refundFailedDetail';
    default:
      return null;
  }
}

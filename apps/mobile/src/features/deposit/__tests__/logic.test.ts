import { describe, expect, it } from 'vitest';
import type { BookingRow } from '../../booking/logic';
import {
  AFTER_DEADLINE_MS,
  DepositEdgeError,
  FAST_PHASE_MS,
  FAST_POLL_MS,
  NO_DEADLINE_CAP_MS,
  PAYMENT_STATUSES,
  SLOW_POLL_MS,
  bodyErrorCode,
  bodyErrorDetail,
  failureTextKey,
  fetchFailureOf,
  holdIdOf,
  isPollingScreen,
  isTerminalScreen,
  isTicketPayment,
  onlinePaymentOf,
  openPaymentRef,
  parseDepositBegin,
  parseDepositQuote,
  parseDepositStatus,
  pollDelayMs,
  refundDetailKey,
  refundNoteKey,
  reviewPayment,
  screenFor,
  secondsLeft,
  serverNowMs,
  ticketBeginRefusalOf,
  type DepositStatus,
  type PayScreenKind,
  type PaymentStatus,
} from '../logic';

/**
 * The online deposit's pure half (build-contracts-2026-09-27; plan §5.3, §11
 * "Mobile"). The heart of it is `screenFor`: every status the server can send
 * maps to exactly one screen, and nothing but the server can put "failed" or
 * "paid" on it.
 */

const NOW = Date.parse('2026-09-27T12:00:00Z');
const DEADLINE = '2026-09-27T12:10:00Z';

function status(over: Partial<DepositStatus> = {}): DepositStatus {
  return {
    ref: 'ref-1',
    status: 'pending',
    failureCode: null,
    amountIqd: 20000,
    priceIqd: 40000,
    restIqd: 20000,
    deadlineAt: DEADLINE,
    formUrl: 'https://pay.example/x',
    refundReason: null,
    refundAmountIqd: null,
    refundedAt: null,
    sandbox: false,
    depositMode: 'optional',
    attemptsLeft: 2,
    holdLive: true,
    reservation: {
      id: 'hold-1',
      kind: 'hold',
      status: 'pending',
      courtId: 'court-1',
      startAt: '2026-09-28T18:00:00Z',
      endAt: '2026-09-28T19:30:00Z',
      venueId: 'venue-1',
    },
    serverNow: '2026-09-27T12:00:00Z',
    ...over,
  };
}

const kindOf = (s: DepositStatus | null, failure: Parameters<typeof screenFor>[0]['failure'] = null, nowMs = NOW) =>
  screenFor({ status: s, failure, nowMs }).kind;

describe('parseDepositQuote', () => {
  it('reads the three modes with their amounts', () => {
    const q = parseDepositQuote({
      deposit_mode: 'required',
      deposit_iqd: 20000,
      price_iqd: 40000,
      rest_iqd: 20000,
      window_seconds: 900,
      active: null,
    });
    expect(q).toEqual({
      mode: 'required',
      depositIqd: 20000,
      priceIqd: 40000,
      restIqd: 20000,
      windowSeconds: 900,
      active: null,
    });
    expect(parseDepositQuote({ deposit_mode: 'optional', deposit_iqd: 10000, price_iqd: 30000 }).mode).toBe(
      'optional',
    );
  });

  it('reads a mode with a zero deposit, an unknown mode, or garbage as off', () => {
    expect(parseDepositQuote({ deposit_mode: 'required', deposit_iqd: 0, price_iqd: 40000 }).mode).toBe('off');
    expect(parseDepositQuote({ deposit_mode: 'sometimes', deposit_iqd: 5000 }).mode).toBe('off');
    expect(parseDepositQuote(null).mode).toBe('off');
    expect(parseDepositQuote('nope').mode).toBe('off');
    const off = parseDepositQuote({ deposit_mode: 'off', deposit_iqd: 0, price_iqd: 40000, rest_iqd: 0 });
    // Off means the desk takes the whole price.
    expect(off.depositIqd).toBe(0);
    expect(off.restIqd).toBe(40000);
  });

  it('accepts numeric strings, and derives the rest only when the server sent none', () => {
    const q = parseDepositQuote({ deposit_mode: 'optional', deposit_iqd: '20000', price_iqd: '40000' });
    expect(q.depositIqd).toBe(20000);
    expect(q.restIqd).toBe(20000);
  });

  it('carries the attempt already running on the hold', () => {
    const q = parseDepositQuote({
      deposit_mode: 'optional',
      deposit_iqd: 20000,
      price_iqd: 40000,
      active: { request_id: 'r-9', status: 'pending', form_url: 'https://x', deadline_at: DEADLINE },
    });
    expect(q.active).toEqual({ ref: 'r-9', status: 'pending', formUrl: 'https://x', deadlineAt: DEADLINE });
  });
});

describe('reviewPayment', () => {
  const quote = parseDepositQuote({ deposit_mode: 'optional', deposit_iqd: 20000, price_iqd: 40000, rest_iqd: 20000 });

  it('waits for the quote, and falls back to Confirm when it cannot be read', () => {
    expect(reviewPayment(undefined, false)).toEqual({ kind: 'loading' });
    // An older server (no deposit_quote) or a flaky one must not block a booking.
    expect(reviewPayment(undefined, true)).toEqual({ kind: 'off' });
  });

  it('offers what the venue asks for', () => {
    expect(reviewPayment(parseDepositQuote({ deposit_mode: 'off' }), false)).toEqual({ kind: 'off' });
    expect(reviewPayment(quote, false)).toEqual({
      kind: 'optional',
      depositIqd: 20000,
      restIqd: 20000,
      priceIqd: 40000,
      activeRef: null,
    });
  });

  it('names a payment already running, so the button can say Continue', () => {
    const running = { ...quote, active: { ref: 'r-1', status: 'pending', formUrl: null, deadlineAt: null } };
    const r = reviewPayment(running, false);
    expect(r.kind === 'optional' && r.activeRef).toBe('r-1');
  });
});

describe('parseDepositBegin', () => {
  it('reads the attempt to follow', () => {
    expect(
      parseDepositBegin({
        request_id: 'r-1',
        form_url: 'https://pay',
        amount_iqd: 20000,
        deadline_at: DEADLINE,
        status: 'pending',
      }),
    ).toEqual({ ref: 'r-1', formUrl: 'https://pay', amountIqd: 20000, deadlineAt: DEADLINE });
  });

  it('refuses an answer with no page to open', () => {
    expect(() => parseDepositBegin({ request_id: 'r-1' })).toThrow('MALFORMED_DEPOSIT_BEGIN');
    expect(() => parseDepositBegin(null)).toThrow('MALFORMED_DEPOSIT_BEGIN');
  });
});

describe('parseDepositStatus', () => {
  const wire = {
    request_id: 'r-1',
    status: 'failed',
    failure_code: 'declined',
    amount_iqd: 20000,
    price_iqd: '40000',
    rest_iqd: 20000,
    deadline_at: DEADLINE,
    form_url: null,
    refund_reason: null,
    refund_amount_iqd: null,
    refunded_at: null,
    sandbox: true,
    deposit_mode: 'optional',
    attempts_left: 1,
    hold_live: true,
    reservation: {
      id: 'hold-1',
      kind: 'hold',
      status: 'pending',
      court_id: 'c-1',
      start_at: '2026-09-28T18:00:00Z',
      end_at: '2026-09-28T19:30:00Z',
      venue_id: 'v-1',
    },
    server_now: '2026-09-27T12:00:00Z',
  };

  it('reads the contract §2.2 shape', () => {
    const s = parseDepositStatus(wire);
    expect(s.status).toBe('failed');
    expect(s.failureCode).toBe('declined');
    expect(s.priceIqd).toBe(40000);
    expect(s.sandbox).toBe(true);
    expect(s.attemptsLeft).toBe(1);
    expect(s.holdLive).toBe(true);
    expect(s.reservation).toEqual({
      id: 'hold-1',
      kind: 'hold',
      status: 'pending',
      courtId: 'c-1',
      startAt: '2026-09-28T18:00:00Z',
      endAt: '2026-09-28T19:30:00Z',
      venueId: 'v-1',
    });
  });

  it('keeps a status this build has never heard of as unknown, not as a guess', () => {
    expect(parseDepositStatus({ ...wire, status: 'chargeback' }).status).toBeNull();
    expect(parseDepositStatus({ ...wire, failure_code: 'solar_flare' }).failureCode).toBeNull();
  });

  it('refuses an answer with no ref', () => {
    expect(() => parseDepositStatus({ status: 'pending' })).toThrow('MALFORMED_DEPOSIT_STATUS');
  });
});

describe('holdIdOf', () => {
  it('is the hold while it is live, and nothing once it is not', () => {
    expect(holdIdOf(status(), null)).toBe('hold-1');
    expect(holdIdOf(status({ holdLive: false }), 'saved')).toBeNull();
    expect(holdIdOf(status({ reservation: null }), 'saved')).toBe('saved');
  });
});

describe('edge refusals', () => {
  it('reads the body code', () => {
    expect(bodyErrorCode({ error: 'PROVIDER_UNAVAILABLE', message: 'x' })).toBe('PROVIDER_UNAVAILABLE');
    expect(bodyErrorCode({ error: '' })).toBeNull();
    expect(bodyErrorCode('oops')).toBeNull();
  });

  it('makes the code the message, as a PostgREST refusal does', () => {
    const e = new DepositEdgeError('TOO_MANY_ATTEMPTS', 429);
    expect(e.message).toBe('TOO_MANY_ATTEMPTS');
    expect(e.status).toBe(429);
    expect(new DepositEdgeError(null, 500).message).toBe('edge function failed');
  });

  it('sorts a failed status fetch into not-found, connection, or other', () => {
    expect(fetchFailureOf(null)).toBeNull();
    expect(fetchFailureOf(new DepositEdgeError('PAYMENT_NOT_FOUND', 404))).toBe('not_found');
    // A mangled ref never reaches SQL: the edge function refuses it BAD_REQUEST.
    expect(fetchFailureOf(new DepositEdgeError('BAD_REQUEST', 400))).toBe('not_found');
    expect(fetchFailureOf(new DepositEdgeError('AUTH_REQUIRED', 401))).toBe('other');
    expect(fetchFailureOf(new TypeError('Network request failed'))).toBe('transport');
    expect(fetchFailureOf(new Error('boom'))).toBe('other');
  });
});

// ── screenFor ────────────────────────────────────────────────────────────────

describe('screenFor: every server status maps to exactly one screen', () => {
  /** The screen each status reaches with an ordinary payload (window open, hold live). */
  const EXPECTED: Record<PaymentStatus, PayScreenKind> = {
    created: 'checking',
    pending: 'checking',
    // The ordinary payload's reservation is still the hold; see the cases below.
    succeeded: 'stillChecking',
    failed: 'failed',
    expired: 'expired',
    refund_pending: 'refundPending',
    refunded: 'refunded',
    refund_failed: 'refundFailed',
  };

  it('covers the whole status list', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });

  it.each([...PAYMENT_STATUSES])('%s', (s) => {
    expect(kindOf(status({ status: s }))).toBe(EXPECTED[s]);
  });

  it.each([...PAYMENT_STATUSES])('%s: a failed REQUEST never changes the screen', (s) => {
    const answer = status({ status: s });
    const calm = screenFor({ status: answer, failure: null, nowMs: NOW });
    expect(screenFor({ status: answer, failure: 'transport', nowMs: NOW })).toEqual(calm);
    expect(screenFor({ status: answer, failure: 'other', nowMs: NOW })).toEqual(calm);
  });

  it('never shows failed for anything but a failed status', () => {
    for (const s of PAYMENT_STATUSES) {
      if (s === 'failed') continue;
      for (const failure of [null, 'transport', 'other'] as const) {
        expect(kindOf(status({ status: s }), failure)).not.toBe('failed');
      }
    }
  });
});

describe('screenFor: before the first answer', () => {
  it('spins while the first answer is on its way, or while the connection is down', () => {
    expect(kindOf(null)).toBe('loading');
    expect(kindOf(null, 'transport')).toBe('loading');
  });

  it('offers a retry when the status cannot be read for another reason', () => {
    expect(kindOf(null, 'other')).toBe('error');
  });

  it('says nothing is here for an unknown, foreign or mangled ref', () => {
    expect(kindOf(null, 'not_found')).toBe('notFound');
    // Even over an answer already on screen (a different account signed in).
    expect(kindOf(status(), 'not_found')).toBe('notFound');
  });
});

describe('screenFor: an open attempt', () => {
  it('is checking until the window ends, then still checking', () => {
    expect(kindOf(status({ status: 'pending' }), null, Date.parse(DEADLINE) - 1)).toBe('checking');
    expect(kindOf(status({ status: 'created' }), null, Date.parse(DEADLINE) + 1)).toBe('stillChecking');
  });

  it('never calls an open attempt failed, however late it runs', () => {
    expect(kindOf(status({ status: 'pending' }), 'transport', Date.parse(DEADLINE) + 3_600_000)).toBe(
      'stillChecking',
    );
  });

  it('keeps checking when the deadline is unknown', () => {
    expect(kindOf(status({ status: 'pending', deadlineAt: null }))).toBe('checking');
  });

  it('holds an unknown status at still checking rather than guessing', () => {
    expect(kindOf(status({ status: null }))).toBe('stillChecking');
  });
});

describe('screenFor: succeeded', () => {
  const booking = (s: string) =>
    status({
      status: 'succeeded',
      reservation: { ...status().reservation!, kind: 'booking', status: s },
    });

  it('hands a confirmed booking to the success screen', () => {
    expect(kindOf(booking('confirmed'))).toBe('confirmed');
  });

  it('shows a paid booking that has since been played or closed as paid', () => {
    expect(kindOf(booking('arrived'))).toBe('paid');
    expect(kindOf(booking('completed'))).toBe('paid');
    expect(kindOf(booking('no_show'))).toBe('paid');
  });

  it('reads a cancelled booking as the refund the trigger is about to start', () => {
    expect(kindOf(booking('cancelled'))).toBe('refundPending');
  });

  it('never claims success without a booking', () => {
    expect(kindOf(status({ status: 'succeeded' }))).toBe('stillChecking');
    expect(kindOf(status({ status: 'succeeded', reservation: null }))).toBe('stillChecking');
  });
});

describe('screenFor: failed', () => {
  const failed = (over: Partial<DepositStatus> = {}) =>
    screenFor({ status: status({ status: 'failed', ...over }), failure: null, nowMs: NOW });

  it('carries the bank reason through', () => {
    for (const code of ['declined', 'auth_failed', 'bank_error', 'cancelled'] as const) {
      const s = failed({ failureCode: code });
      expect(s.kind === 'failed' && s.reason).toBe(code);
    }
    const unknown = failed({ failureCode: null });
    expect(unknown.kind === 'failed' && unknown.reason).toBeNull();
  });

  it('offers a new attempt only on a live hold with attempts left', () => {
    expect(failed()).toMatchObject({ canRetry: true, outOfAttempts: false });
    expect(failed({ attemptsLeft: 0 })).toMatchObject({ canRetry: false, outOfAttempts: true });
    expect(failed({ holdLive: false })).toMatchObject({ canRetry: false, outOfAttempts: false, holdLive: false });
  });

  it('offers the desk only in optional mode, on a live hold', () => {
    expect(failed({ depositMode: 'optional' })).toMatchObject({ canPayAtDesk: true });
    expect(failed({ depositMode: 'required' })).toMatchObject({ canPayAtDesk: false });
    expect(failed({ depositMode: 'optional', holdLive: false })).toMatchObject({ canPayAtDesk: false });
  });
});

describe('screenFor: refunds', () => {
  it('says the slot could not be kept only when that is the reason', () => {
    for (const reason of ['slot_lost', 'venue_offline', 'amount_mismatch']) {
      expect(kindOf(status({ status: 'refund_pending', refundReason: reason }))).toBe('slotLost');
    }
    for (const reason of ['guest_cancel', 'staff_cancel', 'duplicate_success', 'staff_refund', null]) {
      expect(kindOf(status({ status: 'refund_pending', refundReason: reason }))).toBe('refundPending');
    }
  });
});

describe('isTerminalScreen / isPollingScreen', () => {
  it('keeps the pointer and the polling while the payment is open', () => {
    for (const k of ['loading', 'checking', 'stillChecking'] as const) {
      expect(isTerminalScreen(k)).toBe(false);
      expect(isPollingScreen(k)).toBe(true);
    }
    expect(isTerminalScreen('error')).toBe(false);
  });

  it('lets go of every settled answer', () => {
    for (const k of [
      'confirmed',
      'paid',
      'failed',
      'expired',
      'slotLost',
      'refundPending',
      'refunded',
      'refundFailed',
      'notFound',
    ] as const) {
      expect(isTerminalScreen(k)).toBe(true);
      expect(isPollingScreen(k)).toBe(false);
    }
  });
});

describe('failureTextKey', () => {
  it('has a sentence for every failure code and for none', () => {
    expect(failureTextKey('declined')).toBe('deposit.failedDeclined');
    expect(failureTextKey('auth_failed')).toBe('deposit.failedAuth');
    expect(failureTextKey('bank_error')).toBe('deposit.failedBank');
    expect(failureTextKey('cancelled')).toBe('deposit.failedCancelled');
    expect(failureTextKey(null)).toBe('deposit.failedUnknown');
  });
});

// ── Polling ─────────────────────────────────────────────────────────────────

describe('pollDelayMs (contract §4 cadence)', () => {
  const start = NOW;
  const deadline = start + 15 * 60_000;

  it('polls every 2 s for the first minute', () => {
    expect(FAST_POLL_MS).toBe(2_000);
    expect(pollDelayMs({ startedAtMs: start, nowMs: start, deadlineMs: deadline })).toBe(2_000);
    expect(pollDelayMs({ startedAtMs: start, nowMs: start + FAST_PHASE_MS - 1, deadlineMs: deadline })).toBe(2_000);
  });

  it('then every 5 s until a minute past the deadline', () => {
    expect(SLOW_POLL_MS).toBe(5_000);
    expect(pollDelayMs({ startedAtMs: start, nowMs: start + FAST_PHASE_MS, deadlineMs: deadline })).toBe(5_000);
    expect(
      pollDelayMs({ startedAtMs: start, nowMs: deadline + AFTER_DEADLINE_MS - 1, deadlineMs: deadline }),
    ).toBe(5_000);
  });

  it('then stops, and leaves the rest to push and the foreground refetch', () => {
    expect(
      pollDelayMs({ startedAtMs: start, nowMs: deadline + AFTER_DEADLINE_MS, deadlineMs: deadline }),
    ).toBe(false);
  });

  it('does not start polling a window that closed long ago', () => {
    const old = start - 30 * 60_000;
    expect(pollDelayMs({ startedAtMs: start, nowMs: start, deadlineMs: old })).toBe(false);
  });

  it('caps the polling when no deadline is known yet', () => {
    expect(pollDelayMs({ startedAtMs: start, nowMs: start + 1_000, deadlineMs: null })).toBe(2_000);
    expect(pollDelayMs({ startedAtMs: start, nowMs: start + NO_DEADLINE_CAP_MS - 1, deadlineMs: null })).toBe(
      5_000,
    );
    expect(pollDelayMs({ startedAtMs: start, nowMs: start + NO_DEADLINE_CAP_MS, deadlineMs: null })).toBe(false);
  });
});

describe('serverNowMs / secondsLeft', () => {
  it('moves the server clock on by the time since the answer arrived', () => {
    // The phone is five minutes slow; the answer arrived 10 s ago.
    const received = NOW - 5 * 60_000;
    const deviceNow = received + 10_000;
    expect(serverNowMs('2026-09-27T12:00:00Z', received, deviceNow)).toBe(NOW + 10_000);
  });

  it('falls back to the device clock without a usable answer', () => {
    expect(serverNowMs(null, NOW, NOW + 5)).toBe(NOW + 5);
    expect(serverNowMs('garbage', NOW, NOW + 5)).toBe(NOW + 5);
    expect(serverNowMs('2026-09-27T12:00:00Z', 0, NOW + 5)).toBe(NOW + 5);
  });

  it('counts whole seconds down to the deadline, never below zero', () => {
    expect(secondsLeft(DEADLINE, NOW)).toBe(600);
    expect(secondsLeft(DEADLINE, NOW + 599_500)).toBe(1);
    expect(secondsLeft(DEADLINE, NOW + 3_600_000)).toBe(0);
    expect(secondsLeft(null, NOW)).toBeNull();
  });
});

// ── My reservations ─────────────────────────────────────────────────────────

const row = (over: Partial<BookingRow>): BookingRow => ({
  id: 'id',
  court_id: 'c',
  kind: 'booking',
  status: 'confirmed',
  start_at: '2026-09-28T18:00:00Z',
  end_at: '2026-09-28T19:30:00Z',
  price_iqd: 40000,
  ...over,
});

describe('openPaymentRef', () => {
  it('points a live hold with an open payment at that payment', () => {
    for (const s of ['created', 'pending']) {
      expect(
        openPaymentRef(row({ kind: 'hold', status: 'pending', payment_status: s, payment_ref: 'r-1' })),
      ).toBe('r-1');
    }
  });

  it('has nothing to finish anywhere else', () => {
    expect(openPaymentRef(row({ kind: 'hold', status: 'pending', payment_status: 'failed', payment_ref: 'r' }))).toBeNull();
    expect(openPaymentRef(row({ kind: 'hold', status: 'pending' }))).toBeNull();
    expect(openPaymentRef(row({ payment_status: 'pending', payment_ref: 'r' }))).toBeNull();
    expect(openPaymentRef(row({ kind: 'hold', status: 'pending', payment_status: 'pending' }))).toBeNull();
  });
});

describe('onlinePaymentOf', () => {
  it('pairs the deposit with the server’s own remainder', () => {
    expect(onlinePaymentOf(row({ online_paid_iqd: 20000, court_remaining_iqd: 25000 }))).toEqual({
      paid: 20000,
      rest: 25000,
    });
    expect(onlinePaymentOf(row({ online_paid_iqd: 40000, court_remaining_iqd: 0 }))).toEqual({
      paid: 40000,
      rest: 0,
    });
  });

  it('is nothing without a deposit, or with one refunded away', () => {
    expect(onlinePaymentOf(row({}))).toBeNull();
    expect(onlinePaymentOf(row({ online_paid_iqd: 0 }))).toBeNull();
    expect(onlinePaymentOf(row({ online_paid_iqd: null }))).toBeNull();
  });

  it('falls back to price minus deposit only when the remainder is missing', () => {
    expect(onlinePaymentOf(row({ online_paid_iqd: 15000, price_iqd: 40000 }))).toEqual({ paid: 15000, rest: 25000 });
  });
});

describe('refund lines', () => {
  it('names each refund state, and nothing else', () => {
    expect(refundNoteKey(row({ payment_status: 'refund_pending' }))).toBe('deposit.refundPendingNote');
    expect(refundNoteKey(row({ payment_status: 'refunded' }))).toBe('deposit.refundedNote');
    expect(refundNoteKey(row({ payment_status: 'refund_failed' }))).toBe('deposit.refundFailedNote');
    expect(refundNoteKey(row({ payment_status: 'succeeded' }))).toBeNull();
    expect(refundDetailKey(row({ payment_status: 'refund_pending' }))).toBe('deposit.refundPendingDetail');
    expect(refundDetailKey(row({ payment_status: 'refunded' }))).toBe('deposit.refundedDetail');
    expect(refundDetailKey(row({ payment_status: 'refund_failed' }))).toBe('deposit.refundFailedDetail');
    expect(refundDetailKey(row({}))).toBeNull();
  });
});

// ── Open-match tickets (docs/design/open-matches/guest.md §4.10.4) ──────────

/** A ticket purchase as deposit-status sends it (money.md §5.5): no hold, no reservation. */
function ticket(over: Partial<DepositStatus> = {}): DepositStatus {
  return status({
    purpose: 'ticket',
    ticketCount: 2,
    unitPriceIqd: 10000,
    amountIqd: 20000,
    priceIqd: 20000,
    restIqd: 0,
    depositMode: 'off',
    holdLive: false,
    reservation: null,
    ...over,
  });
}

describe('parseDepositStatus: purpose', () => {
  it('reads a ticket purchase with its count and unit price', () => {
    const s = parseDepositStatus({
      request_id: 'r-2',
      purpose: 'ticket',
      status: 'succeeded',
      amount_iqd: 20000,
      ticket_count: 2,
      unit_price_iqd: '10000',
      deposit_mode: null,
      attempts_left: 2,
      hold_live: false,
      reservation: null,
    });
    expect(s.purpose).toBe('ticket');
    expect(s.ticketCount).toBe(2);
    expect(s.unitPriceIqd).toBe(10000);
    // deposit_mode null on a ticket (conc-D15): the phone reads it as off.
    expect(s.depositMode).toBe('off');
    expect(isTicketPayment(s)).toBe(true);
  });

  it('reads a row with no purpose, or one it does not know, as a deposit', () => {
    expect(parseDepositStatus({ request_id: 'r-3', status: 'pending' }).purpose).toBe('deposit');
    expect(parseDepositStatus({ request_id: 'r-3', purpose: 'gift', status: 'pending' }).purpose).toBe(
      'deposit',
    );
    expect(parseDepositStatus({ request_id: 'r-3', status: 'pending' }).ticketCount).toBeNull();
    expect(isTicketPayment(status())).toBe(false);
    expect(isTicketPayment(null)).toBe(false);
  });
});

describe('screenFor: a ticket purchase', () => {
  /** Every status, with a ticket's payload (window open, attempts left). */
  const EXPECTED: Record<PaymentStatus, PayScreenKind> = {
    created: 'checking',
    pending: 'checking',
    // Decided before the deposit switch: a ticket has no booking to wait for.
    succeeded: 'ticketsBought',
    failed: 'failed',
    expired: 'expired',
    refund_pending: 'refundPending',
    refunded: 'refunded',
    refund_failed: 'refundFailed',
  };

  it.each([...PAYMENT_STATUSES])('%s', (s) => {
    expect(kindOf(ticket({ status: s }))).toBe(EXPECTED[s]);
  });

  it('carries the count the purchase was for', () => {
    expect(screenFor({ status: ticket({ status: 'succeeded' }), failure: null, nowMs: NOW })).toEqual({
      kind: 'ticketsBought',
      count: 2,
    });
  });

  it('is still checking past the window, like a deposit', () => {
    expect(kindOf(ticket({ status: 'pending' }), null, Date.parse(DEADLINE) + 1)).toBe('stillChecking');
  });

  it('offers a new attempt while attempts are left, and never the desk', () => {
    expect(
      screenFor({ status: ticket({ status: 'failed', failureCode: 'declined' }), failure: null, nowMs: NOW }),
    ).toEqual({
      kind: 'failed',
      reason: 'declined',
      holdLive: false,
      canRetry: true,
      canPayAtDesk: false,
      outOfAttempts: false,
    });
    expect(
      screenFor({ status: ticket({ status: 'failed', attemptsLeft: 0 }), failure: null, nowMs: NOW }),
    ).toMatchObject({ kind: 'failed', canRetry: false, outOfAttempts: true });
  });

  it('never reads a refund as a lost slot: amount_mismatch is the one a purchase can show', () => {
    expect(kindOf(ticket({ status: 'refund_pending', refundReason: 'amount_mismatch' }))).toBe('refundPending');
    expect(kindOf(status({ status: 'refund_pending', refundReason: 'amount_mismatch' }))).toBe('slotLost');
  });

  it('lets go of the pointer once the tickets are in', () => {
    expect(isTerminalScreen('ticketsBought')).toBe(true);
    expect(isPollingScreen('ticketsBought')).toBe(false);
  });
});

describe('ticket-begin refusals', () => {
  it('carries the body detail on the error', () => {
    expect(bodyErrorDetail({ error: 'TICKET_COUNT_INVALID', detail: 'wallet_limit' })).toBe('wallet_limit');
    expect(bodyErrorDetail({ error: 'X', detail: ' ' })).toBeNull();
    expect(bodyErrorDetail(null)).toBeNull();
    expect(new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'wallet_limit').detail).toBe('wallet_limit');
    expect(new DepositEdgeError('X', 400).detail).toBeNull();
  });

  it('sends each refusal where §4.10.1 says', () => {
    expect(ticketBeginRefusalOf(new DepositEdgeError('PHONE_REQUIRED', 400))).toBe('phone');
    expect(ticketBeginRefusalOf(new DepositEdgeError('TERMS_REQUIRED', 403))).toBe('terms');
    expect(ticketBeginRefusalOf(new DepositEdgeError('TOO_MANY_ATTEMPTS', 429))).toBe('tooManyAttempts');
    expect(ticketBeginRefusalOf(new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'wallet_limit'))).toBe(
      'walletLimit',
    );
    expect(ticketBeginRefusalOf(new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'p_count'))).toBe('inline');
    expect(ticketBeginRefusalOf(new DepositEdgeError('MATCHES_OFF', 409))).toBe('inline');
    expect(ticketBeginRefusalOf(new TypeError('Network request failed'))).toBe('inline');
  });
});

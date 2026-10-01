/**
 * Open-match refusals on the phone (docs/design/open-matches/guest.md §4.22,
 * §4.13, §4.10.3). PURE.
 *
 * The codes themselves map through `CODE_TO_KEY` (features/booking/errors.ts,
 * the only literal block `check-error-codes` reads). This file adds what that
 * map cannot do alone:
 *  - the DETAIL a few refusals carry (PostgREST `details`, or the edge body's
 *    `detail`): MATCH_TOO_LATE's minutes, TICKET_COUNT_INVALID's
 *    `wallet_limit`, NEED_TICKETS' `{needed, available, buy}`;
 *  - which way a refusal sends the guest (buy tickets, the gender ask, the
 *    profile, the terms, back to the Book sheet), and whether the start's
 *    idempotency key survives it (§4.23).
 */
import { localParts } from '@touch/core';
import { countPhrase, formatTime, isolate, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode, rpcErrorDetail } from '../booking/errors';
import { errorMessageOf, isTransportError } from '../../lib/network';

type T = (key: MessageKey, params?: TParams) => string;

/** The known code of a refusal (PostgREST message or edge body), or null. */
export function errorCodeOf(err: unknown): string | null {
  return rpcErrorCode(errorMessageOf(err));
}

export interface NeedTickets {
  /** Tickets the action needs in all. */
  needed: number;
  /** Tickets the wallet has now. */
  available: number;
  /** Tickets to buy: the shortfall. */
  buy: number;
}

/** NEED_TICKETS' detail (JSON text `{"needed","available","buy"}`), or null. */
export function parseNeedTickets(detail: string | null): NeedTickets | null {
  if (!detail) return null;
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
    const needed = n(o.needed);
    const available = n(o.available);
    const buy = n(o.buy);
    if (needed === null || available === null || buy === null) return null;
    return { needed, available, buy };
  } catch {
    return null;
  }
}

/** PRICE_CHANGED's detail (JSON text `{"quoted_iqd","current_iqd"}`), or null. */
export function parsePriceChanged(detail: string | null): { quotedIqd: number; currentIqd: number } | null {
  if (!detail) return null;
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    const q = Number(o.quoted_iqd);
    const c = Number(o.current_iqd);
    return Number.isInteger(q) && Number.isInteger(c) ? { quotedIqd: q, currentIqd: c } : null;
  } catch {
    return null;
  }
}

/**
 * The earliest start MATCH_TOO_LATE allows (§4.22): now + the detail's
 * minutes, rounded up to the next half hour on the branch's clock.
 */
export function earliestStartAfter(minutes: number, now: Date, tz: string): Date {
  const at = now.getTime() + minutes * 60_000;
  const parts = localParts(new Date(at), tz);
  const msInto = ((parts.minutesOfDay % 30) * 60 + parts.seconds) * 1000 + (((at % 1000) + 1000) % 1000);
  return msInto === 0 ? new Date(at) : new Date(at + 30 * 60_000 - msInto);
}

export interface MatchErrorContext {
  locale: Locale;
  /** The branch's timezone, for MATCH_TOO_LATE's earliest time. */
  timezone?: string | null;
  /** The clock to count from (the server's, when the screen has it). */
  now?: Date;
  /** The branch's phone: DEGRADED_LOCKOUT then reads `degraded.bookingRefused`. */
  phone?: string | null;
}

/**
 * The line a refusal reads (§4.22), detail first: MATCH_TOO_LATE with its
 * minutes reads the earliest start, TICKET_COUNT_INVALID `wallet_limit` the
 * wallet cap, NEED_TICKETS how many more; DEGRADED_LOCKOUT the branch's phone
 * when the screen knows it. Everything else is `mapErrorToKey`.
 */
export function matchErrorText(err: unknown, t: T, ctx: MatchErrorContext): string {
  const code = errorCodeOf(err);
  const detail = rpcErrorDetail(err);
  if (code === 'MATCH_TOO_LATE' && detail && /^\d+$/.test(detail)) {
    const tz = ctx.timezone ?? 'Asia/Baghdad';
    const at = earliestStartAfter(Number(detail), ctx.now ?? new Date(), tz);
    return t('matches.errors.tooLateAt', { time: formatTime(at, ctx.locale, tz) });
  }
  if (code === 'TICKET_COUNT_INVALID' && detail === 'wallet_limit') {
    return t('matches.errors.walletLimit');
  }
  if (code === 'NEED_TICKETS') {
    const need = parseNeedTickets(detail);
    if (need && need.buy > 0) {
      return t('matches.errors.needTicketsCount', {
        tickets: countPhrase('matches.count.tickets', need.buy, ctx.locale),
      });
    }
  }
  if (isDegradedRefusal(errorMessageOf(err)) && ctx.phone) {
    return t('degraded.bookingRefused', { phone: isolate(ctx.phone) });
  }
  return t(mapErrorToKey(err));
}

/**
 * The copy of a refusal the server REPORTED rather than raised: `me.refusal`
 * on the match screen, `refusal` on the quote (§4.13 item 2, §4.14).
 */
export function refusalKey(code: string): MessageKey {
  return mapErrorToKey({ message: code });
}

// ── Where a refusal sends the guest ─────────────────────────────────────────

/**
 * What `match-new` does with a `match_start` refusal (§4.13 table):
 *  tickets       buy, then continue (`kind: 'start'`, §4.10.3)
 *  gender        the inline gender ask
 *  phone         /complete-profile?returnTo=back
 *  terms         /accept-terms, or `matches.errors.updateApp` on a build whose terms are current
 *  priceChanged  refetch the quote; "The price is now {price}…"
 *  tooLate       toast with the earliest start, then back to the Book sheet
 *  backToSheet   toast, `requestBookingSheet()`, back
 *  degraded      `degraded.bookingRefused` with the branch phone
 *  inline        the refusal's copy on the form
 */
export type StartRefusal =
  | 'tickets'
  | 'gender'
  | 'phone'
  | 'terms'
  | 'priceChanged'
  | 'tooLate'
  | 'backToSheet'
  | 'degraded'
  | 'inline';

const BACK_TO_SHEET = new Set([
  'SLOT_TAKEN',
  'MATCH_SLOT_FULL',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
  'SLOT_IN_PAST',
  'BEYOND_HORIZON',
  'NO_RATE',
  'INVALID_DURATION',
]);

export function startRefusalOf(code: string | null): StartRefusal {
  switch (code) {
    case 'NEED_TICKETS':
      return 'tickets';
    case 'GENDER_REQUIRED':
      return 'gender';
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'PRICE_CHANGED':
      return 'priceChanged';
    case 'MATCH_TOO_LATE':
      return 'tooLate';
    case 'DEGRADED_LOCKOUT':
      return 'degraded';
    default:
      return code !== null && BACK_TO_SHEET.has(code) ? 'backToSheet' : 'inline';
  }
}

/** The refusals the guest fixes and retries: the start's key survives them (§4.23). */
const KEEPS_START_KEY: ReadonlySet<StartRefusal> = new Set<StartRefusal>([
  'tickets',
  'gender',
  'phone',
  'terms',
  'priceChanged',
]);

/**
 * Whether a failed `match_start` keeps its idempotency key: yes for the
 * refusals the guest fixes and retries, and for a request that never came
 * back (the retry must carry the same key, or a start that committed would be
 * made twice); no for any other refusal, which ends the intent.
 */
export function keepsStartKey(err: unknown): boolean {
  if (isTransportError(err)) return true;
  return KEEPS_START_KEY.has(startRefusalOf(errorCodeOf(err)));
}

/** What the match screen does with a `match_join` / `match_request` refusal (§4.14, §4.10.3). */
export type JoinRefusal = 'tickets' | 'gender' | 'phone' | 'terms' | 'degraded' | 'inline';

export function joinRefusalOf(code: string | null): JoinRefusal {
  switch (code) {
    case 'NEED_TICKETS':
      return 'tickets';
    case 'GENDER_REQUIRED':
      return 'gender';
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'DEGRADED_LOCKOUT':
      return 'degraded';
    default:
      return 'inline';
  }
}

/**
 * How many tickets to buy after a NEED_TICKETS (§4.10.3): the detail's `buy`,
 * or, when the detail is absent, `seats − available` from a fresh wallet;
 * clamped to one purchase (1..3).
 */
export function ticketsToBuy(err: unknown, fallback: { seats: number; available: number }): number {
  const need = parseNeedTickets(rpcErrorDetail(err));
  const raw = need ? need.buy : fallback.seats - fallback.available;
  return Math.min(3, Math.max(1, raw));
}

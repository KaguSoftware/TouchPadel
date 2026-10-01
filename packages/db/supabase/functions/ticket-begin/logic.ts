/**
 * ticket-begin, the pure half (no Deno, no npm: specifiers): the body, the
 * refusal map and the flow against ports, so tests/ticket-begin.test.ts runs
 * it under vitest. index.ts wires the ports to the database and the gateway.
 *
 * Contract: docs/design/open-matches/money.md §5.3 (build contracts §1.6,
 * §1.10). POST {count, locale} → 200 {request_id, form_url, amount_iqd,
 * ticket_count, unit_price_iqd, deadline_at, status: 'pending', reused}; a
 * refusal is {error, detail?}, where detail is the SQL refusal's own (the phone
 * reads TICKET_COUNT_INVALID detail wallet_limit through DepositEdgeError.detail).
 */
import { isRetryablePgError, type PgError } from '../_shared/http.ts';

export interface TicketBeginRequest {
  /** An integer; its range (1..3) is the SQL's to judge. */
  count: number;
  locale: 'en' | 'ar';
}

export type Parsed = { ok: true; value: TicketBeginRequest } | { ok: false; message: string };

export function parseTicketBegin(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'a JSON object is required' };
  const b = body as { count?: unknown; locale?: unknown };
  if (typeof b.count !== 'number' || !Number.isInteger(b.count)) return { ok: false, message: 'count must be an integer' };
  // 'en' or anything else Arabic, as deposit-begin.
  return { ok: true, value: { count: b.count, locale: b.locale === 'en' ? 'en' : 'ar' } };
}

/** The SQL refusals of app.ticket_payment_prepare and their HTTP status (money.md §5.3). */
export const TICKET_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  TICKET_COUNT_INVALID: 400,
  PHONE_REQUIRED: 400,
  INVALID_ARGUMENT: 400,
  AUTH_REQUIRED: 401,
  ACCOUNT_REQUIRED: 403,
  TERMS_REQUIRED: 403,
  MATCH_BANNED: 403,
  MATCHES_OFF: 409,
  TOO_MANY_ATTEMPTS: 429,
};

export interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** A database error as the phone reads it: a known refusal keeps its detail. */
export function refusalFor(err: PgError): Answer {
  if (isRetryablePgError(err)) return { status: 503, body: { error: 'RETRY_LATER' } };
  const code = err.message ?? '';
  const status = TICKET_REFUSAL_STATUS[code];
  if (status === undefined) return { status: 500, body: { error: 'INTERNAL' } };
  const detail = typeof err.details === 'string' && err.details.trim() !== '' ? err.details : null;
  return { status, body: detail === null ? { error: code } : { error: code, detail } };
}

/** What app.ticket_payment_prepare returns (the fields this function reads). */
export interface PreparedTicket {
  request_id: string;
  status: string;
  provider: string;
  sandbox: boolean;
  amount_iqd: number;
  ticket_count: number;
  unit_price_iqd: number;
  deadline_at: string;
  form_url: string | null;
  provider_payment_id: string | null;
  locale: 'en' | 'ar';
  reused: boolean;
  guest_phone: string | null;
}

export type Prepared = { data: PreparedTicket; error?: undefined } | { error: PgError; data?: undefined };
export type Gateway = { formUrl: string } | { error: 'PROVIDER_UNAVAILABLE' | 'RETRY_LATER' | 'INTERNAL' };

export interface TicketBeginPorts {
  /** app.ticket_payment_prepare for the caller. */
  prepare(): Promise<Prepared>;
  /** Ask the gateway once where a stale attempt stands and apply it (never throws). */
  settleStale(row: PreparedTicket): Promise<void>;
  /** _shared/deposits.ts createAtGateway. */
  gateway(row: PreparedTicket): Promise<Gateway>;
  now(): number;
}

function ok(row: PreparedTicket, formUrl: string): Answer {
  return {
    status: 200,
    body: {
      request_id: row.request_id,
      form_url: formUrl,
      amount_iqd: row.amount_iqd,
      ticket_count: row.ticket_count,
      unit_price_iqd: row.unit_price_iqd,
      deadline_at: row.deadline_at,
      status: 'pending',
      reused: row.reused,
    },
  };
}

/**
 * The flow after the caller is known and a provider is configured:
 *   1. prepare; a refusal answers with its code (and detail);
 *   2. a reused attempt whose window has passed is asked about once and
 *      prepared again; still the same stale attempt → 503 RETRY_LATER (the
 *      reconciler closes it within a minute);
 *   3. a pending attempt with a page answers with that page; anything else is
 *      created at the gateway (a created attempt that never got there, too).
 */
export async function beginTickets(ports: TicketBeginPorts): Promise<Answer> {
  const first = await ports.prepare();
  if (first.error) return refusalFor(first.error);
  let row = first.data;

  const stale = (r: PreparedTicket) => r.reused && new Date(r.deadline_at).getTime() <= ports.now();
  if (stale(row)) {
    await ports.settleStale(row);
    const again = await ports.prepare();
    if (again.error) return refusalFor(again.error);
    if (again.data.request_id === row.request_id && stale(again.data)) {
      return { status: 503, body: { error: 'RETRY_LATER' } };
    }
    row = again.data;
  }

  if (row.status === 'pending' && row.form_url) return ok(row, row.form_url);

  const created = await ports.gateway(row);
  if ('error' in created) {
    return { status: created.error === 'INTERNAL' ? 500 : 503, body: { error: created.error } };
  }
  return ok(row, created.formUrl);
}

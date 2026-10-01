/**
 * lesson-begin, the pure half (no Deno, no npm: specifiers): the body, the
 * refusal map and the flow against ports, so tests/lesson-begin.test.ts runs
 * it under vitest. index.ts wires the ports to the database and the gateway.
 *
 * Contract: docs/design/coaching/money.md §6.7 (build contracts §1.11, R3,
 * R50, R67; guest.md §4.3, X33). POST {enrolment_id, locale} → 200
 * {request_id, form_url, amount_iqd, deadline_at, status: 'pending', reused,
 * enrolment_id} (COACHING_SHAPES['lesson-begin']); a refusal is
 * {error, detail?}, where detail is the SQL refusal's own (the phone picks
 * LESSON_NOT_PAYABLE's sentence from it: booked, cancelled, expired, desk,
 * free).
 */
import { isRetryablePgError, isUuid, type PgError } from '../_shared/http.ts';

export interface LessonBeginRequest {
  /** The held enrolment to pay for (lesson_enrolments.id). */
  enrolment_id: string;
  locale: 'en' | 'ar';
}

export type Parsed = { ok: true; value: LessonBeginRequest } | { ok: false; message: string };

export function parseLessonBegin(body: unknown): Parsed {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { ok: false, message: 'a JSON object is required' };
  const b = body as { enrolment_id?: unknown; locale?: unknown };
  if (!isUuid(b.enrolment_id)) return { ok: false, message: 'enrolment_id must be a uuid' };
  // 'en' or anything else Arabic, as deposit-begin and ticket-begin.
  return {
    ok: true,
    value: { enrolment_id: b.enrolment_id, locale: b.locale === 'en' ? 'en' : 'ar' },
  };
}

/**
 * The SQL refusals of app.lesson_payment_prepare and their HTTP status
 * (money.md §6.7). DEGRADED_LOCKOUT is 503, as deposit-begin maps it: the
 * venue is trading offline, try later or pay at the desk.
 */
export const LESSON_REFUSAL_STATUS: Readonly<Record<string, number>> = {
  INVALID_ARGUMENT: 400,
  PHONE_REQUIRED: 400,
  AUTH_REQUIRED: 401,
  ACCOUNT_REQUIRED: 403,
  TERMS_REQUIRED: 403,
  ENROLMENT_NOT_FOUND: 404,
  LESSON_NOT_PAYABLE: 409,
  ONLINE_PAYMENT_OFF: 409,
  COACHING_OFF: 409,
  TOO_MANY_ATTEMPTS: 429,
  DEGRADED_LOCKOUT: 503,
};

export interface Answer {
  status: number;
  body: Record<string, unknown>;
}

/** A database error as the phone reads it: a known refusal keeps its detail. */
export function refusalFor(err: PgError): Answer {
  if (isRetryablePgError(err)) return { status: 503, body: { error: 'RETRY_LATER' } };
  const code = err.message ?? '';
  const status = LESSON_REFUSAL_STATUS[code];
  if (status === undefined) return { status: 500, body: { error: 'INTERNAL' } };
  const detail = typeof err.details === 'string' && err.details.trim() !== '' ? err.details : null;
  return { status, body: detail === null ? { error: code } : { error: code, detail } };
}

/** What app.lesson_payment_prepare returns (the fields this function reads). */
export interface PreparedLesson {
  request_id: string;
  status: string;
  provider: string;
  sandbox: boolean;
  amount_iqd: number;
  deadline_at: string;
  form_url: string | null;
  provider_payment_id: string | null;
  locale: 'en' | 'ar';
  reused: boolean;
  enrolment_id: string;
  lesson_id: string | null;
  course_id: string | null;
  guest_phone: string | null;
}

export type Prepared =
  { data: PreparedLesson; error?: undefined } | { error: PgError; data?: undefined };
export type Gateway =
  { formUrl: string } | { error: 'PROVIDER_UNAVAILABLE' | 'RETRY_LATER' | 'INTERNAL' };

export interface LessonBeginPorts {
  /** app.lesson_payment_prepare for the caller and the enrolment. */
  prepare(): Promise<Prepared>;
  /** Ask the gateway once where a stale attempt stands and apply it (never throws). */
  settleStale(row: PreparedLesson): Promise<void>;
  /** _shared/deposits.ts createAtGateway. */
  gateway(row: PreparedLesson): Promise<Gateway>;
  now(): number;
}

function ok(row: PreparedLesson, formUrl: string): Answer {
  return {
    status: 200,
    body: {
      request_id: row.request_id,
      form_url: formUrl,
      amount_iqd: row.amount_iqd,
      deadline_at: row.deadline_at,
      status: 'pending',
      reused: row.reused,
      enrolment_id: row.enrolment_id,
    },
  };
}

/**
 * The flow after the caller is known and a provider is configured (ticket-begin's):
 *   1. prepare; a refusal answers with its code (and detail);
 *   2. a reused attempt whose window has passed is asked about once and
 *      prepared again; still the same stale attempt → 503 RETRY_LATER (the
 *      reconciler closes it within a minute);
 *   3. a pending attempt with a page answers with that page; anything else is
 *      created at the gateway (a created attempt that never got there, too).
 */
export async function beginLesson(ports: LessonBeginPorts): Promise<Answer> {
  const first = await ports.prepare();
  if (first.error) return refusalFor(first.error);
  let row = first.data;

  const stale = (r: PreparedLesson) => r.reused && new Date(r.deadline_at).getTime() <= ports.now();
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

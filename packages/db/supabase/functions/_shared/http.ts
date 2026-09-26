/**
 * HTTP + error-mapping helpers shared by edge functions.
 *
 * The RPCs (packages/db/supabase/migrations) raise business errors as errcode
 * P0001 with a MESSAGE CODE ('SLOT_TAKEN', 'FORBIDDEN', ...) — PostgREST hands
 * these back as { code: 'P0001', message: '<CODE>', details, hint }. Raw
 * constraint slips (an RPC that didn't map 23P01 itself) surface with the
 * SQLSTATE as `code`. Both shapes are mapped here so till/replay clients see
 * one stable contract.
 */

// Record<string,string>, not HeadersInit: this module is also typechecked by the
// Node test suite (tests/replay-transport.test.ts), which has no DOM lib.
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export interface PgError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

export interface MappedError {
  status: number;
  /** Stable machine code, e.g. 'SLOT_TAKEN', 'FORBIDDEN', 'EXCLUSION_CONFLICT'. */
  code: string;
  message: string;
  details?: string | null;
}

/** Exclusion-constraint conflict — replayed booking collides with a live one. */
export function isExclusionConflict(err: PgError): boolean {
  return err.code === '23P01' || err.message === 'SLOT_TAKEN';
}

const MESSAGE_CODE_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  PIN_INVALID: 403,
  PIN_LOCKED: 423,
  SLOT_TAKEN: 409,
  HOLD_EXPIRED: 409,
  DEGRADED_LOCKOUT: 503,
  COURT_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
};

/**
 * Transient failures: the write was NOT judged, the server merely could not run
 * it right now. A queued till mutation that hits one of these must be retried
 * later, never recorded as a terminal outcome — recording it as a conflict is
 * exactly how a settle or a discount got lost (PHASE-2 criticals, C1).
 *
 *   40001 serialization_failure      40P01 deadlock_detected
 *   55P03 lock_not_available         57014 query_canceled (statement_timeout)
 *   53300 too_many_connections       53400 configuration_limit_exceeded
 *   57P01/02/03 admin/crash shutdown, cannot_connect_now
 *   08xxx connection exceptions      PGRST000/001 PostgREST could not reach or pool the database
 */
const RETRYABLE_SQLSTATES = new Set([
  '40001', '40P01', '55P03', '57014', '53300', '53400', '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007', 'PGRST000', 'PGRST001',
]);

export function isRetryablePgError(err: PgError): boolean {
  const code = (err.code ?? '').toUpperCase();
  return RETRYABLE_SQLSTATES.has(code);
}

export function mapPgError(err: PgError): MappedError {
  const message = err.message ?? 'unknown database error';

  if (isExclusionConflict(err)) {
    return { status: 409, code: 'SLOT_TAKEN', message, details: err.details };
  }
  // Transient: 503 so a queue client releases the row and tries again later.
  if (isRetryablePgError(err)) {
    return { status: 503, code: 'RETRY_LATER', message, details: err.details };
  }
  // P0001 = our RAISE EXCEPTION convention; the message IS the machine code.
  if (err.code === 'P0001') {
    return {
      status: MESSAGE_CODE_STATUS[message] ?? 400,
      code: message,
      message,
      details: err.details,
    };
  }
  if (err.code === '23505') {
    return { status: 409, code: 'DUPLICATE', message, details: err.details };
  }
  // PGRST202: no such function — a mutation type whose RPC has not landed yet.
  if (err.code === 'PGRST202') {
    return { status: 501, code: 'RPC_NOT_DEPLOYED', message, details: err.details };
  }
  return { status: 500, code: err.code ?? 'INTERNAL', message, details: err.details };
}

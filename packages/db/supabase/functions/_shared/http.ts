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

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
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

export function mapPgError(err: PgError): MappedError {
  const message = err.message ?? 'unknown database error';

  if (isExclusionConflict(err)) {
    return { status: 409, code: 'SLOT_TAKEN', message, details: err.details };
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

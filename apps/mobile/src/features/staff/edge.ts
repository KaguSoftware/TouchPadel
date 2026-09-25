/**
 * Edge-function failures on the staff phone (build-contracts-2026-09-23 §3).
 *
 * `protocol-action` (launch) and `staff-admin` (the owner's add-staff form)
 * answer a refusal with a JSON body `{error: '<CODE>', message}`: SQL codes pass
 * through `mapPgError` with their status, and the functions' own codes
 * (BAD_REQUEST, EMAIL_IN_USE, …) arrive the same way. The body's `error` is
 * read through `rpcErrorCode`, so an edge refusal lands on the same catalog
 * string as the RPC refusal it came from. `BAD_REQUEST` is the functions' own
 * "the form sent something malformed" and reads as `errors.validation`.
 *
 * PURE (vitest): api.ts does the call and turns a failure into StaffEdgeError.
 */
import type { MessageKey } from '@touch/i18n';
import { mapErrorToKey, rpcErrorCode } from '../booking/errors';

export type StaffEdgeFunction = 'protocol-action' | 'staff-admin';

/** A refused edge call. `code` is the body's `error`, when it had one. */
export class StaffEdgeError extends Error {
  readonly code: string | null;
  readonly status: number | null;

  constructor(code: string | null, status: number | null, message?: string) {
    // The message IS the code when there is one, as a PostgREST refusal's is,
    // so every reader of errorMessageOf (telemetry, the retry policy) sees it.
    super(code ?? message ?? 'edge function failed');
    this.name = 'StaffEdgeError';
    this.code = code;
    this.status = status;
  }
}

/** The `error` of an edge function's JSON body, or null. */
export function edgeErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && 'error' in body) {
    const code = (body as { error: unknown }).error;
    if (typeof code === 'string' && code.trim()) return code.trim();
  }
  return null;
}

/**
 * The catalog key for any failure a staff page can meet: an edge refusal by its
 * body code, anything else (an RPC refusal, a dropped connection) through the
 * app's one mapper.
 */
export function mapStaffError(err: unknown): MessageKey {
  if (err instanceof StaffEdgeError) {
    if (err.code === 'BAD_REQUEST') return 'errors.validation';
    const code = rpcErrorCode(err.code);
    // The function answered, so this is never a connection problem.
    return code ? mapErrorToKey(new Error(code)) : 'errors.generic';
  }
  return mapErrorToKey(err);
}

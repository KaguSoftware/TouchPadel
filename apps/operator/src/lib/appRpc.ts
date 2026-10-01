/**
 * app-schema RPC wrapper — mirrors packages/db/tests/helpers.ts `appRpc`:
 * functions live in schema `app`, called via supabase.schema('app').rpc(...).
 *
 * Server errors are raised as `raise exception 'CODE' using errcode='P0001'`,
 * so PostgREST surfaces the CODE in `error.message`. AppRpcError carries that
 * code for the i18n mapper (lib/errors.ts).
 */
import type { Database } from '@touch/db';
import { PIN_GATED_RPC_SET } from '@touch/core/schemas/mutations';
import { supabase } from './supabase';

export type AppFunctionName = keyof Database['app']['Functions'] & string;

export class AppRpcError extends Error {
  /** Upper-snake server code ('SLOT_TAKEN', 'PIN_INVALID', …) or 'UNKNOWN'. */
  readonly code: string;
  readonly hint?: string;
  readonly details?: string;
  /**
   * PostgREST's `code`: the SQLSTATE ('P0001' for a raised code, '23505' for a
   * unique violation, …). A native Postgres error maps by it (SQLSTATE_KEYS in
   * @touch/i18n) when `code` is UNKNOWN.
   */
  readonly sqlState?: string;

  constructor(code: string, message: string, hint?: string, details?: string, sqlState?: string) {
    super(message);
    this.name = 'AppRpcError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.sqlState = sqlState;
  }
}

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

interface PgError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string | null;
}

/**
 * PostgREST's "function not in the schema cache": this build calls an RPC the
 * server it talks to does not have yet (a station updated before its
 * migration reached hosted). Renderer-minted as RPC_MISSING, like PIN_OWN, so
 * a feature that meets it can render nothing rather than "needs a connection"
 * (open matches, docs/design/open-matches/operator.md §5.5).
 */
const PGRST_FUNCTION_MISSING = 'PGRST202';

export function toAppRpcError(error: PgError): AppRpcError {
  const message = error.message ?? 'unknown error';
  const sqlState = error.code ?? undefined;
  if (error.code === PGRST_FUNCTION_MISSING) {
    return new AppRpcError('RPC_MISSING', message, error.hint ?? undefined, error.details ?? undefined, sqlState);
  }
  const code = CODE_RE.test(message) ? message : 'UNKNOWN';
  return new AppRpcError(code, message, error.hint ?? undefined, error.details ?? undefined, sqlState);
}

/** True when the server has no such RPC (PGRST202): the feature is not there yet, not offline. */
export function isRpcMissing(error: unknown): boolean {
  return error instanceof AppRpcError && error.code === 'RPC_MISSING';
}

async function callAppRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // Loose cast: the generated arg unions fight optional-parameter call sites;
  // the SQL migrations remain the source of truth for names/args.
  const { data, error } = await (
    supabase.schema('app').rpc as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: PgError | null }>
  )(fn, args);
  if (error) throw toAppRpcError(error);
  return data as T;
}

/** Call an app-schema RPC; resolves to the function result or throws AppRpcError. */
export async function appRpc<T = unknown>(
  fn: AppFunctionName,
  args: Record<string, unknown> = {},
): Promise<T> {
  // 0115 (S3): a manager PIN is proved to verify_manager_pin FIRST — its own
  // round trip, so the attempt row commits whatever the money RPC does next and
  // the 5-failure lockout engages. The RPC then consumes the single-use grant
  // that verification minted; without it the RPC refuses PIN_GRANT_REQUIRED
  // whatever the PIN, so nothing here is worth guessing at. PIN_INVALID and
  // PIN_LOCKED surface from this first call exactly as they used to.
  if (PIN_GATED_RPC_SET.has(fn) && typeof args.p_pin === 'string') {
    const authorizer = await callAppRpc<string | null>('verify_manager_pin', {
      p_pin: args.p_pin,
      p_device_id: typeof args.p_device_id === 'string' ? args.p_device_id : null,
    });
    // verify_manager_pin RETURNS null for a wrong PIN (it raises only PIN_LOCKED
    // and FORBIDDEN) — the attempt is already recorded; raise the code here so
    // the prompt says "incorrect PIN", not "authorisation expired".
    if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
  }
  return callAppRpc<T>(fn, args);
}

// The `appRpcUntyped` escape hatch and its lib/rpcNames.ts name map are gone.
// They existed because the cafe-rebuild RPCs predated a `pnpm db:types` run —
// every one of those sixteen names has been in packages/db/src/types.gen.ts
// since, so the hatch was doing nothing but opting one call site out of the
// type checking the rest of the app relies on.

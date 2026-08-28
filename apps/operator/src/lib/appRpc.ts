/**
 * app-schema RPC wrapper — mirrors packages/db/tests/helpers.ts `appRpc`:
 * functions live in schema `app`, called via supabase.schema('app').rpc(...).
 *
 * Server errors are raised as `raise exception 'CODE' using errcode='P0001'`,
 * so PostgREST surfaces the CODE in `error.message`. AppRpcError carries that
 * code for the i18n mapper (lib/errors.ts).
 */
import type { Database } from '@touch/db';
import { supabase } from './supabase';

export type AppFunctionName = keyof Database['app']['Functions'] & string;

export class AppRpcError extends Error {
  /** Upper-snake server code ('SLOT_TAKEN', 'PIN_INVALID', …) or 'UNKNOWN'. */
  readonly code: string;
  readonly hint?: string;
  readonly details?: string;

  constructor(code: string, message: string, hint?: string, details?: string) {
    super(message);
    this.name = 'AppRpcError';
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

const CODE_RE = /^[A-Z][A-Z0-9_]*$/;

interface PgError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string | null;
}

export function toAppRpcError(error: PgError): AppRpcError {
  const message = error.message ?? 'unknown error';
  const code = CODE_RE.test(message) ? message : 'UNKNOWN';
  return new AppRpcError(code, message, error.hint ?? undefined, error.details ?? undefined);
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
  return callAppRpc<T>(fn, args);
}

// The `appRpcUntyped` escape hatch and its lib/rpcNames.ts name map are gone.
// They existed because the cafe-rebuild RPCs predated a `pnpm db:types` run —
// every one of those sixteen names has been in packages/db/src/types.gen.ts
// since, so the hatch was doing nothing but opting one call site out of the
// type checking the rest of the app relies on.

/**
 * app-schema RPC wrapper — mirrors packages/db/tests/helpers.ts `appRpc`:
 * functions live in schema `app`, called via supabase.schema('app').rpc(...).
 *
 * Server errors are raised as `raise exception 'CODE' using errcode='P0001'`,
 * so PostgREST surfaces the CODE in `error.message`. AppRpcError carries that
 * code for the i18n mapper (lib/errors.ts).
 *
 * Every call has a deadline (15 s; 60 s for the report and analytics RPCs; a
 * call site may pass its own or none). A call that misses it throws
 * RequestTimeoutError — a TypeError, so lib/errors.ts shows it as a connection
 * problem, and retryable, so lib/queryPolicy.ts tries a query once more.
 */
import type { Database } from '@touch/db';
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  LONG_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
  normalizeTimeout,
  startDeadline,
} from '@touch/core';
import { PIN_GATED_RPC_SET, QUEUEABLE_RPC_SET, type QueueableRpc } from '@touch/core/schemas/mutations';
import { supabase } from './supabase';
import { isStationOffline, isTransportFailure, setStationReachable } from './connectivity';

export type AppFunctionName = keyof Database['app']['Functions'] & string;

export class AppRpcError extends Error {
  /** Upper-snake server code ('SLOT_TAKEN', 'PIN_INVALID', …) or 'UNKNOWN'. */
  readonly code: string;
  readonly hint?: string;
  readonly details?: string;
  /**
   * PostgREST's `code`: the SQLSTATE ('P0001' for a raised code, '23505' for a
   * unique violation, '40P01' for a deadlock, 'PGRST202' for a missing
   * function). Kept under two names for its two readers: `sqlState` is what the
   * error catalogue maps (SQLSTATE_KEYS in @touch/i18n) when `code` is UNKNOWN,
   * `pgCode` is what isRetryableError (@touch/core) reads.
   */
  readonly sqlState?: string;
  readonly pgCode?: string;
  /** The HTTP status of the answer, when one came back. */
  readonly status?: number;

  constructor(code: string, message: string, hint?: string, details?: string, sqlState?: string, status?: number) {
    super(message);
    this.name = 'AppRpcError';
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.sqlState = sqlState;
    this.pgCode = sqlState;
    this.status = status;
  }
}

/**
 * The report, analytics and panel RPCs (the same family lib/venueScope.ts
 * widens for "All branches") run deliberately heavy queries.
 */
const LONG_RPC = /^(report_|reports_|analytics_|panel_|audit_log_page)/;

/** The deadline an RPC gets when its call site names none. */
export function rpcTimeoutMs(fn: string): number {
  return LONG_RPC.test(fn) ? LONG_REQUEST_TIMEOUT_MS : DEFAULT_REQUEST_TIMEOUT_MS;
}

export interface AppRpcOptions {
  /** Override the deadline (ms); null for none. Default: rpcTimeoutMs(fn). */
  timeoutMs?: number | null;
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

export function toAppRpcError(error: PgError, status?: number): AppRpcError {
  const message = error.message ?? 'unknown error';
  const sqlState = error.code || undefined;
  const httpStatus = status && status > 0 ? status : undefined;
  if (error.code === PGRST_FUNCTION_MISSING) {
    return new AppRpcError('RPC_MISSING', message, error.hint ?? undefined, error.details ?? undefined, sqlState, httpStatus);
  }
  const code = CODE_RE.test(message) ? message : 'UNKNOWN';
  return new AppRpcError(code, message, error.hint ?? undefined, error.details ?? undefined, sqlState, httpStatus);
}

/**
 * F-23 (0395): an allowlisted save made while the station is offline was
 * durably queued, not lost. Thrown (not returned) so an editor keeps its
 * draft and shows the line; `localId` is the queue row.
 */
export class SavedOfflineError extends AppRpcError {
  readonly localId: string;
  constructor(localId: string) {
    super('SAVED_OFFLINE', 'SAVED_OFFLINE');
    this.name = 'SavedOfflineError';
    this.localId = localId;
  }
}

/** True when a save was queued offline (SAVED_OFFLINE): a soft success, not a failure. */
export function isSavedOffline(error: unknown): error is SavedOfflineError {
  return error instanceof AppRpcError && error.code === 'SAVED_OFFLINE';
}

/** True when the server has no such RPC (PGRST202): the feature is not there yet, not offline. */
export function isRpcMissing(error: unknown): boolean {
  return error instanceof AppRpcError && error.code === 'RPC_MISSING';
}

type RpcAnswer = { data: unknown; error: PgError | null; status?: number };
/** The builder supabase-js returns: awaitable, and abortable when it is the real one. */
type RpcCall = PromiseLike<RpcAnswer> & { abortSignal?: (signal: AbortSignal) => PromiseLike<RpcAnswer> };

async function callAppRpc<T>(fn: string, args: Record<string, unknown>, timeoutMs: number | null): Promise<T> {
  // Loose cast: the generated arg unions fight optional-parameter call sites;
  // the SQL migrations remain the source of truth for names/args.
  const call = (supabase.schema('app').rpc as (fn: string, args: Record<string, unknown>) => RpcCall)(fn, args);
  // The call carries its own signal, so venueFetch leaves its deadline to us.
  const deadline = timeoutMs === null ? null : startDeadline(timeoutMs);
  let answer: RpcAnswer;
  try {
    answer = await (deadline && typeof call.abortSignal === 'function' ? call.abortSignal(deadline.signal) : call);
  } catch (error) {
    if (deadline?.timedOut()) throw new RequestTimeoutError(timeoutMs ?? 0, fn);
    if (isTransportFailure(error)) setStationReachable(false);
    throw error;
  } finally {
    deadline?.clear();
  }
  const { data, error, status } = answer;
  if (error) {
    // postgrest-js answers an aborted fetch with an `AbortError: …` error object.
    if (deadline?.timedOut()) throw new RequestTimeoutError(timeoutMs ?? 0, fn);
    const mapped = toAppRpcError(error, status);
    // No answer at all (postgrest-js wraps the fetch TypeError): the station is
    // offline now, whatever the last heartbeat said (F-31). Any answer: online.
    setStationReachable(!isTransportFailure(mapped));
    throw mapped;
  }
  setStationReachable(true);
  return data as T;
}

function inElectron(): boolean {
  const w = (globalThis as { window?: { touch?: unknown } }).window;
  return !!w && !!w.touch;
}

/** What queues one allowlisted call: lib/queuedRpc.ts registers it at load (main.tsx imports it). */
export type OfflineQueue = (
  fn: QueueableRpc,
  args: Record<string, unknown>,
) => Promise<{ queued: boolean; localId: string; result: unknown }>;
let offlineQueue: OfflineQueue | null = null;

/**
 * Set by lib/queuedRpc.ts. Registered rather than imported: queuedRpc -> mutate
 * -> appRpc would be an import cycle, and this file is also compiled by
 * packages/db's tests (no DOM), which must not pull the queue in.
 */
export function setOfflineQueue(q: OfflineQueue | null): void {
  offlineQueue = q;
}

/**
 * F-23: queue an allowlisted save instead of losing it. Resolves with the
 * RPC's answer when the queue reached the server inside mutate()'s wait after
 * all; otherwise throws SavedOfflineError. A manager PIN on a PIN-gated one is
 * checked against the station's cache first (mutate, F-05).
 */
async function queueOffline<T>(fn: QueueableRpc, args: Record<string, unknown>): Promise<T> {
  if (!offlineQueue) throw new TypeError('Failed to fetch');
  const outcome = await offlineQueue(fn, args);
  if (outcome.queued) throw new SavedOfflineError(outcome.localId);
  return outcome.result as T;
}

/**
 * May this failure be queued instead? Only a call that never reached the
 * server: a fetch that could not connect. A timeout is NOT one — the request
 * may have landed and its answer been lost, and queuing it would make a
 * second, unclaimed copy.
 */
function queueableFailure(error: unknown): boolean {
  return !(error instanceof RequestTimeoutError) && isTransportFailure(error);
}

/** Call an app-schema RPC; resolves to the function result or throws AppRpcError. */
export async function appRpc<T = unknown>(
  fn: AppFunctionName,
  args: Record<string, unknown> = {},
  opts: AppRpcOptions = {},
): Promise<T> {
  const timeoutMs = normalizeTimeout(opts.timeoutMs, rpcTimeoutMs(fn));
  // F-23 (0395): offline, an allowlisted save goes to the durable queue rather
  // than failing with "No connection" and taking the change with it.
  const queueable = inElectron() && offlineQueue !== null && QUEUEABLE_RPC_SET.has(fn);
  if (queueable && isStationOffline()) return queueOffline<T>(fn as QueueableRpc, args);
  try {
    return await callWithPin<T>(fn, args, timeoutMs);
  } catch (error) {
    if (queueable && queueableFailure(error)) {
      setStationReachable(false);
      return queueOffline<T>(fn as QueueableRpc, args);
    }
    throw error;
  }
}

async function callWithPin<T>(fn: string, args: Record<string, unknown>, timeoutMs: number | null): Promise<T> {
  // 0115 (S3): a manager PIN is proved to verify_manager_pin FIRST — its own
  // round trip, so the attempt row commits whatever the money RPC does next and
  // the 5-failure lockout engages. The RPC then consumes the single-use grant
  // that verification minted; without it the RPC refuses PIN_GRANT_REQUIRED
  // whatever the PIN, so nothing here is worth guessing at. PIN_INVALID and
  // PIN_LOCKED surface from this first call exactly as they used to.
  if (PIN_GATED_RPC_SET.has(fn) && typeof args.p_pin === 'string') {
    const authorizer = await callAppRpc<string | null>(
      'verify_manager_pin',
      { p_pin: args.p_pin, p_device_id: typeof args.p_device_id === 'string' ? args.p_device_id : null },
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    // verify_manager_pin RETURNS null for a wrong PIN (it raises only PIN_LOCKED
    // and FORBIDDEN) — the attempt is already recorded; raise the code here so
    // the prompt says "incorrect PIN", not "authorisation expired".
    if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
  }
  return callAppRpc<T>(fn, args, timeoutMs);
}

// The `appRpcUntyped` escape hatch and its lib/rpcNames.ts name map are gone.
// They existed because the cafe-rebuild RPCs predated a `pnpm db:types` run —
// every one of those sixteen names has been in packages/db/src/types.gen.ts
// since, so the hatch was doing nothing but opting one call site out of the
// type checking the rest of the app relies on.

import { describe, expect, it } from 'vitest';
import {
  RETRYABLE_SQLSTATES,
  isAbortFailure,
  isRetryableError,
  isTimeoutFailure,
  isTransportFailure,
} from './retry';
import { RequestTimeoutError } from './timeout';

/** The operator's AppRpcError shape (apps/operator/src/lib/appRpc.ts), duck-typed. */
class FakeAppRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly pgCode?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AppRpcError';
  }
}

/** The operator's EdgeError shape (apps/operator/src/lib/edge.ts). */
class FakeEdgeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`edge failed with ${status}`);
    this.name = 'EdgeError';
  }
}

describe('isRetryableError — retries what the server never judged', () => {
  it('retries the platforms fetch failures and their postgrest-js wrappers', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableError(new TypeError('Network request failed'))).toBe(true);
    expect(isRetryableError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isRetryableError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isRetryableError({ message: 'FetchError: connect ECONNREFUSED 127.0.0.1:54321', code: '' })).toBe(true);
    expect(isRetryableError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe(true);
    expect(isRetryableError({ name: 'FunctionsFetchError', message: 'Failed to send a request' })).toBe(true);
    expect(isRetryableError({ name: 'FunctionsRelayError', message: 'Relay Error' })).toBe(true);
    // The operator's appRpc wraps a fetch failure as UNKNOWN with the wrapper as message.
    expect(isRetryableError(new FakeAppRpcError('UNKNOWN', 'TypeError: Failed to fetch'))).toBe(true);
  });

  it('retries timeouts and aborts', () => {
    expect(isRetryableError(new RequestTimeoutError(15_000, 'hold_slot'))).toBe(true);
    expect(isRetryableError({ message: 'TimeoutError: Request timed out after 15000 ms', code: '' })).toBe(true);
    expect(isRetryableError({ name: 'AbortError', message: 'Aborted' })).toBe(true);
    expect(isRetryableError({ message: 'AbortError: signal is aborted without reason', code: '' })).toBe(true);
  });

  it('retries the transient SQLSTATEs, as a raw code or the AppRpcError pgCode', () => {
    expect(isRetryableError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
    expect(isRetryableError({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(true);
    expect(isRetryableError({ code: 'PGRST001', message: 'Database client error' })).toBe(true);
    expect(isRetryableError(new FakeAppRpcError('UNKNOWN', 'deadlock detected', '40P01'))).toBe(true);
    for (const state of RETRYABLE_SQLSTATES) expect(isRetryableError({ code: state, message: 'x' })).toBe(true);
  });

  it('retries 5xx and 429 from an edge call, unless the 5xx names a decision', () => {
    expect(isRetryableError(new FakeEdgeError(503, 'UPSTREAM'))).toBe(true);
    expect(isRetryableError(new FakeEdgeError(502, 'UPSTREAM'))).toBe(true);
    expect(isRetryableError(new FakeEdgeError(429, 'RATE_LIMITED'))).toBe(true);
    expect(isRetryableError(new FakeEdgeError(503, 'NOT_CONFIGURED'))).toBe(false);
    // Mobile's edge errors: a status, and a code only when the body named one.
    expect(isRetryableError({ name: 'DepositEdgeError', message: 'edge function failed', code: null, status: 502 })).toBe(true);
    expect(isRetryableError({ name: 'DepositEdgeError', message: 'PROVIDER_UNAVAILABLE', code: 'PROVIDER_UNAVAILABLE', status: 503 })).toBe(false);
    // functions-js FunctionsHttpError carries the Response as `context`.
    expect(isRetryableError({ name: 'FunctionsHttpError', message: 'non-2xx', context: { status: 504 } })).toBe(true);
    expect(isRetryableError({ name: 'FunctionsHttpError', message: 'non-2xx', context: { status: 400 } })).toBe(false);
  });

  it('retries a gateway body that carries no code', () => {
    expect(isRetryableError({ message: '<html><title>502 Bad Gateway</title></html>' })).toBe(true);
    expect(isRetryableError({ message: 'upstream connect error or disconnect/reset before headers' })).toBe(true);
  });

  it('never retries a raised business code', () => {
    expect(isRetryableError({ code: 'P0001', message: 'FORBIDDEN' })).toBe(false);
    expect(isRetryableError({ code: 'P0001', message: 'NOT_CANCELLABLE' })).toBe(false);
    expect(isRetryableError({ code: 'P0001', message: 'DEGRADED_LOCKOUT' })).toBe(false);
    expect(isRetryableError(new FakeAppRpcError('FORBIDDEN', 'FORBIDDEN', 'P0001', 400))).toBe(false);
    expect(isRetryableError(new FakeAppRpcError('SLOT_TAKEN', 'SLOT_TAKEN'))).toBe(false);
    expect(isRetryableError(new Error('SLOT_TAKEN'))).toBe(false);
    expect(isRetryableError({ message: 'STEP_NOT_OPEN' })).toBe(false);
  });

  it('never retries a 4xx or a deterministic SQLSTATE', () => {
    expect(isRetryableError(new FakeEdgeError(403, 'FORBIDDEN'))).toBe(false);
    expect(isRetryableError(new FakeEdgeError(401, 'AUTH_REQUIRED'))).toBe(false);
    expect(isRetryableError(new FakeEdgeError(400, 'UNKNOWN'))).toBe(false);
    expect(isRetryableError({ code: '42501', message: 'permission denied for table profiles' })).toBe(false);
    expect(isRetryableError({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isRetryableError({ code: 'PGRST202', message: 'Could not find the function' })).toBe(false);
    expect(isRetryableError(new FakeAppRpcError('RPC_MISSING', 'Could not find the function', 'PGRST202', 404))).toBe(false);
    expect(isRetryableError({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400, code: 'invalid_credentials' })).toBe(false);
  });

  it('does not retry what it cannot place', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
    expect(isRetryableError('')).toBe(false);
    expect(isRetryableError(new Error('boom'))).toBe(false);
    expect(isRetryableError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isRetryableError({ message: 'Could not find the function app.deposit_quote(p_hold_id)' })).toBe(false);
    // A raw statement-timeout message without its SQLSTATE is not proof of anything.
    expect(isRetryableError(new Error('canceling statement due to statement timeout'))).toBe(false);
  });
});

describe('the classifiers behind it', () => {
  it('isTransportFailure keeps "no connection" for real transport failures', () => {
    expect(isTransportFailure(new RequestTimeoutError(15_000))).toBe(true);
    expect(isTransportFailure({ name: 'AbortError', message: 'Aborted' })).toBe(false);
    expect(isTransportFailure({ status: 0, message: 'weird payload' })).toBe(false);
    expect(isTransportFailure(new Error('current transaction is aborted'))).toBe(false);
  });

  it('isAbortFailure and isTimeoutFailure read the error and the postgrest-js wrapper alike', () => {
    expect(isAbortFailure({ name: 'AbortError' })).toBe(true);
    expect(isAbortFailure({ code: 'ABORT_ERR', message: 'x' })).toBe(true);
    expect(isAbortFailure({ message: 'AbortError: The user aborted a request.' })).toBe(true);
    expect(isAbortFailure(new Error('aborted transaction'))).toBe(false);
    expect(isTimeoutFailure(new RequestTimeoutError(1))).toBe(true);
    expect(isTimeoutFailure({ message: 'TimeoutError: signal timed out' })).toBe(true);
    expect(isTimeoutFailure(new Error('statement timeout'))).toBe(false);
  });
});

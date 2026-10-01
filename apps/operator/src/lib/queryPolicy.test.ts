import { describe, expect, it } from 'vitest';
import { RequestTimeoutError } from '@touch/core';
import { AppRpcError, toAppRpcError } from './appRpc';
import { EdgeError } from './edge';
import { MUTATION_RETRY, QUERY_RETRY_LIMIT, queryRetry } from './queryPolicy';

/**
 * The QueryClient's retry policy (main.tsx). It used to be `retry: 1` on every
 * query, which retried FORBIDDEN as readily as a dropped connection.
 */
describe('queryRetry', () => {
  it('retries once what the server never judged', () => {
    const transient = [
      new TypeError('Failed to fetch'),
      toAppRpcError({ message: 'TypeError: Failed to fetch', code: '' }, 0),
      new RequestTimeoutError(15_000, 'customer_record'),
      toAppRpcError({ message: 'deadlock detected', code: '40P01' }, 500),
      toAppRpcError({ message: 'canceling statement due to statement timeout', code: '57014' }, 500),
      new EdgeError(502, 'UPSTREAM', 'bad gateway'),
      new EdgeError(429, 'RATE_LIMITED', 'slow down'),
    ];
    for (const e of transient) {
      expect(queryRetry(0, e), String(e)).toBe(true);
      expect(queryRetry(QUERY_RETRY_LIMIT, e), String(e)).toBe(false);
    }
  });

  it('never retries a refusal, a 4xx or a missing function', () => {
    const final = [
      toAppRpcError({ message: 'FORBIDDEN', code: 'P0001' }, 400),
      toAppRpcError({ message: 'NOT_CANCELLABLE', code: 'P0001' }, 400),
      toAppRpcError({ message: 'Could not find the function app.x', code: 'PGRST202' }, 404),
      toAppRpcError({ message: 'permission denied for table tabs', code: '42501' }, 403),
      new AppRpcError('PIN_INVALID', 'PIN_INVALID'),
      new EdgeError(403, 'FORBIDDEN', 'no'),
      new EdgeError(503, 'NOT_CONFIGURED', 'off'),
      new Error('bad payload'),
    ];
    for (const e of final) expect(queryRetry(0, e), String(e)).toBe(false);
  });

  it('mutations never retry by themselves', () => {
    expect(MUTATION_RETRY).toBe(false);
  });
});

describe('toAppRpcError keeps what the retry policy reads', () => {
  it('carries the SQLSTATE and the HTTP status', () => {
    const e = toAppRpcError({ message: 'deadlock detected', code: '40P01' }, 500);
    expect(e.code).toBe('UNKNOWN');
    expect(e.pgCode).toBe('40P01');
    expect(e.status).toBe(500);
    // postgrest-js reports a failed fetch as status 0: no answer, no status.
    expect(toAppRpcError({ message: 'TypeError: Failed to fetch', code: '' }, 0).status).toBeUndefined();
    expect(toAppRpcError({ message: 'TypeError: Failed to fetch', code: '' }, 0).pgCode).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_REQUEST_TIMEOUT_MS, RequestTimeoutError } from '@touch/core';
import { EDGE_REQUEST_TIMEOUT_MS, requestTimeoutMs } from '../requestTimeout';
import { isTransportError } from '../network';
import { mapErrorToKey } from '../../features/booking/errors';

const base = 'https://p.supabase.co';

describe('requestTimeoutMs — every Supabase request has a deadline', () => {
  it('15 s for REST, RPC and auth; 30 s for an edge function; none for storage', () => {
    expect(requestTimeoutMs(`${base}/rest/v1/rpc/hold_slot`)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(`${base}/rest/v1/courts?select=*`)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(`${base}/auth/v1/token?grant_type=refresh_token`)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(`${base}/functions/v1/deposit-begin`)).toBe(EDGE_REQUEST_TIMEOUT_MS);
    expect(requestTimeoutMs(`${base}/storage/v1/object/staff-media/a.jpg`)).toBeNull();
  });

  it('a missed deadline reads as "no connection", thrown or wrapped by postgrest-js', () => {
    const thrown = new RequestTimeoutError(15_000, '/rest/v1/rpc/hold_slot');
    expect(isTransportError(thrown)).toBe(true);
    expect(mapErrorToKey(thrown)).toBe('errors.network');
    const wrapped = { message: `TimeoutError: ${thrown.message}`, code: '' };
    expect(isTransportError(wrapped)).toBe(true);
    expect(mapErrorToKey(wrapped)).toBe('errors.network');
  });
});

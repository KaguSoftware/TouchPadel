import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTimeoutError } from '@touch/core';
import {
  isStationOffline,
  isTransportFailure,
  onReachabilityChange,
  resetConnectivityForTests,
  setStationReachable,
} from './connectivity';
import { AppRpcError, toAppRpcError } from './appRpc';

afterEach(() => resetConnectivityForTests());

describe('isTransportFailure (F-31)', () => {
  it('reads fetch failures as the connection, however they are wrapped', () => {
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(new RequestTimeoutError(15_000, 'x'))).toBe(true);
    // postgrest-js catches the rejection and answers an error object with no SQLSTATE.
    expect(isTransportFailure(toAppRpcError({ message: 'TypeError: Failed to fetch', code: '' }))).toBe(true);
    expect(isTransportFailure({ name: 'FunctionsFetchError', message: 'Failed to send a request' })).toBe(true);
  });

  it('never reads a server answer as the connection', () => {
    expect(isTransportFailure(new AppRpcError('PIN_INVALID', 'PIN_INVALID'))).toBe(false);
    expect(isTransportFailure(toAppRpcError({ message: 'Failed to fetch', code: '23505' }))).toBe(false);
    expect(isTransportFailure(new AppRpcError('UNKNOWN', 'boom', undefined, undefined, undefined, 500))).toBe(false);
    expect(isTransportFailure(new Error('something else'))).toBe(false);
  });
});

describe('station reachability', () => {
  it('starts online, follows the last witness and tells listeners only on a change', () => {
    const seen = vi.fn();
    const off = onReachabilityChange(seen);
    expect(isStationOffline()).toBe(false);
    setStationReachable(false);
    setStationReachable(false);
    expect(isStationOffline()).toBe(true);
    setStationReachable(true);
    expect(seen.mock.calls).toEqual([[false], [true]]);
    off();
  });

  it("the browser's own offline flag wins", () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isStationOffline()).toBe(true);
    vi.unstubAllGlobals();
    expect(isStationOffline()).toBe(false);
  });
});

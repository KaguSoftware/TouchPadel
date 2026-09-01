import { describe, expect, it } from 'vitest';
import { errorMessageOf, isTransportError } from '../network';
import { mapErrorToKey } from '../../features/booking/errors';

describe('isTransportError — what "no connection" is allowed to mean', () => {
  it('recognises the platforms fetch failures', () => {
    expect(isTransportError(new TypeError('Network request failed'))).toBe(true);
    expect(isTransportError(new Error('fetch failed'))).toBe(true);
    expect(isTransportError(new Error('Failed to fetch'))).toBe(true);
    expect(isTransportError(new Error('The request timed out.'))).toBe(true);
    expect(isTransportError(new Error('The network connection was lost.'))).toBe(true);
    expect(isTransportError(new Error('Unable to resolve host "x.supabase.co"'))).toBe(true);
    expect(isTransportError({ message: 'connect ECONNREFUSED 127.0.0.1:54321' })).toBe(true);
  });

  it('recognises the wrappers postgrest-js / gotrue-js put around a thrown fetch', () => {
    // postgrest-js: `${fetchError.name}: ${fetchError.message}`
    expect(isTransportError({ message: 'TypeError: Network request failed', code: '' })).toBe(true);
    // gotrue-js: AuthRetryableFetchError with status 0
    expect(isTransportError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe(true);
    expect(isTransportError({ name: 'AbortError', message: 'Aborted' })).toBe(true);
  });

  it('does NOT label server-side failures as connectivity', () => {
    // The old /network|fetch|timeout|abort/i test matched every one of these.
    expect(isTransportError(new Error('canceling statement due to statement timeout'))).toBe(false);
    expect(isTransportError({ message: 'permission denied for table profiles', code: '42501' })).toBe(false);
    expect(
      isTransportError({ message: 'Could not find the function app.hold_slot in the schema cache' }),
    ).toBe(false);
    expect(isTransportError(new Error('current transaction is aborted'))).toBe(false);
    expect(isTransportError(new Error('SLOT_TAKEN'))).toBe(false);
    expect(
      isTransportError({ message: 'JSON object requested, multiple (or no) rows returned; fetch again' }),
    ).toBe(false);
    expect(isTransportError(null)).toBe(false);
    expect(isTransportError('')).toBe(false);
  });

  it('feeds mapErrorToKey: RPC codes first, transport second, generic last', () => {
    expect(mapErrorToKey(new TypeError('Network request failed'))).toBe('errors.network');
    expect(mapErrorToKey({ message: 'TypeError: Network request failed' })).toBe('errors.network');
    expect(mapErrorToKey({ message: 'permission denied for table reservations' })).toBe('errors.generic');
    expect(mapErrorToKey(new Error('statement timeout'))).toBe('errors.generic');
    expect(mapErrorToKey(new Error('SLOT_TAKEN'))).toBe('booking.slotTaken');
  });

  it('errorMessageOf tolerates every shape it is handed', () => {
    expect(errorMessageOf('plain')).toBe('plain');
    expect(errorMessageOf(new Error('boom'))).toBe('boom');
    expect(errorMessageOf({ message: 42 })).toBeNull();
    expect(errorMessageOf(undefined)).toBeNull();
  });
});

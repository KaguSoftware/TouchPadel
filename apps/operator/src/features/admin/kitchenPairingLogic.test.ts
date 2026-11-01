import { describe, expect, it } from 'vitest';
import { errorToMessageKey } from '../../lib/errors';
import { AppRpcError } from '../../lib/appRpc';
import { readPairingAnswer } from './kitchenPairingLogic';

describe('readPairingAnswer (F-31)', () => {
  it('reads a PIN the cache does not know as Incorrect PIN, not a generic error', () => {
    const out = readPairingAnswer({ ok: false, error: 'pin not recognised' });
    expect(out.kind).toBe('error');
    const error = (out as { error: Error }).error;
    expect(error).toBeInstanceOf(AppRpcError);
    expect((error as AppRpcError).code).toBe('PIN_INVALID');
    expect(errorToMessageKey(error)).toBe(errorToMessageKey(new AppRpcError('PIN_INVALID', 'PIN_INVALID')));
    expect(errorToMessageKey(error)).not.toBe(errorToMessageKey(new Error('boom')));
  });

  it('reads main refusing the PIN on format the same way', () => {
    const out = readPairingAnswer({ error: 'pin must be 4-12 digits' });
    expect(out.kind === 'error' && (out.error as AppRpcError).code).toBe('PIN_INVALID');
  });

  it('passes the code through, and names the other refusals', () => {
    expect(readPairingAnswer({ ok: true, stationId: 'TILL-01', host: '10.0.0.2', port: 7443, code: 'ABCDEFGHJK' })).toEqual({
      kind: 'info',
      host: '10.0.0.2',
      port: 7443,
      code: 'ABCDEFGHJK',
    });
    expect(readPairingAnswer({ ok: false, error: 'not-a-till' })).toEqual({ kind: 'refusal', refusal: 'not-a-till' });
    expect(readPairingAnswer({ ok: false, error: 'custom-psk' })).toEqual({ kind: 'refusal', refusal: 'custom-psk' });
  });
});

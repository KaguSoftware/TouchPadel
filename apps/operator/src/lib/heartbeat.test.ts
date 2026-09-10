import { describe, expect, it } from 'vitest';
import { devSafeIdentity } from './heartbeat';

/**
 * The tap on the degraded-mode footgun: a development session must never be
 * counted as the venue's till by app.is_degraded(), which tests BOTH the
 * is_till flag AND a `TILL%` device id — so a dev identity has to fail both.
 */
describe('devSafeIdentity', () => {
  it('files a dev session as a plain DEV- device, never a till', () => {
    expect(devSafeIdentity('DEV1', true, true)).toEqual({ deviceId: 'DEV-DEV1', isTill: false });
    // The dev Electron shell set up as TILL1 (2026-09-05): the name would still
    // match the TILL% back-compat, so it is prefixed away too.
    expect(devSafeIdentity('TILL1', true, true)).toEqual({ deviceId: 'DEV-TILL1', isTill: false });
  });

  it('leaves a packaged build untouched', () => {
    expect(devSafeIdentity('TILL1', true, false)).toEqual({ deviceId: 'TILL1', isTill: true });
    expect(devSafeIdentity('DESK-01', false, false)).toEqual({
      deviceId: 'DESK-01',
      isTill: false,
    });
  });

  it('neither half of the is_degraded till test matches a dev identity', () => {
    const { deviceId, isTill } = devSafeIdentity('TILL1', true, true);
    expect(isTill).toBe(false);
    expect(deviceId.startsWith('TILL')).toBe(false);
  });
});

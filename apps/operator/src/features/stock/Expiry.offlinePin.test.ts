import { describe, expect, it } from 'vitest';
import src from './Expiry.tsx?raw';

// F-05: the expired-batch write-off asks the station's PIN cache before its
// online-only, PIN-gated call, so offline a wrong PIN is refused on the spot.
describe('Expiry write-off PIN (F-05)', () => {
  it('checks the manager PIN offline before write_off_expired', () => {
    const check = src.indexOf('await assertManagerPinOffline(pin)');
    const call = src.indexOf("appRpc('write_off_expired'");
    expect(check).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(check);
  });
});

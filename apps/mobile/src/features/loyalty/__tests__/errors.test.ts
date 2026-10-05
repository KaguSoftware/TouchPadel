import { describe, expect, it } from 'vitest';
import { phoneTakenKey } from '../errors';

/** PHONE_TAKEN (build contracts L-3) reads the catalogue's line through the shared resolver. */
describe('phoneTakenKey', () => {
  it('maps the profile trigger refusal', () => {
    expect(phoneTakenKey({ message: 'PHONE_TAKEN', code: 'P0001' })).toBe('op.errors.PHONE_TAKEN');
    expect(phoneTakenKey(new Error('PHONE_TAKEN'))).toBe('op.errors.PHONE_TAKEN');
  });

  it('leaves every other error to the screen', () => {
    expect(phoneTakenKey({ message: 'FORBIDDEN', code: 'P0001' })).toBeNull();
    expect(
      phoneTakenKey({ code: 'otp_expired', message: 'Token has expired or is invalid' }),
    ).toBeNull();
    expect(phoneTakenKey(undefined)).toBeNull();
  });
});

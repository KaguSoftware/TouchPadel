import { describe, expect, it } from 'vitest';
import {
  GUEST_EMAIL_DOMAIN,
  OTP_LENGTH,
  hasRealEmail,
  mapOtpError,
  parsePhoneOtpFlag,
  sanitizeOtpInput,
  validatePhoneInput,
} from '../phoneOtp';

/**
 * Phone OTP is a DORMANT scaffold: these pin the three things that must hold
 * before anyone flips it on — the flag is strict, the number gate is strict,
 * and every refusal the hook or GoTrue can send has copy.
 */

describe('parsePhoneOtpFlag', () => {
  it('enables on the literal "on" only', () => {
    expect(parsePhoneOtpFlag('on')).toBe(true);
    expect(parsePhoneOtpFlag(' ON ')).toBe(true);
  });

  it('treats everything else — including truthy-looking values — as off', () => {
    for (const v of ['off', 'true', '1', 'yes', '', undefined, null]) {
      expect(parsePhoneOtpFlag(v)).toBe(false);
    }
  });
});

describe('validatePhoneInput (any country, since 2026-09-15)', () => {
  it('joins the picked country and the national digits into E.164, trunk zero dropped', () => {
    expect(validatePhoneInput('IQ', '0770 123 4567')).toEqual({ e164: '+9647701234567', error: null });
    expect(validatePhoneInput('IQ', '7701234567')).toEqual({ e164: '+9647701234567', error: null });
    expect(validatePhoneInput('GB', '07700 900123')).toEqual({ e164: '+447700900123', error: null });
    expect(validatePhoneInput('AE', '50 123 4567')).toEqual({ e164: '+971501234567', error: null });
    expect(validatePhoneInput('US', '(415) 555-2671')).toEqual({ e164: '+14155552671', error: null });
    expect(validatePhoneInput('BR', '11 91234 5678')).toEqual({ e164: '+5511912345678', error: null });
  });

  it('refuses what cannot be a number before a paid code is requested', () => {
    for (const [iso, national] of [
      ['IQ', ''],
      ['IQ', 'abc'],
      ['IQ', '123'], // under 4 national digits
      ['US', '1234567890123456'], // past E.164's 15 digits
    ] as const) {
      expect(validatePhoneInput(iso, national), `${iso} ${national}`).toEqual({ e164: null, error: 'PHONE_INVALID' });
    }
  });
});

describe('sanitizeOtpInput', () => {
  it('keeps digits only, folds Arabic-Indic digits and caps at the code length', () => {
    expect(sanitizeOtpInput('12 34-56')).toBe('123456');
    expect(sanitizeOtpInput('١٢٣٤٥٦')).toBe('123456');
    expect(sanitizeOtpInput('1234567890')).toHaveLength(OTP_LENGTH);
    expect(sanitizeOtpInput('')).toBe('');
  });
});

describe('hasRealEmail', () => {
  it('is false for a phone-only account and a desk-created synthetic address', () => {
    expect(hasRealEmail({ email: null })).toBe(false);
    expect(hasRealEmail({ email: '' })).toBe(false);
    expect(hasRealEmail({ email: `7701234567@${GUEST_EMAIL_DOMAIN}` })).toBe(false);
    expect(hasRealEmail(undefined)).toBe(false);
  });

  it('is true for a mailbox someone can actually read', () => {
    expect(hasRealEmail({ email: 'sara@example.com' })).toBe(true);
    expect(hasRealEmail({ email: 'k3x9q2@privaterelay.appleid.com' })).toBe(true);
  });
});

describe('mapOtpError', () => {
  it('maps GoTrue codes', () => {
    expect(mapOtpError({ name: 'AuthApiError', code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe(
      'auth.otpInvalid',
    );
    expect(mapOtpError({ code: 'over_sms_send_rate_limit', message: 'x' })).toBe('auth.otpTooMany');
    expect(mapOtpError({ code: 'over_request_rate_limit', message: 'x' })).toBe('auth.otpTooMany');
    expect(mapOtpError({ code: 'sms_send_failed', message: 'x' })).toBe('auth.otpSendFailed');
    expect(mapOtpError({ code: 'phone_provider_disabled', message: 'x' })).toBe('auth.phoneSignInUnavailable');
    expect(mapOtpError({ code: 'otp_disabled', message: 'x' })).toBe('auth.phoneSignInUnavailable');
    expect(mapOtpError({ code: 'hook_timeout', message: 'x' })).toBe('auth.phoneSignInUnavailable');
    expect(mapOtpError({ code: 'validation_failed', message: 'x' })).toBe('auth.phoneOtpInvalid');
  });

  it('maps the refusal reasons the send-sms-otp hook relays as the message', () => {
    expect(mapOtpError(new Error('SMS_DISABLED'))).toBe('auth.phoneSignInUnavailable');
    expect(mapOtpError(new Error('PHONE_NOT_ALLOWED'))).toBe('auth.phoneOtpInvalid');
    expect(mapOtpError(new Error('PHONE_RATE'))).toBe('auth.otpTooMany');
    expect(mapOtpError(new Error('DAILY_CAP'))).toBe('auth.otpSendFailed');
    expect(mapOtpError(new Error('SMS_SEND_FAILED'))).toBe('auth.otpSendFailed');
    expect(mapOtpError(new Error('UNAUTHORIZED'))).toBe('auth.phoneSignInUnavailable');
  });

  it('falls back to the message when GoTrue sends no code', () => {
    expect(mapOtpError(new Error('Token has expired or is invalid'))).toBe('auth.otpInvalid');
    expect(mapOtpError(new Error('Request rate limit reached'))).toBe('auth.otpTooMany');
    expect(mapOtpError(new Error('Unsupported phone provider'))).toBe('auth.phoneSignInUnavailable');
  });

  it('keeps transport failures as "no connection"', () => {
    expect(mapOtpError(new Error('Network request failed'))).toBe('errors.network');
    expect(mapOtpError({ name: 'AuthRetryableFetchError', message: 'x' })).toBe('errors.network');
  });

  it('is generic for anything else', () => {
    expect(mapOtpError(new Error('kaboom'))).toBe('errors.generic');
    expect(mapOtpError(undefined)).toBe('errors.generic');
  });
});

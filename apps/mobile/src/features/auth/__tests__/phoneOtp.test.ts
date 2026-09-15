import { describe, expect, it } from 'vitest';
import {
  GUEST_EMAIL_DOMAIN,
  OTP_LENGTH,
  classifyPhoneSignIn,
  hasRealEmail,
  isNoAccountForPhone,
  isPhoneTaken,
  mapOtpError,
  parsePhoneOtpFlag,
  sanitizeOtpInput,
  validatePhoneInput,
} from '../phoneOtp';

/**
 * Phone is the only way to create an account (2026-09-15). These pin that the
 * flag is strict, a number is checked before a paid code is asked for, every
 * refusal the hook or GoTrue can send has copy, and the sign-up / sign-in /
 * recovery screens can tell their failures apart.
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

describe('phone + password failures', () => {
  it('isPhoneTaken: a confirmed account already owns the number, by code or message', () => {
    expect(isPhoneTaken({ code: 'phone_exists', message: 'x' })).toBe(true);
    expect(isPhoneTaken({ code: 'user_already_exists', message: 'x' })).toBe(true);
    expect(isPhoneTaken(new Error('User already registered'))).toBe(true);
    expect(isPhoneTaken({ code: 'weak_password', message: 'x' })).toBe(false);
    expect(isPhoneTaken(undefined)).toBe(false);
  });

  it('classifyPhoneSignIn: wrong credentials vs a sign-up whose code was never entered', () => {
    expect(classifyPhoneSignIn({ code: 'invalid_credentials', message: 'x' })).toBe('wrong-credentials');
    expect(classifyPhoneSignIn(new Error('Invalid login credentials'))).toBe('wrong-credentials');
    expect(classifyPhoneSignIn({ code: 'phone_not_confirmed', message: 'x' })).toBe('phone-not-confirmed');
    expect(classifyPhoneSignIn(new Error('Phone not confirmed'))).toBe('phone-not-confirmed');
    expect(classifyPhoneSignIn(new Error('Network request failed'))).toBe('other');
  });

  it('isNoAccountForPhone: recovery to an unknown number, not a switched-off provider', () => {
    expect(isNoAccountForPhone({ code: 'otp_disabled', message: 'Signups not allowed for otp' })).toBe(true);
    expect(isNoAccountForPhone({ code: 'otp_disabled', message: 'OTP is disabled' })).toBe(false);
    expect(isNoAccountForPhone(new Error('SMS_DISABLED'))).toBe(false);
  });
});

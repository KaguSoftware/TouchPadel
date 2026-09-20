import { describe, expect, it } from 'vitest';
import {
  isEmailRateLimited,
  isEmailTaken,
  isValidEmail,
  mapEmailAuthError,
  parseAuthMethod,
  signUpHidExistingEmail,
} from '../emailAuth';

/**
 * Email restored beside phone (2026-09-20). What must not drift: phone stays
 * the default segment, an obvious typo is stopped before a mail is sent, and
 * the two ways GoTrue reports "this address already has an account" — an
 * error, or a silent identity-less success — both reach the field.
 */

describe('parseAuthMethod', () => {
  it('opens on phone unless the param says email', () => {
    expect(parseAuthMethod('email')).toBe('email');
    expect(parseAuthMethod('phone')).toBe('phone');
    expect(parseAuthMethod(undefined)).toBe('phone');
    expect(parseAuthMethod('EMAIL')).toBe('phone');
    expect(parseAuthMethod(['email'])).toBe('phone');
  });
});

describe('isValidEmail', () => {
  it('accepts an ordinary address, trimmed', () => {
    expect(isValidEmail('sara@example.com')).toBe(true);
    expect(isValidEmail('  sara@example.com  ')).toBe(true);
  });

  it('refuses what cannot be delivered to', () => {
    for (const v of ['', 'sara', 'sara@', '@example.com', 'sara@example', 'sara example@x.y']) {
      expect(isValidEmail(v), v).toBe(false);
    }
  });
});

describe('isEmailTaken', () => {
  it('reads the GoTrue codes, then the message', () => {
    expect(isEmailTaken({ code: 'email_exists' })).toBe(true);
    expect(isEmailTaken({ code: 'user_already_exists' })).toBe(true);
    expect(isEmailTaken({ message: 'User already registered' })).toBe(true);
    expect(isEmailTaken({ code: 'weak_password', message: 'x' })).toBe(false);
    expect(isEmailTaken(null)).toBe(false);
  });
});

describe('signUpHidExistingEmail', () => {
  it('spots the identity-less "success" confirmations-on GoTrue returns for a taken address', () => {
    expect(signUpHidExistingEmail({ user: { identities: [] } })).toBe(true);
  });

  it('lets a real sign-up through', () => {
    expect(signUpHidExistingEmail({ user: { identities: [{ id: 'x' }] } })).toBe(false);
    expect(signUpHidExistingEmail({ user: null })).toBe(false);
    expect(signUpHidExistingEmail(undefined)).toBe(false);
  });
});

describe('mapEmailAuthError', () => {
  it('names the mail rate limit', () => {
    expect(isEmailRateLimited({ code: 'over_email_send_rate_limit' })).toBe(true);
    expect(mapEmailAuthError({ message: 'email rate limit exceeded' })).toBe('errors.tooManyRequests');
  });

  it('leaves everything else to the generic mapper', () => {
    expect(mapEmailAuthError(new TypeError('Network request failed'))).toBe('errors.network');
    expect(mapEmailAuthError({ message: 'boom' })).toBe('errors.generic');
  });
});

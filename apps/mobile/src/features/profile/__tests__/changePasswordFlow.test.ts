import { describe, expect, it } from 'vitest';
import {
  classifySignInFailure,
  classifyUpdateFailure,
  hasPasswordSignIn,
} from '../changePasswordFlow';

describe('classifySignInFailure', () => {
  it('names a wrong current password, by code or by message', () => {
    expect(classifySignInFailure({ code: 'invalid_credentials', message: 'x' })).toBe(
      'wrong-password',
    );
    expect(classifySignInFailure({ message: 'Invalid login credentials' })).toBe('wrong-password');
  });

  it('names an unconfirmed email rather than blaming the password', () => {
    expect(classifySignInFailure({ code: 'email_not_confirmed' })).toBe('email-not-confirmed');
    expect(classifySignInFailure({ message: 'Email not confirmed' })).toBe('email-not-confirmed');
  });

  it('does not call a network failure a wrong password', () => {
    // THE REPORTED BUG: every failure of the proof sign-in — including this
    // one — was rendered as "Email or password is incorrect".
    expect(classifySignInFailure(new TypeError('Network request failed'))).toBe('other');
    expect(classifySignInFailure(null)).toBe('other');
  });
});

describe('classifyUpdateFailure', () => {
  it('names the server refusing an unchanged password', () => {
    expect(classifyUpdateFailure({ code: 'same_password' })).toBe('same-password');
    expect(
      classifyUpdateFailure({ message: 'New password should be different from the old password.' }),
    ).toBe('same-password');
  });

  it('names a weak password', () => {
    expect(classifyUpdateFailure({ code: 'weak_password' })).toBe('weak-password');
    expect(classifyUpdateFailure({ message: 'Password should be at least 6 characters.' })).toBe(
      'weak-password',
    );
  });

  it('names the secure-password-change setting asking for a nonce', () => {
    expect(classifyUpdateFailure({ code: 'reauthentication_needed' })).toBe('reauthentication');
    expect(classifyUpdateFailure({ message: 'Password update requires reauthentication' })).toBe(
      'reauthentication',
    );
  });

  it('leaves everything else to the generic mapper', () => {
    expect(classifyUpdateFailure({ message: 'boom' })).toBe('other');
  });
});

describe('hasPasswordSignIn', () => {
  it('is true for an email/password account, alone or alongside a social link', () => {
    expect(hasPasswordSignIn({ app_metadata: { provider: 'email', providers: ['email'] } })).toBe(
      true,
    );
    expect(
      hasPasswordSignIn({ app_metadata: { provider: 'google', providers: ['google', 'email'] } }),
    ).toBe(true);
    // An older token carries only `provider`.
    expect(hasPasswordSignIn({ app_metadata: { provider: 'email' } })).toBe(true);
  });

  it('is false for a social-only or anonymous account — nothing to change', () => {
    expect(hasPasswordSignIn({ app_metadata: { provider: 'google', providers: ['google'] } })).toBe(
      false,
    );
    expect(hasPasswordSignIn({ app_metadata: { provider: 'apple' } })).toBe(false);
    expect(hasPasswordSignIn({ app_metadata: null })).toBe(false);
    expect(hasPasswordSignIn(null)).toBe(false);
  });
});

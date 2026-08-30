import { describe, expect, it } from 'vitest';
import { authLinkErrorKey, isRecoveryLink, linkErrorParam, parseAuthLink } from '../deepLink';

describe('parseAuthLink', () => {
  it('reads a PKCE code from the query string', () => {
    expect(parseAuthLink('touchpadel://verify-email?code=abc123')).toEqual({
      kind: 'pkce',
      path: 'verify-email',
      code: 'abc123',
    });
  });

  it('reads implicit tokens from the fragment', () => {
    expect(
      parseAuthLink('touchpadel://reset-password#access_token=at&refresh_token=rt&type=recovery'),
    ).toEqual({
      kind: 'tokens',
      path: 'reset-password',
      accessToken: 'at',
      refreshToken: 'rt',
      type: 'recovery',
    });
  });

  it('reads an error, url-decoding the description', () => {
    expect(
      parseAuthLink(
        'touchpadel://verify-email?error=access_denied&error_code=otp_expired' +
          '&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).toEqual({
      kind: 'error',
      path: 'verify-email',
      code: 'otp_expired',
      description: 'Email link is invalid or has expired',
    });
  });

  it('prefers an error over a code delivered alongside it', () => {
    expect(parseAuthLink('touchpadel://verify-email?code=abc&error=access_denied')?.kind).toBe(
      'error',
    );
  });

  it('does not mistake a fragment separator for the query separator', () => {
    expect(parseAuthLink('touchpadel://reset-password#access_token=a?b&refresh_token=rt')).toEqual({
      kind: 'tokens',
      path: 'reset-password',
      accessToken: 'a?b',
      refreshToken: 'rt',
      type: null,
    });
  });

  it('ignores links that carry no auth payload', () => {
    expect(parseAuthLink('touchpadel://bookings')).toBeNull();
    expect(parseAuthLink('touchpadel://verify-email')).toBeNull();
    // An access_token without its refresh_token is not a usable session.
    expect(parseAuthLink('touchpadel://reset-password#access_token=at')).toBeNull();
    expect(parseAuthLink('not-a-url')).toBeNull();
    expect(parseAuthLink(null)).toBeNull();
    expect(parseAuthLink('')).toBeNull();
  });

  it('survives a malformed percent escape rather than throwing', () => {
    expect(parseAuthLink('touchpadel://verify-email?code=%E0%A4%A')).toEqual({
      kind: 'pkce',
      path: 'verify-email',
      code: '%E0%A4%A',
    });
  });

  it('reads the route from an Expo Go url, past the host and /--/ separator', () => {
    expect(parseAuthLink('exp://192.168.1.5:8081/--/verify-email?code=abc')).toEqual({
      kind: 'pkce',
      path: 'verify-email',
      code: 'abc',
    });
    const recovery = parseAuthLink('exp://192.168.1.5:8081/--/reset-password?code=abc');
    expect(recovery && isRecoveryLink(recovery)).toBe(true);
  });

  it('strips slashes around the path', () => {
    expect(parseAuthLink('touchpadel:///reset-password/?code=x')?.path).toBe('reset-password');
  });
});

describe('isRecoveryLink', () => {
  it('trusts an explicit type over the path', () => {
    const link = parseAuthLink(
      'touchpadel://verify-email#access_token=a&refresh_token=b&type=recovery',
    );
    expect(link && isRecoveryLink(link)).toBe(true);
  });

  it('falls back to the redirect path when there is no type', () => {
    const reset = parseAuthLink('touchpadel://reset-password?code=x');
    const verify = parseAuthLink('touchpadel://verify-email?code=x');
    expect(reset && isRecoveryLink(reset)).toBe(true);
    expect(verify && isRecoveryLink(verify)).toBe(false);
  });
});

describe('authLinkErrorKey', () => {
  it('separates expiry from every other failure', () => {
    expect(authLinkErrorKey('otp_expired')).toBe('auth.linkExpired');
    expect(authLinkErrorKey('Email link is invalid or has expired')).toBe('auth.linkExpired');
    expect(authLinkErrorKey('access_denied')).toBe('auth.linkInvalid');
    expect(authLinkErrorKey(null)).toBe('auth.linkInvalid');
  });
});

describe('linkErrorParam', () => {
  it('accepts only the two known keys', () => {
    expect(linkErrorParam('auth.linkExpired')).toBe('auth.linkExpired');
    expect(linkErrorParam('auth.linkInvalid')).toBe('auth.linkInvalid');
    expect(linkErrorParam('errors.crashTitle')).toBeNull();
    expect(linkErrorParam(undefined)).toBeNull();
  });
});

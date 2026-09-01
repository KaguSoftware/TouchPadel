import { describe, expect, it, vi } from 'vitest';
import {
  SocialAuthError,
  appleDisplayName,
  buildProfilePatch,
  firstGoogleAttempt,
  isGoogleClientId,
  makeNonce,
  mapSocialError,
  needsProfileCompletion,
  nextGoogleStep,
  prefillDisplayName,
  profileGateState,
} from '../social';

describe('makeNonce', () => {
  it('returns the injected random value as raw and its hash as hashed', async () => {
    const sha = vi.fn(async (s: string) => `H(${s})`);
    const nonce = await makeNonce(() => 'abc', sha);
    expect(nonce).toEqual({ raw: 'abc', hashed: 'H(abc)' });
    // The provider gets the hash of the RAW value — nothing derived in between.
    expect(sha).toHaveBeenCalledTimes(1);
    expect(sha).toHaveBeenCalledWith('abc');
  });

  it('rejects an empty random value instead of sending an empty nonce', async () => {
    await expect(makeNonce(() => '', async (s) => s)).rejects.toThrow(/empty nonce/);
  });

  it('gives two attempts two different nonces', async () => {
    let n = 0;
    const next = () => `nonce-${n++}`;
    const a = await makeNonce(next, async (s) => s);
    const b = await makeNonce(next, async (s) => s);
    expect(a.raw).not.toBe(b.raw);
  });
});

describe('appleDisplayName', () => {
  it('joins given, middle and family names with single spaces', () => {
    expect(appleDisplayName({ givenName: 'Sara', familyName: 'Ali' })).toBe('Sara Ali');
    expect(
      appleDisplayName({ givenName: 'Ali', middleName: 'Hussein', familyName: 'Al-Saadi' }),
    ).toBe('Ali Hussein Al-Saadi');
  });

  it('tolerates partial names and trims whitespace', () => {
    expect(appleDisplayName({ givenName: ' Sara ' })).toBe('Sara');
    expect(appleDisplayName({ familyName: 'Ali' })).toBe('Ali');
  });

  it('returns null when Apple sent nothing usable (every sign-in after the first)', () => {
    expect(appleDisplayName({ givenName: '  ', familyName: '' })).toBeNull();
    expect(appleDisplayName({})).toBeNull();
    expect(appleDisplayName(null)).toBeNull();
    expect(appleDisplayName(undefined)).toBeNull();
  });
});

describe('mapSocialError', () => {
  it('treats a cancelled or in-progress attempt as nothing to show', () => {
    expect(mapSocialError(new SocialAuthError('CANCELLED', 'apple'))).toEqual({ kind: 'cancelled' });
    expect(mapSocialError(new SocialAuthError('IN_PROGRESS', 'google'))).toEqual({ kind: 'cancelled' });
  });

  it('still recognises raw SDK cancel codes an adapter forgot to wrap', () => {
    expect(mapSocialError({ code: 'ERR_REQUEST_CANCELED' })).toEqual({ kind: 'cancelled' });
    expect(mapSocialError({ code: 'SIGN_IN_CANCELLED' })).toEqual({ kind: 'cancelled' });
    expect(mapSocialError({ code: 12501 })).toEqual({ kind: 'cancelled' });
  });

  it('explains device limitations without reporting them', () => {
    expect(mapSocialError(new SocialAuthError('PLAY_SERVICES_NOT_AVAILABLE', 'google'))).toEqual({
      kind: 'error',
      key: 'auth.googlePlayServices',
      report: false,
    });
    expect(mapSocialError({ code: 'PLAY_SERVICES_NOT_AVAILABLE' })).toMatchObject({
      key: 'auth.googlePlayServices',
      report: false,
    });
    expect(mapSocialError(new SocialAuthError('UNAVAILABLE', 'apple'))).toEqual({
      kind: 'error',
      key: 'auth.appleUnavailable',
      report: false,
    });
  });

  it('reports configuration faults (DEVELOPER_ERROR = a missing SHA-1 client)', () => {
    expect(mapSocialError(new SocialAuthError('DEVELOPER_ERROR', 'google'))).toEqual({
      kind: 'error',
      key: 'errors.generic',
      report: true,
    });
    expect(mapSocialError({ code: 'DEVELOPER_ERROR' })).toMatchObject({ report: true });
  });

  it('maps a missing token or an unknown SDK failure to the social-failed copy, reported', () => {
    expect(mapSocialError(new SocialAuthError('NO_ID_TOKEN', 'apple'))).toEqual({
      kind: 'error',
      key: 'auth.socialFailed',
      report: true,
    });
    expect(mapSocialError(new SocialAuthError('FAILED', 'google'))).toMatchObject({
      key: 'auth.socialFailed',
    });
    expect(mapSocialError({ code: 'ERR_REQUEST_UNKNOWN' })).toMatchObject({
      key: 'auth.socialFailed',
      report: true,
    });
  });

  it('keeps transport failures as "no connection", unreported', () => {
    expect(mapSocialError(new Error('Network request failed'))).toEqual({
      kind: 'error',
      key: 'errors.network',
      report: false,
    });
    expect(mapSocialError({ name: 'AuthRetryableFetchError', message: 'x' })).toMatchObject({
      key: 'errors.network',
    });
  });

  it('reports a GoTrue refusal of the token (dashboard Client IDs / nonce)', () => {
    expect(
      mapSocialError({ name: 'AuthApiError', message: 'Unacceptable audience in id_token', status: 400 }),
    ).toEqual({ kind: 'error', key: 'auth.socialFailed', report: true });
    expect(
      mapSocialError(new Error('Passed nonce and nonce in id_token should either both exist or not')),
    ).toMatchObject({ key: 'auth.socialFailed', report: true });
  });

  it('falls back to the generic message for anything else', () => {
    expect(mapSocialError(new Error('kaboom'))).toEqual({
      kind: 'error',
      key: 'errors.generic',
      report: true,
    });
    expect(mapSocialError(undefined)).toMatchObject({ key: 'errors.generic' });
  });
});

describe('needsProfileCompletion', () => {
  it('is true only for a KNOWN row with a blank phone', () => {
    expect(needsProfileCompletion({ phone: null })).toBe(true);
    expect(needsProfileCompletion({ phone: '' })).toBe(true);
    expect(needsProfileCompletion({ phone: '   ' })).toBe(true);
    expect(needsProfileCompletion({ phone: '+9647701234567' })).toBe(false);
  });

  it('fails open when there is no row or it has not loaded', () => {
    expect(needsProfileCompletion(null)).toBe(false);
    expect(needsProfileCompletion(undefined)).toBe(false);
  });
});

describe('profileGateState', () => {
  it('is unknown while loading or after an error', () => {
    expect(profileGateState({ status: 'pending', data: undefined })).toBe('unknown');
    expect(profileGateState({ status: 'error', data: undefined })).toBe('unknown');
  });

  it('decides from the loaded row', () => {
    expect(profileGateState({ status: 'success', data: { phone: null } })).toBe('incomplete');
    expect(profileGateState({ status: 'success', data: { phone: '077' } })).toBe('complete');
    // No row = an anonymous session; never gated.
    expect(profileGateState({ status: 'success', data: null })).toBe('complete');
  });
});

describe('prefillDisplayName', () => {
  it('hides the trigger email-local-part fallback', () => {
    expect(prefillDisplayName('k3x9q2', 'k3x9q2@privaterelay.appleid.com')).toBe('');
    expect(prefillDisplayName('ABC', 'abc@b.c')).toBe('');
  });

  it('keeps a real name', () => {
    expect(prefillDisplayName('Sara Ali', 'sara@x.com')).toBe('Sara Ali');
    expect(prefillDisplayName('  Sara Ali ', null)).toBe('Sara Ali');
  });

  it('is empty for nothing', () => {
    expect(prefillDisplayName('', 'a@b.c')).toBe('');
    expect(prefillDisplayName(null, null)).toBe('');
  });
});

describe('buildProfilePatch', () => {
  it('writes the Apple first-authorization name and nothing for Google', () => {
    expect(buildProfilePatch('apple', { fullName: 'Sara Ali' })).toEqual({ full_name: 'Sara Ali' });
    expect(buildProfilePatch('apple', { fullName: null })).toBeNull();
    expect(buildProfilePatch('apple', { fullName: '  ' })).toBeNull();
    expect(buildProfilePatch('google', { fullName: 'X' })).toBeNull();
  });

  it('fills a blank or trigger-fallback name but never overwrites a chosen one (linked account)', () => {
    const apple = { fullName: 'Sara Ali' };
    expect(buildProfilePatch('apple', { ...apple, existingFullName: '', email: 'x@y.z' })).toEqual({
      full_name: 'Sara Ali',
    });
    expect(
      buildProfilePatch('apple', { ...apple, existingFullName: 'k3x9q2', email: 'k3x9q2@privaterelay.appleid.com' }),
    ).toEqual({ full_name: 'Sara Ali' });
    expect(buildProfilePatch('apple', { ...apple, existingFullName: 'sara', email: 'sara@icloud.com' })).toEqual({
      full_name: 'Sara Ali',
    });
    // An existing email/password guest who linked Apple keeps the name she typed. (A chosen name that
    // EQUALS the email local part is indistinguishable from the trigger fallback and is refreshed — accepted.)
    expect(buildProfilePatch('apple', { ...apple, existingFullName: 'Sara Karim', email: 'sara@icloud.com' })).toBeNull();
  });
});

describe('firstGoogleAttempt', () => {
  it('skips the cached-token silent step on iOS and keeps it on Android', () => {
    expect(firstGoogleAttempt('ios')).toBe('createAccount');
    expect(firstGoogleAttempt('android')).toBe('signIn');
  });
});

describe('isGoogleClientId', () => {
  it('accepts only what Google Cloud issues', () => {
    expect(isGoogleClientId('123456789012-abc9def8ghi7jkl6.apps.googleusercontent.com')).toBe(true);
  });

  it('treats the committed placeholders, blanks and typos as unset', () => {
    expect(isGoogleClientId('REPLACE_WITH_GOOGLE_IOS_CLIENT_ID.apps.googleusercontent.com')).toBe(false);
    expect(isGoogleClientId('replace-with-web-client-id.apps.googleusercontent.com')).toBe(false);
    expect(isGoogleClientId('123456789012-abc.apps.googleusercontent.com ')).toBe(false);
    expect(isGoogleClientId('')).toBe(false);
    expect(isGoogleClientId(undefined)).toBe(false);
    expect(isGoogleClientId(null)).toBe(false);
  });
});

describe('nextGoogleStep', () => {
  it('walks signIn -> createAccount -> explicit -> fail while nothing is saved', () => {
    expect(nextGoogleStep('noSavedCredentialFound', 'signIn')).toBe('createAccount');
    expect(nextGoogleStep('noSavedCredentialFound', 'createAccount')).toBe('explicit');
    expect(nextGoogleStep('noSavedCredentialFound', 'explicit')).toBe('fail');
  });

  it('stops on success or cancel at any stage', () => {
    expect(nextGoogleStep('success', 'signIn')).toBe('done');
    expect(nextGoogleStep('success', 'explicit')).toBe('done');
    expect(nextGoogleStep('cancelled', 'createAccount')).toBe('cancelled');
  });
});

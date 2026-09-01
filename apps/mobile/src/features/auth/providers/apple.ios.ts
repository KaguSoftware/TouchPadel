/**
 * Sign in with Apple — iOS. Native sheet via expo-apple-authentication (works
 * in Expo Go on iOS too: the identity token's audience is then
 * `host.exp.Exponent`, which the Supabase Apple provider lists for development).
 * Supabase needs no Services ID / secret / team id for this native flow — only
 * the bundle id(s) in the provider's Client IDs.
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import { SocialAuthError, appleDisplayName } from '../social';
import type { AppleCredential } from './apple';

export type { AppleCredential } from './apple';

/**
 * Sync first-frame expectation so the button renders without a pop-in; every
 * supported iOS has Sign in with Apple, and the async probe below only ever
 * turns it OFF (e.g. a managed device with Apple ID sign-in restricted).
 */
export const appleSignInExpected = true;

export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * `hashedNonce` is the SHA-256 hex of the raw nonce; Apple copies it into the
 * identity token's `nonce` claim, and GoTrue compares it with the hash of the
 * raw value we pass to signInWithIdToken.
 */
export async function requestAppleCredential(hashedNonce: string): Promise<AppleCredential> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    throw normalizeAppleError(error);
  }
  if (!credential.identityToken) throw new SocialAuthError('NO_ID_TOKEN', 'apple');
  return {
    identityToken: credential.identityToken,
    fullName: appleDisplayName(credential.fullName),
    email: credential.email ?? null,
  };
}

function normalizeAppleError(error: unknown): SocialAuthError {
  if (error instanceof SocialAuthError) return error;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : undefined;
  switch (code) {
    case 'ERR_REQUEST_CANCELED':
      return new SocialAuthError('CANCELLED', 'apple', message, error);
    case 'ERR_REQUEST_NOT_HANDLED':
    case 'ERR_REQUEST_NOT_INTERACTIVE':
      return new SocialAuthError('UNAVAILABLE', 'apple', message, error);
    default:
      return new SocialAuthError('FAILED', 'apple', message, error);
  }
}

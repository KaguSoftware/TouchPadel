/**
 * Sign in with Apple — the NON-iOS resolution of this module (Metro picks
 * apple.ios.ts on iOS). Owner decision D2 (2026-09-01): Apple is iOS only, so
 * Android never bundles expo-apple-authentication at all and the button is
 * simply absent there. tsc type-checks against THIS file, so both files must
 * export the same signatures.
 */
import { SocialAuthError } from '../social';

export interface AppleCredential {
  identityToken: string;
  /** Present on the FIRST authorization only. */
  fullName: string | null;
  email: string | null;
}

/** Sync first-frame expectation (the async probe below is the truth). Never on this platform. */
export const appleSignInExpected = false;

export async function isAppleSignInAvailable(): Promise<boolean> {
  return false;
}

export async function requestAppleCredential(_hashedNonce: string): Promise<AppleCredential> {
  throw new SocialAuthError('UNAVAILABLE', 'apple', 'Sign in with Apple is iOS only');
}

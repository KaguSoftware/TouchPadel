/**
 * Google Sign-In adapter — THE ONLY FILE that imports the Google SDK
 * (react-native-nitro-google-signin: Android Credential Manager + the Google
 * Sign-In SDK for iOS). Owner decision D1 (2026-09-01): native SDK, so this needs
 * an EAS development build; in Expo Go the button is simply hidden.
 *
 * Why this library and not @react-native-google-signin/google-signin: that
 * library's free "Original" API is built on Google's DEPRECATED legacy Android
 * Sign-In SDK ("will be removed from the Google Play services Auth SDK in a
 * future release"); its Credential Manager support is paid. Nitro is young
 * (2026-06) — hence this one-file boundary, guarded by a test in
 * src/lib/__tests__/reliability.test.ts.
 *
 * ONE-FILE SWAP to @react-native-google-signin/google-signin (Original API), if
 * ever needed: configure({ webClientId, iosClientId }) / hasPlayServices() /
 * signIn() + isSuccessResponse / isCancelledResponse / response.data.idToken /
 * signOut(); its config plugin is ['@react-native-google-signin/google-signin',
 * { iosUrlScheme }]. It has NO nonce support, so the swap also means omitting
 * `nonce` in signInWithIdToken and turning "Skip nonce check" ON for Google in
 * the Supabase dashboard — a security-reviewer decision, recorded in HANDOFF.
 *
 * iOS GOTCHA (verified in the 2.1.0 Swift source, HybridNitroGoogleSignin.swift):
 * signIn() returns GIDSignIn.currentUser or a keychain restore — an id token
 * minted by an EARLIER authorization, so its nonce claim is never this
 * attempt's; only createAccount()/presentExplicitSignIn() run the interactive
 * flow that mints a token with the configured nonce. Hence firstGoogleAttempt:
 * iOS starts interactive. Android's Credential Manager mints per request.
 */
import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';
// Type-only: erased at compile time, so the module is still loaded lazily below.
import type * as GoogleLib from 'react-native-nitro-google-signin';
import { captureException, captureMessage } from '../../../lib/telemetry';
import {
  SocialAuthError,
  firstGoogleAttempt,
  isGoogleClientId,
  nextGoogleStep,
  type GoogleAttempt,
} from '../social';

const RAW_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const RAW_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
// A REPLACE_* placeholder (eas.json / .env.example as committed) is non-empty but
// not a client id: treated as UNSET so the button hides instead of shipping a tap
// that can never succeed (isGoogleClientId; app.config.ts applies the same rule).
const WEB_CLIENT_ID = isGoogleClientId(RAW_WEB_CLIENT_ID) ? RAW_WEB_CLIENT_ID : undefined;
const IOS_CLIENT_ID = isGoogleClientId(RAW_IOS_CLIENT_ID) ? RAW_IOS_CLIENT_ID : undefined;

let noted = false;

/**
 * Whether the Google button should exist at all. False in Expo Go (the native
 * module cannot load there — same idiom as profile/push.ts) and in any build
 * without the public client ids (a missing button on a dev build is a config
 * symptom, not a UI bug).
 */
export function isGoogleSignInAvailable(): boolean {
  if (isRunningInExpoGo()) {
    if (__DEV__ && !noted) {
      noted = true;
      console.info(
        '[auth] Google sign-in hidden: the native SDK is not in Expo Go — use an EAS development build',
      );
    }
    return false;
  }
  if (!WEB_CLIENT_ID || (Platform.OS === 'ios' && !IOS_CLIENT_ID)) {
    if (__DEV__ && !noted && (RAW_WEB_CLIENT_ID || RAW_IOS_CLIENT_ID)) {
      noted = true;
      console.warn(
        '[auth] Google sign-in hidden: EXPO_PUBLIC_GOOGLE_*_CLIENT_ID is not a Google OAuth client id (still a placeholder?)',
      );
    }
    return false;
  }
  return true;
}

type Lib = typeof GoogleLib;
let lib: Promise<Lib> | null = null;
// Lazy on purpose: evaluating the module creates its Nitro HybridObject, which
// throws where the native side is absent (Expo Go). Never import it at module scope.
const loadLib = (): Promise<Lib> => (lib ??= import('react-native-nitro-google-signin'));

let configured = false;

export interface GoogleCredential {
  idToken: string;
  email: string | null;
  name: string | null;
}

/**
 * `hashedNonce` is the SHA-256 hex of the raw nonce; the SDK puts it into the id
 * token's `nonce` claim and GoTrue compares it with the hash of the raw value we
 * pass to signInWithIdToken (Supabase "Skip nonce check" stays OFF).
 *
 * Cascade (Credential Manager semantics): signIn() restores a saved credential
 * silently; noSavedCredentialFound -> createAccount() shows the account picker;
 * still nothing -> presentExplicitSignIn(). Each step decided by nextGoogleStep;
 * iOS starts at createAccount() (firstGoogleAttempt — the silent step there
 * returns a cached token whose nonce is not this attempt's).
 */
export async function requestGoogleIdToken(hashedNonce: string): Promise<GoogleCredential> {
  if (!isGoogleSignInAvailable() || !WEB_CLIENT_ID) {
    throw new SocialAuthError('UNAVAILABLE', 'google', 'Google sign-in is not configured for this build');
  }
  const { GoogleOneTapSignIn, statusCodes } = await loadLib();
  try {
    // Throws GoogleSignInError(PLAY_SERVICES_NOT_AVAILABLE) on a phone without Play services.
    if (Platform.OS === 'android') await GoogleOneTapSignIn.checkPlayServices();
    // A nonce is per attempt, so configure per attempt (synchronous, cheap).
    GoogleOneTapSignIn.configure({
      webClientId: WEB_CLIENT_ID,
      iosClientId: IOS_CLIENT_ID,
      nonce: hashedNonce,
    });
    configured = true;

    let attempt: GoogleAttempt = firstGoogleAttempt(Platform.OS);
    let response =
      attempt === 'signIn' ? await GoogleOneTapSignIn.signIn() : await GoogleOneTapSignIn.createAccount();
    let step = nextGoogleStep(response.type, attempt);
    if (step === 'createAccount') {
      attempt = 'createAccount';
      response = await GoogleOneTapSignIn.createAccount();
      step = nextGoogleStep(response.type, attempt);
    }
    if (step === 'explicit') {
      attempt = 'explicit';
      response = await GoogleOneTapSignIn.presentExplicitSignIn();
      step = nextGoogleStep(response.type, attempt);
    }
    if (step === 'cancelled') {
      // Android's Credential Manager reports RESULT_CANCELED both for a real
      // dismissal AND for an OAuth misconfiguration (no Android client for this
      // signing SHA-1 / package) — the library only logs the latter to logcat.
      // Even the "silent" signIn() shows a sheet when an authorized account
      // exists, so EVERY Android cancel is recorded with the step as context: a
      // spike of them on one build means a missing SHA-1 client, not shy guests.
      if (Platform.OS === 'android') {
        captureMessage('auth.google.cancelled', 'warning', { attempt });
      }
      throw new SocialAuthError('CANCELLED', 'google', `cancelled at ${attempt}`);
    }
    const idToken = step === 'done' ? response.data?.idToken : null;
    if (!idToken) throw new SocialAuthError('NO_ID_TOKEN', 'google');
    return {
      idToken,
      email: response.data?.user?.email ?? null,
      name: response.data?.user?.name ?? null,
    };
  } catch (error) {
    throw normalizeGoogleError(error, statusCodes);
  }
}

function normalizeGoogleError(error: unknown, codes: Lib['statusCodes']): SocialAuthError {
  if (error instanceof SocialAuthError) return error;
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : undefined;
  switch (code) {
    case codes.SIGN_IN_CANCELLED:
      return new SocialAuthError('CANCELLED', 'google', message, error);
    case codes.IN_PROGRESS:
      return new SocialAuthError('IN_PROGRESS', 'google', message, error);
    case codes.PLAY_SERVICES_NOT_AVAILABLE:
      return new SocialAuthError('PLAY_SERVICES_NOT_AVAILABLE', 'google', message, error);
    case codes.DEVELOPER_ERROR:
      // Android: the APK's signing SHA-1 has no OAuth client in the Google Cloud
      // project, or the package name differs; both: webClientId must be the WEB client.
      // (The same misconfiguration can also surface as a plain 'cancelled' — see
      // the auth.google.cancelled telemetry above.)
      return new SocialAuthError('DEVELOPER_ERROR', 'google', message, error);
    default:
      return new SocialAuthError('FAILED', 'google', message, error);
  }
}

/**
 * Forget the SDK's remembered account so the next signIn() shows the picker
 * instead of auto-selecting. Called from AuthProvider on every SIGNED_OUT.
 * No-op in Expo Go / unconfigured builds; SDK errors are recorded, never thrown.
 */
export async function googleSignOut(): Promise<void> {
  if (!isGoogleSignInAvailable() || !WEB_CLIENT_ID) return;
  try {
    const { GoogleOneTapSignIn } = await loadLib();
    if (!configured) {
      GoogleOneTapSignIn.configure({ webClientId: WEB_CLIENT_ID, iosClientId: IOS_CLIENT_ID });
      configured = true;
    }
    await GoogleOneTapSignIn.signOut();
  } catch (error) {
    captureException(error, { scope: 'auth.google.signOut' });
  }
}

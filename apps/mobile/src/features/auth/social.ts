/**
 * Social sign-in (Apple / Google) — the PURE half. No RN / expo / supabase
 * imports, so it is unit-tested under plain node like deepLink.ts and
 * booking/errors.ts. The provider SDK calls live in ./providers/*, the Supabase
 * call in ./api.ts (signInWithIdToken), the orchestration in useSocialSignIn.ts.
 *
 * Vendor addition 2026-09-01: the signed SOW (L259-260) lists social sign-in as
 * NOT INCLUDED and the design spec §10 says do-not-build; the owner chose to add
 * it. Email + password remains the contractual path.
 */
import type { MessageKey } from '@touch/i18n';
import { errorMessageOf, isTransportError } from '../../lib/network';

export type SocialProvider = 'apple' | 'google';

/** Brand names stay Latin in both locales (wrap with isolate() when interpolating into Arabic). */
export const PROVIDER_LABEL: Record<SocialProvider, string> = { apple: 'Apple', google: 'Google' };

/**
 * Library-agnostic failure codes. The adapters translate SDK-specific codes into
 * these, which is what makes the Google SDK a one-file swap.
 */
export type SocialErrorCode =
  | 'CANCELLED'
  | 'IN_PROGRESS'
  | 'PLAY_SERVICES_NOT_AVAILABLE'
  | 'DEVELOPER_ERROR'
  | 'UNAVAILABLE'
  | 'NO_ID_TOKEN'
  | 'FAILED';

export class SocialAuthError extends Error {
  readonly code: SocialErrorCode;
  readonly provider: SocialProvider;
  /** The SDK error this wraps, kept for telemetry — never shown to the guest. */
  readonly reason: unknown;

  constructor(code: SocialErrorCode, provider: SocialProvider, message?: string, reason?: unknown) {
    super(message ?? `${provider}:${code}`);
    this.name = 'SocialAuthError';
    this.code = code;
    this.provider = provider;
    this.reason = reason;
  }
}

export interface Nonce {
  /** Handed to supabase.auth.signInWithIdToken — GoTrue hashes it and compares with the token's nonce claim. */
  raw: string;
  /** SHA-256 hex of `raw` — handed to the provider SDK, which puts it into the id token. */
  hashed: string;
}

/** RNG and hasher are injected so this runs (and is tested) without expo-crypto. */
export async function makeNonce(
  random: () => string,
  sha256Hex: (value: string) => Promise<string>,
): Promise<Nonce> {
  const raw = random();
  if (!raw) throw new Error('empty nonce');
  return { raw, hashed: await sha256Hex(raw) };
}

export interface AppleFullName {
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
}

/**
 * given + middle + family, single-spaced, trimmed; null when nothing usable.
 * Apple delivers this on the FIRST authorization only — every later sign-in
 * returns null for all of it, so the caller writes it immediately or loses it.
 */
export function appleDisplayName(fullName: AppleFullName | null | undefined): string | null {
  if (!fullName) return null;
  const parts = [fullName.givenName, fullName.middleName, fullName.familyName]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

export type SocialErrorOutcome =
  | { kind: 'cancelled' }
  | { kind: 'error'; key: MessageKey; report: boolean };

/** Raw SDK codes a forgetful adapter might let through (Apple, Google, Android status 12501). */
const RAW_CANCEL_CODES = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED', '12501', 'IN_PROGRESS']);

function codeOf(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string' || typeof code === 'number') return String(code);
  }
  return null;
}

function nameOf(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

/**
 * Map a SocialAuthError, a raw SDK error ({code}), a Supabase AuthError or a
 * transport failure to what the screen does. `report` = worth a captureException
 * (a configuration fault we must see in telemetry), as opposed to a device
 * limitation the guest can do nothing about.
 */
export function mapSocialError(err: unknown): SocialErrorOutcome {
  if (err instanceof SocialAuthError) {
    switch (err.code) {
      case 'CANCELLED':
      case 'IN_PROGRESS':
        return { kind: 'cancelled' };
      case 'PLAY_SERVICES_NOT_AVAILABLE':
        return { kind: 'error', key: 'auth.googlePlayServices', report: false };
      case 'UNAVAILABLE':
        return { kind: 'error', key: 'auth.appleUnavailable', report: false };
      case 'DEVELOPER_ERROR':
        // Android: the signing SHA-1 has no OAuth client / package mismatch;
        // both: webClientId is not the WEB client. A config fault, not a bug.
        return { kind: 'error', key: 'errors.generic', report: true };
      default:
        return { kind: 'error', key: 'auth.socialFailed', report: true };
    }
  }
  const code = codeOf(err);
  if (code && RAW_CANCEL_CODES.has(code)) return { kind: 'cancelled' };
  if (code === 'PLAY_SERVICES_NOT_AVAILABLE') {
    return { kind: 'error', key: 'auth.googlePlayServices', report: false };
  }
  if (code === 'DEVELOPER_ERROR') return { kind: 'error', key: 'errors.generic', report: true };
  if (code && code.startsWith('ERR_REQUEST_')) {
    return { kind: 'error', key: 'auth.socialFailed', report: true };
  }
  if (isTransportError(err)) return { kind: 'error', key: 'errors.network', report: false };
  // GoTrue refusing the token: 'Unacceptable audience in id_token' (client id
  // missing from the dashboard list), a nonce mismatch, 'provider is not enabled'.
  const message = errorMessageOf(err) ?? '';
  if (nameOf(err) === 'AuthApiError' || /audience|nonce|id_token|provider/i.test(message)) {
    return { kind: 'error', key: 'auth.socialFailed', report: true };
  }
  return { kind: 'error', key: 'errors.generic', report: true };
}

/**
 * D3 predicate: the phone is a required profile field (spec 05.3). True only
 * when the row is KNOWN and the phone is blank. `null` (no row — an anonymous
 * cafe session) and `undefined` (not loaded) are false: fail open, the screens
 * treat "unknown" separately via profileGateState.
 */
export function needsProfileCompletion(
  profile: { phone: string | null } | null | undefined,
): boolean {
  if (!profile) return false;
  return (profile.phone ?? '').trim().length === 0;
}

export type ProfileGate = 'unknown' | 'complete' | 'incomplete';

/** For screens holding a TanStack result: pending / error -> 'unknown'. */
export function profileGateState(query: {
  status: 'pending' | 'error' | 'success';
  data: { phone: string | null } | null | undefined;
}): ProfileGate {
  if (query.status !== 'success') return 'unknown';
  return needsProfileCompletion(query.data) ? 'incomplete' : 'complete';
}

/**
 * The trigger app.handle_new_user falls back to the email's local part for
 * full_name. Hide that fallback so the complete-profile name field shows its
 * placeholder instead of 'k3x9q2' (an Apple relay address) or 'parsa.m'.
 */
export function prefillDisplayName(
  fullName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = (fullName ?? '').trim();
  if (!name) return '';
  const local = (email ?? '').split('@')[0]?.trim().toLowerCase() ?? '';
  if (local && name.toLowerCase() === local) return '';
  return name;
}

/**
 * Profile patch to apply right after a social sign-in. Apple: the
 * first-authorization name (see appleDisplayName) — written ONLY over a blank or
 * trigger-fallback name, never over one the guest chose: GoTrue links a provider
 * to an EXISTING account with the same verified email, and Apple still sends the
 * name on this app's first authorization for that account. Google: nothing —
 * GoTrue already copied `name` into metadata and the trigger stored it.
 */
export function buildProfilePatch(
  provider: SocialProvider,
  identity: { fullName?: string | null; existingFullName?: string | null; email?: string | null },
): { full_name: string } | null {
  if (provider !== 'apple') return null;
  const name = (identity.fullName ?? '').trim();
  if (!name) return null;
  if (prefillDisplayName(identity.existingFullName, identity.email)) return null;
  return { full_name: name };
}

/**
 * `<project-number>-<hash>.apps.googleusercontent.com` — the only shape Google
 * Cloud issues. A REPLACE_* placeholder (eas.json / .env.example as committed) is
 * non-empty but NOT a client id: treating it as unset keeps the button hidden
 * and lets app.config.ts fail an EAS build loudly instead of shipping a dead
 * button. app.config.ts repeats the regex (kept import-free on purpose).
 */
export const GOOGLE_CLIENT_ID_RE = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;

export function isGoogleClientId(value: string | null | undefined): value is string {
  return !!value && GOOGLE_CLIENT_ID_RE.test(value);
}

export type GoogleResponseType = 'success' | 'noSavedCredentialFound' | 'cancelled';
export type GoogleAttempt = 'signIn' | 'createAccount' | 'explicit';
export type GoogleStep = 'done' | 'createAccount' | 'explicit' | 'cancelled' | 'fail';

/**
 * Credential Manager cascade, kept out of the adapter so it is testable:
 * signIn() (silent / saved credential) -> createAccount() (account picker) ->
 * presentExplicitSignIn() (explicit chooser) -> give up.
 */
export function nextGoogleStep(type: GoogleResponseType, attempt: GoogleAttempt): GoogleStep {
  if (type === 'success') return 'done';
  if (type === 'cancelled') return 'cancelled';
  if (attempt === 'signIn') return 'createAccount';
  if (attempt === 'createAccount') return 'explicit';
  return 'fail';
}

/**
 * Where the cascade starts. iOS: the library's signIn() hands back GIDSignIn's
 * CACHED user — an id token minted by an EARLIER authorization, whose nonce claim
 * cannot equal this attempt's hash (verified in the 2.1.0 Swift source) — and
 * GoTrue would refuse it forever after one failed exchange. So iOS begins at the
 * interactive step, which mints a fresh token with the configured nonce.
 * Android's Credential Manager mints per request: the silent step is safe there.
 */
export function firstGoogleAttempt(os: string): GoogleAttempt {
  return os === 'ios' ? 'createAccount' : 'signIn';
}

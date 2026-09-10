/**
 * Auth mutations, separated from hooks/screens so they stay unit-testable
 * (each takes the client as an argument — no RN imports here).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';

import { clearPushToken } from '../profile/api';

type Client = SupabaseClient<Database>;

/**
 * Deep-link targets for the auth emails in a BUILT app (scheme from
 * app.config.ts). Callers pass the environment-resolved value from
 * features/auth/redirects.ts instead — under Expo Go the app is not reachable
 * at this scheme at all. These remain the defaults so the pure module keeps
 * working (and testing) without an expo-linking import.
 *
 * BOTH must be present in the HOSTED project's Auth -> URL Configuration
 * redirect allow-list. When a link is not allow-listed (or the option is simply
 * omitted, as signUp used to omit it) GoTrue silently falls back to the
 * project's Site URL -- http://localhost:3000 -- and the confirmation link
 * lands the phone's browser on a port nothing is listening on.
 */
export const RESET_REDIRECT = 'touchpadel://reset-password';
export const VERIFY_REDIRECT = 'touchpadel://verify-email';

export interface SignUpArgs {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  preferredLang: Locale;
}

/**
 * Email+password sign-up. The DB trigger app.handle_new_user creates the
 * profiles row from this metadata (full_name / phone / preferred_lang).
 */
export async function signUp(client: Client, args: SignUpArgs, redirectTo = VERIFY_REDIRECT) {
  const { data, error } = await client.auth.signUp({
    email: args.email.trim(),
    password: args.password,
    options: {
      emailRedirectTo: redirectTo,
      data: {
        full_name: args.fullName.trim(),
        phone: args.phone.trim() || null,
        preferred_lang: args.preferredLang,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(client: Client, email: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error) throw error;
  return data;
}

export async function resendVerification(
  client: Client,
  email: string,
  redirectTo = VERIFY_REDIRECT,
) {
  const { error } = await client.auth.resend({
    type: 'signup',
    email: email.trim(),
    // Without this the RESENT mail repeats the original bug and points at the
    // Site URL again -- the resend button would "work" and still dead-end.
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

export async function sendPasswordReset(client: Client, email: string, redirectTo = RESET_REDIRECT) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;
}

export async function updatePassword(client: Client, newPassword: string) {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/**
 * SEC-21 — the push token is cleared BEFORE the session goes.
 *
 * The update needs the guest's own JWT (profiles_update_own is
 * `id = auth.uid()`), so it cannot be done after signOut(). It is also best
 * effort: clearPushToken swallows its own failures, because a network hiccup
 * must not leave somebody unable to sign out of a shared phone.
 *
 * Without this the row keeps a live capability to push notifications to a
 * handset the guest has walked away from, and the next person to use it goes on
 * receiving the previous guest's booking reminders.
 */
export async function signOut(client: Client) {
  const { data } = await client.auth.getUser();
  const uid = data.user?.id;
  if (uid) await clearPushToken(client, uid);

  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Local sign-up form validation. Returns an i18n-mappable code or null when valid. */
export type SignUpValidation =
  | 'NAME_REQUIRED'
  | 'EMAIL_INVALID'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_MISMATCH'
  | 'PHONE_REQUIRED'
  | null;

export function validateSignUp(args: {
  fullName: string;
  email: string;
  password: string;
  /** The design's sign-up has no confirm field; only checked when supplied. */
  confirmPassword?: string;
  phone?: string;
}): SignUpValidation {
  if (!args.fullName.trim()) return 'NAME_REQUIRED';
  if (!/^\S+@\S+\.\S+$/.test(args.email.trim())) return 'EMAIL_INVALID';
  if (args.password.length < 8) return 'PASSWORD_TOO_SHORT';
  if (args.confirmPassword !== undefined && args.password !== args.confirmPassword) {
    return 'PASSWORD_MISMATCH';
  }
  // Phone is required from day one (spec 05.3 — profile field, not identity).
  if (args.phone !== undefined && !args.phone.trim()) return 'PHONE_REQUIRED';
  return null;
}

// ── Social sign-in (vendor addition 2026-09-01) ─────────────────────────────

export type IdTokenProvider = 'apple' | 'google';

/**
 * Native id-token grant. `nonce` is the RAW nonce: GoTrue hashes it and compares
 * with the token's `nonce` claim (the provider SDK was given the SHA-256). A
 * provider that is not enabled on the project, a client id missing from the
 * dashboard's Client IDs list ("Unacceptable audience") or a nonce mismatch all
 * surface here as an AuthApiError — mapped by features/auth/social.ts.
 */
export async function signInWithIdToken(
  client: Client,
  args: { provider: IdTokenProvider; token: string; nonce: string },
) {
  const { data, error } = await client.auth.signInWithIdToken({
    provider: args.provider,
    token: args.token,
    nonce: args.nonce,
  });
  if (error) throw error;
  return data;
}

/** Mirror a provider-supplied name into user metadata as well as profiles (Apple sends it once). */
export async function setUserMetadata(client: Client, data: { full_name: string }) {
  const { error } = await client.auth.updateUser({ data });
  if (error) throw error;
}

// ── Phone OTP (dormant vendor-addition scaffold 2026-09-05) ─────────────────
// GoTrue-native: the session these return is the same object the email path
// stores. Delivery goes through GoTrue's Send SMS hook (functions/send-sms-otp),
// which refuses every send until app.sms_limits.enabled (0069) is flipped —
// so calling these against a project that has not been activated fails
// cleanly with a message features/auth/phoneOtp.ts maps to copy.

/** Sign in or sign up by phone: GoTrue creates the user on first use and sends a code. */
export async function sendPhoneOtp(client: Client, phoneE164: string) {
  const { error } = await client.auth.signInWithOtp({ phone: phoneE164 });
  if (error) throw error;
}

export async function verifyPhoneOtp(client: Client, phoneE164: string, code: string) {
  const { data, error } = await client.auth.verifyOtp({ phone: phoneE164, token: code, type: 'sms' });
  if (error) throw error;
  return data;
}

/**
 * Link a verified phone to an EXISTING (email / social) account so a later
 * phone sign-in lands on the same user instead of minting a second one. GoTrue
 * sends the code to the new number; verifyPhoneLink confirms it.
 */
export async function startPhoneLink(client: Client, phoneE164: string) {
  const { error } = await client.auth.updateUser({ phone: phoneE164 });
  if (error) throw error;
}

export async function verifyPhoneLink(client: Client, phoneE164: string, code: string) {
  const { data, error } = await client.auth.verifyOtp({
    phone: phoneE164,
    token: code,
    type: 'phone_change',
  });
  if (error) throw error;
  return data;
}

/** Resend for the link flow (a sign-in resend is simply sendPhoneOtp again). */
export async function resendPhoneLink(client: Client, phoneE164: string) {
  const { error } = await client.auth.resend({ type: 'phone_change', phone: phoneE164 });
  if (error) throw error;
}

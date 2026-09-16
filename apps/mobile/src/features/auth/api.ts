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
export const VERIFY_REDIRECT = 'touchpadel://verify-email';

export interface SignUpArgs {
  firstName: string;
  lastName: string;
  /** E.164 (composed by the phone field). */
  phone: string;
  password: string;
  preferredLang: Locale;
}

/** "First Last" — profiles keeps one name column; the parts also ride in metadata. */
export function fullNameOf(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
}

/**
 * Phone + password sign-up (owner decision 2026-09-15: phone is the only way
 * to create an account; email sign-up is gone). With [auth.sms]
 * enable_confirmations on, GoTrue creates the user UNCONFIRMED and sends a
 * code through the Send SMS hook; verifyPhoneOtp confirms it and returns the
 * session. The DB trigger app.handle_new_user creates the profiles row from
 * this metadata (full_name / phone / preferred_lang) at insert time.
 *
 * Signing up again with a number that never confirmed re-sends the code and
 * replaces the password; a CONFIRMED number is refused (isPhoneTaken).
 */
export async function signUpWithPhone(client: Client, args: SignUpArgs) {
  const { data, error } = await client.auth.signUp({
    phone: args.phone,
    password: args.password,
    options: {
      data: {
        full_name: fullNameOf(args.firstName, args.lastName),
        given_name: args.firstName.trim(),
        family_name: args.lastName.trim(),
        phone: args.phone,
        preferred_lang: args.preferredLang,
      },
    },
  });
  if (error) throw error;
  return data;
}

/** Every later sign-in: phone + password, no code (the code is spent once, at sign-up). */
export async function signInWithPhone(client: Client, phoneE164: string, password: string) {
  const { data, error } = await client.auth.signInWithPassword({ phone: phoneE164, password });
  if (error) throw error;
  return data;
}

/**
 * Email + password proof, kept for change-password on accounts created before
 * phone sign-up (and staff): nothing in the guest UI signs in by email any more.
 */
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
  | 'FIRST_NAME_REQUIRED'
  | 'LAST_NAME_REQUIRED'
  | 'PHONE_REQUIRED'
  | 'PASSWORD_TOO_SHORT'
  | null;

export const PASSWORD_MIN = 8;

/**
 * In the form's order — first name, surname, phone, password — so the guest is
 * corrected top to bottom. The phone's LENGTH rule is the phone field's own
 * (validatePhoneInput), checked by the screen after this.
 */
export function validateSignUp(args: {
  firstName: string;
  lastName: string;
  phoneNational: string;
  password: string;
}): SignUpValidation {
  if (!args.firstName.trim()) return 'FIRST_NAME_REQUIRED';
  if (!args.lastName.trim()) return 'LAST_NAME_REQUIRED';
  if (!args.phoneNational.trim()) return 'PHONE_REQUIRED';
  if (args.password.length < PASSWORD_MIN) return 'PASSWORD_TOO_SHORT';
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

// ── Phone codes ──────────────────────────────────────────────────────────────
// GoTrue-native: the session these return is the same object every other path
// stores. Delivery goes through GoTrue's Send SMS hook (functions/send-sms-otp,
// OTPIQ: WhatsApp first, SMS when the number cannot receive it), which refuses
// when app.sms_limits says so — the refusal
// reason reaches the app as the error message and features/auth/phoneOtp.ts
// maps it to copy. A code is spent only to confirm a new number (sign-up, link)
// and to recover a forgotten password; sign-in itself is by password.

/** Confirms a phone sign-up (or a recovery sign-in) and returns the session. */
export async function verifyPhoneOtp(client: Client, phoneE164: string, code: string) {
  const { data, error } = await client.auth.verifyOtp({ phone: phoneE164, token: code, type: 'sms' });
  if (error) throw error;
  return data;
}

/** A fresh code for an unconfirmed sign-up (also where a sign-in on an unconfirmed number is sent). */
export async function resendSignUpCode(client: Client, phoneE164: string) {
  const { error } = await client.auth.resend({ type: 'sms', phone: phoneE164 });
  if (error) throw error;
}

/**
 * Forgot password: a code to an EXISTING account's number. shouldCreateUser
 * false is load-bearing — without it a mistyped number would mint a
 * password-less, nameless account. The verified code signs the guest in and
 * app/reset-password.tsx sets the new password on that session.
 */
export async function sendPasswordResetCode(client: Client, phoneE164: string) {
  const { error } = await client.auth.signInWithOtp({
    phone: phoneE164,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

/**
 * Link a verified phone to an EXISTING (social) account so the number on the
 * account is one the guest proved they hold. GoTrue sends the code to the new
 * number; verifyPhoneLink confirms it.
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

/** Resend for the link flow. */
export async function resendPhoneLink(client: Client, phoneE164: string) {
  const { error } = await client.auth.resend({ type: 'phone_change', phone: phoneE164 });
  if (error) throw error;
}

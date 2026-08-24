/**
 * Auth mutations, separated from hooks/screens so they stay unit-testable
 * (each takes the client as an argument — no RN imports here).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';

type Client = SupabaseClient<Database>;

/** Deep-link target for the password-recovery email (app.config.ts scheme). */
export const RESET_REDIRECT = 'touchpadel://reset-password';

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
export async function signUp(client: Client, args: SignUpArgs) {
  const { data, error } = await client.auth.signUp({
    email: args.email.trim(),
    password: args.password,
    options: {
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

export async function resendVerification(client: Client, email: string) {
  const { error } = await client.auth.resend({ type: 'signup', email: email.trim() });
  if (error) throw error;
}

export async function sendPasswordReset(client: Client, email: string) {
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: RESET_REDIRECT,
  });
  if (error) throw error;
}

export async function updatePassword(client: Client, newPassword: string) {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut(client: Client) {
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Local sign-up form validation. Returns an i18n-mappable code or null when valid. */
export function validateSignUp(args: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): 'NAME_REQUIRED' | 'EMAIL_INVALID' | 'PASSWORD_TOO_SHORT' | 'PASSWORD_MISMATCH' | null {
  if (!args.fullName.trim()) return 'NAME_REQUIRED';
  if (!/^\S+@\S+\.\S+$/.test(args.email.trim())) return 'EMAIL_INVALID';
  if (args.password.length < 8) return 'PASSWORD_TOO_SHORT';
  if (args.password !== args.confirmPassword) return 'PASSWORD_MISMATCH';
  return null;
}

/**
 * The change-password screen's decisions, PURE so they are unit-tested under
 * plain node (no react-native, no supabase client).
 *
 * The screen proves knowledge of the current password by signing in with it
 * again, then calls `updateUser({ password })`. Both calls can fail for
 * reasons that are not "wrong password", and the screen used to report every
 * one of them as "Email or password is incorrect" — on a screen with no email
 * field, for a failure that may have been the server refusing the NEW password
 * (owner, 2026-09-11: "there is no email there … I think it's broken"). Each
 * failure now has a name, and the screen tells the guest which one it was.
 *
 * GoTrue reports a machine `code` on its errors (invalid_credentials,
 * email_not_confirmed, same_password, weak_password, reauthentication_needed)
 * and, on older servers, only the message; both are read, code first.
 */

import { hasRealEmail } from '../auth/phoneOtp';

/** The minimal shape of a GoTrue AuthError this module reads. */
export interface AuthFailure {
  code?: string | null;
  message?: string | null;
}

const codeOf = (err: unknown): string => {
  const e = err as AuthFailure | null | undefined;
  return (e?.code ?? '').toLowerCase();
};
const messageOf = (err: unknown): string => {
  const e = err as AuthFailure | null | undefined;
  return e?.message ?? '';
};

export type SignInFailure = 'wrong-password' | 'email-not-confirmed' | 'other';

/** Why proving the current password failed. */
export function classifySignInFailure(err: unknown): SignInFailure {
  const code = codeOf(err);
  const message = messageOf(err);
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message))
    return 'wrong-password';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message))
    return 'email-not-confirmed';
  return 'other';
}

export type UpdateFailure = 'same-password' | 'weak-password' | 'reauthentication' | 'other';

/** Why the server refused the new password. */
export function classifyUpdateFailure(err: unknown): UpdateFailure {
  const code = codeOf(err);
  const message = messageOf(err);
  if (
    code === 'same_password' ||
    /should be different|same as the old|same password/i.test(message)
  )
    return 'same-password';
  if (code === 'weak_password' || /weak|at least \d+ characters|should contain/i.test(message))
    return 'weak-password';
  if (code === 'reauthentication_needed' || /reauthentication/i.test(message))
    return 'reauthentication';
  return 'other';
}

/**
 * Can this account change a password at all? Only an account with a password
 * identity has one: `email` (accounts from before 2026-09-15, staff) or
 * `phone` (every guest sign-up since). A guest who only ever signed in with
 * Google or Apple has no password, and for them "current password" cannot be
 * right — every attempt failed as "incorrect" and the feature looked broken.
 * GoTrue lists every linked provider in `app_metadata.providers`, with the
 * first one alone in `app_metadata.provider` on older tokens.
 *
 * A social account that later LINKED a number also lists `phone` but has no
 * password; passwordProofOf still offers the row, and the guest recovers
 * through Forgot password. That case is rare enough not to hide the row for
 * everyone.
 */
const PASSWORD_PROVIDERS = ['email', 'phone'];

export function hasPasswordSignIn(
  user: { app_metadata?: { provider?: string; providers?: string[] } | null } | null | undefined,
): boolean {
  const meta = user?.app_metadata;
  if (!meta) return false;
  if (Array.isArray(meta.providers)) return meta.providers.some((p) => PASSWORD_PROVIDERS.includes(p));
  return PASSWORD_PROVIDERS.includes(meta.provider ?? '');
}

/**
 * What the change-password screen re-authenticates with: the phone for a
 * phone account (GoTrue stores it as digits, no '+'), else a real email.
 * Null when the account has no password to prove.
 */
export type PasswordProof = { kind: 'phone'; phone: string } | { kind: 'email'; email: string };

export function passwordProofOf(
  user:
    | {
        email?: string | null;
        phone?: string | null;
        app_metadata?: { provider?: string; providers?: string[] } | null;
      }
    | null
    | undefined,
): PasswordProof | null {
  if (!user || !hasPasswordSignIn(user)) return null;
  const meta = user.app_metadata;
  const providers = Array.isArray(meta?.providers) ? meta.providers : [meta?.provider ?? ''];
  const digits = (user.phone ?? '').replace(/\D/g, '');
  if (providers.includes('phone') && digits) return { kind: 'phone', phone: `+${digits}` };
  if (providers.includes('email') && hasRealEmail(user)) return { kind: 'email', email: user.email!.trim() };
  return null;
}

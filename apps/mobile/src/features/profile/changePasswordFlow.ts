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
 * Can this account change a password at all? Only an account with an EMAIL
 * (password) identity has one to change; a guest who only ever signed in with
 * Google or Apple has no password, and for them "current password" cannot be
 * right — every attempt failed as "incorrect" and the feature looked broken.
 * GoTrue lists every linked provider in `app_metadata.providers`, with the
 * first one alone in `app_metadata.provider` on older tokens.
 */
export function hasPasswordSignIn(
  user: { app_metadata?: { provider?: string; providers?: string[] } | null } | null | undefined,
): boolean {
  const meta = user?.app_metadata;
  if (!meta) return false;
  if (Array.isArray(meta.providers)) return meta.providers.includes('email');
  return meta.provider === 'email';
}

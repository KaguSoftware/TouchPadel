/**
 * Email + password auth — the PURE half (no RN / expo / supabase imports;
 * unit-tested under plain node like phoneOtp.ts). The Supabase calls live in
 * ./api.ts; the screens are app/sign-up.tsx, app/sign-in.tsx,
 * app/forgot-password.tsx, app/verify-email.tsx and app/reset-password.tsx.
 *
 * History: email sign-up / sign-in / verify / reset were the SOW's contractual
 * path (M1), removed from the guest app on 2026-09-15 when phone + password
 * became the only way in, and restored BESIDE phone on 2026-09-20 (Phase 2
 * plan, O2: the removal had no change-control record and the M1 acceptance
 * names email). Phone stays the default segment; email is one tap away on
 * the same screens. An email guest still owes a phone before booking — the
 * sign-up form requires one, and complete-profile / 0059 PHONE_REQUIRED catch
 * any account that lacks it.
 */
import type { MessageKey } from '@touch/i18n';
import { errorMessageOf } from '../../lib/network';
import { mapErrorToKey } from '../booking/errors';

/** Which of the two password sign-in methods a screen is showing. */
export type AuthMethod = 'phone' | 'email';

/**
 * Narrow an untrusted `method` route param. Phone is the default so a screen
 * reached with no param — the welcome buttons, a redirect — opens exactly as
 * it did before email came back.
 */
export function parseAuthMethod(value: unknown): AuthMethod {
  return value === 'email' ? 'email' : 'phone';
}

/** Loose on purpose: GoTrue is the authority; this only stops an obvious typo before a request. */
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

function codeOf(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** Sign-up refused because a CONFIRMED account already owns the address. */
export function isEmailTaken(err: unknown): boolean {
  const code = codeOf(err);
  if (code === 'email_exists' || code === 'user_already_exists') return true;
  return /already (registered|exists)/i.test(errorMessageOf(err) ?? '');
}

/**
 * With email confirmations on, GoTrue does NOT error for an existing
 * confirmed address (that would let anyone probe who has an account). It
 * answers as if the sign-up succeeded, with a user that has NO identities.
 * The screen has to read that shape or the guest waits for a mail that never
 * comes.
 */
export function signUpHidExistingEmail(
  data: { user: { identities?: unknown[] | null } | null } | null | undefined,
): boolean {
  const identities = data?.user?.identities;
  return Array.isArray(identities) && identities.length === 0;
}

/** Too many mails asked for (GoTrue's per-address and per-project caps). */
export function isEmailRateLimited(err: unknown): boolean {
  const code = codeOf(err);
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return true;
  return /rate limit/i.test(errorMessageOf(err) ?? '');
}

/**
 * Copy for a failure of the email sign-up / reset requests. The one case with
 * its own advice is the rate limit ("wait"); everything else — transport, an
 * RPC-style code, the unknown — is what the generic mapper already says.
 */
export function mapEmailAuthError(err: unknown): MessageKey {
  if (isEmailRateLimited(err)) return 'errors.tooManyRequests';
  return mapErrorToKey(err);
}

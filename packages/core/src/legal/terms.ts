/**
 * The Terms of Service / Privacy Policy version a guest must have accepted.
 *
 * Bump this (to the day the new text is published, `YYYY-MM-DD`, or
 * `YYYY-MM-DD.N` for a second change the same day) whenever the Terms or the
 * Privacy Policy change in a way a guest must agree to again. Every signed-in
 * guest whose `profiles.terms_version` differs then meets the app's consent
 * screen on next launch, and app.accept_terms (0153) records the new version.
 *
 * The format is enforced by the profiles_terms_version_format CHECK; the test
 * beside this file keeps the two in step.
 */
export const CURRENT_TERMS_VERSION = '2026-09-23';

/** The pattern 0153 accepts — `YYYY-MM-DD`, optionally `.N`. */
export const TERMS_VERSION_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[0-9]{1,3})?$/;

/**
 * True when this account still has to accept the current terms. A profile that
 * has not loaded yet (`null`) is NOT treated as needing acceptance: the gate
 * must never flash over a guest whose row simply has not arrived.
 */
export function needsTermsAcceptance(
  profile: { terms_version: string | null } | null | undefined,
  current: string = CURRENT_TERMS_VERSION,
): boolean {
  if (!profile) return false;
  return profile.terms_version !== current;
}

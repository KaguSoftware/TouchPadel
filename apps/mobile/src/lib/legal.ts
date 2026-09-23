import type { Locale } from '@touch/i18n';

/**
 * The public privacy policy and support pages (apps/web/app/[locale]/privacy|support).
 * App Store Guideline 5.1.1(i) wants the privacy policy reachable inside the app
 * as well as in the listing, so Settings and Sign up link here. Opened in the
 * system browser, never an in-app web view (no "unrestricted web access").
 *
 * The venue's domain is live (2026-09-23; the bare touch-padel.com redirects to
 * www). EXPO_PUBLIC_SITE_URL still overrides it per build.
 */
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.touch-padel.com').replace(/\/+$/, '');

export type LegalPage = 'privacy' | 'support';

export function legalUrl(page: LegalPage, locale: Locale): string {
  return `${SITE_URL}/${locale}/${page}`;
}

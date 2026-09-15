import type { Locale } from '@touch/i18n';

/**
 * The public privacy policy and support pages (apps/web/app/[locale]/privacy|support).
 * App Store Guideline 5.1.1(i) wants the privacy policy reachable inside the app
 * as well as in the listing, so Settings and Sign up link here. Opened in the
 * system browser, never an in-app web view (no "unrestricted web access").
 *
 * EXPO_PUBLIC_SITE_URL moves these to touch-padel.com once the domain is live;
 * until then the Vercel URL is the one App Store Connect also carries.
 */
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://touch-padel-web.vercel.app').replace(/\/+$/, '');

export type LegalPage = 'privacy' | 'support';

export function legalUrl(page: LegalPage, locale: Locale): string {
  return `${SITE_URL}/${locale}/${page}`;
}

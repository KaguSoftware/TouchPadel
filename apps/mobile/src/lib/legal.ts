import type { Locale } from '@touch/i18n';

/**
 * The public legal pages (apps/web/app/[locale]/{privacy,terms,support,delete-account}).
 * App Store Guideline 5.1.1(i) wants the privacy policy reachable inside the app
 * as well as in the listing, so Settings and Sign up link here; the Terms are what
 * the sign-up checkbox and the accept-terms screen record (app.accept_terms, 0153). Opened in the
 * system browser, never an in-app web view (no "unrestricted web access").
 *
 * The venue's domain is live (2026-09-23; the bare touch-padel.com redirects to
 * www). EXPO_PUBLIC_SITE_URL still overrides it per build.
 */
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.touch-padel.com').replace(/\/+$/, '');

/**
 * The public site's origin, no trailing slash. Also the base of an open
 * match's share link (`${siteUrl()}/m/<token>`, docs/design/open-matches/guest.md
 * §4.14): its host must be the one every build claims through
 * EXPO_PUBLIC_LINK_DOMAIN (eas.json), which features/matches' links test pins,
 * so a shared link always opens the app that can read it.
 */
export function siteUrl(): string {
  return SITE_URL;
}

export type LegalPage = 'privacy' | 'terms' | 'support' | 'delete-account';

export function legalUrl(page: LegalPage, locale: Locale): string {
  return `${SITE_URL}/${locale}/${page}`;
}

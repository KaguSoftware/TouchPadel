/**
 * The public site's two modes (packages/ui/src/tokens/site.ts): NIGHT, the app's blue
 * mode and the default for every first visit (owner, 2026-09-23: "night court for
 * sure"), and LIGHT, the app's light palette.
 *
 * The choice lives in a cookie rather than localStorage so the SERVER renders the right
 * mode: the page arrives painted, with no flash of the other ground before hydration.
 * Isomorphic on purpose: the server reads it (mode.server.ts), the toggle writes it.
 * Imports nothing, because the toggle ships it to the browser; the theme colours per
 * mode live in themeColor.ts for the same reason.
 */
export const SITE_MODE_COOKIE = 'tp-site-mode';

export type SiteMode = 'night' | 'light';

export const DEFAULT_SITE_MODE: SiteMode = 'night';

/** One year, in seconds. */
export const SITE_MODE_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but an explicit 'light' is night: a missing or tampered cookie gets the brand. */
export function parseSiteMode(value: string | null | undefined): SiteMode {
  return value === 'light' ? 'light' : DEFAULT_SITE_MODE;
}

/** The `document.cookie` string the toggle writes. `Secure` only where it can be honoured. */
export function siteModeCookie(mode: SiteMode, secure: boolean): string {
  return [
    `${SITE_MODE_COOKIE}=${mode}`,
    `Max-Age=${SITE_MODE_MAX_AGE}`,
    'Path=/',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** Read the mode back out of a raw `document.cookie` string (the error boundary has no server). */
export function siteModeFromCookieString(cookie: string): SiteMode {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SITE_MODE_COOKIE}=([^;]*)`));
  return parseSiteMode(match?.[1]);
}

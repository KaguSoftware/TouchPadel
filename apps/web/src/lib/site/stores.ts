/**
 * App Store / Google Play links for the site's store buttons.
 *
 * The app is on neither store yet (checked 2026-09-23: the iTunes lookup for id
 * 6809045183 returns nothing, Play returns 404), so both are UNSET and the site shows
 * "coming soon" buttons that are not links. The day a listing goes live, setting
 * `NEXT_PUBLIC_APP_STORE_URL` / `NEXT_PUBLIC_PLAY_STORE_URL` in Vercel turns the matching
 * button into the official badge, with no code change.
 *
 * A value is accepted only as an https URL on the store's own host. Anything else is
 * treated as unset: a typo in an env var must never put a link to somewhere else behind
 * an Apple or Google badge.
 */
export interface StoreLinks {
  appStore: string | null;
  googlePlay: string | null;
}

const APP_STORE_HOST = 'apps.apple.com';
const PLAY_STORE_HOST = 'play.google.com';

export function validStoreUrl(raw: string | undefined | null, host: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) {
    return null;
  }
  return url.toString();
}

/**
 * `env` is injectable for tests. The default names each variable LITERALLY: Next
 * inlines `process.env.NEXT_PUBLIC_*` at build only where the full name is written out.
 */
export function getStoreLinks(
  env: { appStore?: string; googlePlay?: string } = {
    appStore: process.env.NEXT_PUBLIC_APP_STORE_URL,
    googlePlay: process.env.NEXT_PUBLIC_PLAY_STORE_URL,
  },
): StoreLinks {
  return {
    appStore: validStoreUrl(env.appStore, APP_STORE_HOST),
    googlePlay: validStoreUrl(env.googlePlay, PLAY_STORE_HOST),
  };
}

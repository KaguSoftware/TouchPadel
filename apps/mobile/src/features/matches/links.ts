/**
 * Links in and out of an open match (docs/design/open-matches/guest.md §4.18,
 * §4.19, §4.14 Share). PURE.
 *
 * IN. A shared invite is `https://www.touch-padel.com/m/<token>` (the site's
 * proxy 307s it to `/{locale}/m/<token>`), and the app claims `/m/*`,
 * `/en/m/*` and `/ar/m/*` (universal links, app.config.ts). The router has no
 * locale segment, so `app/+native-intent.ts` folds every spelling onto the one
 * route `app/m/[token].tsx` through `normaliseIncomingPath`. Whether
 * expo-router 57 hands over the full URL or the bare path for a universal link
 * is unverified (a device check), so both are accepted. Everything else passes
 * through untouched: the payment return link, the auth code links
 * (features/auth/deepLink.ts), `/auth/*`.
 *
 * OUT. The share link is built on `siteUrl()` (src/lib/legal.ts), the same
 * origin every build claims through EXPO_PUBLIC_LINK_DOMAIN; the links test
 * pins the two together so a shared link always opens the app.
 */
import { siteUrl } from '../../lib/legal';

/** A share token (0258: 22 url-safe characters). `m/[token]` shows the closed layout for anything else. */
export const MATCH_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function isMatchToken(value: unknown): value is string {
  return typeof value === 'string' && MATCH_TOKEN_RE.test(value);
}

/**
 * `(https://<host>)?(/(en|ar))?/m/<token>` and `touchpadel://m/<token>`
 * → `/m/<token>` (a trailing query/fragment kept). Anything else is returned
 * as it came. The token is not judged here — `m/[token]` validates it — but a
 * remainder that is not token-shaped (a `/`, a `.`, `..` traversal) folds to a
 * bare `/m/`, never a path that could navigate off the match route (LOW-2).
 */
export function normaliseIncomingPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) return path;
  const scheme = /^touchpadel:\/\/\/?(?:(?:en|ar)\/)?m\/(.*)$/i.exec(path);
  if (scheme) return foldMatchToken(scheme[1] ?? '');
  // The origin, when present, must end in its own slash: `…touch-padel.com/auth`
  // is never read as host `…touch-padel.co` + `m/auth`.
  const web = /^(?:https?:\/\/[^/?#]+\/|\/)?(?:(?:en|ar)\/)?m\/(.*)$/i.exec(path);
  // A bare relative path the router already routes ("m/abc") only needs its slash.
  if (web) return foldMatchToken(web[1] ?? '');
  return path;
}

/**
 * Fold a captured `m/<rest>` onto a safe route (SEC, pentest 2026-10, LOW-2).
 * Only token characters may follow `/m/`; a trailing `?query`/`#fragment` is
 * kept (invites carry `?utm=…`). A remainder with a `.`, a `/` or `..`
 * traversal folds to a bare `/m/`, so a crafted link such as
 * `/m/../../delete-account` can never fold into a path that leaves the match
 * route, whatever expo-router does with `..`.
 */
function foldMatchToken(rest: string): string {
  return `/m/${/^[A-Za-z0-9_-]+(?:[?#].*)?$/.test(rest) ? rest : ''}`;
}

/** The invite link for a match (`${siteUrl()}/m/<token>`); the operator's has the same shape. */
export function matchShareUrl(token: string): string {
  return `${siteUrl()}/m/${token}`;
}

/** The host the share links use, for the check against EXPO_PUBLIC_LINK_DOMAIN. */
export function shareHost(): string {
  return new URL(siteUrl()).host;
}

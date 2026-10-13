/**
 * Links in and out of a coach's page (docs/design/coaching/guest.md §4.12;
 * C-11). PURE.
 *
 * IN. The website and the share sheet hand out
 * `https://www.touch-padel.com/c/<coachId>`; the app claims `/c/*`, `/en/c/*`,
 * `/ar/c/*` (universal links, app.config.ts `COACH_LINK_PREFIXES`) and
 * `touchpadel://c/<id>`. The router has no locale segment, so
 * `app/+native-intent.ts` folds every spelling onto `app/coach/[id].tsx`
 * through `normaliseCoachLink`, before the open-match fold. The id is not
 * checked here: the coach screen validates it (`isCoachId`) and shows the
 * not-found layout otherwise. Opening a link never writes the stored branch.
 *
 * OUT. `coachShareUrl` is built on `siteUrl()` (src/lib/legal.ts), the host
 * every build claims, as the match invite is; the links test pins the two.
 * Since 0337 the link names the coach (`/c/omar-karim`, the coach's slug);
 * the coach screen takes a slug or an id, so a link shared before still opens.
 */
import type { Locale } from '@touch/i18n';
import { siteUrl } from '../../lib/legal';

/** A coach id is `coaches.id`, a uuid (never a profile id, R43). */
export const COACH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCoachId(value: unknown): value is string {
  return typeof value === 'string' && COACH_ID_RE.test(value);
}

/** A coach's share link name (`coaches.slug`, 0337's app.coach_slug_ok), any case. */
export const COACH_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,47}$/i;

export function isCoachSlug(value: unknown): value is string {
  return typeof value === 'string' && COACH_SLUG_RE.test(value) && !isCoachId(value);
}

/**
 * `touchpadel://(en/|ar/)?c/<id>` and `(https://<host>/|/)?(en/|ar/)?c/<id>`
 * → `/coach/<id>` (a trailing query/fragment kept); a non-`c/` path → null, so
 * the caller hands it to the next fold. A `c/` whose remainder is not id-shaped
 * (a `/`, a `.`, `..`) folds to a bare `/coach/` (LOW-2), never a navigable
 * path. The origin must end in its own slash, as `normaliseIncomingPath`
 * requires: `…touch-padel.com/club` is never read as `c/lub`.
 */
export function normaliseCoachLink(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const scheme = /^touchpadel:\/\/\/?(?:(?:en|ar)\/)?c\/(.+)$/i.exec(path);
  if (scheme) return foldCoachId(scheme[1] ?? '');
  const web = /^(?:https?:\/\/[^/?#]+\/|\/)?(?:(?:en|ar)\/)?c\/(.+)$/i.exec(path);
  if (web) return foldCoachId(web[1] ?? '');
  return null;
}

/**
 * Fold a captured `c/<rest>` onto a safe route (SEC, pentest 2026-10, LOW-2).
 * Only id/slug characters may follow `/coach/`; a trailing `?query`/`#fragment`
 * is kept. A remainder with a `/`, a `.` or `..` folds to a bare `/coach/`
 * instead of a navigable path, so a crafted `/c/../../x` cannot escape the
 * coach route whatever expo-router does with `..`. `coach/[id]` still validates
 * the id/slug itself.
 */
function foldCoachId(rest: string): string {
  return `/coach/${/^[A-Za-z0-9_-]+(?:[?#].*)?$/.test(rest) ? rest : ''}`;
}

/**
 * The share link for a coach (`${siteUrl()}/<locale>/c/<slug>`, or the id from a server before
 * 0337): names the coach, never a price (GL-4). The locale is the sharer's: a link preview (WhatsApp) is fetched with no cookie and
 * no useful Accept-Language, so a bare `/c/<id>` would always unfurl in the site's default.
 */
export function coachShareUrl(coach: { id: string; slug: string | null }, locale: Locale): string {
  return `${siteUrl()}/${locale}/c/${coach.slug ?? coach.id}`;
}

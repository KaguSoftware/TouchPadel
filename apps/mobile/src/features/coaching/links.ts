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
 */
import type { Locale } from '@touch/i18n';
import { siteUrl } from '../../lib/legal';

/** A coach id is `coaches.id`, a uuid (never a profile id, R43). */
export const COACH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCoachId(value: unknown): value is string {
  return typeof value === 'string' && COACH_ID_RE.test(value);
}

/**
 * `touchpadel://(en/|ar/)?c/<rest>` and `(https://<host>/|/)?(en/|ar/)?c/<rest>`
 * → `/coach/<rest>` (the query and fragment kept); anything else → null, so
 * the caller hands it to the next fold. The origin must end in its own slash,
 * as `normaliseIncomingPath` requires: `…touch-padel.com/club` is never read
 * as `c/lub`.
 */
export function normaliseCoachLink(path: string): string | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const scheme = /^touchpadel:\/\/\/?(?:(?:en|ar)\/)?c\/(.+)$/i.exec(path);
  if (scheme) return `/coach/${scheme[1]}`;
  const web = /^(?:https?:\/\/[^/?#]+\/|\/)?(?:(?:en|ar)\/)?c\/(.+)$/i.exec(path);
  if (web) return `/coach/${web[1]}`;
  return null;
}

/**
 * The share link for a coach (`${siteUrl()}/<locale>/c/<id>`): names the coach, never a price
 * (GL-4). The locale is the sharer's: a link preview (WhatsApp) is fetched with no cookie and
 * no useful Accept-Language, so a bare `/c/<id>` would always unfurl in the site's default.
 */
export function coachShareUrl(coachId: string, locale: Locale): string {
  return `${siteUrl()}/${locale}/c/${coachId}`;
}

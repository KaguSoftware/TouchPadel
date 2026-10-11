import type { Locale } from '@touch/i18n';

/**
 * The pure half of the coach link page (app/[locale]/c/[id]/page.tsx,
 * docs/design/coaching/guest.md §4.12, §4.14.3).
 *
 * The website's "Book in the app" and the app's share sheet hand out
 * `https://www.touch-padel.com/c/<coachId>`. The app claims that link where it can (universal
 * links, `LINK_PATHS`), and the web page answers everywhere else with an "Open in the app"
 * button on `touchpadel://c/<id>`. The id is a `coaches.id` (never a profile id, R43), a uuid.
 * Since 0336 the link names the coach instead (`/c/omar-karim`, `coaches.slug`); a link with the
 * id still opens. Anything that is neither is dropped before a read, and the page shows its
 * not-found layout.
 */

/** The app's own coach route (apps/mobile `app/coach/[id].tsx`); `scheme: 'touchpadel'`. */
export const APP_COACH_URL = 'touchpadel://c';

/** The app with no route, for a link that names no coach the site can show. */
export const APP_HOME_URL = 'touchpadel://';

const COACH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The `[id]` segment as a lower-case uuid, else null. */
export function parseCoachId(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const id = value.toLowerCase();
  return COACH_ID.test(id) ? id : null;
}

/** A coach's share link name (`coaches.slug`, 0336's app.coach_slug_ok). */
const COACH_SLUG = /^[a-z0-9][a-z0-9-]{1,47}$/;

/**
 * The `[id]` segment as a coach's id or slug, lower-cased, else null: what the page looks the
 * coach up by.
 */
export function parseCoachRef(raw: string | string[] | undefined): string | null {
  const id = parseCoachId(raw);
  if (id) return id;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const slug = value.toLowerCase();
  return COACH_SLUG.test(slug) ? slug : null;
}

/** A slug as the server sent it, or null for anything that cannot be one. */
export function parseCoachSlug(raw: string): string | null {
  const ref = parseCoachRef(raw);
  return ref && !parseCoachId(ref) ? ref : null;
}

/** The segment a coach's link carries: their slug, or the id from a server before 0336. */
export function coachSegment(coach: { id: string; slug: string | null }): string {
  return coach.slug ?? coach.id;
}

/** The app link for a coach; the app's home without one. */
export function appCoachHref(id: string | null): string {
  return id ? `${APP_COACH_URL}/${id}` : APP_HOME_URL;
}

/**
 * The coach's page in a language, by `coachSegment` or the segment the visitor came in on. A
 * segment that is neither an id nor a slug has no page of its own, so the link goes to that
 * language's coaching page instead.
 */
export function coachLinkPath(locale: Locale, id: string | null): string {
  return id ? `/${locale}/c/${id}` : `/${locale}/coaching`;
}

import { formatDate, formatTime, formatWeekdayShort, isolate, VENUE_TZ, type Locale } from '@touch/i18n';

/**
 * The pure half of the open-match invite page (app/[locale]/m/[token]/page.tsx,
 * docs/design/open-matches/guest.md §4.20).
 *
 * A player shares `https://www.touch-padel.com/m/<token>`; the app claims that link where
 * it can (universal links, `LINK_PATHS`), and this page answers everywhere else. The token
 * is the match's `share_token`: 22 characters of the URL-safe base64 alphabet, never a
 * dot (so the proxy matcher never skips the path, and the CSP is always on it). Anything
 * else is dropped before a read and the page shows the closed layout, as the server's own
 * `match_invite` would.
 *
 * DF-9 and GD-4: the page shows no names, no price and no ids. `parseMatchInvite` copies
 * only the fields the page shows out of the RPC's answer, so a field the server ever adds
 * cannot reach the markup by accident.
 */

/** The app's own link route (apps/mobile `app/m/[token].tsx`); `scheme: 'touchpadel'`. */
export const APP_MATCH_URL = 'touchpadel://m';

/** The app with no route, for a link whose token is no token. */
const APP_HOME_URL = 'touchpadel://';

const TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** The `[token]` segment when it is a share token, else null. */
export function parseMatchToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  return TOKEN.test(value) ? value : null;
}

/**
 * The share card's image. Static on purpose: WhatsApp caches a link preview, so a live
 * seat count in it would go stale (guest.md §4.20). The site's own poster until the open
 * match poster (`/brand/site/og-match-{en,ar}.png`) is delivered (§4.29 item 37).
 */
export function inviteOgImage(locale: Locale): string {
  return `/brand/site/og-touch-padel-${locale}.png`;
}

/** The app link for a share token; the app's home without one. */
export function appMatchHref(token: string | null): string {
  return token ? `${APP_MATCH_URL}/${token}` : APP_HOME_URL;
}

/**
 * The same invite in another language. A token that is no token has no page of its own
 * to switch to, so the switch goes to that language's home.
 */
export function matchInvitePath(locale: Locale, token: string | null): string {
  return token ? `/${locale}/m/${token}` : `/${locale}`;
}

export type MatchInviteCategory = 'open' | 'women' | 'men';

/** What the page shows of an `open` or `full` invite, and nothing more. */
export interface MatchInviteCard {
  startAt: string;
  timezone: string;
  category: MatchInviteCategory;
  /** `join_policy = 'approve'`: the organiser approves each player. */
  approve: boolean;
  seatsLeft: number;
  venue: { name_en: string; name_ar: string };
}

/**
 * The read's explicit status union (apps/web/CLAUDE.md): `closed` is every answer the
 * server gives for a match nobody can join, an unknown token included (no oracle);
 * `error` is a read that failed or came back in a shape this page does not know.
 */
export type MatchInvite =
  | { status: 'open' | 'full'; card: MatchInviteCard }
  | { status: 'closed' }
  | { status: 'error' };

const CATEGORIES: readonly string[] = ['open', 'women', 'men'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `app.match_invite`'s jsonb (guest.md §4.3) as the union above. */
export function parseMatchInvite(raw: unknown): MatchInvite {
  if (!isRecord(raw)) return { status: 'error' };
  if (raw.status === 'closed') return { status: 'closed' };
  if (raw.status !== 'open' && raw.status !== 'full') return { status: 'error' };

  const { start_at, timezone, category, join_policy, seats_left, venue } = raw;
  if (
    typeof start_at !== 'string' ||
    Number.isNaN(Date.parse(start_at)) ||
    typeof timezone !== 'string' ||
    typeof category !== 'string' ||
    !CATEGORIES.includes(category) ||
    (join_policy !== 'open' && join_policy !== 'approve') ||
    typeof seats_left !== 'number' ||
    !Number.isInteger(seats_left) ||
    seats_left < 0 ||
    !isRecord(venue) ||
    typeof venue.name_en !== 'string' ||
    typeof venue.name_ar !== 'string'
  ) {
    return { status: 'error' };
  }
  return {
    status: raw.status,
    card: {
      startAt: start_at,
      timezone,
      category: category as MatchInviteCategory,
      approve: join_policy === 'approve',
      seatsLeft: seats_left,
      venue: { name_en: venue.name_en, name_ar: venue.name_ar },
    },
  };
}

/** The timezone when this runtime knows it, else the venue default (never a thrown render). */
function knownTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return VENUE_TZ;
  }
}

/**
 * The start as the `matches.web.when` parts, in the branch's own timezone (a guest
 * abroad still reads the time on the venue's clock): "Thu", "2 Oct 2026", "7:30 PM".
 * Latin digits in both languages (the formatters pin them); the date and the time are
 * bidi-isolated so an Arabic sentence keeps their order. Null for a date it cannot read.
 */
export function inviteWhen(
  startAt: string,
  timezone: string,
  locale: Locale,
): { weekday: string; date: string; time: string } | null {
  const at = new Date(startAt);
  if (Number.isNaN(at.getTime())) return null;
  const zone = knownTimeZone(timezone);
  return {
    weekday: formatWeekdayShort(at, locale, zone),
    date: isolate(formatDate(at, locale, zone)),
    time: isolate(formatTime(at, locale, zone)),
  };
}

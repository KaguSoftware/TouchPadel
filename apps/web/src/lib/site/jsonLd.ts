import type { Locale } from '@touch/i18n';
import { t } from '@touch/i18n';
import type { VenueBranch, VenueOpeningHours } from '@/lib/menu';
import { weekHours, type DayKey } from '@/lib/cafe/hours';
import { branchAddress, branchName } from './contact';

/**
 * Structured data for the landing page: a schema.org `SportsActivityLocation`.
 *
 * Only what the venue has confirmed: the name, the site URL, the logo, the address the
 * owner gave (Durrat Karbala, Karbala; contract §0, Revision B) and the opening hours read
 * live from venue_settings_public. NO telephone: the number on file is the unverified
 * +995 one, and a search engine would print it as the club's. An overnight window is
 * printed the way schema.org reads it: `closes` earlier than `opens` means the next
 * morning.
 *
 * BRANCHES (multi-venue slice 4): the top-level location is the default (oldest open)
 * branch, as before. A branch with its own address stored prints that address (and its
 * pinned map as `hasMap`); one without keeps the contract's address, so today's output
 * is unchanged. Every further open branch is a `department` of it (schema.org lets a
 * LocalBusiness list its departments), each with its own name, address and hours.
 */
const SCHEMA_DAY: Record<DayKey, string> = {
  mon: 'https://schema.org/Monday',
  tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday',
  fri: 'https://schema.org/Friday',
  sat: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday',
};

export interface OpeningHoursSpecification {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

/** Days that share a window collapse into one specification, in week order. */
export function openingHoursSpecification(
  venue: VenueOpeningHours | null | undefined,
): OpeningHoursSpecification[] {
  if (!venue) return [];
  const byWindow = new Map<string, OpeningHoursSpecification>();
  for (const { dayKey, windows } of weekHours(venue)) {
    for (const [opens, to] of windows) {
      // schema.org has no 24:00; the end of the day is 23:59.
      const closes = to === '24:00' ? '23:59' : to;
      const key = `${opens}|${closes}`;
      const spec = byWindow.get(key);
      if (spec) spec.dayOfWeek.push(SCHEMA_DAY[dayKey]);
      else
        byWindow.set(key, {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: [SCHEMA_DAY[dayKey]],
          opens,
          closes,
        });
    }
  }
  return [...byWindow.values()];
}

/** The club's address as the contract spells it, in every language. */
export const CLUB_ADDRESS = {
  '@type': 'PostalAddress',
  streetAddress: 'Durrat Karbala',
  addressLocality: 'Karbala',
  addressCountry: 'IQ',
} as const;

/**
 * A branch's stored address as a PostalAddress. With none stored, the main
 * branch keeps the contract's; a department (a later branch) has no address
 * rather than publishing the club's as its own.
 */
function postalAddress(
  locale: Locale,
  venue: VenueOpeningHours | null | undefined,
  { fallback = true }: { fallback?: boolean } = {},
) {
  const stored = branchAddress(locale, venue, { fallback: false });
  if (stored) return { '@type': 'PostalAddress', streetAddress: stored, addressCountry: 'IQ' } as const;
  return fallback ? CLUB_ADDRESS : null;
}

/** A stored https map link, or nothing (the Maps search is not a map of the place). */
function hasMap(venue: VenueOpeningHours | null | undefined): { hasMap?: string } {
  const url = venue?.map_url?.trim();
  return url && /^https:\/\//i.test(url) ? { hasMap: url } : {};
}

function department(locale: Locale, branch: VenueBranch): Record<string, unknown> {
  const hours = openingHoursSpecification(branch);
  const address = postalAddress(locale, branch, { fallback: false });
  return {
    '@type': 'SportsActivityLocation',
    name: `${t(locale, 'common.appName')} · ${branchName(locale, branch)}`,
    ...(address ? { address } : {}),
    ...hasMap(branch),
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
  };
}

export function buildLandingJsonLd({
  locale,
  origin,
  venue,
  branches = [],
}: {
  locale: Locale;
  origin: string;
  venue: VenueOpeningHours | null;
  /** every open branch, oldest first; the ones after the first become departments */
  branches?: readonly VenueBranch[];
}): Record<string, unknown> {
  const name = t(locale, 'common.appName');
  const hours = openingHoursSpecification(venue);
  const departments = branches.slice(1).map((b) => department(locale, b));
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name,
    ...(locale === 'ar' ? { alternateName: 'Touch Padel' } : {}),
    description: t(locale, 'site.seo.description'),
    url: `${origin}/${locale}`,
    logo: `${origin}/brand/site/icon-512.png`,
    image: `${origin}/brand/site/og-touch-padel-${locale}.png`,
    inLanguage: locale,
    address: postalAddress(locale, venue),
    ...hasMap(venue),
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
    ...(departments.length > 0 ? { department: departments } : {}),
  };
}

/**
 * Serialised for a `<script type="application/ld+json">`: `<` escaped so no value can
 * close the script element (Next's JSON-LD guide, `json-ld.md`).
 */
export function jsonLdString(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

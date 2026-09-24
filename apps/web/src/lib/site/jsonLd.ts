import type { Locale } from '@touch/i18n';
import { t } from '@touch/i18n';
import type { VenueOpeningHours } from '@/lib/menu';
import { weekHours, type DayKey } from '@/lib/cafe/hours';

/**
 * Structured data for the landing page: a schema.org `SportsActivityLocation`.
 *
 * Only what the venue has confirmed: the name, the site URL, the logo, the address the
 * owner gave (Durrat Karbala, Karbala; contract §0, Revision B) and the opening hours read
 * live from venue_settings_public. NO telephone: the number on file is the unverified
 * +995 one, and a search engine would print it as the club's. An overnight window is
 * printed the way schema.org reads it: `closes` earlier than `opens` means the next
 * morning.
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

export function buildLandingJsonLd({
  locale,
  origin,
  venue,
}: {
  locale: Locale;
  origin: string;
  venue: VenueOpeningHours | null;
}): Record<string, unknown> {
  const name = t(locale, 'common.appName');
  const hours = openingHoursSpecification(venue);
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
    address: CLUB_ADDRESS,
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
  };
}

/**
 * Serialised for a `<script type="application/ld+json">`: `<` escaped so no value can
 * close the script element (Next's JSON-LD guide, `json-ld.md`).
 */
export function jsonLdString(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

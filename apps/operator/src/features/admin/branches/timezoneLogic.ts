/**
 * The timezone picker's data (Open a new branch › Contact): every zone the
 * platform knows, with its country, continent, city and today's offset, and
 * the three lists the picker walks (continents, a continent's countries, a
 * country's cities) plus a search across all of them. Pure, so it is tested
 * under node; the table itself is timezoneData.ts.
 */
import { TZ_CONTINENTS, TZ_COUNTRY_CONTINENT, TZ_ZONES, type TzContinent } from './timezoneData';

export interface TzZone {
  id: string;
  country: string;
  countryName: string;
  continent: TzContinent;
  city: string;
  /** "GMT+3", "GMT+5:30", "GMT": today's offset, daylight saving included. */
  offset: string;
}

/** The zone's city: its last part, underscores as spaces ("America/New_York" → "New York"). */
export function tzCity(zone: string): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

/** Today's offset as Intl writes it ("GMT+3"), or null when the platform does not know the zone. */
export function tzOffset(zone: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/** Minutes east of UTC for an offset label ("GMT+5:30" → 330), for ordering. */
function offsetMinutes(label: string): number {
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3] ?? 0);
  return m[1] === '-' ? -minutes : minutes;
}

/**
 * Every zone the platform accepts, named in `locale`. A zone the platform does
 * not know is left out rather than offered and refused on save.
 */
export function buildTzZones(locale: string, at: Date = new Date()): TzZone[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  const out: TzZone[] = [];
  for (const [id, country] of TZ_ZONES) {
    const offset = tzOffset(id, at);
    const continent = TZ_COUNTRY_CONTINENT[country];
    if (!offset || !continent) continue;
    out.push({ id, country, countryName: names?.of(country) ?? country, continent, city: tzCity(id), offset });
  }
  return out;
}

export interface TzCountry {
  code: string;
  name: string;
  cities: number;
}

/** The continents that hold at least one zone, in the picker's order, with their country counts. */
export function tzContinents(zones: readonly TzZone[]): { key: TzContinent; countries: number }[] {
  return TZ_CONTINENTS.map((key) => ({ key, countries: new Set(zones.filter((z) => z.continent === key).map((z) => z.country)).size })).filter(
    (c) => c.countries > 0,
  );
}

/** A continent's countries, by name in the operator's language. */
export function tzCountries(zones: readonly TzZone[], continent: TzContinent, locale: string): TzCountry[] {
  const byCode = new Map<string, TzCountry>();
  for (const z of zones) {
    if (z.continent !== continent) continue;
    const c = byCode.get(z.country);
    if (c) c.cities += 1;
    else byCode.set(z.country, { code: z.country, name: z.countryName, cities: 1 });
  }
  return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** A country's cities, east to west, then by name. */
export function tzCities(zones: readonly TzZone[], country: string): TzZone[] {
  return zones
    .filter((z) => z.country === country)
    .sort((a, b) => offsetMinutes(b.offset) - offsetMinutes(a.offset) || a.city.localeCompare(b.city));
}

/**
 * The zones a search matches: the city, the country (in the operator's
 * language and by code), the continent's name or the zone id, case- and
 * accent-blind. Empty for an empty query.
 */
export function tzSearch(zones: readonly TzZone[], query: string, continentName: (c: TzContinent) => string): TzZone[] {
  const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  return zones
    .filter((z) => fold(`${z.city} ${z.countryName} ${z.country} ${continentName(z.continent)} ${z.id}`).includes(q))
    .sort((a, b) => a.city.localeCompare(b.city));
}

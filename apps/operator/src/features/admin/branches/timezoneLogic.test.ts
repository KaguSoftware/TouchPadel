import { describe, expect, it } from 'vitest';
import { TZ_COUNTRY_CONTINENT, TZ_ZONES } from './timezoneData';
import { buildTzZones, tzCities, tzCity, tzContinents, tzCountries, tzOffset, tzSearch } from './timezoneLogic';

// A fixed winter day, so daylight saving cannot move an offset under the test.
const AT = new Date('2026-01-15T12:00:00Z');
const zones = buildTzZones('en', AT);
const name = (c: string) => c;

describe('timezone picker data', () => {
  it('names every zone country with a continent', () => {
    for (const [, country] of TZ_ZONES) expect(TZ_COUNTRY_CONTINENT[country], country).toBeTruthy();
  });

  it('reads the city from the zone id', () => {
    expect(tzCity('America/New_York')).toBe('New York');
    expect(tzCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  it("gives today's offset from the platform", () => {
    expect(tzOffset('Asia/Baghdad', AT)).toBe('GMT+3');
    expect(tzOffset('Asia/Kolkata', AT)).toBe('GMT+5:30');
    expect(tzOffset('Not/AZone', AT)).toBeNull();
  });

  it('puts Baghdad in Asia › Iraq', () => {
    const baghdad = zones.find((z) => z.id === 'Asia/Baghdad');
    expect(baghdad).toMatchObject({ continent: 'asia', country: 'IQ', countryName: 'Iraq', city: 'Baghdad', offset: 'GMT+3' });
  });

  it('lists the continents in order, each with its countries', () => {
    const list = tzContinents(zones);
    expect(list.map((c) => c.key)).toEqual(['asia', 'africa', 'europe', 'americas', 'oceania', 'antarctica']);
    expect(list.every((c) => c.countries > 0)).toBe(true);
  });

  it("counts a country's cities and lists them east to west", () => {
    const us = tzCountries(zones, 'americas', 'en').find((c) => c.code === 'US');
    expect(us?.cities).toBeGreaterThan(10);
    const cities = tzCities(zones, 'US').map((z) => z.city);
    expect(cities.indexOf('New York')).toBeLessThan(cities.indexOf('Los Angeles'));
  });

  it('keeps an island zone with its country', () => {
    expect(zones.find((z) => z.id === 'Atlantic/Canary')?.continent).toBe('europe');
  });

  it('searches city, country and zone id, accent-blind', () => {
    expect(tzSearch(zones, 'baghdad', name).map((z) => z.id)).toEqual(['Asia/Baghdad']);
    expect(tzSearch(zones, 'iraq', name).map((z) => z.id)).toContain('Asia/Baghdad');
    expect(tzSearch(zones, 'sao paulo', name).map((z) => z.id)).toContain('America/Sao_Paulo');
    expect(tzSearch(zones, '   ', name)).toEqual([]);
  });

  it('names countries in Arabic for the Arabic operator', () => {
    const ar = buildTzZones('ar', AT).find((z) => z.id === 'Asia/Baghdad');
    expect(ar?.countryName).toBe('العراق');
  });
});

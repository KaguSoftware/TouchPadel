import { describe, expect, it } from 'vitest';
import { formatLatLng, inRange, mapsLink, parsePlace } from './placeParse';

const at = (lat: number, lng: number) => ({ ok: true, point: { lat, lng } });

describe('parsePlace', () => {
  it('reads typed coordinates', () => {
    expect(parsePlace('33.3128, 44.3615')).toEqual(at(33.3128, 44.3615));
    expect(parsePlace('  33.3128 44.3615 ')).toEqual(at(33.3128, 44.3615));
    expect(parsePlace('-33.9;18.42')).toEqual(at(-33.9, 18.42));
  });

  it('prefers the place pin over where the map looked', () => {
    const url =
      'https://www.google.com/maps/place/Touch+Padel/@33.3000,44.3000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d33.312805!4d44.361493!16s';
    expect(parsePlace(url)).toEqual(at(33.312805, 44.361493));
  });

  it('reads q=, query= and ll=', () => {
    expect(parsePlace('https://maps.google.com/?q=33.31,44.36')).toEqual(at(33.31, 44.36));
    expect(parsePlace('https://www.google.com/maps/search/?api=1&query=33.31%2C44.36')).toEqual(at(33.31, 44.36));
    expect(parsePlace('https://maps.google.com/maps?ll=33.31,44.36&z=16')).toEqual(at(33.31, 44.36));
  });

  it('falls back to @lat,lng', () => {
    expect(parsePlace('https://www.google.com/maps/@33.3128,44.3615,18z')).toEqual(at(33.3128, 44.3615));
  });

  it('names a short share link apart', () => {
    expect(parsePlace('https://maps.app.goo.gl/AbCdEf123')).toEqual({ ok: false, reason: 'short_link' });
    expect(parsePlace('https://goo.gl/maps/xyz')).toEqual({ ok: false, reason: 'short_link' });
  });

  it('refuses empty, unreadable and out-of-range input', () => {
    expect(parsePlace('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(parsePlace('Baghdad')).toEqual({ ok: false, reason: 'unreadable' });
    expect(parsePlace('95, 44')).toEqual({ ok: false, reason: 'out_of_range' });
    expect(parsePlace('33, 190')).toEqual({ ok: false, reason: 'out_of_range' });
    expect(parsePlace('0, 0')).toEqual({ ok: false, reason: 'out_of_range' });
  });

  it('formats and links a point', () => {
    expect(formatLatLng({ lat: 33.3128, lng: 44.3615 })).toBe('33.312800, 44.361500');
    expect(mapsLink({ lat: 33.3128, lng: 44.3615 })).toBe('https://www.google.com/maps?q=33.312800,44.361500');
  });

  it('checks a whole number in range', () => {
    expect(inRange(120, 20, 2000)).toBe(true);
    expect(inRange(19, 20, 2000)).toBe(false);
    expect(inRange(null, 20, 2000)).toBe(false);
    expect(inRange(12.5, 10, 500)).toBe(false);
  });
});

/**
 * The club's point for staff clock-in (0442): what the owner pastes, read as a latitude and a
 * longitude. Pure, so it is tested on its own (placeParse.test.ts).
 *
 * Accepted:
 *  - a Google Maps address with the pin's own coordinates: `…!3d33.31!4d44.36…` (the place),
 *    then `?q=33.31,44.36` / `?query=` / `?ll=` / `?destination=`, then `@33.31,44.36,17z`
 *    (where the map was looking, the weakest);
 *  - typed numbers: `33.3128, 44.3615` (a comma, spaces or a semicolon between them).
 *
 * A short share link (maps.app.goo.gl/…, goo.gl/maps/…) carries no coordinates at all; it is
 * named apart so the screen can say how to get the long one.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export type PlaceParse =
  | { ok: true; point: LatLng }
  | { ok: false; reason: 'empty' | 'short_link' | 'out_of_range' | 'unreadable' };

export const RADIUS_MIN = 20;
export const RADIUS_MAX = 2000;
export const RADIUS_DEFAULT = 120;
export const ACCURACY_MIN = 10;
export const ACCURACY_MAX = 500;
export const ACCURACY_DEFAULT = 60;

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^\s*(${NUM})\s*[,;\s]\s*(${NUM})\s*$`);

function valid(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

function point(lat: string, lng: string): PlaceParse {
  const a = Number(lat);
  const b = Number(lng);
  return valid(a, b) ? { ok: true, point: { lat: a, lng: b } } : { ok: false, reason: 'out_of_range' };
}

export function parsePlace(raw: string): PlaceParse {
  const text = raw.trim();
  if (text === '') return { ok: false, reason: 'empty' };

  const typed = PAIR.exec(text);
  if (typed) return point(typed[1]!, typed[2]!);

  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    /* a stray % — read it as it is */
  }

  // The place's own pin: !3d<lat>!4d<lng> (the last pair wins: Maps appends the chosen place).
  const pins = [...decoded.matchAll(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`, 'g'))];
  const pin = pins[pins.length - 1];
  if (pin) return point(pin[1]!, pin[2]!);

  const query = new RegExp(String.raw`[?&](?:q|query|ll|destination|center)=(?:loc:)?\s*(${NUM})\s*,\s*(${NUM})`).exec(decoded);
  if (query) return point(query[1]!, query[2]!);

  const at = new RegExp(String.raw`@(${NUM}),(${NUM})`).exec(decoded);
  if (at) return point(at[1]!, at[2]!);

  if (/(?:^|\/\/|\.)(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(decoded)) return { ok: false, reason: 'short_link' };
  return { ok: false, reason: 'unreadable' };
}

/** Six decimals: about 10 cm, more than any phone fix. */
export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

/** A link that opens the point in Google Maps, for checking it. */
export function mapsLink(p: LatLng): string {
  return `https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

export function inRange(n: number | null, min: number, max: number): boolean {
  return n !== null && Number.isInteger(n) && n >= min && n <= max;
}

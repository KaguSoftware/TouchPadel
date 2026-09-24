/**
 * How a visitor reaches the club (docs/design/web-site/contracts-2026-09-23.md §0,
 * "Contact plumbing"): WhatsApp, a call, the map, Instagram.
 *
 * Every WhatsApp and Call button on the site is built from the ONE venue phone in
 * `venue_settings_public`, so correcting that setting in the operator app corrects every
 * button (today it holds the unverified +995 number). A number that cannot be dialled
 * from abroad is worse than no button: anything that does not normalise to a plausible
 * international number gives `null`, and the page falls back to "Plan your visit".
 *
 * Pure and client-safe; the env readers name each variable LITERALLY because Next
 * inlines `process.env.NEXT_PUBLIC_*` at build only where the full name is written out.
 */

/** Arabic-Indic (٠–٩) and Extended Arabic-Indic (۰–۹) digits, typed in the operator app. */
function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The phone as international digits with no prefix (`9647701234567`), the form both
 * `wa.me` and `tel:+` want, or null when it is not a plausible number.
 *
 * - `+964 770 123 4567`, `00964 770 123 4567` → `9647701234567`;
 * - Iraqi local mobile `0770 123 4567` (07 + nine digits) → `9647701234567`;
 * - a written trunk zero, `+964 (0)770 …`, is dropped, and so is the bare one many Iraqi
 *   numbers are spelled with after the country code (`+964 0770 …`, `00964 0770 …`);
 *   any other digits after `9640` → null;
 * - spaces, dashes, dots and parentheses are separators;
 * - any other local number (a leading single 0: the country is unknown), letters, a `+`
 *   anywhere but the front, or a result outside E.164's 8–15 digits → null.
 */
export function internationalDigits(phone: string | null | undefined): string | null {
  const raw = asciiDigits(phone?.trim() ?? '');
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\(0\)/g, '').replace(/[\s().-]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^07\d{9}$/.test(digits)) digits = `964${digits.slice(1)}`;
  else if (digits.startsWith('0')) return null;
  // No Iraqi number starts with 0 after the country code: `9640770…` is the trunk zero
  // written in, and dialling it from abroad fails. Only a mobile number is repaired.
  if (digits.startsWith('9640')) {
    if (!/^96407\d{9}$/.test(digits)) return null;
    digits = `964${digits.slice(4)}`;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** E.164 country codes one and two digits long; every other code has three. */
const CC_ONE = new Set(['1', '7']);
const CC_TWO = new Set(
  '20 27 30 31 32 33 34 36 39 40 41 43 44 45 46 47 48 49 51 52 53 54 55 56 57 58 60 61 62 63 64 65 66 81 82 84 86 90 91 92 93 94 95 98'.split(
    ' ',
  ),
);

/**
 * The phone as a person reads it: `+964 770 123 4567`, `+995 419 010 203`. The country
 * code, then the number in threes with a final group of up to four. One helper for every
 * surface that prints the desk's number (the site footer, the legal pages, the café
 * menu's footer), so the same number never appears in two spellings. Null exactly when
 * `internationalDigits` is null, so a number is printed only where it can be dialled.
 */
export function displayPhone(phone: string | null | undefined): string | null {
  const digits = internationalDigits(phone);
  if (!digits) return null;
  const ccLength = CC_ONE.has(digits[0]!) ? 1 : CC_TWO.has(digits.slice(0, 2)) ? 2 : 3;
  const rest = digits.slice(ccLength);
  const groups: string[] = [];
  let i = 0;
  while (rest.length - i > 4) {
    groups.push(rest.slice(i, i + 3));
    i += 3;
  }
  groups.push(rest.slice(i));
  return `+${digits.slice(0, ccLength)} ${groups.join(' ')}`;
}

/**
 * `https://wa.me/<digits>?text=<pre-fill>`: opens a chat with the desk, the message
 * already typed in the page's language (`site.whatsapp.*`), editable before sending.
 */
export function whatsappUrl(phone: string | null | undefined, text?: string): string | null {
  const digits = internationalDigits(phone);
  if (!digits) return null;
  const message = text?.trim();
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

/** `tel:+<digits>`, dialable from any phone in any country, or null. */
export function telUrl(phone: string | null | undefined): string | null {
  const digits = internationalDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

/** An https URL with no credentials and the default port, or null. */
function httpsUrl(raw: string | null | undefined): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url : null;
}

/** Where the club is, as Google Maps searches it (owner, 2026-09-23: "darra karbela"). */
export const MAPS_QUERY = 'درّة كربلاء، كربلاء';

/** The fallback when no pinned link is configured: a Google Maps search for the club. */
export const DEFAULT_MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(MAPS_QUERY)}`;

/**
 * Google Maps and its share links, and nothing else: the button says "Open in Google
 * Maps", so a typo in the env var must never put another site behind it (the same rule
 * stores.ts keeps for the store badges). `google.com` and `goo.gl` only under `/maps`.
 */
function isGoogleMaps(url: URL): boolean {
  const host = url.hostname;
  if (host === 'maps.google.com' || host === 'maps.app.goo.gl') return true;
  if (host === 'www.google.com' || host === 'google.com' || host === 'goo.gl') {
    return url.pathname === '/maps' || url.pathname.startsWith('/maps/');
  }
  return false;
}

/**
 * "Open in Google Maps": `NEXT_PUBLIC_MAPS_URL` when it is an https Google Maps link
 * (a pinned place or a share link), else a search for Durrat Karbala. A link out, never
 * an iframe (the CSP has no frame-src).
 */
export function mapsUrl(env: string | undefined = process.env.NEXT_PUBLIC_MAPS_URL): string {
  const url = httpsUrl(env);
  return url && isGoogleMaps(url) ? url.toString() : DEFAULT_MAPS_URL;
}

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);

/**
 * The club's Instagram profile from `NEXT_PUBLIC_INSTAGRAM_URL`, as
 * `https://www.instagram.com/<handle>/…`, or null (and the link is not drawn) for
 * anything else: another host, http, credentials, a port, or no profile path. No handle is
 * confirmed yet, so today this is null and the page shows no Instagram at all.
 */
export function instagramUrl(
  env: string | undefined = process.env.NEXT_PUBLIC_INSTAGRAM_URL,
): string | null {
  const url = httpsUrl(env);
  if (!url || !INSTAGRAM_HOSTS.has(url.hostname) || url.pathname.replace(/\//g, '') === '') {
    return null;
  }
  url.hostname = 'www.instagram.com';
  return url.toString();
}

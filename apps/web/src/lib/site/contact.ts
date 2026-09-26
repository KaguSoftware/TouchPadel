/**
 * How a visitor reaches the club (docs/design/web-site/contracts-2026-09-23.md §0,
 * "Contact plumbing"): WhatsApp, a call, the map.
 *
 * Every WhatsApp and Call button on the site is built from the ONE venue phone in
 * `venue_settings_public`, so correcting that setting in the operator app corrects every
 * button (today it holds the unverified +995 number). A number that cannot be dialled
 * from abroad is worse than no button: anything that does not normalise to a plausible
 * international number gives `null`, and the page falls back to "Plan your visit".
 *
 * Pure and client-safe.
 */
import { t, type Locale } from '@touch/i18n';

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

/** Where the club is, as Google Maps searches it (owner, 2026-09-23: "darra karbela"). */
const MAPS_QUERY = 'درّة كربلاء، كربلاء';

/**
 * "Open in Google Maps": a search for Durrat Karbala. A link out, never an iframe (the
 * CSP has no frame-src). When the owner sends a pinned place link, it replaces this.
 */
export const MAPS_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(MAPS_QUERY)}`;

/**
 * The branch fields the site prints (multi-venue slice 4). Every one is
 * optional: a `VenueOpeningHours` from a fixture or a failed read has none.
 */
export interface BranchContact {
  venue_name?: string | null;
  name_en?: string | null;
  name_ar?: string | null;
  address_en?: string | null;
  address_ar?: string | null;
  map_url?: string | null;
}

const filled = (v: string | null | undefined): string | null => {
  const s = v?.trim();
  return s ? s : null;
};

/** The branch's name in the page's language, then the other one, then the venue name. */
export function branchName(locale: Locale, branch: BranchContact | null | undefined): string {
  const own = locale === 'ar' ? branch?.name_ar : branch?.name_en;
  const other = locale === 'ar' ? branch?.name_en : branch?.name_ar;
  return filled(own) ?? filled(other) ?? filled(branch?.venue_name) ?? t(locale, 'common.appName');
}

/**
 * The branch's address in the page's language (then the other language). A
 * branch with no address stored yet (today's only branch, until the owner
 * fills it in) prints the confirmed one, `site.visit.address`, so the page
 * reads exactly as it did before branches; `fallback: false` gives null instead.
 */
export function branchAddress(
  locale: Locale,
  branch: BranchContact | null | undefined,
  { fallback = true }: { fallback?: boolean } = {},
): string | null {
  const own = locale === 'ar' ? branch?.address_ar : branch?.address_en;
  const other = locale === 'ar' ? branch?.address_en : branch?.address_ar;
  return filled(own) ?? filled(other) ?? (fallback ? t(locale, 'site.visit.address') : null);
}

/**
 * "Open in Google Maps" for a branch: its pinned link when stored and https,
 * otherwise the Durrat Karbala search above. The https check keeps a mistyped
 * `javascript:` or bare-text value out of an href.
 */
export function branchMapUrl(branch: BranchContact | null | undefined): string {
  return branchOwnMapUrl(branch) ?? MAPS_URL;
}

/** A branch's own pinned https map link, or null (no Durrat Karbala fallback). */
export function branchOwnMapUrl(branch: BranchContact | null | undefined): string | null {
  const url = filled(branch?.map_url);
  return url && /^https:\/\//i.test(url) ? url : null;
}

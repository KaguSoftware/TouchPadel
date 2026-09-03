/**
 * Phone numbers as the app stores them: E.164, `+` then digits only
 * (`+9647701234567`). That is already the shape in `user_metadata` and in the
 * DB fixtures, so nothing downstream changes — this module only gives the UI a
 * way to SPLIT that string into a country and a national part, and to put it
 * back together.
 *
 * Iraq is the venue's country (docs/client/06 — the desk's own number is +964),
 * so it is the default for an empty field and sorts to the top of the picker.
 *
 * Deliberately RN-free: unit tests run under plain node (vitest.config.ts).
 */

export type Country = {
  /** ISO 3166-1 alpha-2 — the picker's key and the flag's source. */
  iso: string;
  /** Dial code WITHOUT the plus: '964'. */
  dial: string;
  /** English name; the picker also searches the localized name. */
  name: string;
};

/** Iraq — the default for a field with nothing in it. */
export const DEFAULT_ISO = 'IQ';

/**
 * Iraq and its neighbours first (who actually walks into the venue), then the
 * rest alphabetically. Not the full ITU list: every country a guest of this
 * venue plausibly dials from, which keeps the bundle honest and the picker
 * scrollable. Add a row here rather than reaching for a phone-number library.
 */
export const COUNTRIES: readonly Country[] = [
  { iso: 'IQ', dial: '964', name: 'Iraq' },
  { iso: 'IR', dial: '98', name: 'Iran' },
  { iso: 'TR', dial: '90', name: 'Türkiye' },
  { iso: 'SY', dial: '963', name: 'Syria' },
  { iso: 'JO', dial: '962', name: 'Jordan' },
  { iso: 'KW', dial: '965', name: 'Kuwait' },
  { iso: 'SA', dial: '966', name: 'Saudi Arabia' },
  { iso: 'AE', dial: '971', name: 'United Arab Emirates' },
  { iso: 'QA', dial: '974', name: 'Qatar' },
  { iso: 'BH', dial: '973', name: 'Bahrain' },
  { iso: 'OM', dial: '968', name: 'Oman' },
  { iso: 'LB', dial: '961', name: 'Lebanon' },
  { iso: 'EG', dial: '20', name: 'Egypt' },
  // Rest of world, alphabetical.
  { iso: 'AU', dial: '61', name: 'Australia' },
  { iso: 'AT', dial: '43', name: 'Austria' },
  { iso: 'AZ', dial: '994', name: 'Azerbaijan' },
  { iso: 'BE', dial: '32', name: 'Belgium' },
  { iso: 'CA', dial: '1', name: 'Canada' },
  { iso: 'CN', dial: '86', name: 'China' },
  { iso: 'CY', dial: '357', name: 'Cyprus' },
  { iso: 'CZ', dial: '420', name: 'Czechia' },
  { iso: 'DK', dial: '45', name: 'Denmark' },
  { iso: 'FI', dial: '358', name: 'Finland' },
  { iso: 'FR', dial: '33', name: 'France' },
  { iso: 'GE', dial: '995', name: 'Georgia' },
  { iso: 'DE', dial: '49', name: 'Germany' },
  { iso: 'GR', dial: '30', name: 'Greece' },
  { iso: 'IN', dial: '91', name: 'India' },
  { iso: 'ID', dial: '62', name: 'Indonesia' },
  { iso: 'IE', dial: '353', name: 'Ireland' },
  { iso: 'IT', dial: '39', name: 'Italy' },
  { iso: 'JP', dial: '81', name: 'Japan' },
  { iso: 'KZ', dial: '7', name: 'Kazakhstan' },
  { iso: 'MY', dial: '60', name: 'Malaysia' },
  { iso: 'MA', dial: '212', name: 'Morocco' },
  { iso: 'NL', dial: '31', name: 'Netherlands' },
  { iso: 'NZ', dial: '64', name: 'New Zealand' },
  { iso: 'NO', dial: '47', name: 'Norway' },
  { iso: 'PK', dial: '92', name: 'Pakistan' },
  { iso: 'PL', dial: '48', name: 'Poland' },
  { iso: 'PT', dial: '351', name: 'Portugal' },
  { iso: 'RO', dial: '40', name: 'Romania' },
  { iso: 'RU', dial: '7', name: 'Russia' },
  { iso: 'SG', dial: '65', name: 'Singapore' },
  { iso: 'ZA', dial: '27', name: 'South Africa' },
  { iso: 'ES', dial: '34', name: 'Spain' },
  { iso: 'SE', dial: '46', name: 'Sweden' },
  { iso: 'CH', dial: '41', name: 'Switzerland' },
  { iso: 'TH', dial: '66', name: 'Thailand' },
  { iso: 'TN', dial: '216', name: 'Tunisia' },
  { iso: 'UA', dial: '380', name: 'Ukraine' },
  { iso: 'GB', dial: '44', name: 'United Kingdom' },
  { iso: 'US', dial: '1', name: 'United States' },
  { iso: 'UZ', dial: '998', name: 'Uzbekistan' },
  { iso: 'YE', dial: '967', name: 'Yemen' },
];

export function countryByIso(iso: string): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? defaultCountry();
}

/**
 * Iraq, as an object. The literal is the fallback rather than `COUNTRIES[0]`
 * so that this never depends on the table's order surviving an edit — and so
 * it has a type without a `noUncheckedIndexedAccess` assertion.
 */
export function defaultCountry(): Country {
  return COUNTRIES.find((c) => c.iso === DEFAULT_ISO) ?? { iso: 'IQ', dial: '964', name: 'Iraq' };
}

/**
 * The flag emoji for an ISO code, built from regional-indicator codepoints
 * rather than shipped as literals — no font asset, no 50 pasted emoji.
 */
export function flagOf(iso: string): string {
  const A = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  const cps = iso
    .toUpperCase()
    .split('')
    .map((ch) => A + (ch.charCodeAt(0) - 65));
  if (cps.some((cp) => cp < A || cp > A + 25)) return '';
  return String.fromCodePoint(...cps);
}

/** Everything that is not a digit — spaces, dashes, parens the guest typed. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

export type ParsedPhone = {
  /** ISO of the matched country, or DEFAULT_ISO when nothing matched. */
  iso: string;
  /** National part: digits only, no leading zero, no dial code. */
  national: string;
};

/**
 * Splits a stored number into its country and national parts.
 *
 * Handles the three shapes that actually exist in the data:
 *  - E.164 (`+9647701234567`) — what this app writes;
 *  - the international-prefix form (`009647701234567`) — the seeded venue
 *    number is written that way, and guests type it;
 *  - a bare national number (`07701234567`) — no country information at all,
 *    so it falls back to Iraq and the leading trunk `0` is dropped.
 *
 * Ambiguity is resolved by LONGEST dial code first (`+964` must not be read as
 * `+9` … no such code, but `+1` vs `+964` shows the principle), then by the
 * table's own order — so a shared code like +7 lands on Kazakhstan/Russia in
 * the order listed, and +1 on Canada before the US. The guest can always
 * correct it in the picker, and either way the composed E.164 is identical.
 */
export function parsePhone(stored: string | null | undefined): ParsedPhone {
  const raw = (stored ?? '').trim();
  if (!raw) return { iso: DEFAULT_ISO, national: '' };

  let rest: string | null = null;
  if (raw.startsWith('+')) rest = digitsOnly(raw);
  else {
    const d = digitsOnly(raw);
    // `00` is the international access prefix, equivalent to a leading `+`.
    if (d.startsWith('00')) rest = d.slice(2);
  }

  if (rest !== null) {
    const byLongest = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const hit = byLongest.find((c) => rest!.startsWith(c.dial) && rest!.length > c.dial.length);
    if (hit) return { iso: hit.iso, national: stripTrunk(rest.slice(hit.dial.length)) };
    // A `+` we cannot attribute: keep the digits so nothing is silently lost,
    // and let the guest pick the country.
    return { iso: DEFAULT_ISO, national: stripTrunk(rest) };
  }

  return { iso: DEFAULT_ISO, national: stripTrunk(digitsOnly(raw)) };
}

/**
 * Drops the national trunk prefix `0` (`0770…` → `770…`). Iraqi mobiles are
 * dialled `07XX` locally but carry no zero in E.164, and that zero is the most
 * common way a guest's number would otherwise be stored wrong.
 */
export function stripTrunk(national: string): string {
  return national.replace(/^0+/, '');
}

/** Joins a country and a typed national number into stored E.164. */
export function composePhone(iso: string, national: string): string {
  const digits = stripTrunk(digitsOnly(national));
  if (!digits) return '';
  return `+${countryByIso(iso).dial}${digits}`;
}

/** What the guest is allowed to type into the national box. */
export function sanitizeNationalInput(input: string): string {
  return digitsOnly(input);
}

export type PhoneValidation = 'PHONE_REQUIRED' | 'PHONE_INVALID' | null;

/**
 * Length-only validation, deliberately. Carrier prefixes change, and a wrong
 * "invalid" locks a real guest out of booking — the number's true test is the
 * desk ringing it. E.164 caps the whole number at 15 digits (dial code
 * included); below 4 national digits nothing is a phone number.
 */
export function validatePhone(iso: string, national: string): PhoneValidation {
  const digits = stripTrunk(sanitizeNationalInput(national));
  if (!digits) return 'PHONE_REQUIRED';
  const dial = countryByIso(iso).dial;
  if (digits.length < 4 || dial.length + digits.length > 15) return 'PHONE_INVALID';
  return null;
}

/** Groups the national part in threes for display: `770 123 4567`. */
export function formatNational(national: string): string {
  const d = sanitizeNationalInput(national);
  return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

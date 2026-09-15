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
  /**
   * How the NATIONAL digits are grouped when shown to the guest, as group
   * sizes: `'3 3 4'` renders `770 123 4567`. A leading group in parentheses
   * (`'(3) 3 4'`) is the North-American / Turkish area-code convention and
   * renders `(555) 123 4567`.
   *
   * Display only. Everything stored and validated is digits — `composePhone`
   * strips non-digits on the way to E.164 — so a wrong grouping here is a
   * cosmetic bug, never a corrupt number. Omitted for a country whose shape
   * is not worth asserting; those fall back to even groups of three.
   */
  fmt?: string;
  /**
   * Most national digits the field will accept, when that differs from the
   * length `fmt` implies. `fmt` is the COMMON shape, not a rule: a few
   * countries genuinely run longer (German numbers are 10–11 digits, Lebanese
   * mobiles 7–8), and a cap taken blindly from the pattern would make a real
   * number untypable — the failure mode `validatePhone` exists to avoid.
   * Omitted where the pattern's own length is the true maximum.
   */
  max?: number;
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
  { iso: 'IQ', dial: '964', name: 'Iraq', fmt: '3 3 4' },
  { iso: 'IR', dial: '98', name: 'Iran', fmt: '3 3 4' },
  { iso: 'TR', dial: '90', name: 'Türkiye', fmt: '(3) 3 2 2' },
  { iso: 'SY', dial: '963', name: 'Syria', fmt: '3 3 3' },
  { iso: 'JO', dial: '962', name: 'Jordan', fmt: '1 4 4' },
  { iso: 'KW', dial: '965', name: 'Kuwait', fmt: '4 4' },
  { iso: 'SA', dial: '966', name: 'Saudi Arabia', fmt: '2 3 4' },
  { iso: 'AE', dial: '971', name: 'United Arab Emirates', fmt: '2 3 4' },
  { iso: 'QA', dial: '974', name: 'Qatar', fmt: '4 4' },
  { iso: 'BH', dial: '973', name: 'Bahrain', fmt: '4 4' },
  { iso: 'OM', dial: '968', name: 'Oman', fmt: '4 4' },
  { iso: 'LB', dial: '961', name: 'Lebanon', fmt: '2 3 3' , max: 8 },
  { iso: 'EG', dial: '20', name: 'Egypt', fmt: '3 3 4' },
  // Rest of world, alphabetical.
  { iso: 'AU', dial: '61', name: 'Australia', fmt: '3 3 3' },
  { iso: 'AT', dial: '43', name: 'Austria', fmt: '3 4 4' , max: 13 },
  { iso: 'AZ', dial: '994', name: 'Azerbaijan', fmt: '2 3 2 2' },
  { iso: 'BE', dial: '32', name: 'Belgium', fmt: '3 2 2 2' },
  { iso: 'CA', dial: '1', name: 'Canada', fmt: '(3) 3 4' },
  { iso: 'CN', dial: '86', name: 'China', fmt: '3 4 4' },
  { iso: 'CY', dial: '357', name: 'Cyprus', fmt: '2 6' },
  { iso: 'CZ', dial: '420', name: 'Czechia', fmt: '3 3 3' },
  { iso: 'DK', dial: '45', name: 'Denmark', fmt: '2 2 2 2' },
  { iso: 'FI', dial: '358', name: 'Finland', fmt: '2 3 3' , max: 10 },
  { iso: 'FR', dial: '33', name: 'France', fmt: '1 2 2 2 2' },
  { iso: 'GE', dial: '995', name: 'Georgia', fmt: '3 2 2 2' },
  { iso: 'DE', dial: '49', name: 'Germany', fmt: '3 4 4' , max: 11 },
  { iso: 'GR', dial: '30', name: 'Greece', fmt: '3 3 4' },
  { iso: 'IN', dial: '91', name: 'India', fmt: '5 5' },
  { iso: 'ID', dial: '62', name: 'Indonesia', fmt: '3 4 4' },
  { iso: 'IE', dial: '353', name: 'Ireland', fmt: '2 3 4' },
  { iso: 'IT', dial: '39', name: 'Italy', fmt: '3 3 4' , max: 10 },
  { iso: 'JP', dial: '81', name: 'Japan', fmt: '2 4 4' },
  { iso: 'KZ', dial: '7', name: 'Kazakhstan', fmt: '3 3 2 2' , max: 10 },
  { iso: 'MY', dial: '60', name: 'Malaysia', fmt: '2 3 4' },
  { iso: 'MA', dial: '212', name: 'Morocco', fmt: '3 3 3' },
  { iso: 'NL', dial: '31', name: 'Netherlands', fmt: '1 4 4' , max: 9 },
  { iso: 'NZ', dial: '64', name: 'New Zealand', fmt: '2 3 4' },
  { iso: 'NO', dial: '47', name: 'Norway', fmt: '3 2 3' , max: 8 },
  { iso: 'PK', dial: '92', name: 'Pakistan', fmt: '3 7' },
  { iso: 'PL', dial: '48', name: 'Poland', fmt: '3 3 3' },
  { iso: 'PT', dial: '351', name: 'Portugal', fmt: '3 3 3' },
  { iso: 'RO', dial: '40', name: 'Romania', fmt: '3 3 3' },
  { iso: 'RU', dial: '7', name: 'Russia', fmt: '3 3 2 2' , max: 10 },
  { iso: 'SG', dial: '65', name: 'Singapore', fmt: '4 4' },
  { iso: 'ZA', dial: '27', name: 'South Africa', fmt: '2 3 4' },
  { iso: 'ES', dial: '34', name: 'Spain', fmt: '3 3 3' },
  { iso: 'SE', dial: '46', name: 'Sweden', fmt: '2 3 2 2' },
  { iso: 'CH', dial: '41', name: 'Switzerland', fmt: '2 3 2 2' },
  { iso: 'TH', dial: '66', name: 'Thailand', fmt: '2 3 4' },
  { iso: 'TN', dial: '216', name: 'Tunisia', fmt: '2 3 3' },
  { iso: 'UA', dial: '380', name: 'Ukraine', fmt: '2 3 2 2' },
  { iso: 'GB', dial: '44', name: 'United Kingdom', fmt: '4 6' },
  { iso: 'US', dial: '1', name: 'United States', fmt: '(3) 3 4' },
  { iso: 'UZ', dial: '998', name: 'Uzbekistan', fmt: '2 3 2 2' },
  { iso: 'YE', dial: '967', name: 'Yemen', fmt: '3 3 3' },
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

/**
 * What the guest is allowed to type into the national box.
 *
 * With an `iso` the input is also CAPPED at that country's own length, so the
 * field simply stops accepting digits rather than letting a guest type a
 * number that could never dial. Without one it only strips non-digits — the
 * shape every existing caller relies on.
 */
export function sanitizeNationalInput(input: string, iso?: string): string {
  const digits = digitsOnly(input);
  if (!iso) return digits;
  return digits.slice(0, maxNationalDigits(iso));
}

/** Groups of three, for a country whose own shape is not worth asserting. */
const DEFAULT_FMT = '3 3 3 3';

/**
 * E.164 caps a whole number — dial code included — at 15 digits, so this is
 * the ceiling for a country with no shape of its own.
 */
const E164_MAX = 15;

/**
 * How many national digits this country's field accepts.
 *
 * `max` when the table states one, otherwise the length `fmt` implies, and for
 * a country with neither, whatever E.164 leaves after the dial code. Capping
 * the field at this is what stops a guest typing past their own number's
 * length; it is deliberately a MAXIMUM and never a minimum, so a shorter valid
 * number is still accepted and judged by `validatePhone`.
 */
export function maxNationalDigits(iso: string): number {
  const c = countryByIso(iso);
  const room = E164_MAX - c.dial.length;
  if (c.max) return Math.min(c.max, room);
  if (!c.fmt) return room;
  const implied = c.fmt.split(' ').reduce((n, t) => n + Number(t.replace(/[()]/g, '')), 0);
  return Math.min(implied, room);
}

/**
 * The national digits, grouped the way that country writes them:
 * `formatNational('TR', '5551234567')` → `'(555) 123 45 67'`.
 *
 * DISPLAY ONLY. The value the app stores and validates is always bare digits —
 * `composePhone` and `validatePhone` both run `digitsOnly` first — so a
 * grouping that is wrong for some carrier is a cosmetic bug and can never
 * produce a malformed E.164 number.
 *
 * Digits past the last group are appended unbroken rather than dropped: the
 * table's shapes are the COMMON case, not a length rule, and a guest with a
 * longer number must still be able to see everything they typed. Validation is
 * length-based and lives in `validatePhone`; this function never judges.
 */
export function formatNational(iso: string, national: string): string {
  const digits = digitsOnly(national);
  if (!digits) return '';
  const spec = countryByIso(iso).fmt ?? DEFAULT_FMT;

  const out: string[] = [];
  let at = 0;
  for (const token of spec.split(' ')) {
    if (at >= digits.length) break;
    // `(3)` — a parenthesised group, the area-code convention.
    const paren = token.startsWith('(');
    const size = Number(paren ? token.slice(1, -1) : token);
    const part = digits.slice(at, at + size);
    at += part.length;
    // The bracket CLOSES only once a digit follows the group — not merely when
    // the group is full. Closing it on the third digit made `(555)` the last
    // character of the field, so a backspace deleted the bracket, the digits
    // were unchanged, and this function put the bracket straight back: the
    // field looked frozen and those three digits could not be erased. Waiting
    // for the next digit means the final character is always one the guest
    // typed, so a backspace always removes a digit.
    const closed = paren && at < digits.length;
    out.push(paren ? (closed ? `(${part})` : `(${part}`) : part);
  }
  // Anything the shape did not account for, kept visible.
  if (at < digits.length) out.push(digits.slice(at));
  return out.join(' ');
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

/**
 * Does saving this phone number need a 6-digit code first?
 *
 * Changing the number the desk dials is a contact-detail change, and until now
 * Save wrote whatever was typed. With phone OTP switched on, a CHANGED number
 * has to prove itself: the code goes to the new number, and `profiles.phone`
 * is only rewritten once it comes back (app/verify-otp.tsx, mode `link`).
 *
 * Three conditions, all required:
 *
 *  - `enabled` — EXPO_PUBLIC_PHONE_OTP is on. While the scaffold is dormant
 *    there is no vendor to deliver anything, so demanding a code would simply
 *    make the phone field unsaveable (docs/client/phone-otp-activation.md).
 *  - the number actually CHANGED. Editing only the name, or re-saving the same
 *    number written differently, must not spend a message — the comparison is
 *    on composed E.164, so `00964…` and `+964…` are the same number.
 *  - the new number is an Iraqi mobile. The SMS gate (0069) refuses every other
 *    prefix, so a code could never arrive; those fall through to a direct save
 *    and are judged by `validatePhone` alone, exactly as before.
 *
 * Pure and RN-free so the rule is unit-tested rather than inferred from a
 * screen. `next`/`current` are stored E.164 (or anything `parsePhone` accepts).
 */
export function phoneChangeNeedsCode(args: {
  enabled: boolean;
  current: string | null | undefined;
  next: string;
}): boolean {
  if (!args.enabled) return false;
  const cur = parsePhone(args.current);
  const nxt = parsePhone(args.next);
  const currentE164 = composePhone(cur.iso, cur.national);
  const nextE164 = composePhone(nxt.iso, nxt.national);
  if (!nextE164 || nextE164 === currentE164) return false;
  // Iraqi mobile: '+964' then 7 and nine more digits. Kept as a local test
  // rather than importing @touch/core so this module stays dependency-free.
  return /^\+9647\d{9}$/.test(nextE164);
}

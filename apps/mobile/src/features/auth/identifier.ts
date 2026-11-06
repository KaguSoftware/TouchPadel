/**
 * Sign-in's one field: an email address or a phone number. Anything with an
 * `@` or a letter is an email; otherwise digits (with `+`, spaces, dashes) are
 * a phone number. Pure, so vitest covers it.
 */
import { COUNTRIES, DEFAULT_ISO, PRIMARY_BY_DIAL, parsePhone } from '../profile/phone';

export type IdentifierKind = 'email' | 'phone' | 'none';

export function identifierKind(text: string): IdentifierKind {
  const v = text.trim();
  if (!v) return 'none';
  if (v.includes('@') || /[a-z]/i.test(v)) return 'email';
  return /[0-9٠-٩۰-۹]/.test(v) ? 'phone' : 'none';
}

/**
 * The country and national digits for validatePhoneInput, and whether the
 * number is plausible. A `+` or `00` start names its country (any country, as
 * the country code says). Otherwise the number is an IRAQI one in local form,
 * as Turkey writes 0552 123 4567: `0770 123 4567`, or without the leading 0.
 * An Iraqi mobile is 07 + 9 digits, so anything else typed that way is not
 * plausible and no code is paid for. A bare `964…` is read as Iraq's country
 * code, not as a second one.
 */
export function phoneFromIdentifier(text: string): {
  iso: string;
  national: string;
  plausible: boolean;
} {
  const digits = text.trim().replace(/[^0-9٠-٩۰-۹+]/g, '');
  if (digits.startsWith('+') || digits.startsWith('00')) {
    return { ...parsePhone(digits), plausible: true };
  }
  const plain = digits.replace(/[^0-9٠-٩۰-۹]/g, '');
  if (plain.startsWith('964') && plain.length >= 12) {
    return { ...parsePhone(`+${plain}`), plausible: true };
  }
  const national = plain.replace(/^0+/, '');
  return { iso: DEFAULT_ISO, national: plain, plausible: /^7[0-9]{9}$/.test(national) };
}

/** Arabic-Indic and Persian digits to ASCII, so a length is a count of digits. */
function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * What the field keeps while a phone number is being typed, so it stops taking
 * digits that could never dial: an Iraqi number in local form is 11 digits with
 * the leading 0 (0770 123 4567) or 10 without; `964…` is 12 to 13; a `+` number
 * is E.164's 15 digits at most (17 after a `00`). Anything that is not a phone
 * number (an email being typed) is returned as it is.
 */
export function limitIdentifier(text: string): string {
  if (identifierKind(text) !== 'phone') return text;
  const folded = foldDigits(text.trim());
  const plus = folded.startsWith('+');
  const digits = folded.replace(/[^0-9]/g, '');
  if (plus) return `+${digits.slice(0, 15)}`;
  if (digits.startsWith('00')) return digits.slice(0, 17);
  if (digits.startsWith('964')) return digits.slice(0, 13);
  return digits.slice(0, digits.startsWith('0') ? 11 : 10);
}

/**
 * What `limitIdentifier` is given as the guest types: a `00` start or a bare
 * `964…` is turned into the `+` form first, so the country code is recognised
 * (and slides into the field's chip) the moment it is complete. Local numbers
 * start with 0 or 7, never 9, so `964…` can only be a country code.
 */
export function normalizeIdentifier(text: string): string {
  if (identifierKind(text) !== 'phone') return text;
  const folded = foldDigits(text.trim());
  if (!folded.startsWith('+')) {
    const digits = folded.replace(/[^0-9]/g, '');
    if (digits.startsWith('00') && digits.length > 2) return limitIdentifier(`+${digits.slice(2)}`);
    if (digits.startsWith('964') && digits.length > 3) return limitIdentifier(`+${digits}`);
  }
  return limitIdentifier(text);
}

/**
 * The country a `+` number names, as soon as its code is complete (`+44` is
 * enough), and the digits after it. A code shared by several countries
 * resolves to its main one, as `parsePhone` does. Null for no `+`, or a code
 * nobody has.
 */
export function splitCountryCode(value: string): { iso: string; dial: string; rest: string } | null {
  const v = value.trim();
  if (!v.startsWith('+')) return null;
  const digits = foldDigits(v).replace(/[^0-9]/g, '');
  const hit = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => digits.startsWith(c.dial));
  if (!hit) return null;
  const main = COUNTRIES.find((c) => c.iso === PRIMARY_BY_DIAL[hit.dial]) ?? hit;
  return { iso: main.iso, dial: hit.dial, rest: digits.slice(hit.dial.length) };
}

/** A local Iraqi number grouped the way it is written: `0770 123 4567`, or `770 123 4567`. */
export function formatLocal(value: string): string {
  const d = foldDigits(value).replace(/[^0-9]/g, '');
  const groups = d.startsWith('0') ? [4, 3, 4] : [3, 3, 4];
  const out: string[] = [];
  let at = 0;
  for (const n of groups) {
    if (at >= d.length) break;
    out.push(d.slice(at, at + n));
    at += n;
  }
  return out.join(' ');
}

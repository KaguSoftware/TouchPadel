/**
 * Iraqi phone numbers — the ONE normaliser the apps share (phone OTP scaffold,
 * 2026-09-05; design note docs/design/phone-otp-2026-09-05.md).
 *
 * `phoneDigits` and `phoneCanon` are TS twins of the SQL functions
 * app.phone_digits / app.phone_canon (migration 0065) and MUST agree with them
 * character for character: the database dedupes customers on the canonical
 * form, and the desk-customer-create edge function refuses duplicates on it.
 * The edge functions cannot import this package (no import map — deps are
 * `npm:` specifiers), so supabase/functions/_shared/phone.ts carries a copy;
 * packages/db/tests/phone-otp.test.ts runs the same fixture table through
 * both.
 *
 * Shapes an Iraqi mobile arrives in, all one number:
 *   07701234567 · 7701234567 · +964 770 123 4567 · 009647701234567 ·
 *   ٠٧٧٠١٢٣٤٥٦٧ (Arabic-Indic) · ۰۷۷۰۱۲۳۴۵۶۷ (Extended Arabic-Indic)
 *
 * Zero runtime deps, no RN / Deno / node imports.
 */

/** Iraq country calling code, digits only. */
export const IRAQ_CC = '964';

/** National significant number of an Iraqi mobile: 7 + nine digits. */
const IRAQI_MOBILE_NSN = /^7\d{9}$/;

/**
 * Digits only; Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic
 * (U+06F0–U+06F9) folded to ASCII. Empty string when nothing is left
 * (SQL returns NULL there; the callers treat both as "no digits").
 */
export function phoneDigits(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[٠-٩۰-۹]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/[^0-9]/g, '');
}

/**
 * The identity form: digits, minus an international prefix written as 00,
 * minus ONE leading 964 or trunk 0 — so 07701234567, 009647701234567 and
 * +964 770 123 4567 all become 7701234567. A number from any other country
 * keeps its own code and still compares with itself consistently.
 */
export function phoneCanon(raw: unknown): string {
  return phoneDigits(raw).replace(/^00/, '').replace(/^(964|0)/, '');
}

/**
 * E.164 for an Iraqi MOBILE, or null when the input is not one: wrong length,
 * a landline (01…), or any other country's number. This is the strict gate the
 * OTP screens use — an SMS to a mistyped number is money spent on nothing.
 */
export function toE164Iraq(raw: unknown): string | null {
  const canon = phoneCanon(raw);
  return IRAQI_MOBILE_NSN.test(canon) ? `+${IRAQ_CC}${canon}` : null;
}

/** True when `raw` is an Iraqi mobile in any accepted shape. */
export function isIraqiMobile(raw: unknown): boolean {
  return toE164Iraq(raw) !== null;
}

/** What GoTrue stores in auth.users.phone and expects in test_otp keys: E.164 without the '+'. */
export function gotruePhone(e164: string): string {
  return e164.replace(/^\+/, '');
}

/**
 * Display form `07XX XXX XXXX` for an Iraqi E.164 number; anything else is
 * returned untouched (never throws — it is a formatter, not a validator).
 */
export function formatIraqiNational(e164: string | null | undefined): string {
  if (!e164) return '';
  const canon = phoneCanon(e164);
  if (!IRAQI_MOBILE_NSN.test(canon)) return e164;
  return `0${canon.slice(0, 3)} ${canon.slice(3, 6)} ${canon.slice(6)}`;
}

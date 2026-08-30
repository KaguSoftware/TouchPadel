/**
 * Intl-based formatting for the venue: dates/times in Asia/Baghdad,
 * money as INTEGER IQD, Western (Latin) digits by default in BOTH locales
 * per venue preference — forced via the `nu-latn` Unicode extension.
 */
import type { Locale } from './t';

/** Venue timezone. Everything user-facing renders in Baghdad time unless told otherwise. */
export const VENUE_TZ = 'Asia/Baghdad';

/** BCP-47 tags with Latin digits pinned. */
function intlLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-IQ-u-nu-latn';
}

/** e.g. en: "24 Aug 2026" · ar: "24 آب 2026" (Latin digits both). */
export function formatDate(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
}

/** e.g. "7:30 PM" / Arabic equivalent with Latin digits, venue timezone. */
export function formatTime(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * Format an INTEGER IQD amount. Money is never fractional in this system
 * (bigint IQD in SQL, integer number in TS) — a non-integer input throws
 * rather than silently rounding, so float bugs surface immediately.
 *
 * e.g. formatIQD(15000, 'en') → "15,000 IQD" · ('ar') → "١٥٬٠٠٠ د.ع." style
 * but with Latin digits forced: "15,000 د.ع.".
 *
 * House style puts the unit AFTER the amount in both languages. Arabic already
 * formats that way under CLDR; English does not (it would read "IQD 15,000"),
 * so the parts are reordered rather than the string patched — that keeps the
 * grouping, the digit system and the locale's own spacing intact.
 */
export function formatIQD(amount: number, locale: Locale): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`formatIQD expects an integer IQD amount, got ${amount}`);
  }
  const fmt = new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'IQD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  if (locale === 'ar') return fmt.format(amount);

  const parts = fmt.formatToParts(amount);
  const currency = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('');
  const number = parts
    .filter((p) => p.type !== 'currency' && p.type !== 'literal')
    .map((p) => p.value)
    .join('');
  return currency ? `${number} ${currency}` : number;
}

/** Plain grouped number with Latin digits (counts, quantities). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

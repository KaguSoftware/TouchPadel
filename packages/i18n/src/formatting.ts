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
 * e.g. formatIQD(15000, 'en') → "IQD 15,000" · ('ar') → "١٥٬٠٠٠ د.ع." style
 * but with Latin digits forced: "15,000 د.ع.".
 */
export function formatIQD(amount: number, locale: Locale): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`formatIQD expects an integer IQD amount, got ${amount}`);
  }
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: 'IQD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Plain grouped number with Latin digits (counts, quantities). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

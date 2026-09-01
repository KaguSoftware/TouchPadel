/**
 * Intl-based formatting for the venue: dates/times in Asia/Baghdad,
 * money as INTEGER IQD, Western (Latin) digits by default in BOTH locales
 * per venue preference — forced via the `nu-latn` Unicode extension.
 *
 * Every formatter here is the ONLY sanctioned way to render its value (spec
 * R4): screens must never construct `Intl.*` themselves. The two places that
 * did (the availability day strip and the booking date badge) rendered
 * Eastern-Arabic digits next to Latin ones and used the DEVICE timezone next
 * to values pinned to the venue's.
 */
import type { Locale } from './t';
import { isolate } from './bidi';

/** Venue timezone. Everything user-facing renders in Baghdad time unless told otherwise. */
export const VENUE_TZ = 'Asia/Baghdad';

/** BCP-47 tags with Latin digits pinned. */
function intlLocale(locale: Locale): string {
  return locale === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-IQ-u-nu-latn';
}

/**
 * `Intl.DateTimeFormat` construction is the expensive part (ICU lookups); the
 * availability grid formats ~100 values per render. Cache per locale + options.
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(locale: Locale, timeZone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone });
    dtfCache.set(key, f);
  }
  return f;
}

/** e.g. en: "24 Aug 2026" · ar: "24 آب 2026" (Latin digits both). */
export function formatDate(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** e.g. "7:30 PM" / Arabic equivalent with Latin digits, venue timezone. */
export function formatTime(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/** Date AND time in one locale-correct string: "24 Aug 2026, 7:30 PM". */
export function formatDateTime(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/**
 * "7:30 PM–8:30 PM", bidi-isolated so the two Latin-digit times keep their order
 * inside an Arabic sentence (spec R3).
 */
export function formatTimeRange(
  start: Date,
  end: Date,
  locale: Locale,
  timeZone: string = VENUE_TZ,
): string {
  return isolate(`${formatTime(start, locale, timeZone)}–${formatTime(end, locale, timeZone)}`);
}

/** Short weekday for the day strip: "Tue" / "ثلاثاء". */
export function formatWeekdayShort(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, { weekday: 'short' }).format(date);
}

/** Short month for the date badge: "Sep" / "أيلول". */
export function formatMonthShort(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, { month: 'short' }).format(date);
}

/** Day of month with Latin digits: "24". */
export function formatDayNumber(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dtf(locale, timeZone, { day: 'numeric' }).format(date);
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

  // Hermes' Intl is a shim over the platform's formatter, not full ICU.
  // formatToParts is the call most often missing there; fall back to the
  // grouped number + unit rather than taking the screen down.
  if (typeof fmt.formatToParts !== 'function') return `${formatNumber(amount, locale)} IQD`;
  try {
    const parts = fmt.formatToParts(amount);
    const currency = parts.filter((p) => p.type === 'currency').map((p) => p.value).join('');
    const number = parts
      .filter((p) => p.type !== 'currency' && p.type !== 'literal')
      .map((p) => p.value)
      .join('');
    return currency ? `${number} ${currency}` : number;
  } catch {
    return `${formatNumber(amount, locale)} IQD`;
  }
}

/** Plain grouped number with Latin digits (counts, quantities). */
export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

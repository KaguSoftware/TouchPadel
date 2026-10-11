/**
 * Formatting for the venue: dates/times in Asia/Baghdad, money as INTEGER IQD,
 * Western (Latin) digits in BOTH locales per venue preference.
 *
 * Every formatter here is the ONLY sanctioned way to render its value (spec
 * R4): screens must never construct `Intl.*` themselves. The two places that
 * did (the availability day strip and the booking date badge) rendered
 * Eastern-Arabic digits next to Latin ones and used the DEVICE timezone next
 * to values pinned to the venue's.
 *
 * THE WORDS AND DIGITS ARE OURS, NOT THE PLATFORM'S. Hermes on Android runs
 * Intl over the phone's own formatter, and it did not resolve the tags this
 * file used to pass (`en-IQ-u-nu-latn`, `ar-IQ-u-nu-latn`): it fell back to
 * the PHONE's language, so a Persian phone showed Persian weekdays and
 * Persian digits in an English app (owner, 2026-10-11). Intl is now asked for
 * one thing only, the wall-clock fields of an instant in a time zone, in
 * plain `en-US` (the tag `@touch/core`'s tz helpers have always used, which
 * every engine resolves), and its digits are folded to ASCII regardless.
 * Month and weekday names, AM/PM and digit grouping come from the tables
 * below: CLDR's `en` and `ar-IQ` values, so the output is what ICU printed
 * before, on every engine.
 */
import type { Locale } from './t';
import { isolate } from './bidi';

/** Venue timezone. Everything user-facing renders in Baghdad time unless told otherwise. */
export const VENUE_TZ = 'Asia/Baghdad';

const MONTH_SHORT: Record<Locale, readonly string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'],
};

const MONTH_LONG: Record<Locale, readonly string[]> = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  // Iraqi Arabic uses one form for both widths.
  ar: MONTH_SHORT.ar,
};

/** Sunday first, as `Date.getUTCDay()` counts. */
const WEEKDAY_SHORT: Record<Locale, readonly string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

const WEEKDAY_LONG: Record<Locale, readonly string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: WEEKDAY_SHORT.ar,
};

const DAY_PERIOD: Record<Locale, readonly [am: string, pm: string]> = {
  en: ['AM', 'PM'],
  ar: ['ص', 'م'],
};

interface WallClock {
  year: number;
  /** 0-11, an index into the month tables. */
  month: number;
  day: number;
  /** 0-23. */
  hour: number;
  minute: number;
  /** 0=Sun .. 6=Sat. */
  weekday: number;
}

/**
 * `Intl.DateTimeFormat` construction is the expensive part (ICU lookups); the
 * availability grid formats ~100 values per render. One formatter per zone.
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

/** The instant's wall clock in `timeZone`. */
function wallClock(date: Date, timeZone: string): WallClock {
  const out: WallClock = { year: NaN, month: NaN, day: NaN, hour: NaN, minute: NaN, weekday: NaN };
  for (const part of zoneFormatter(timeZone).formatToParts(date)) {
    const n = Number(asciiDigits(part.value));
    switch (part.type) {
      case 'year':
        out.year = n;
        break;
      case 'month':
        out.month = n - 1;
        break;
      case 'day':
        out.day = n;
        break;
      // Some engines print midnight as "24" even under h23.
      case 'hour':
        out.hour = n % 24;
        break;
      case 'minute':
        out.minute = n;
        break;
      default:
        break;
    }
  }
  // From the calendar date, not Intl's weekday name: no word to parse.
  out.weekday = new Date(Date.UTC(out.year, out.month, out.day)).getUTCDay();
  return out;
}

function dateText(w: WallClock, locale: Locale): string {
  const month = MONTH_SHORT[locale][w.month] ?? '';
  // Inside a date, a two-word Arabic month is held together by a no-break
  // space ("كانون الأول" never wraps away from its day), as CLDR does.
  return locale === 'ar'
    ? `${w.day} ${month.replace(/ /g, '\u00a0')} ${w.year}`
    : `${month} ${w.day}, ${w.year}`;
}

function timeText(w: WallClock, locale: Locale): string {
  const h12 = w.hour % 12 === 0 ? 12 : w.hour % 12;
  const period = DAY_PERIOD[locale][w.hour < 12 ? 0 : 1];
  return `${h12}:${String(w.minute).padStart(2, '0')} ${period}`;
}

/** e.g. en: "Aug 24, 2026" · ar: "24 آب 2026" (Latin digits both). */
export function formatDate(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return dateText(wallClock(date, timeZone), locale);
}

/** e.g. "7:30 PM" / "7:30 م", venue timezone. */
export function formatTime(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return timeText(wallClock(date, timeZone), locale);
}

/** Date AND time in one locale-correct string: "Aug 24, 2026, 7:30 PM". */
export function formatDateTime(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  const w = wallClock(date, timeZone);
  return `${dateText(w, locale)}${locale === 'ar' ? '، ' : ', '}${timeText(w, locale)}`;
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

/** Short weekday for the day strip: "Tue" / "الثلاثاء". */
export function formatWeekdayShort(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return WEEKDAY_SHORT[locale][wallClock(date, timeZone).weekday] ?? '';
}

/** Full weekday for a day's heading: "Thursday" / "الخميس". */
export function formatWeekdayLong(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return WEEKDAY_LONG[locale][wallClock(date, timeZone).weekday] ?? '';
}

/** Short month for the date badge: "Sep" / "أيلول". */
export function formatMonthShort(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return MONTH_SHORT[locale][wallClock(date, timeZone).month] ?? '';
}

/** The month alone, in full: "September" / "أيلول". */
export function formatMonthLong(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return MONTH_LONG[locale][wallClock(date, timeZone).month] ?? '';
}

/** Month and year for a calendar heading: "September 2026" / "أيلول 2026". */
export function formatMonthYear(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  const w = wallClock(date, timeZone);
  return `${MONTH_LONG[locale][w.month] ?? ''} ${w.year}`;
}

/** Day of month with Latin digits: "24". */
export function formatDayNumber(date: Date, locale: Locale, timeZone: string = VENUE_TZ): string {
  return String(wallClock(date, timeZone).day);
}

/** Right-to-left and left-to-right marks: the bidi controls CLDR's Arabic patterns carry. */
const RLM = '\u200f';
const LRM = '\u200e';

/**
 * Format an INTEGER IQD amount. Money is never fractional in this system
 * (bigint IQD in SQL, integer number in TS) — a non-integer input throws
 * rather than silently rounding, so float bugs surface immediately.
 *
 * e.g. formatIQD(15000, 'en') → "15,000 IQD" · ('ar') → "15,000 د.ع." (Latin
 * digits, wrapped in the right-to-left marks CLDR's Arabic pattern carries).
 *
 * House style puts the unit AFTER the amount in both languages.
 */
export function formatIQD(amount: number, locale: Locale): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`formatIQD expects an integer IQD amount, got ${amount}`);
  }
  if (locale === 'en') return `${group(amount, 0, 0)} IQD`;
  return `${RLM}${amount < 0 ? LRM : ''}${group(amount, 0, 0)}\u00a0د.ع.${RLM}`;
}

/**
 * `value` with ',' between thousands and '.' before `minFraction`..`maxFraction`
 * decimals, half away from zero — what `Intl.NumberFormat` prints for `en`.
 */
function group(value: number, minFraction: number, maxFraction: number): string {
  if (!Number.isFinite(value)) return String(value);
  const scale = 10 ** maxFraction;
  const rounded = Math.round(Math.abs(value) * scale) / scale;
  let [whole = '0', fraction = ''] = rounded.toFixed(maxFraction).split('.');
  fraction = fraction.replace(/0+$/, '').padEnd(minFraction, '0');
  whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value < 0 && rounded !== 0 ? '-' : '';
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Typed digits to ASCII, for a number box: Arabic-Indic (U+0660–U+0669) and
 * Extended Arabic-Indic (U+06F0–U+06F9) fold to 0–9, and the Arabic thousands
 * separator (U+066C) to ','. An Arabic keyboard types those, and a `\d` filter
 * (ASCII only) would leave the box empty. Everything else is left for the
 * caller's own filter.
 */
export function asciiDigits(raw: string): string {
  return raw.replace(/[٠-٩۰-۹٬]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code === 0x066c) return ',';
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Plain grouped number with Latin digits (counts, quantities): up to 3 decimals. */
export function formatNumber(value: number, locale: Locale): string {
  const out = group(value, 0, 3);
  // CLDR's Arabic pattern puts a left-to-right mark before the minus.
  return locale === 'ar' && out.startsWith('-') ? `${LRM}${out}` : out;
}

/**
 * A percentage change, always to ONE decimal place.
 *
 * Pinned rather than left to a 0-3 default: these render in KPI columns,
 * and a column that prints 25%, 12.3%, 0% has ragged decimals down its length
 * where a single format would align. One format per data type, in one place
 * (rulebook 12.4). The sign is the caller's — this formats the magnitude.
 */
export function formatPercent(value: number, locale: Locale): string {
  const out = group(value, 1, 1);
  return locale === 'ar' && out.startsWith('-') ? `${LRM}${out}` : out;
}

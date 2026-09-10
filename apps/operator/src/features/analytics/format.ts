/**
 * Locale-bound formatters for the analytics dashboard. Digits are LATIN in both
 * locales (`ar-IQ-u-nu-latn`) — consistent with `formatIQD` and with the CSV
 * export, so a figure reads the same in a card, a tooltip and a spreadsheet.
 */
import type { Locale } from '@touch/i18n';

export interface Formatters {
  locale: Locale;
  /** "12,500 IQD" / "12,500 د.ع." */
  money: (iqd: number) => string;
  /** "1,234" */
  num: (n: number) => string;
  /** "1.2K", "3.4M" */
  compact: (n: number) => string;
  /** "42%" — one decimal only when |n| < 10 and not integer. */
  pct: (n: number) => string;
  /** "+12%" / "−8%" */
  signedPct: (n: number) => string;
  /** "12 Aug" (withYear → "12 Aug 2026") from 'YYYY-MM-DD'. */
  date: (iso: string, withYear?: boolean) => string;
  /** "12 Aug – 3 Sep" */
  dateRange: (from: string, to: string) => string;
  /** "2m 15s" / "45s" */
  duration: (seconds: number) => string;
  /** "07:00" */
  hour: (h: number) => string;
  /** Short weekday from JS index (0 = Sunday). */
  weekday: (dow: number) => string;
}

function tag(locale: Locale): string {
  return locale === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB-u-nu-latn';
}

const cache = new Map<Locale, Formatters>();

function parseIso(iso: string): Date {
  // Noon UTC so the venue offset can never roll the date over.
  return new Date(`${iso}T12:00:00Z`);
}

export function makeFormatters(locale: Locale): Formatters {
  const hit = cache.get(locale);
  if (hit) return hit;
  const t = tag(locale);
  const nf = new Intl.NumberFormat(t, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(t, { maximumFractionDigits: 1 });
  const compactNf = new Intl.NumberFormat(t, { notation: 'compact', maximumFractionDigits: 1 });
  const dayMonth = new Intl.DateTimeFormat(t, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayMonthYear = new Intl.DateTimeFormat(t, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const weekdayNf = new Intl.DateTimeFormat(t, { weekday: 'short', timeZone: 'UTC' });
  const unit = locale === 'ar' ? 'د.ع' : 'IQD';
  const minus = '−';

  const f: Formatters = {
    locale,
    money: (iqd) => {
      const v = Math.round(iqd);
      const body = nf.format(Math.abs(v));
      return `${v < 0 ? minus : ''}${body} ${unit}`;
    },
    num: (n) => nf.format(Math.round(n)),
    compact: (n) => compactNf.format(n),
    pct: (n) => {
      const abs = Math.abs(n);
      const body = abs < 10 && !Number.isInteger(n) ? nf1.format(abs) : nf.format(abs);
      return `${n < 0 ? minus : ''}${body}%`;
    },
    signedPct: (n) => {
      const r = Math.round(n);
      if (r === 0) return '0%';
      return `${r > 0 ? '+' : minus}${nf.format(Math.abs(r))}%`;
    },
    date: (iso, withYear = false) => (withYear ? dayMonthYear : dayMonth).format(parseIso(iso)),
    dateRange: (from, to) =>
      from === to ? dayMonth.format(parseIso(from)) : `${dayMonth.format(parseIso(from))} – ${dayMonth.format(parseIso(to))}`,
    duration: (seconds) => {
      const s = Math.max(0, Math.round(seconds));
      const m = Math.floor(s / 60);
      const rest = s % 60;
      const unitM = locale === 'ar' ? 'د' : 'm';
      const unitS = locale === 'ar' ? 'ث' : 's';
      if (m === 0) return `${rest}${unitS}`;
      return `${m}${unitM} ${String(rest).padStart(2, '0')}${unitS}`;
    },
    hour: (h) => `${String(h).padStart(2, '0')}:00`,
    weekday: (dow) => weekdayNf.format(new Date(Date.UTC(2024, 8, 1 + ((dow % 7) + 7) % 7))), // 2024-09-01 is a Sunday
  };
  cache.set(locale, f);
  return f;
}

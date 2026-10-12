/**
 * The formatters print the APP's language whatever the platform's Intl does
 * with a language tag. Hermes on Android fell back to the phone's language for
 * the tags formatting.ts used to pass: a Persian phone showed Persian weekdays
 * and digits in an English app (owner, 2026-10-11).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as f from '../formatting';

const TAG = { en: 'en-IQ-u-nu-latn', ar: 'ar-IQ-u-nu-latn' } as const;
const LOCALES = ['en', 'ar'] as const;
const nbsp = (s: string) => s.replace(/ /g, ' ');

describe('formatting matches CLDR (Node ICU) byte for byte', () => {
  const icu = (l: 'en' | 'ar', o: Intl.DateTimeFormatOptions, d: Date) =>
    new Intl.DateTimeFormat(TAG[l], { ...o, timeZone: f.VENUE_TZ }).format(d);

  it('dates, times, weekdays and months over a year of instants', () => {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 7 * 3600e3 + 13 * 60e3) {
      const d = new Date(t);
      for (const l of LOCALES) {
        // CLDR keeps only "تشرين الأول" together with a no-break space inside a
        // date; ours keeps every two-word month together. Spaces compared loosely.
        expect(nbsp(f.formatDate(d, l))).toBe(nbsp(icu(l, { day: 'numeric', month: 'short', year: 'numeric' }, d)));
        expect(nbsp(f.formatDateTime(d, l))).toBe(
          nbsp(icu(l, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }, d)),
        );
        expect(f.formatTime(d, l)).toBe(icu(l, { hour: 'numeric', minute: '2-digit' }, d));
        expect(f.formatWeekdayShort(d, l)).toBe(icu(l, { weekday: 'short' }, d));
        expect(f.formatWeekdayLong(d, l)).toBe(icu(l, { weekday: 'long' }, d));
        expect(f.formatMonthShort(d, l)).toBe(icu(l, { month: 'short' }, d));
        expect(f.formatMonthLong(d, l)).toBe(icu(l, { month: 'long' }, d));
        expect(f.formatMonthYear(d, l)).toBe(icu(l, { month: 'long', year: 'numeric' }, d));
        expect(f.formatDayNumber(d, l)).toBe(icu(l, { day: 'numeric' }, d));
      }
    }
  });

  it('money, numbers and percentages', () => {
    for (const n of [0, 5, -7, 999, 1000, 15000, 1234567, -250000, 1e9]) {
      for (const l of LOCALES) {
        const nf = new Intl.NumberFormat(TAG[l]);
        const iqd =
          l === 'ar'
            ? new Intl.NumberFormat(TAG[l], { style: 'currency', currency: 'IQD', maximumFractionDigits: 0 }).format(n)
            : `${nf.format(n)} IQD`;
        expect(f.formatIQD(n, l)).toBe(iqd);
        for (const x of [n, n / 7, n + 0.0005, -0.04]) expect(f.formatNumber(x, l)).toBe(nf.format(x));
        const pf = new Intl.NumberFormat(TAG[l], { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        for (const x of [n / 3, 12.25, 0.05, -3.45]) expect(f.formatPercent(x, l)).toBe(pf.format(x));
      }
    }
  });
});

describe('formatting never asks Intl for a language', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prints English and Latin digits even when Intl answers in Persian', () => {
    const Real = Intl.DateTimeFormat;
    // A Hermes that resolves only en-US and answers everything else in the
    // phone's language (Persian, Extended Arabic-Indic digits).
    const Phone = function (tag: string, options: Intl.DateTimeFormatOptions) {
      return new Real(tag === 'en-US' ? 'en-US' : 'fa-IR', options);
    } as unknown as typeof Intl.DateTimeFormat;
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: Phone,
      NumberFormat: function () {
        throw new Error('NumberFormat is not used');
      },
    });
    const d = new Date('2026-10-11T11:30:00Z'); // Sunday 14:30 in Baghdad
    expect(f.formatWeekdayShort(d, 'en')).toBe('Sun');
    expect(f.formatWeekdayShort(d, 'ar')).toBe('الأحد');
    expect(f.formatTime(d, 'en')).toBe('2:30 PM');
    expect(f.formatDayNumber(d, 'en')).toBe('11');
    expect(f.formatIQD(40000, 'en')).toBe('40,000 IQD');
  });
});

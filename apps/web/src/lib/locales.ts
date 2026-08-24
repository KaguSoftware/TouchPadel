import type { Locale } from '@touch/i18n';

export const LOCALES = ['en', 'ar'] as const;
export const DEFAULT_LOCALE: Locale = 'en';

/** Narrow an arbitrary route segment to a supported locale (default: 'en'). */
export function asLocale(value: string): Locale {
  return value === 'ar' ? 'ar' : 'en';
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

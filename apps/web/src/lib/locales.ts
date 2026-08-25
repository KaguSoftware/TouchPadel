import type { Locale } from '@touch/i18n';

export const LOCALES = ['en', 'ar'] as const;
/** Arabic is the default (owner decision, web-slice §0). */
export const DEFAULT_LOCALE: Locale = 'ar';
/** Cookie the locale switcher sets; proxy.ts reads it before Accept-Language. */
export const LOCALE_COOKIE = 'tp-locale';

/** Narrow an arbitrary route segment to a supported locale (default: 'ar'). */
export function asLocale(value: string): Locale {
  return value === 'en' ? 'en' : 'ar';
}

export function otherLocale(locale: Locale): Locale {
  return locale === 'ar' ? 'en' : 'ar';
}

/**
 * Same page in another locale. Rewrites a leading /en|/ar, or prefixes a
 * locale-less path (the printed /t/{token}); search string preserved.
 */
export function hrefForLocale(pathname: string, search: string, locale: Locale): string {
  const stripped = pathname.replace(/^\/(en|ar)(?=\/|$)/, '');
  const base = stripped === '' ? '' : stripped;
  return `/${locale}${base}${search}`;
}

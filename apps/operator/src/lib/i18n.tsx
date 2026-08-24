/**
 * Locale context for the operator app — staff pick EN/AR; persisted per station.
 * Layout flips purely via dir (ThemeProvider sets it on <html>); all CSS is
 * logical-properties-only.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { dir, makeT, type Locale, type MessageKey, type TParams } from '@touch/i18n';

const STORAGE_KEY = 'touch-operator-locale';

interface LocaleContextValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  tr: (key: MessageKey, params?: TParams) => string;
  toggleLocale: () => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'ar' ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(loadLocale);

  const toggleLocale = useCallback(() => {
    setLocale((prev) => {
      const next: Locale = prev === 'en' ? 'ar' : 'en';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* private mode — locale simply resets next boot */
      }
      return next;
    });
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, dir: dir(locale), tr: makeT(locale), toggleLocale }),
    [locale, toggleLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale outside LocaleProvider');
  return ctx;
}

/** Pick the localized column of a bilingual row (name_en/name_ar pattern). */
export function pickName(
  locale: Locale,
  row: { name_en: string; name_ar: string } | null | undefined,
): string {
  if (!row) return '';
  return locale === 'ar' ? row.name_ar : row.name_en;
}

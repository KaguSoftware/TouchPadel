export type Locale = 'en' | 'ar';

/** Bilingual fallback: preferred language, else the other, else ''. */
export function pickLocale(
  pair: { en: string | null | undefined; ar: string | null | undefined },
  locale: Locale,
): string {
  return (locale === 'ar' ? (pair.ar ?? pair.en) : (pair.en ?? pair.ar)) ?? '';
}

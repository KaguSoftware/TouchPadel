import { iqd } from './iqd';

export type MoneyLocale = 'en' | 'ar';

export interface FormatIqdOptions {
  /**
   * Digit system. Per the approved plan, money renders with WESTERN (latn) digits in BOTH
   * locales — Iraqi price displays conventionally use Western digits. 'arabic-indic' is exposed
   * for a later client preference, not used by default.
   */
  digits?: 'western' | 'arabic-indic';
}

const formatterCache = new Map<string, Intl.NumberFormat>();

/**
 * Format an integer IQD amount for display. Zero decimal places always; locale controls
 * grouping/symbol placement ('ar' renders the Arabic currency label, RTL-friendly), while the
 * digits stay Western in both locales unless 'arabic-indic' is requested.
 */
export function formatIQD(
  amount: number,
  locale: MoneyLocale,
  options: FormatIqdOptions = {},
): string {
  const value = iqd(amount);
  const nu = (options.digits ?? 'western') === 'arabic-indic' ? 'arab' : 'latn';
  const tag = `${locale === 'ar' ? 'ar-IQ' : 'en'}-u-nu-${nu}`;
  let nf = formatterCache.get(tag);
  if (!nf) {
    nf = new Intl.NumberFormat(tag, {
      style: 'currency',
      currency: 'IQD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    formatterCache.set(tag, nf);
  }
  return nf.format(value);
}

import { formatNumber, type Locale } from '@touch/i18n';

/** The most a count badge shows; anything above reads "9+". The screen-reader text keeps the true number. */
export const BADGE_CAP = 9;

export function badgeLabel(count: number, locale: Locale): string {
  return count > BADGE_CAP ? `${formatNumber(BADGE_CAP, locale)}+` : formatNumber(count, locale);
}

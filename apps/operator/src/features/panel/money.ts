/**
 * F-58: a money figure on the panel is IQD, always. The panel printed one as
 * "12,345 IQD" only when the server sent a whole number, and as a bare
 * "12,345.67" otherwise — so the average order value (a ratio, the one figure
 * that is rarely whole) showed with no currency at all, beside figures that
 * had one. The dinar has no subunit in use: round half away from zero to a
 * whole dinar, then format as every other amount is.
 */
import { formatIQD, type Locale } from '@touch/i18n';

/** A server figure (possibly fractional, possibly negative) as whole dinars. */
export function wholeIqd(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.sign(n) * Math.round(Math.abs(n));
  return r === 0 ? 0 : r; // never -0
}

export function formatFigureIqd(n: number, locale: Locale): string {
  return formatIQD(wholeIqd(n), locale);
}

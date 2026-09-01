import { formatIQD, type Locale } from '@touch/i18n';

/**
 * Price for display, or null when there is nothing sensible to show.
 *
 * `formatIQD` THROWS on a non-integer (money is integer IQD by design), and it
 * was being called inside render with values straight off the wire — PostgREST
 * can serialise bigint/numeric columns as strings, so one such row would have
 * taken the whole Bookings tab down via the error boundary.
 */
export function formatPrice(value: unknown, locale: Locale): string | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return formatIQD(n, locale);
}

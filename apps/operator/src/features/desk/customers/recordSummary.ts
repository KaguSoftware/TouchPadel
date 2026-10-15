/**
 * The figures behind the customer record's cards (CustomerRecord.tsx), kept
 * pure so they are tested under node.
 */
import type { CustomerCounts, CustomerReservationRow } from '../deskTypes';
import { elapsedSince, type Elapsed } from '../../till/elapsed';

export interface KeptShare {
  /** Bookings still live or played (app.customer_counts `bookings`). */
  kept: number;
  cancelled: number;
  /** Booking no-shows only: `noShows` less its open-match seats. */
  noShows: number;
  /** kept / (kept + cancelled + noShows), 0–100, rounded. */
  pct: number;
}

/**
 * How many of the customer's bookings they kept. app.customer_counts counts a
 * booking once, by its status: `bookings` is pending, confirmed, arrived or
 * completed, so it already leaves out the cancelled and no-show ones, and
 * `noShows` adds open-match seats (DF-12), which are not bookings. null when
 * there is no booking to measure.
 */
export function keptShare(counts: CustomerCounts): KeptShare | null {
  const kept = Math.max(0, counts.bookings);
  const cancelled = Math.max(0, counts.cancellations);
  const noShows = Math.max(0, counts.noShows - (counts.matchNoShows ?? 0));
  const total = kept + cancelled + noShows;
  if (total === 0) return null;
  return { kept, cancelled, noShows, pct: Math.round((kept / total) * 100) };
}

/** The soonest upcoming booking. customer_record sends them in start order; sorted again so the card never trusts that. */
export function nextBooking(upcoming: readonly CustomerReservationRow[]): CustomerReservationRow | null {
  let next: CustomerReservationRow | null = null;
  for (const r of upcoming) if (!next || r.start_at < next.start_at) next = r;
  return next;
}

/** Up to two initials for the record's avatar: first and last word, in the name's own script. */
export function initials(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return (first + last).toLocaleUpperCase();
}

/** How long until a booking starts, on the same scale as the till's ages (now · min · h min · d h). */
export function untilStart(startIso: string, nowMs: number): Elapsed {
  return elapsedSince(new Date(nowMs).toISOString(), Date.parse(startIso));
}

/** The café card's bars: the newest `n` orders' totals, oldest first. */
export function cafeSpark(orders: readonly { opened_at: string; total_iqd: number | null }[], n = 8): number[] {
  return [...orders]
    .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
    .slice(0, n)
    .reverse()
    .map((o) => Math.max(0, o.total_iqd ?? 0));
}

/** The newest café order's time, or null. */
export function lastOrderAt(orders: readonly { opened_at: string }[]): string | null {
  let last: string | null = null;
  for (const o of orders) if (!last || o.opened_at > last) last = o.opened_at;
  return last;
}

/** What a card opens: one section of the record, in a dialog. */
export type RecordSection = 'bookings' | 'matches' | 'lessons' | 'tickets' | 'loyalty' | 'cafe' | 'series';

/** The loyalty card's colour for a tier, read from its English name; null (brand green) for any other. */
export type TierColour = 'gold' | 'silver' | 'bronze' | 'platinum';
export function tierColour(nameEn: string | null | undefined): TierColour | null {
  const n = (nameEn ?? '').toLowerCase();
  for (const c of ['platinum', 'gold', 'silver', 'bronze'] as const) if (n.includes(c)) return c;
  return null;
}

/**
 * Per-day counts for the zoomed-out month calendar.
 *
 * One hook for every calendar that shades a month: the desk and the Courts
 * observe board count bookings by the night they START on, and the Tills
 * observe board counts tabs by the business day they were opened under. The
 * hook owns the window and the busiest-day scale; the fetcher owns what is
 * counted and which day it lands on (see monthFetchers).
 *
 * Paged, not one select: PostgREST caps a response at `max_rows` (1000), and a
 * busy month of bookings passes that. A capped response would not error — it
 * would silently shade the last week of the month as empty.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { shiftIsoDate } from '../weekLogic';
import { busiestCount, inheritedTailMin, monthGridBounds, monthStart, monthWeeks, type OpeningHours } from './monthLogic';

const PAGE = 1000;

/** Read every row of a ranged select, one page at a time. */
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** What a fetcher is asked for: the grid's dates and the instants that bound them. */
export interface MonthWindow {
  /** First and last date on the grid, inclusive. */
  first: string;
  last: string;
  /** [fromIso, toIso): local midnight of `first` to the end of `last`'s night. */
  fromIso: string;
  toIso: string;
  timeZone: string;
  hours: OpeningHours;
}

export interface MonthCounts {
  counts: ReadonlyMap<string, number>;
  /** The busiest day inside the displayed month (not its neighbours' spill-over days). */
  max: number;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function useMonthCounts({
  queryKey,
  date,
  timeZone,
  hours,
  enabled,
  fetchCounts,
}: {
  /** Prefix; the month is appended. Broadcast invalidation targets this prefix. */
  queryKey: string;
  date: string;
  timeZone: string;
  hours: OpeningHours;
  enabled: boolean;
  fetchCounts: (window: MonthWindow) => Promise<Map<string, number>>;
}): MonthCounts {
  const month = monthStart(date);
  const q = useQuery({
    queryKey: [queryKey, month],
    enabled,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { first, last } = monthGridBounds(month);
      const after = shiftIsoDate(last, 1);
      // Widen by the night that runs past the grid's last midnight.
      return fetchCounts({
        first,
        last,
        fromIso: wallTimeToUtc(first, 0, timeZone).toISOString(),
        toIso: wallTimeToUtc(after, inheritedTailMin(after, hours), timeZone).toISOString(),
        timeZone,
        hours,
      });
    },
  });

  const counts = useMemo(() => q.data ?? new Map<string, number>(), [q.data]);
  const max = useMemo(() => {
    const inMonth = monthWeeks(month).flat().filter((d) => d.startsWith(month.slice(0, 7)));
    return busiestCount(counts, inMonth);
  }, [counts, month]);

  return { counts, max, isPending: q.isPending, isError: q.isError, error: q.error, refetch: () => void q.refetch() };
}

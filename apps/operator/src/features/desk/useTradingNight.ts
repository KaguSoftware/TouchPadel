/**
 * One trading night of the desk: venue settings, courts and the reservations
 * that start inside it, plus the 'courts' broadcast that busts the cache.
 *
 * Extracted from DeskCalendar so Today's board renders the same rows the
 * calendar does — same fetch window, same cache slot, same invalidation.
 *
 * The night, not the calendar day: Touch trades 09:00 → 02:00, so the
 * 00:00–02:00 rows belong to the FOLLOWING date. `tradingSpan` folds the next
 * day's inherited tail in; the fetch window is never narrower than the day.
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { tradingSpan, wallTimeToUtc, type DayKey } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { cachedQuery } from '../../lib/refCache';
import { QK, fetchVenueSettings, fetchActiveCourts, type CourtRow, type VenueSettingsRow } from '../../lib/queries';
import { useBroadcast } from '../../lib/realtime';
import { RESERVATION_COLUMNS, type ReservationRow, type TabLinkRow } from './deskTypes';

export const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const SLOT_MIN = 30;

export function todayInTz(tz: string): string {
  // en-CA is the one common locale whose short date IS YYYY-MM-DD.
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export interface TradingNight {
  date: string;
  tz: string;
  settingsQ: UseQueryResult<VenueSettingsRow>;
  courtsQ: UseQueryResult<CourtRow[]>;
  reservationsQ: UseQueryResult<ReservationRow[]>;
  courts: CourtRow[];
  reservations: ReservationRow[];
  /** Venue-local minutes past midnight the grid opens / closes (close may exceed 1440). */
  openMin: number;
  closeMin: number;
  rowCount: number;
  rows: number[];
  dayStart: Date;
  dayEnd: Date;
  closed: boolean;
  closedDates: string[];
}

export function useTradingNight(date: string): TradingNight {
  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const courtsQ = useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts });

  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const dayStart = useMemo(() => wallTimeToUtc(date, 0, tz), [date, tz]);

  const dayIndex = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayKey = DAY_KEYS[dayIndex] as DayKey;
  const windows = settingsQ.data?.opening_hours?.[dayKey] ?? [];
  const nextDayWindows = settingsQ.data?.opening_hours?.[DAY_KEYS[(dayIndex + 1) % 7] as DayKey] ?? [];
  const closedDates = settingsQ.data?.closed_dates ?? [];
  const closed = closedDates.includes(date);

  const { startMin: openMin, endMin: closeMin } = tradingSpan(windows, nextDayWindows);
  const rowCount = Math.max(0, Math.ceil((closeMin - openMin) / SLOT_MIN));
  const rows = useMemo(() => Array.from({ length: rowCount }, (_, i) => openMin + i * SLOT_MIN), [rowCount, openMin]);

  const dayEnd = useMemo(() => wallTimeToUtc(date, Math.max(24 * 60, closeMin), tz), [date, tz, closeMin]);

  const reservationsQ = useQuery({
    queryKey: ['reservations', date],
    queryFn: async (): Promise<ReservationRow[]> => {
      // The ref_cache slot holds ONE day's rows tagged with its date; offline,
      // a cached different day must not be presented as this one.
      const cached = await cachedQuery('reservations', async () => {
        const { data, error } = await supabase
          .from('reservations')
          .select(RESERVATION_COLUMNS)
          .gte('start_at', dayStart.toISOString())
          .lt('start_at', dayEnd.toISOString())
          .order('start_at');
        if (error) throw error;
        return { date, rows: data as unknown as ReservationRow[] };
      });
      if (cached.date !== date) throw new Error(`cached reservations are for ${cached.date}`);
      return cached.rows;
    },
    enabled: settingsQ.isSuccess,
    // Safety net under the 'courts' broadcast: a missed frame must not leave
    // the desk promising a slot a guest already took.
    refetchInterval: 60_000,
  });

  useBroadcast({
    topic: 'courts',
    isPrivate: true,
    events: ['slot_changed'],
    invalidateKeys: [['reservations'], ['reservationsWeek'], ['reservation']],
  });

  return {
    date,
    tz,
    settingsQ,
    courtsQ,
    reservationsQ,
    courts: courtsQ.data ?? [],
    reservations: reservationsQ.data ?? [],
    openMin,
    closeMin,
    rowCount,
    rows,
    dayStart,
    dayEnd,
    closed,
    closedDates,
  };
}

/**
 * Which of these bookings a tab charges, and whether it is settled. The desk
 * may not be allowed to read `tabs` (RLS) — an error here degrades to
 * "payment unknown", never to a broken board.
 */
export function useTabLinks(reservationIds: readonly string[]): UseQueryResult<TabLinkRow[]> {
  const ids = useMemo(() => [...reservationIds].sort(), [reservationIds]);
  return useQuery({
    queryKey: ['tabLinks', ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<TabLinkRow[]> => {
      const { data, error } = await supabase.from('tabs').select('reservation_id, status').in('reservation_id', ids);
      if (error) throw error;
      return (data ?? []) as TabLinkRow[];
    },
    retry: false,
    refetchInterval: 60_000,
  });
}

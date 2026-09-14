/**
 * What the month calendars count, and which day each row lands on. Kept beside
 * the hook so the desk and the observe boards count the same rows the same way.
 */
import { supabase } from '../../../lib/supabase';
import { countByTradingDate } from './monthLogic';
import { selectAllPages, type MonthWindow } from './useMonthCounts';

/**
 * Bookings, on the night they start. Cancelled and expired ones never happened
 * and are not counted; a no-show still booked the court, so it is. Holds and
 * maintenance blocks are not a guest's reservation.
 */
export async function fetchBookingCounts(w: MonthWindow): Promise<Map<string, number>> {
  const rows = await selectAllPages<{ start_at: string }>((a, b) =>
    supabase
      .from('reservations')
      .select('start_at')
      .eq('kind', 'booking')
      .not('status', 'in', '(cancelled,expired)')
      .gte('start_at', w.fromIso)
      .lt('start_at', w.toIso)
      .order('start_at')
      .range(a, b),
  );
  return countByTradingDate(
    rows.map((r) => ({ at: r.start_at })),
    w.timeZone,
    w.hours,
  );
}

/**
 * Tabs, on the BUSINESS day they were opened under — the day the till traded
 * against and the day close counted, which is what an owner means by "that
 * day's tabs". Every status. A merged-away donor is not counted: its lines now
 * live on the survivor, which is.
 */
export async function fetchTabCounts(w: MonthWindow): Promise<Map<string, number>> {
  const rows = await selectAllPages<{ day_session: { business_date: string } | null }>((a, b) =>
    supabase
      .from('tabs')
      .select('id, day_session:day_sessions!inner(business_date)')
      .is('merged_into_tab_id', null)
      .gte('day_session.business_date', w.first)
      .lte('day_session.business_date', w.last)
      .order('opened_at')
      .range(a, b),
  );
  const counts = new Map<string, number>();
  for (const r of rows) {
    const d = r.day_session?.business_date;
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return counts;
}

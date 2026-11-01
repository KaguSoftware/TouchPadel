/**
 * 0388 (F-14): report_drill's totals add up past 500 rows, and each row's day is
 * its business day (the branch's day start, 4:00 by default), not the calendar
 * date. One rolled-back transaction on dates far ahead, so no real booking
 * touches them.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, T, X, KEEP, ok } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

interface Drill {
  transactions: Array<{ at: string; day: string; amountIqd: number }>;
  totals: { count: number; amountIqd: number; kinds: Array<{ key: string; count: number; sum: number }>; days: Record<string, { count: number; sum: number }> };
  capped: boolean;
}

describe.skipIf(!docker)('0388 report_drill totals and business days', () => {
  it('totals count every match past the 500 listed; a booking at 01:30 is the night before', () => {
    const r = scenario('rdt388', [
      KEEP('court', `select id::text from courts where venue_id = {{venue}}::uuid and is_active order by name_en limit 1`),
      X(`update cafe_settings set value = '4' where venue_id = {{venue}}::uuid and key = 'analytics_business_day_start_hour'`),
      // 503 one-hour bookings, back to back from 2032-03-01 10:00 Baghdad, 10,000 IQD each.
      X(`insert into reservations (court_id, kind, status, start_at, end_at, price_iqd, guest_name, source)
         select {{court}}::uuid, 'booking', 'confirmed',
                timestamptz '2032-03-01 10:00+03' + make_interval(hours => g),
                timestamptz '2032-03-01 11:00+03' + make_interval(hours => g), 10000, 'RDT', 'desk'
           from generate_series(0, 502) g`),
      T('drill', 'manager', `select app.report_drill('bookings', 'court:' || {{court}}, date '2032-03-01', date '2032-03-31')`),
    ]);
    const d = ok<Drill>(r, 'drill');
    expect(d.transactions).toHaveLength(500);
    expect(d.capped).toBe(true);
    expect(d.totals.count).toBe(503);
    expect(d.totals.amountIqd).toBe(5_030_000);
    expect(d.totals.kinds).toEqual([{ key: 'booking', count: 503, sum: 5_030_000 }]);
    const dayCounts = Object.values(d.totals.days).reduce((a, x) => a + x.count, 0);
    expect(dayCounts).toBe(503);
    // 2032-03-02 01:00 Baghdad is the night of 2032-03-01 (day start 4:00).
    const late = d.transactions.find((t) => new Date(t.at).toISOString() === '2032-03-01T22:00:00.000Z');
    expect(late?.day).toBe('2032-03-01');
    // The first day holds 10:00 to 03:00 the next morning: 18 bookings.
    expect(d.totals.days['2032-03-01']).toEqual({ count: 18, sum: 180_000 });
  });
});

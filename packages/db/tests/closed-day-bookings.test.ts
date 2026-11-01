/**
 * 0390 (F-51, Majed 2026-11-01): a closed day cannot be saved while a booking
 * on it still has to be cancelled, marked no-show or paid.
 *
 *   * set_opening_hours refuses a newly added closed date with an unresolved
 *     booking (CLOSED_DAY_HAS_BOOKINGS, detail the count, hint the first date);
 *   * a cancelled, no-show or fully paid booking (a settled tab carrying the
 *     court fee) no longer blocks; a lesson, a hold and maintenance never do;
 *   * a date already closed, or removing one, is never refused;
 *   * closed_day_bookings lists exactly the blockers, for a manager or the
 *     owner at the branch, and refuses a cashier.
 *
 * Every scenario is one rolled-back transaction (stores-harness), on dates far
 * in the future so no real booking can touch them.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, T, Q, X, KEEP, ok, refused } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

const DAY = '2031-03-04';
const OTHER_DAY = '2031-03-05';

const COURT = KEEP(
  'court',
  `select id::text from courts where venue_id = {{venue}}::uuid and is_active order by name_en limit 1`,
);
/** A booking on DAY at 12:00 Baghdad. */
const BOOKING = (name: string, status = 'confirmed', kind = 'booking', price = 40000, hour = 12) =>
  KEEP(
    name,
    `insert into reservations (court_id, kind, status, start_at, end_at, price_iqd, guest_name, source)
     values ({{court}}::uuid, '${kind}', '${status}', timestamptz '${DAY} ${hour}:00+03',
             timestamptz '${DAY} ${hour}:00+03' + interval '90 minutes', ${price}, 'CD ${name}', 'desk')
     returning id::text`,
  );
const DAY_SESSION = KEEP(
  'day',
  `insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
   values ({{venue}}::uuid, date '3000-01-01' + (random() * 900000)::int, {{owner}}::uuid, 0) returning id::text`,
);
/** The booking's court fee settled on a tab: paid. */
const PAID = (booking: string, amount = 40000) =>
  X(`insert into tabs (venue_id, day_session_id, label, kind, reservation_id, status, court_iqd)
     values ({{venue}}::uuid, {{day}}::uuid, 'CD paid', 'cafe', {{${booking}}}::uuid, 'settled', ${amount})`);
const CLOSE = (label: string, who: string, dates: string[]) =>
  T(label, who, `select to_jsonb(app.set_opening_hours(null, array[${dates.map((d) => `'${d}'`).join(',')}]::date[], {{venue}}::uuid))`);
const LIST = (label: string, who: string, dates: string[]) =>
  T(label, who, `select app.closed_day_bookings(array[${dates.map((d) => `'${d}'`).join(',')}]::date[], {{venue}}::uuid)`);
/** The branch's closed dates now, as text. */
const CLOSED_NOW = (label: string) =>
  Q(label, `select to_jsonb(closed_dates::text[]) from venue_settings where venue_id = {{venue}}::uuid`);

interface Listed {
  bookings: Array<{ id: string; status: string; remaining_iqd: number | null; guest_name: string | null; day: string }>;
}

describe.skipIf(!docker)('0390 closed days with bookings (rolled-back transactions)', () => {
  it('refuses a new closed date until each booking is cancelled, marked no-show or paid', () => {
    const r = scenario('cd390a', [
      COURT,
      DAY_SESSION,
      X(`update venue_settings set closed_dates = '{}' where venue_id = {{venue}}::uuid`),
      BOOKING('b_open'),
      BOOKING('b_part', 'confirmed', 'booking', 40000, 15),
      BOOKING('b_pending', 'pending', 'booking', 40000, 17),
      BOOKING('b_upkeep', 'confirmed', 'maintenance', 0, 9),
      BOOKING('b_cancelled', 'cancelled', 'booking', 40000, 19),
      PAID('b_part', 10000),
      LIST('list', 'manager', [DAY, OTHER_DAY]),
      LIST('list_cashier', 'cashier', [DAY]),
      CLOSE('refused', 'manager', [DAY]),
      CLOSED_NOW('after_refused'),
      // Another date with nothing on it closes fine.
      CLOSE('other_ok', 'manager', [OTHER_DAY]),
      // Resolve each one: cancel, no-show, and pay the rest.
      X(`update reservations set status = 'cancelled', cancelled_at = now() where id = {{b_open}}::uuid`),
      X(`update reservations set status = 'no_show' where id = {{b_pending}}::uuid`),
      CLOSE('still_one', 'manager', [OTHER_DAY, DAY]),
      PAID('b_part', 30000),
      LIST('list_after', 'owner', [DAY]),
      CLOSE('closed', 'manager', [OTHER_DAY, DAY]),
      CLOSED_NOW('after_closed'),
    ]);

    const listed = ok<Listed>(r, 'list');
    const names = listed.bookings.map((b) => b.guest_name).sort();
    expect(names).toEqual(['CD b_open', 'CD b_part', 'CD b_pending']);
    expect(listed.bookings.find((b) => b.guest_name === 'CD b_part')).toMatchObject({ remaining_iqd: 30000, day: DAY });
    expect(refused(r, 'list_cashier')).toBe('FORBIDDEN');

    expect(r.refused).toMatchObject({ ok: false, code: 'CLOSED_DAY_HAS_BOOKINGS', detail: '3', hint: DAY });
    expect(ok<string[]>(r, 'after_refused')).toEqual([]);
    ok(r, 'other_ok');
    expect(r.still_one).toMatchObject({ ok: false, code: 'CLOSED_DAY_HAS_BOOKINGS', detail: '1' });
    expect(ok<Listed>(r, 'list_after').bookings).toEqual([]);
    ok(r, 'closed');
    expect(ok<string[]>(r, 'after_closed')).toEqual([OTHER_DAY, DAY]);
  });

  it('never refuses a date that was already closed, nor removing one', () => {
    const r = scenario('cd390b', [
      COURT,
      X(`update venue_settings set closed_dates = array[date '${DAY}'] where venue_id = {{venue}}::uuid`),
      // A booking written straight in (the closed date would refuse it through the RPCs).
      BOOKING('b_open'),
      CLOSE('kept', 'manager', [DAY]),
      CLOSE('removed', 'manager', []),
      CLOSE('again', 'manager', [DAY]),
    ]);
    ok(r, 'kept');
    ok(r, 'removed');
    expect(r.again).toMatchObject({ ok: false, code: 'CLOSED_DAY_HAS_BOOKINGS', detail: '1' });
  });
});

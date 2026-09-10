import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { TodaysBoardView, type TodaysBoardViewProps } from './TodaysBoard';
import type { ReservationRow } from './deskTypes';

const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 },
];

function row(over: Partial<ReservationRow> & { id: string }): ReservationRow {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-03T15:00:00.000Z',
    end_at: '2026-09-03T16:00:00.000Z',
    guest_id: null,
    guest_name: 'Sara Ahmed',
    guest_phone: '07701234567',
    price_iqd: 30000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function renderView(over: Partial<TodaysBoardViewProps> = {}) {
  const props: TodaysBoardViewProps = {
    status: 'ready',
    date: '2026-09-03',
    tz: 'Asia/Baghdad',
    nowIso: '2026-09-03T14:30:00.000Z',
    horizonIso: '2026-09-03T15:30:00.000Z',
    courts,
    reservations: [],
    live: true,
    onRetry: vi.fn(),
    onSelectReservation: vi.fn(),
    onCreateBooking: vi.fn(),
    onSearchCustomer: vi.fn(),
    onOpenCalendar: vi.fn(),
    onMarkArrived: vi.fn(),
    ...over,
  };
  render(
    <LocaleProvider>
      <TodaysBoardView {...props} />
    </LocaleProvider>,
  );
  return props;
}

describe("TodaysBoardView — Today's board (spec 06.1)", () => {
  it('loading: renders the header actions and no bookings table', () => {
    renderView({ status: 'loading' });
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('button', { name: 'Search customer' })).toBeTruthy();
  });

  it('error: states the failure and offers retry', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'error', error: new Error('boom') });
    // The wrapper and the inline ErrorText are both alerts: the failure is stated, not hidden.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText('This could not be loaded.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty: teaches the next action and still shows every court as free', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'empty' });
    expect(screen.getByText('No bookings today')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a booking' }));
    expect(props.onCreateBooking).toHaveBeenCalledTimes(1);
    // Availability comes from the rows on screen: none, so both courts are free.
    expect(screen.getAllByText('Free')).toHaveLength(2);
  });

  it('ready: lists bookings with court, time, status, payment, flags and arrivals', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        row({ id: 'r1', guest_id: 'g1' }),
        row({ id: 'r2', court_id: 'c2', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:00:00.000Z', guest_name: 'Omar' }),
        row({ id: 'm1', kind: 'maintenance', court_id: 'c2', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z', guest_name: null, notes: 'Net repair', price_iqd: null }),
      ],
      tabLinks: [{ reservation_id: 'r1', status: 'settled' }],
      flagsByGuest: new Map([['g1', [{ type: 'vip', label: null }]]]),
    });
    const table = screen.getByRole('table', { name: 'Bookings' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(screen.getAllByText('Sara Ahmed').length).toBeGreaterThan(0);
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('Paid')).toBeTruthy();
    expect(screen.getByText('Net repair')).toBeTruthy();
    // Court 2 is in use right now (Omar, 14:00–15:00); court 1 is free until 15:00.
    expect(screen.getByText(/In use until/)).toBeTruthy();
    expect(screen.getByText(/Free until/)).toBeTruthy();
    // Arrivals: Omar already arrived, Sara due at 15:00 — her "Mark arrived" is offered.
    const marks = screen.getAllByRole('button', { name: 'Mark arrived' });
    expect(marks.length).toBeGreaterThan(0);
    await user.click(marks[0]!);
    expect(props.onMarkArrived).toHaveBeenCalledWith('r1');
    await user.click(screen.getByRole('button', { name: 'Open Omar' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('r2');
  });
});

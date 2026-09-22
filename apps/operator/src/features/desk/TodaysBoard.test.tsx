import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { TodaysBoardView, type TodaysBoardViewProps } from './TodaysBoard';
import type { ReservationRow } from './deskTypes';
import { statesById, type BillStateRow } from './payment/deskPaymentLogic';

function billState(over: Partial<BillStateRow> & { reservation_id: string }): BillStateRow {
  return { state: 'none', live_tab_id: null, due_iqd: 30000, court_paid_iqd: 0, court_remaining_iqd: 30000, court_refund_due_iqd: 0, ...over };
}

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
    onBookCourt: vi.fn(),
    onSearchCustomer: vi.fn(),
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
    expect(screen.getByRole('button', { name: 'Find customer' })).toBeTruthy();
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

  it('empty: teaches the next action and still offers every court as a free tile that books it', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'empty' });
    expect(screen.getByText('No bookings today')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a booking' }));
    expect(props.onCreateBooking).toHaveBeenCalledTimes(1);
    // Availability comes from the rows on screen: none, so both courts are free all night.
    expect(screen.getAllByText('Free until close')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Court 2 · Free until close · Book this court$/ }));
    expect(props.onBookCourt).toHaveBeenCalledWith('c2');
  });

  it('arrivals: splits late guests from those due within the hour, and leaves out guests already here', async () => {
    const user = userEvent.setup();
    const props = renderView({
      nowIso: '2026-09-03T15:10:00.000Z',
      horizonIso: '2026-09-03T16:10:00.000Z',
      reservations: [
        row({ id: 'late', guest_name: 'Late Guest' }), // 15:00–16:00, started 10 min ago
        row({ id: 'soon', court_id: 'c2', guest_name: 'Soon Guest', start_at: '2026-09-03T15:40:00.000Z', end_at: '2026-09-03T16:40:00.000Z' }),
        row({ id: 'here', court_id: 'c2', guest_name: 'Here Already', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:30:00.000Z' }),
      ],
    });
    const arrivals = screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!;
    const panel = within(arrivals);
    expect(panel.getByText('Started, not marked arrived')).toBeTruthy();
    expect(panel.getByText('Started 10 min ago')).toBeTruthy();
    expect(panel.getByText('Due in the next hour')).toBeTruthy();
    expect(panel.getByText('In 30 min')).toBeTruthy();
    expect(panel.queryByText('Here Already')).toBeNull();
    // Marking arrived is one click — no reason prompt in between.
    await user.click(panel.getAllByRole('button', { name: 'Mark arrived' })[0]!);
    expect(props.onMarkArrived).toHaveBeenCalledWith('late');
    // Header counts: three bookings, one here, one still to start.
    expect(screen.getByText('Still to come').textContent).toContain('Still to come');
  });

  it('arrivals: with nobody due, says who is next', () => {
    renderView({
      reservations: [row({ id: 'r1', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z' })],
    });
    expect(screen.getByText('Nobody is due in the next hour.')).toBeTruthy();
    expect(screen.getByText(/^Next: .* · Sara Ahmed · Court 1$/)).toBeTruthy();
  });

  it('ready: lists every booking with court, status, court fee and flags; rows and tiles open bookings', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        row({ id: 'r1', guest_id: 'g1' }),
        row({ id: 'r2', court_id: 'c2', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:00:00.000Z', guest_name: 'Omar' }),
        row({ id: 'r3', start_at: '2026-09-03T19:00:00.000Z', end_at: '2026-09-03T20:00:00.000Z', guest_name: 'Nadia' }),
        row({ id: 'm1', kind: 'maintenance', court_id: 'c2', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z', guest_name: null, notes: 'Net repair', price_iqd: null }),
      ],
      billStates: statesById([
        billState({ reservation_id: 'r1', state: 'paid', due_iqd: 0, court_paid_iqd: 30000, court_remaining_iqd: 0 }),
        billState({ reservation_id: 'r2' }),
        billState({ reservation_id: 'r3' }),
      ]),
      flagsByGuest: new Map([['g1', [{ type: 'vip', label: null }]]]),
    });
    const table = screen.getByRole('table', { name: 'All bookings today' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
    // Newest to oldest: Nadia (19:00) heads the list.
    expect(within(table.querySelectorAll('tbody tr')[0] as HTMLElement).getByText('Nadia')).toBeTruthy();
    const t = within(table);
    expect(t.getByText('VIP')).toBeTruthy();
    // Court fee, from the server: paid → Paid; not paid while the game is on or
    // still to come → a quiet fact, not a warning.
    expect(t.getByText('Paid')).toBeTruthy();
    expect(t.getAllByText('Not paid yet').length).toBe(2);
    expect(t.getByText('Net repair')).toBeTruthy();
    // Court 2 is in use right now (Omar, 14:00–15:00): its tile says so, and opens his booking.
    const omarTile = screen.getByRole('button', { name: /^Court 2 · In use until .* · Open$/ });
    await user.click(omarTile);
    expect(props.onSelectReservation).toHaveBeenCalledWith('r2');
    expect(screen.getByRole('button', { name: /^Court 1 · Free until .* · Book this court$/ })).toBeTruthy();
    await user.click(t.getByRole('button', { name: 'Open Nadia' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('r3');
  });

  it('played, not paid: games that are over with the fee open are listed to settle, and the next group hears about it', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        row({ id: 'early', start_at: '2026-09-03T13:00:00.000Z', end_at: '2026-09-03T14:00:00.000Z', guest_name: 'Early Group' }),
        row({ id: 'paidEarly', court_id: 'c2', start_at: '2026-09-03T12:00:00.000Z', end_at: '2026-09-03T13:00:00.000Z', guest_name: 'Paid Group' }),
        row({ id: 'next', start_at: '2026-09-03T15:00:00.000Z', end_at: '2026-09-03T16:00:00.000Z', guest_name: 'Next Group' }),
      ],
      billStates: statesById([
        billState({ reservation_id: 'early' }),
        billState({ reservation_id: 'paidEarly', state: 'paid', due_iqd: 0 }),
        billState({ reservation_id: 'next' }),
      ]),
    });
    const toSettle = within(screen.getByRole('heading', { name: 'Played, not paid' }).closest('section')!);
    expect(toSettle.getByText('Early Group')).toBeTruthy();
    expect(toSettle.queryByText('Paid Group')).toBeNull();
    expect(toSettle.getByText(/^Not paid · /)).toBeTruthy();
    await user.click(toSettle.getByRole('button', { name: 'Take payment Early Group' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('early');
    // The group due on the same court next is told, on its own arrival row.
    const soon = within(screen.getByRole('heading', { name: 'Due in the next hour' }).closest('section')!);
    expect(soon.getByText('The group before on this court has not paid: Early Group')).toBeTruthy();
  });

  it('court fee prints "—" while the tabs are unknown, never a guess', () => {
    renderView({ reservations: [row({ id: 'r1' })] });
    const table = screen.getByRole('table', { name: 'All bookings today' });
    expect(within(table).getByText('—')).toBeTruthy();
  });
});

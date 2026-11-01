import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// 0390 (F-51): a closed day that still has bookings cannot be saved until each
// is cancelled, marked no-show or paid; the editor lists them with those actions.

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../desk/payment/CourtBillPanel', () => ({
  CourtBillPanel: ({ reservationId }: { reservationId: string }) => <div data-testid="bill">{reservationId}</div>,
}));

let bookings: Record<string, unknown>[] = [];
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const mutations: { type: string; payload: Record<string, unknown> }[] = [];

vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({
    opening_hours: { sun: [['09:00', '23:00']], mon: [['09:00', '23:00']], tue: [['09:00', '23:00']], wed: [['09:00', '23:00']], thu: [['09:00', '23:00']], fri: [['09:00', '23:00']], sat: [['09:00', '23:00']] },
    closed_dates: [],
    timezone: 'Asia/Baghdad',
  })),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'closed_day_bookings') return { bookings };
    if (fn === 'set_opening_hours') return null;
    throw new Error(`unexpected ${fn}`);
  }),
}));
vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async (type: string, payload: Record<string, unknown>) => {
    mutations.push({ type, payload });
    bookings = bookings.filter((b) => b.id !== payload.reservationId);
    return { queued: false, result: null, key: 'k' };
  }),
}));

import { OpeningHoursEditor } from './OpeningHoursEditor';

const booking = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  day: '2031-03-04',
  court_id: 'c1',
  court_name_en: 'Court 1',
  court_name_ar: 'ملعب 1',
  start_at: '2031-03-04T09:00:00Z',
  end_at: '2031-03-04T10:30:00Z',
  status: 'confirmed',
  guest_name: 'Ali',
  price_iqd: 40000,
  remaining_iqd: 40000,
  started: false,
  ...over,
});

function renderEditor() {
  try {
    localStorage.setItem('touch-operator-locale', 'en');
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <OpeningHoursEditor />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function addDay(user: ReturnType<typeof userEvent.setup>, date: string) {
  const input = await screen.findByLabelText('Add closed day');
  await user.type(input, date);
  await user.click(screen.getByRole('button', { name: 'Add closed day' }));
}

beforeEach(() => {
  bookings = [];
  calls.length = 0;
  mutations.length = 0;
});

describe('Opening hours: closed days with bookings (0390, F-51)', () => {
  it('saves a new closed day that has no bookings', async () => {
    const user = userEvent.setup();
    renderEditor();
    await addDay(user, '2031-03-05');
    await waitFor(() => expect(calls.some((c) => c.fn === 'closed_day_bookings')).toBe(true));
    const save = screen.getByTestId('hours.save') as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await user.click(save);
    await waitFor(() => expect(calls.find((c) => c.fn === 'set_opening_hours')?.args.p_closed_dates).toEqual(['2031-03-05']));
  });

  it('lists the bookings on the new day and keeps Save off until each is resolved', async () => {
    const user = userEvent.setup();
    bookings = [booking(), booking({ id: 'b2', guest_name: null, started: true, remaining_iqd: 0 })];
    renderEditor();
    await addDay(user, '2031-03-04');
    const list = await screen.findByTestId('hours.closedBookings');
    await within(list).findByTestId('hours.closedBooking.b1');
    expect(within(list).getByText('Walk-in')).toBeTruthy();
    expect(calls.find((c) => c.fn === 'closed_day_bookings')?.args.p_dates).toEqual(['2031-03-04']);
    const save = screen.getByTestId('hours.save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // Not started yet: no-show is not offered; it is owed, so payment is.
    expect((within(list).getByTestId('hours.closedBooking.noShow.b1') as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(list).getByTestId('hours.closedBooking.pay.b1'));
    expect(await screen.findByTestId('bill')).toBeTruthy();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('bill')).toBeNull());
    // Cancel b1 (confirm first), mark b2 no-show.
    await user.click(within(list).getByTestId('hours.closedBooking.cancel.b1'));
    await user.click(within(await screen.findByRole('dialog', { name: 'Cancel this booking?' })).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(mutations).toHaveLength(1));
    expect(mutations[0]).toMatchObject({ type: 'reservation.update', payload: { action: 'cancel', reservationId: 'b1' } });
    expect(save.disabled).toBe(true);
    await user.click(await within(list).findByTestId('hours.closedBooking.noShow.b2'));
    await user.click(within(await screen.findByRole('dialog', { name: 'Mark this booking no-show?' })).getByRole('button', { name: 'No-show' }));
    await waitFor(() => expect(mutations).toHaveLength(2));
    expect(mutations[1]).toMatchObject({ payload: { action: 'mark', reservationId: 'b2', status: 'no_show' } });
    await waitFor(() => expect(save.disabled).toBe(false));
  });
});

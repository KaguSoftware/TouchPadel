import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// /till/drawer for the owner and manager: every shift of the business day on
// every till and the desk, with the shift-end count and the difference as
// words, a day stepper, and the day's figures above (DrawerDay).

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { DrawerDay } from './DrawerDay';

const rpc = vi.mocked(appRpc);
const bare = (s: string) => s.replace(/[⁦-⁩]/g, '').replace(/\s+/g, ' ').trim();

const row = (over: Record<string, unknown>) => ({
  id: 's1', day_session_id: 'd1', business_date: '2026-10-07', station_id: 'TILL-01', staff_id: 'maha', staff_name: 'Maha',
  opened_at: '2026-10-07T06:00:00Z', closed_at: '2026-10-07T13:00:00Z', closed_via: 'own_pin', closed_by_name: 'Maha',
  authorized_by_name: 'Maha', opening_float_iqd: 100000, handover_difference_iqd: null, cash_payments_iqd: 250000,
  cash_refunds_iqd: 10000, cash_expected_iqd: 340000, cash_counted_iqd: 335000, cash_variance_iqd: -5000,
  card_payments_iqd: 80000, card_refunds_iqd: 0, payment_count: 12, refund_count: 1, drawer_open_count: 0,
  open_note: null, close_note: 'Coins short', ...over,
});

const TODAY = {
  from: '2026-10-07',
  to: '2026-10-07',
  shifts: [
    row({}),
    row({ id: 's2', staff_id: 'ali', staff_name: 'Ali', station_id: 'DESK-01', opened_at: '2026-10-07T13:05:00Z', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null, close_note: null, cash_payments_iqd: 40000, cash_refunds_iqd: 0, cash_expected_iqd: 140000, card_payments_iqd: 0, payment_count: 3, refund_count: 0 }),
  ],
  outside: [{ day_session_id: 'd1', business_date: '2026-10-07', station_id: 'DESK-01', cash_payments_iqd: 7000, cash_refunds_iqd: 0, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 1, refund_count: 0 }],
  cross_day: [],
};
const YESTERDAY = { from: '2026-10-06', to: '2026-10-06', shifts: [row({ id: 's0', business_date: '2026-10-06', staff_name: 'Hana' })], outside: [], cross_day: [] };

function mount(openDayDate: string | null = '2026-10-07') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <DrawerDay openDayDate={openDayDate} openDayFloat={100000} whenOpenDay={<p>drawer log</p>} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (_fn: string, args?: Record<string, unknown>) => (args?.p_from === '2026-10-06' ? YESTERDAY : TODAY));
});

describe('the Cash drawer day', () => {
  it('lists every till and desk shift of the open day, whichever station asks, with the shift-end count', async () => {
    mount();
    const table = await screen.findByRole('table', { name: 'Shifts' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(bare(rows[0]!.textContent ?? '')).toContain('Maha');
    expect(bare(rows[0]!.textContent ?? '')).toContain('TILL-01');
    expect(bare(rows[0]!.textContent ?? '')).toContain('335,000 IQD');
    expect(bare(rows[0]!.textContent ?? '')).toContain('Short by 5,000 IQD');
    expect(bare(rows[0]!.textContent ?? '')).toContain('Coins short');
    expect(bare(rows[1]!.textContent ?? '')).toContain('DESK-01');
    expect(bare(rows[1]!.textContent ?? '')).toContain('Open');
    // No station is sent: the whole branch.
    expect(rpc).toHaveBeenCalledWith('till_shift_list', { p_from: null, p_to: null, p_station_id: null, p_staff_id: null });
  });

  it("adds the day's figures and names money taken with no shift open", async () => {
    mount();
    const figures = await screen.findByTestId('drawer.day.figures');
    const text = bare(figures.textContent ?? '');
    expect(text).toContain('Opening float');
    expect(text).toContain('290,000 IQD');
    expect(text).toContain('1 of 2 shifts counted');
    expect(text).toContain('Still open: 1');
    expect(bare(screen.getByTestId('drawer.day.outside').textContent ?? '')).toContain('7,000 IQD');
  });

  it('shows the drawer log only on the open day, and steps back to another day', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByText('drawer log')).toBeTruthy();
    expect((screen.getByTestId('drawer.day.next') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('drawer.day.prev'));
    expect(await screen.findByText('Hana')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('till_shift_list', { p_from: '2026-10-06', p_to: '2026-10-06', p_station_id: null, p_staff_id: null });
    expect(screen.queryByText('drawer log')).toBeNull();
    // The float is the open day's; it is not claimed for another day.
    expect(bare(screen.getByTestId('drawer.day.figures').textContent ?? '')).not.toContain('Opening float');
    await user.click(screen.getByRole('button', { name: 'Latest day' }));
    expect(await screen.findByText('drawer log')).toBeTruthy();
  });

  it('says so on a day with no shifts', async () => {
    rpc.mockImplementation(async () => ({ from: '2026-10-07', to: '2026-10-07', shifts: [], outside: [], cross_day: [] }));
    mount();
    expect(await screen.findByText('No shifts on this day.')).toBeTruthy();
  });
});

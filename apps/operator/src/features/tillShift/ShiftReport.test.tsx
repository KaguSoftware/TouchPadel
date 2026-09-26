import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// /reports/staff ▸ Till shifts (wave5-addendum-2026-09-25 §5.1): every till and
// desk shift in the period from app.till_shift_list, in the order they started,
// with its count and its difference as words. The RPC takes at most 62 days,
// so a longer period says so and never asks.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { ShiftReport, periodDays } from './ShiftReport';

const rpc = vi.mocked(appRpc);
const bare = (s: string) => s.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();

const row = (over: Record<string, unknown>) => ({
  id: 's1', day_session_id: 'd1', business_date: '2026-09-20', station_id: 'TILL-01', staff_id: 'maha', staff_name: 'Maha',
  opened_at: '2026-09-20T06:00:00Z', closed_at: '2026-09-20T13:00:00Z', closed_via: 'own_pin', closed_by_name: 'Maha',
  authorized_by_name: 'Maha', opening_float_iqd: 100000, handover_difference_iqd: null, cash_payments_iqd: 250000,
  cash_refunds_iqd: 0, cash_expected_iqd: 350000, cash_counted_iqd: 345000, cash_variance_iqd: -5000,
  card_payments_iqd: 80000, card_refunds_iqd: 0, payment_count: 12, refund_count: 0, drawer_open_count: 1,
  open_note: null, close_note: null, ...over,
});

function mount(from: string, to: string, staffId: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ShiftReport from={from} to={to} staffId={staffId} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({
    from: '2026-09-20',
    to: '2026-09-21',
    shifts: [
      row({}),
      row({ id: 's2', staff_id: 'ali', staff_name: 'Ali', station_id: 'DESK-01', opened_at: '2026-09-20T13:05:00Z', closed_at: '2026-09-20T20:00:00Z', closed_via: 'day_close', cash_counted_iqd: null, cash_variance_iqd: null }),
      row({ id: 's3', business_date: '2026-09-21', day_session_id: 'd2', opened_at: '2026-09-21T06:00:00Z', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null }),
    ],
    outside: [],
    cross_day: [],
  }));
});

describe('the Till shifts view', () => {
  it('lists every shift in the order they started, with the difference in words', async () => {
    mount('2026-09-20', '2026-09-21', 'maha');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(bare(rows[0]!.textContent ?? '')).toContain('Short by 5,000 IQD');
    expect(bare(rows[1]!.textContent ?? '')).toContain('Ended with the day, not counted');
    expect(bare(rows[2]!.textContent ?? '')).toContain('Open');
    expect(rpc).toHaveBeenCalledWith('till_shift_list', { p_from: '2026-09-20', p_to: '2026-09-21', p_station_id: null, p_staff_id: 'maha' });
  });

  it('says a period longer than 62 days is too long, and never asks', async () => {
    expect(periodDays('2026-06-01', '2026-09-26')).toBe(118);
    expect(periodDays('2026-08-01', '2026-10-01')).toBe(62);
    mount('2026-06-01', '2026-09-26');
    expect(await screen.findByText('Till shifts show for up to 62 days at a time. Pick a shorter period.')).toBeTruthy();
    await waitFor(() => expect(rpc).not.toHaveBeenCalled());
  });
});

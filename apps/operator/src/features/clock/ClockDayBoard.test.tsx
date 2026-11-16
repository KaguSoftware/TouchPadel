import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// Attendance › Today (0442): status words, refused attempts in plain words, Reset phone.

vi.mock('../../lib/venue', () => ({
  useVenue: () => ({ branchId: 'v1', current: { timezone: 'UTC' }, venues: [], stationBranchId: null, canSwitch: false, setBranch: () => undefined }),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

const T = (hhmm: string) => `2026-11-15T${hhmm}:00Z`;
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string) => {
    if (fn === 'clock_reset_device') return { status: 'reset', had_device: true };
    if (fn !== 'clock_day') throw new Error(`unexpected ${fn}`);
    const shift = (s: string, e: string) => ({ starts: T(s), ends: T(e), role: null, block_starts: T(s), block_ends: T(e) });
    return {
      date: '2026-11-15',
      today: '2026-11-15',
      now: T('10:00'),
      people: [
        {
          staff_id: 'a',
          display_name: 'Ali',
          role: 'waiter',
          shifts: [shift('09:00', '14:00')],
          events: [{ id: 'e1', kind: 'in', status: 'refused', refusal: 'NOT_HERE', at: T('08:55'), late_minutes: 0, early_minutes: 0, distance_m: 4210, accuracy_m: 12, mocked: false, station_id: null }],
          in_since: null,
          attendance: null,
          device_bound: true,
        },
        {
          staff_id: 'b',
          display_name: 'Bara',
          role: 'cashier',
          shifts: [shift('09:00', '17:00')],
          events: [{ id: 'e2', kind: 'in', status: 'accepted', refusal: null, at: T('09:12'), late_minutes: 12, early_minutes: 0, distance_m: 20, accuracy_m: 8, mocked: false, station_id: 'DEV1' }],
          in_since: T('09:12'),
          attendance: { id: 'x', late_minutes: 12, early_leave_minutes: 0, penalty_iqd: 0, source: 'clock' },
          device_bound: false,
        },
      ],
    };
  }),
}));

import { appRpc } from '../../lib/appRpc';
import { ClockDayBoard } from './ClockDayBoard';

const rpc = vi.mocked(appRpc);

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmProvider>
          <ClockDayBoard />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockClear();
});

describe('ClockDayBoard', () => {
  it('puts the late person first and says where a refused try came from', async () => {
    renderBoard();
    expect(await screen.findByText(/Late, not in since/)).toBeTruthy();
    expect(screen.getByText(/Tried from .*4\.2 km.* away/)).toBeTruthy();
    expect(screen.getByText(/At work since .* as Cashier/)).toBeTruthy();
    expect(screen.getByText('12 min late', { selector: 'span span' })).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Ali')).toBeTruthy();
    expect(within(screen.getByTestId('clock-board-counts')).getByText('At work')).toBeTruthy();
  });

  it('resets a phone after a confirm', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(await screen.findByTestId('clock-reset-a'));
    await screen.findByText(/Reset .*Ali.*'s phone\?/);
    const buttons = screen.getAllByRole('button', { name: 'Reset phone' });
    await user.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('clock_reset_device', { p_venue_id: null, p_staff_id: 'a' }));
    expect(screen.queryByTestId('clock-reset-b')).toBeNull();
  });
});

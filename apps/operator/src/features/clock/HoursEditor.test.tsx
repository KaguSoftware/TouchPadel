import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Set hours (0442): touching shifts are one stretch, a gap is time off, the week is checked with
// the server's rules before saving, and the main job is sent as null.

vi.mock('../../lib/venue', () => ({ useVenue: () => ({ branchId: 'v1', current: null, venues: [], stationBranchId: null, canSwitch: false, setBranch: () => undefined }) }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

const state = vi.hoisted(() => ({
  canEdit: true,
  shifts: [] as { weekday: number; starts_at: string; ends_at: string; role: string | null }[],
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string) => {
    if (fn === 'staff_shifts_get') return { staff_id: 's1', roles: ['waiter', 'cashier'], can_edit: state.canEdit, shifts: state.shifts };
    if (fn === 'set_staff_shifts') return { status: 'saved', shifts: 1 };
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { appRpc } from '../../lib/appRpc';
import { HoursEditor } from './HoursEditor';

const rpc = vi.mocked(appRpc);

function renderEditor() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <HoursEditor staffId="s1" />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockClear();
  state.canEdit = true;
  state.shifts = [
    { weekday: 1, starts_at: '09:00', ends_at: '14:00', role: null },
    { weekday: 1, starts_at: '14:00', ends_at: '18:00', role: 'cashier' },
    { weekday: 1, starts_at: '19:00', ends_at: '23:00', role: null },
  ];
});

describe('HoursEditor', () => {
  it('shows a job switch with no scan, a gap as time off, and the week total', async () => {
    renderEditor();
    const monday = await screen.findByTestId('hours-day-1');
    expect(within(monday).getByText(/Switches to Cashier at .*14:00.*, no scan needed/)).toBeTruthy();
    expect(within(monday).getByText(/Time off .*18:00.* to .*19:00.* \(1 h\)/)).toBeTruthy();
    expect(within(screen.getByTestId('hours-day-2')).getByText('Day off')).toBeTruthy();
    expect(screen.getByTestId('hours-total').textContent).toBe('13 h a week');
  });

  it('points at an overlapping shift and saves nothing until it is fixed', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId('hours-day-1');
    fireEvent.change(screen.getByTestId('hours-start-1-2'), { target: { value: '17:00' } });
    await user.click(screen.getByTestId('hours-save'));
    expect(await screen.findByTestId('hours-issue-1-2')).toBeTruthy();
    expect(screen.getByText('Overlaps another shift.')).toBeTruthy();
    expect(rpc.mock.calls.some(([fn]) => fn === 'set_staff_shifts')).toBe(false);

    fireEvent.change(screen.getByTestId('hours-start-1-2'), { target: { value: '18:00' } });
    await user.click(screen.getByTestId('hours-save'));
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === 'set_staff_shifts')).toBe(true));
    const args = rpc.mock.calls.find(([fn]) => fn === 'set_staff_shifts')![1] as { p_shifts: unknown };
    expect(args.p_shifts).toEqual([
      { weekday: 1, starts_at: '09:00', ends_at: '14:00', role: null },
      { weekday: 1, starts_at: '14:00', ends_at: '18:00', role: 'cashier' },
      { weekday: 1, starts_at: '18:00', ends_at: '23:00', role: null },
    ]);
  });

  it('copies a day onto the days ticked', async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId('hours-day-1');
    await user.click(screen.getByTestId('hours-copy-1'));
    const picker = screen.getByTestId('hours-copy-picker');
    await user.click(within(picker).getByRole('checkbox', { name: 'Tuesday' }));
    await user.click(screen.getByTestId('hours-copy-apply'));
    expect(within(screen.getByTestId('hours-day-2')).getByText(/Switches to Cashier/)).toBeTruthy();
    expect(screen.getByTestId('hours-total').textContent).toBe('26 h a week');
  });

  it('is read-only when the viewer may not change these hours', async () => {
    state.canEdit = false;
    renderEditor();
    await screen.findByText('You can see your own hours here. The owner changes them.');
    expect(screen.queryByTestId('hours-add-1')).toBeNull();
    expect(screen.queryByTestId('hours-start-1-0')).toBeNull();
  });
});

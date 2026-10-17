import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// /observation/activity (0341): the owner reads, per person, the operator and
// the mobile app as two separate parts, in the server's name order.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({ timezone: 'Asia/Baghdad' })),
}));

/** The text without the bidi isolates countPhrase wraps a count in. */
const plain = (s: string | null) => (s ?? '').replace(/[\u2066-\u2069]/g, '');

const SERVER_TIME = '2026-10-16T12:00:00Z';

const part = (over: Record<string, unknown> = {}) => ({
  status: 'online',
  state: 'active',
  stateAt: '2026-10-16T11:58:00Z',
  lastSeenAt: '2026-10-16T11:58:00Z',
  screen: '/observation/tills',
  appVersion: '0.2.30',
  deviceId: 'TILL1',
  lastAction: 'tab.cancel',
  lastActionEntity: 'tabs',
  lastActionAt: '2026-10-16T11:55:00Z',
  ...over,
});

let rows: () => Record<string, unknown>[];
const calls: string[] = [];

vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string) => {
    calls.push(fn);
    if (fn === 'staff_activity_board') return { serverTime: SERVER_TIME, rows: rows() };
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { ActivityMonitorScreen } from './ActivityMonitor';

function renderPage() {
  try {
    localStorage.setItem('touch-operator-locale', 'en');
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ActivityMonitorScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  navigate.mockReset();
  rows = () => [
    {
      staffId: 's-hasan',
      name: 'Hasan',
      role: 'waiter',
      onBreak: true,
      operator: part(),
      mobile: part({ status: 'away', state: 'background', screen: '/staff-order', lastAction: 'mystery.thing', lastActionAt: '2026-10-16T09:00:00Z' }),
    },
    { staffId: 's-rusul', name: 'Rusul', role: 'cashier', onBreak: false, operator: part({ status: 'offline', state: 'signed_out', lastAction: null, lastActionAt: null }), mobile: null },
  ];
});

describe('ActivityMonitorScreen', () => {
  it('shows the operator and the mobile app as two separate parts', async () => {
    renderPage();
    const op = await screen.findByTestId('activity.operator.s-hasan');
    const mob = screen.getByTestId('activity.mobile.s-hasan');
    expect(calls).toContain('staff_activity_board');
    expect(op.dataset.status).toBe('online');
    expect(within(op).getByText('Online')).toBeTruthy();
    expect(plain(op.textContent)).toContain('Last seen 2 min ago');
    // The operator screen is named by its rail row, not its path.
    expect(within(op).getByText(/Screen: Open tabs/)).toBeTruthy();
    expect(mob.dataset.status).toBe('away');
    expect(within(mob).getByText('Away')).toBeTruthy();
    expect(within(mob).getByText(/\/staff-order/)).toBeTruthy();
    expect(screen.getByTestId('activity.summary').textContent).toBe('Online now: 1 on the operator, 0 on the mobile app.');
  });

  it('says when an app was never used, and when the person signed out', async () => {
    renderPage();
    const never = await screen.findByTestId('activity.mobile.s-rusul');
    expect(never.dataset.status).toBe('never');
    expect(within(never).getByText('Never used')).toBeTruthy();
    const op = screen.getByTestId('activity.operator.s-rusul');
    expect(within(op).getByText('Signed out')).toBeTruthy();
    expect(within(op).getByText('No actions yet')).toBeTruthy();
  });

  it('marks a person on break', async () => {
    renderPage();
    const hasan = await screen.findByTestId('activity.row.s-hasan');
    expect(within(hasan).getByText('On break')).toBeTruthy();
    expect(within(hasan).getByText('Waiter')).toBeTruthy();
    expect(within(screen.getByTestId('activity.row.s-rusul')).queryByText('On break')).toBeNull();
  });

  it("words a known action as the Audit log does, and falls back to the code for an unknown one", async () => {
    renderPage();
    const known = await screen.findByTestId('activity.operator.s-hasan.action');
    expect(known.textContent).not.toContain('tab.cancel');
    expect(plain(known.textContent)).toMatch(/, 5 min ago$/);
    const unknown = screen.getByTestId('activity.mobile.s-hasan.action');
    expect(plain(unknown.textContent)).toBe('mystery · mystery.thing, 3 hours ago');
  });

  it('filters to the people online now, and opens the audit log filtered to a person', async () => {
    renderPage();
    await screen.findByTestId('activity.row.s-rusul');
    await userEvent.click(screen.getByTestId('activity.filter.online'));
    expect(screen.queryByTestId('activity.row.s-rusul')).toBeNull();
    expect(screen.getByTestId('activity.row.s-hasan')).toBeTruthy();
    await userEvent.click(screen.getByTestId('activity.audit.s-hasan'));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/audit', search: { actor: 's-hasan' } });
  });
});

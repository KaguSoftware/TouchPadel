import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// The overview is the manager's landing screen; its three states (loading,
// ready, error) must render from the server document alone. The RPC, the
// broadcast subscription and the router are mocked at the seam.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../lib/appRpc', () => ({
  appRpc: rpc.appRpc,
  AppRpcError: class AppRpcError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));
vi.mock('../../lib/realtime', () => ({ useBroadcast: () => ({ status: 'live' }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));

import { OperationsOverviewScreen } from './OperationsOverview';

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <OperationsOverviewScreen />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const payload = {
  bookings: { today: 12, arrived: 4, upcoming: 7, noShows: 1 },
  cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 1, waiterCallsOpen: 0 },
  stock: { low: 2, belowPar: 5, expiringSoon: 1, expired: 0, lastCountAt: null },
  staffActivity: [{ staffId: 's1', name: 'Noor', role: 'cashier', ordersTaken: 9, bookingsCreated: 2 }],
  exceptions: { discounts: { count: 2, amountIqd: 15000 }, voids: { count: 0, amountIqd: 0 }, refunds: { count: 1, amountIqd: 3000 } },
  dayClose: { open: true, businessDate: '2026-09-03', openedAt: '2026-09-03T06:00:00Z', blockingTabs: [{ id: 'tab-1', label: 'T4' }], queued: 0 },
};

beforeEach(() => {
  rpc.appRpc.mockReset();
  nav.navigate.mockReset();
});

describe('OperationsOverviewScreen', () => {
  it('shows a skeleton while loading', () => {
    rpc.appRpc.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole('heading', { name: 'Operations overview' })).toBeTruthy();
    expect(screen.queryByText('Staff activity today')).toBeNull();
  });

  it('renders the dashboard from the server document', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    expect(await screen.findByText('Staff activity today')).toBeTruthy();
    expect(rpc.appRpc).toHaveBeenCalledWith('ops_overview');
    // Staff activity is a table, not a ranking.
    expect(screen.getByRole('table', { name: 'Staff activity today' })).toBeTruthy();
    expect(screen.getByText('Noor')).toBeTruthy();
    // Exceptions render as server amounts and drill to the audit log.
    expect(screen.getByText('15,000 IQD')).toBeTruthy();
    // A blocking tab links to the till.
    expect(screen.getByRole('button', { name: 'Tab T4' })).toBeTruthy();
  });

  it('drills an exception to the filtered audit log', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    const tile = screen.getByRole('button', { name: /Discounts/ });
    tile.click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/audit?q=discount.apply' }));
  });

  it('routes a blocking tab to the till', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    (await screen.findByRole('button', { name: 'Tab T4' })).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/till?tab=tab-1' }));
  });

  it('renders the error state with a retry', async () => {
    rpc.appRpc.mockRejectedValue(new Error('UNKNOWN'));
    renderScreen();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

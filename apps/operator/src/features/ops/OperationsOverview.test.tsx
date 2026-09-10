import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

/** The <section> a cluster's Panel renders, so a label that also appears as an
 *  attention chip is queried in exactly one place. */
function cluster(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

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
  staffActivity: [
    { staffId: 's1', name: 'Noor', role: 'cashier', ordersTaken: 9, bookingsCreated: 2 },
  ],
  exceptions: {
    discounts: { count: 2, amountIqd: 15000 },
    voids: { count: 0, amountIqd: 0 },
    refunds: { count: 1, amountIqd: 3000 },
  },
  dayClose: {
    open: true,
    businessDate: '2026-09-03',
    openedAt: '2026-09-03T06:00:00Z',
    blockingTabs: [{ id: 'tab-1', label: 'T4' }],
    queued: 0,
  },
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
    await waitFor(() =>
      expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/audit?q=discount.apply' }),
    );
  });

  it('routes a blocking tab to the till', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    (await screen.findByRole('button', { name: 'Tab T4' })).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/till?tab=tab-1' }));
  });

  // The attention band is the point of the layout: the alarms are promoted only
  // when they are non-zero, so the loudest thing on a good day is one calm line
  // rather than four large noughts.
  it('collapses to a single all-clear line when no alarm is standing', async () => {
    rpc.appRpc.mockResolvedValue({
      ...payload,
      bookings: { today: 12, arrived: 12, upcoming: 0, noShows: 0 },
      cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 0, waiterCallsOpen: 0 },
      stock: { low: 0, belowPar: 5, expiringSoon: 1, expired: 0, lastCountAt: null },
    });
    renderScreen();
    expect(await screen.findByText('Nothing needs your attention.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Needs attention' })).toBeNull();
    // Below par and expiring soon are still on the page — demoted, not dropped.
    expect(screen.getByText('Below par')).toBeTruthy();
    expect(screen.getByText('Expiring soon')).toBeTruthy();
  });

  it('promotes only the non-zero alarms, and each one opens the list behind it', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeTruthy();
    // payload: ticketsLate 1, low 2, noShows 1 stand; waiterCalls 0 and
    // expired 0 do not.
    const chips = within(cluster('Needs attention')).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['1Tickets late', '2Low stock', '1No-shows']);
    chips[1]!.click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/stock' }));
  });

  it('leads day close with one state word rather than a sum for the manager to do', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    // payload has one blocking tab, so the day is blocked by open tabs.
    expect(await screen.findByText('Blocked by open tabs')).toBeTruthy();
    rpc.appRpc.mockResolvedValue({
      ...payload,
      dayClose: { ...payload.dayClose, blockingTabs: [], queued: 0 },
    });
    cleanup();
    renderScreen();
    expect(await screen.findByText('Ready to close')).toBeTruthy();
  });

  it('omits a part the server does not report instead of drawing it as zero', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    // 0068 carries no ticketsPreparing; the meter legend says "—", not "0".
    const preparing = screen.getByText('Preparing').parentElement;
    expect(preparing?.textContent).toBe('Preparing—');
  });

  // Pins the encoding, using the shape the LOCAL fixtures actually return:
  // ticketsQueued 470 + ticketsPreparing 3 === ticketsLate 473, because a late
  // ticket is a queued or preparing one past target. Stacking these would draw
  // 946 tickets where 473 exist, so they must stay independent rows.
  it('never totals the overlapping ticket counts', async () => {
    rpc.appRpc.mockResolvedValue({
      ...payload,
      cafe: {
        openTabs: 8,
        ticketsQueued: 470,
        ticketsPreparing: 3,
        ticketsLate: 473,
        waiterCallsOpen: 8,
      },
    });
    renderScreen();
    await screen.findByText('Tickets on the board');
    const cafe = within(cluster('Cafe floor'));
    for (const [label, count] of [
      ['Tickets waiting', '470'],
      ['Preparing', '3'],
      ['Tickets late', '473'],
    ] as const) {
      expect(cafe.getByText(label).parentElement?.textContent).toBe(`${label}${count}`);
    }
    // 946 is what a stacked bar's total would have been. It must appear nowhere.
    expect(screen.queryByText('946')).toBeNull();
  });

  // bookings.today counts confirmed|arrived|completed, so no_show is OUTSIDE it.
  // The meter may only measure a genuine subset of it.
  it('measures arrived against booked, and keeps no-shows out of that ratio', async () => {
    rpc.appRpc.mockResolvedValue({
      ...payload,
      bookings: { today: 10, arrived: 4, upcoming: 3, noShows: 2 },
    });
    renderScreen();
    expect(await screen.findByText('of 10 booked')).toBeTruthy();
    // No-shows is its own figure beside the meter, never a slice of the 10.
    const bookings = within(cluster('Bookings today'));
    expect(bookings.getByText('No-shows').parentElement?.textContent).toBe('No-shows2');
    // The meter measures arrived, and only arrived, against booked.
    expect(bookings.getByText('Arrived').parentElement?.textContent).toBe('Arrived4 of 10 booked');
  });

  it('renders the error state with a retry', async () => {
    rpc.appRpc.mockRejectedValue(new Error('UNKNOWN'));
    renderScreen();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

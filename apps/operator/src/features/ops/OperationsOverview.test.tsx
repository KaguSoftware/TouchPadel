import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// Today is the manager's landing screen; its three states (loading, ready,
// error) must render from the server document alone. The RPC, the
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
// Wave 5 (wave5-addendum-2026-09-25 §5.2): "Needs you now" reads the people
// records only for a role that acts on them, so the screen asks who is signed in.
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'm1', displayName: 'Manager', role: 'manager' } }),
}));

import { OperationsOverviewScreen } from './OperationsOverview';

/** The <section> a card's Panel renders, so a label that also appears in
 *  "Needs you now" is queried in exactly one place. */
function card(name: string): HTMLElement {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement;
}

/** The text of the row holding `label`, inside `within`. */
function rowText(scope: ReturnType<typeof within>, label: string): string | null {
  const el = scope.getByText(label);
  return (el.closest('button') ?? el.parentElement!.parentElement)!.textContent;
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
  bookings: {
    today: 12,
    arrived: 4,
    upcoming: 7,
    noShows: 1,
    cancelledToday: 2,
    nextArrival: { startAt: '2026-09-03T15:00:00Z', guestName: 'Ali', courtNameEn: 'Court 2', courtNameAr: 'الملعب 2' },
  },
  cafe: { openTabs: 3, ordersToday: 41, ticketsQueued: 2, ticketsLate: 1, waiterCallsOpen: 0 },
  stock: { low: 2, belowPar: 5, expiringSoon: 1, expired: 0, openAlerts: 0, lastCountAt: null },
  staffActivity: [{ staffId: 's1', name: 'Noor', role: 'cashier', ordersTaken: 9, bookingsCreated: 2 }],
  exceptions: { discounts: { count: 2, amountIqd: 15000 }, voids: { count: 0, amountIqd: 0 }, refunds: { count: 1, amountIqd: 3000 } },
  dayClose: {
    open: true,
    businessDate: '2026-09-03',
    openedAt: '2026-09-03T06:00:00Z',
    blockingTabs: [{ id: 'tab-1', label: 'walk-in', tableNumber: '4' }],
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
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByText('Staff activity today')).toBeNull();
  });

  it('renders every part of the day from the server document', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    expect(await screen.findByText('Staff activity today')).toBeTruthy();
    expect(rpc.appRpc).toHaveBeenCalledWith('ops_overview');
    for (const heading of ['Needs you now', 'Courts', 'Cafe', 'Stock', 'Closing the day', 'Discounts, voids, refunds and waste']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    // Staff activity is a table, not a ranking.
    expect(screen.getByRole('table', { name: 'Staff activity today' })).toBeTruthy();
    expect(screen.getByText('Noor')).toBeTruthy();
    // Exceptions render as server amounts.
    expect(screen.getByText('15,000 IQD')).toBeTruthy();
    // The subtitle names the business day rather than describing the screen.
    expect(screen.getByText(/^Business day /)).toBeTruthy();
  });

  it('prints each figure once per card', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    const stock = within(card('Stock'));
    // The old card printed "Low stock" as its headline and again beneath it.
    expect(stock.getAllByText('Running low')).toHaveLength(1);
    expect(rowText(stock, 'Running low')).toBe('Running low2');
  });

  it('reads the fields 0068 sends that the first screen ignored', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    const courts = within(card('Courts'));
    expect(rowText(courts, 'Cancelled today')).toBe('Cancelled today2');
    expect(courts.getByText(/Court 2 · Ali/)).toBeTruthy();
    expect(rowText(within(card('Cafe')), 'Orders today')).toBe('Orders today41');
  });

  it('names a blocking tab by its table, not its token, and routes it to the till', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    (await screen.findByRole('button', { name: 'Table 4' })).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/till?tab=tab-1' }));
  });

  it('drills an exception to the filtered audit log', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    within(card('Discounts, voids, refunds and waste')).getByRole('button', { name: /Discounts/ }).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/audit?q=discount.apply' }));
  });

  it('opens a stock figure on the list of exactly those items', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    within(card('Stock')).getByRole('button', { name: /Below par/ }).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/stock?filter=belowPar' }));
  });

  it('collapses "Needs you now" to one all-clear line when nothing is standing', async () => {
    rpc.appRpc.mockResolvedValue({
      ...payload,
      cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 0, waiterCallsOpen: 0 },
      stock: { low: 0, belowPar: 5, expiringSoon: 1, expired: 0, lastCountAt: null },
    });
    renderScreen();
    expect(await screen.findByText('All clear. Nothing needs you right now.')).toBeTruthy();
    // Below par and expiring soon are still on the page, on the stock card.
    const stock = within(card('Stock'));
    expect(stock.getByText('Below par')).toBeTruthy();
    expect(stock.getByText('Expiring soon')).toBeTruthy();
  });

  it('lists each standing alarm with what to do, and its button opens the screen that fixes it', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    const now = within(card('Needs you now'));
    // payload: ticketsLate 1 and low 2 stand; waiter calls 0, expired 0 and an
    // open day do not. No-shows are never an alarm.
    expect(now.getByText('Kitchen tickets past their target time')).toBeTruthy();
    expect(now.getByText('Ingredients running low')).toBeTruthy();
    expect(now.queryByText('Waiter calls waiting')).toBeNull();
    expect(now.queryByText(/No-shows/)).toBeNull();
    // Late tickets have no screen here that lists them, so no button pretends to.
    expect(now.getAllByRole('button').map((b) => b.textContent)).toEqual(['See which']);
    now.getByRole('button', { name: 'See which' }).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/stock?filter=low' }));
  });

  it('puts "the day is not open" first, and routes it to day close', async () => {
    rpc.appRpc.mockResolvedValue({ ...payload, dayClose: { open: false, businessDate: null, openedAt: null, blockingTabs: [] } });
    renderScreen();
    await screen.findByText('Staff activity today');
    const now = within(card('Needs you now'));
    expect(now.getAllByRole('listitem')[0]!.textContent).toContain('The day is not open');
    now.getByRole('button', { name: 'Open the day' }).click();
    await waitFor(() => expect(nav.navigate).toHaveBeenCalledWith({ href: '/admin/day-close' }));
    expect(screen.getByText('No business day is open.')).toBeTruthy();
  });

  it('leads day close with one state word, and walks the steps to it', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    // payload has one blocking tab, so the day is blocked by open tabs.
    expect(await screen.findByText('Open tabs left')).toBeTruthy();
    expect(screen.getByText('1 still open')).toBeTruthy();
    expect(screen.getByText('Nothing waiting to sync')).toBeTruthy();
    rpc.appRpc.mockResolvedValue({ ...payload, dayClose: { ...payload.dayClose, blockingTabs: [] } });
    cleanup();
    renderScreen();
    expect(await screen.findByText('Ready to close')).toBeTruthy();
    expect(screen.getByText('All tabs are settled')).toBeTruthy();
  });

  it('prints a figure the server does not report as "—", never as zero', async () => {
    rpc.appRpc.mockResolvedValue(payload);
    renderScreen();
    await screen.findByText('Staff activity today');
    // payload carries no ticketsPreparing.
    expect(rowText(within(card('Cafe')), 'Being prepared')).toBe('Being prepared—');
  });

  // A late ticket is also a waiting or preparing one. On the local fixtures
  // 470 + 3 === 473 late, so the rows must stay independent and never total.
  it('never totals the overlapping ticket counts', async () => {
    rpc.appRpc.mockResolvedValue({
      ...payload,
      cafe: { openTabs: 8, ticketsQueued: 470, ticketsPreparing: 3, ticketsLate: 473, waiterCallsOpen: 8 },
    });
    renderScreen();
    await screen.findByText('Staff activity today');
    const cafe = within(card('Cafe'));
    for (const [label, count] of [
      ['Tickets waiting', '470'],
      ['Being prepared', '3'],
      ['Past target time', '473'],
    ] as const) {
      expect(rowText(cafe, label)).toBe(`${label}${count}`);
    }
    expect(screen.queryByText('946')).toBeNull();
  });

  it('renders the error state with a retry', async () => {
    rpc.appRpc.mockRejectedValue(new Error('UNKNOWN'));
    renderScreen();
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

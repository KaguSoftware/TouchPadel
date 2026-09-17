import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LocaleProvider } from '../../lib/i18n';
import type * as AuthModule from '../../lib/auth';

// Revenue, cafe, stock and staff activity against the payloads their RPCs
// really return. Each test pins something the running app got wrong before:
// revenue showed two columns, stock was always "Nothing to report", staff
// exceptions printed JSON and roles as codes, and no breakdown switch changed
// what was on screen.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
const role = { current: 'owner' };
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return {
    ...actual,
    useAuth: () => ({ staff: { role: role.current } }),
    // usePermissions reads useAuth inside its own module, past the mock above.
    usePermissions: () => actual.permissionsFor(role.current as never),
  };
});
vi.mock('../../routes/__root', () => ({ useWorkspace: () => ({ active: 'owner' }) }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/queries', () => ({ QK: { courts: ['courts'] }, fetchActiveCourts: vi.fn() }));
vi.mock('../../lib/settings', () => ({ useCafeSettings: vi.fn() }));
vi.mock('./filterOptions', () => ({
  REPORT_CATEGORIES_KEY: ['reports', 'categories'],
  REPORT_STAFF_KEY: ['reports', 'staff'],
  fetchReportCategories: vi.fn(),
  fetchReportStaff: vi.fn(),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { useCafeSettings } from '../../lib/settings';
import { fetchReportCategories, fetchReportStaff } from './filterOptions';
import { RevenueReportScreen } from './RevenueReport';
import { CafeReportScreen } from './CafeReport';
import { StockReportScreen } from './StockReport';
import { StaffActivityReportScreen } from './StaffActivityReport';

const rpc = vi.mocked(appRpc);

function renderIt(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>{node}</LocaleProvider>
    </QueryClientProvider>,
  );
}

const DRILL = { transactions: [{ id: 't1', at: '2026-09-11T10:00:00Z', kind: 'adjustment', label: 'discount · comp', amountIqd: 2500, staffName: 'Dev Cashier' }] };

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  role.current = 'owner';
  vi.mocked(useCafeSettings).mockReturnValue({ isSuccess: true, isError: false, settings: { analytics_business_day_start_hour: 4 } } as never);
  vi.mocked(fetchReportCategories).mockResolvedValue([]);
  vi.mocked(fetchReportStaff).mockResolvedValue([{ id: 's1', display_name: 'Dev Cashier', role: 'cashier', is_active: true }]);
});

// ---------------------------------------------------------------------------

const REVENUE = {
  group: 'day',
  rows: [
    { period: '2026-09-11', padelIqd: 40000, cafeIqd: 0, cafeNetIqd: 0, totalIqd: 40000, cashIqd: 0, cardIqd: 0, discountsIqd: 0, voidsIqd: 0, refundsIqd: 0, taxIqd: 0, orders: 0, bookings: 1 },
    { period: '2026-09-14', padelIqd: 40000, cafeIqd: 610000, cafeNetIqd: 599473, totalIqd: 639473, cashIqd: 500000, cardIqd: 71298, discountsIqd: 12345, voidsIqd: 6000, refundsIqd: 10527, taxIqd: 14454, orders: 133, bookings: 1 },
  ],
  totals: { padelIqd: 80000, cafeIqd: 610000, cafeNetIqd: 599473, totalIqd: 679473, cashIqd: 500000, cardIqd: 71298, discountsIqd: 12345, voidsIqd: 6000, refundsIqd: 10527, taxIqd: 14454, orders: 133, bookings: 2 },
  comparison: null,
};

describe('RevenueReportScreen', () => {
  it('refuses anyone but the owner, and asks the server for nothing', () => {
    role.current = 'manager';
    renderIt(<RevenueReportScreen />);
    expect(screen.getByText(/Viewing revenue/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('report_revenue', expect.anything());
  });

  it('leads with what was earned, taken and given away, and breaks it down by day', async () => {
    rpc.mockImplementation(async (fn) => (fn === 'report_revenue' ? REVENUE : DRILL));
    renderIt(<RevenueReportScreen />);
    const table = await screen.findByRole('table', { name: 'Earned' });
    // Every money column the old screen hid behind "Show all columns".
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', 'Padel', 'Cafe', 'Revenue', 'Bookings', 'Orders']);
    expect(within(table).getByText('639,473 IQD')).toBeTruthy();
    const band = screen.getByRole('region', { name: 'Revenue' });
    expect(within(band).getByText('679,473 IQD')).toBeTruthy();
    expect(within(band).getByText('Money taken')).toBeTruthy();
    expect(within(band).getByText('Given away')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('report_revenue', expect.objectContaining({ p_group: 'day', p_filters: { paymentMethod: null, staffId: null } }));
  });

  it('switching the breakdown changes the columns', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(REVENUE);
    renderIt(<RevenueReportScreen />);
    await screen.findByRole('table', { name: 'Earned' });
    await user.click(screen.getByRole('button', { name: 'Given away' }));
    const table = screen.getByRole('table', { name: 'Given away' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Day', 'Discounts', 'Voids', 'Refunds']);
    await user.click(screen.getByRole('button', { name: 'Week' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_revenue', expect.objectContaining({ p_group: 'week' })));
  });

  it("a row opens that day's transactions for the breakdown, with a switch between its figures", async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) => (fn === 'report_revenue' ? REVENUE : DRILL));
    renderIt(<RevenueReportScreen />);
    await screen.findByRole('table', { name: 'Earned' });
    await user.click(screen.getByRole('button', { name: 'Given away' }));
    await user.click(within(screen.getByRole('table', { name: 'Given away' })).getByText('12,345 IQD'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', { p_figure: 'discounts', p_key: null, p_from: '2026-09-14', p_to: '2026-09-14' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Discount or void')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Refunds' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'refunds', p_from: '2026-09-14' })));
  });

  it('a staff filter narrows the report and its drills, and says what it counts', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) => (fn === 'report_revenue' ? REVENUE : DRILL));
    renderIt(<RevenueReportScreen />);
    await screen.findByRole('table', { name: 'Earned' });
    await user.selectOptions(await screen.findByLabelText('Staff member'), 's1');
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_revenue', expect.objectContaining({ p_filters: { paymentMethod: null, staffId: 's1' } })));
    expect(await screen.findByText(/Only what Dev Cashier recorded/)).toBeTruthy();
    await user.click(await within(await screen.findByRole('table', { name: 'Earned' })).findByText('639,473 IQD'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'revenue', p_key: 'staff:s1' })));
  });

  it('empty: says nothing was recorded and offers a longer period', async () => {
    rpc.mockResolvedValue({ group: 'day', rows: [], totals: {} });
    renderIt(<RevenueReportScreen />);
    expect(await screen.findByText('No sales, bookings or payments in this period')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

describe('CafeReportScreen', () => {
  const CAFE = {
    rows: [
      { itemId: 'i1', nameEn: 'Latte', nameAr: 'لاتيه', categoryId: 'k1', categoryNameEn: 'Drinks', categoryNameAr: 'مشروبات', qty: 11, orders: 6, revenueIqd: 100000, cogsIqd: 30000, grossProfitIqd: 70000, marginPct: 70 },
      { itemId: 'i2', nameEn: 'Cake', nameAr: 'كعكة', categoryId: 'k2', categoryNameEn: 'Food', categoryNameAr: 'طعام', qty: 2, orders: 2, revenueIqd: 20000, cogsIqd: null, grossProfitIqd: null, marginPct: null },
    ],
    summary: { orders: 8, qty: 13, avgOrderValueIqd: 15000, revenueIqd: 120000, cogsIqd: 30000, grossProfitIqd: 70000, marginPct: 70, cogsCoveragePct: 83.3, itemsWithCogs: 1, itemsTotal: 2 },
    byCategory: [{ categoryId: 'k1', categoryNameEn: 'Drinks', categoryNameAr: 'مشروبات', items: 1, qty: 11, revenueIqd: 100000, cogsIqd: 30000, grossProfitIqd: 70000, marginPct: 70 }],
    wasteByReason: [{ reason: 'waste_spill', count: 3, qty: 30, costIqd: 15000 }],
    prepTimes: { avgSeconds: 240, p90Seconds: 600, count: 18 },
  };

  it('says which items profit and margin rest on, and never sends filters the server ignores', async () => {
    rpc.mockResolvedValue(CAFE);
    renderIt(<CafeReportScreen />);
    expect(await screen.findByText('Margin 70.0%, on the 1 of 2 items with a cost')).toBeTruthy();
    expect(screen.getByText('4 min')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('report_cafe', { p_from: expect.any(String), p_to: expect.any(String), p_filters: { categoryId: null } });
    expect(screen.queryByLabelText('Paid by')).toBeNull();
  });

  it('an item opens its sold lines; waste reads in words and opens every write-off', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) => (fn === 'report_cafe' ? CAFE : DRILL));
    renderIt(<CafeReportScreen />);
    await user.click(within(await screen.findByRole('table', { name: 'Best sellers' })).getByText('Latte'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'item:i1', p_key: null })));
    await user.click(within(await screen.findByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]!);

    await user.click(screen.getByRole('button', { name: 'Cost & profit' }));
    const profit = screen.getByRole('table', { name: 'Cost & profit' });
    expect(within(profit).getAllByText('—').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Waste' }));
    expect(within(screen.getByRole('table', { name: 'Waste' })).getByText('Spill')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'See each write-off' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'waste', p_key: null })));
  });
});

// ---------------------------------------------------------------------------

describe('StockReportScreen', () => {
  const STOCK = {
    stockValueIqd: 1633337,
    lowStock: [{ ingredientId: 'm1', nameEn: 'Milk', nameAr: 'حليب', unit: 'g', onHand: 0, threshold: 1000, parLevel: 5000 }],
    belowPar: [],
    expiringSoon: [],
    expired: [{ batchId: 'b1', ingredientId: 'b', nameEn: 'Buns', nameAr: 'خبز', unit: 'pc', qtyRemaining: 22, expiryDate: '2026-09-15', daysExpired: 2, valueIqd: 11000 }],
    consumption: [],
    variance: [
      { countId: 'k', ingredientId: 'p1', nameEn: 'Patty', nameAr: 'قرص', unit: 'pc', periodEnd: '2026-09-17T00:10:10Z', theoreticalQty: 10, countedQty: 10, varianceQty: 0 },
      { countId: 'k', ingredientId: 'p2', nameEn: 'Beans', nameAr: 'بن', unit: 'g', periodEnd: '2026-09-17T00:10:10Z', theoreticalQty: 500, countedQty: 450, varianceQty: -50 },
    ],
    comparison: null,
  };

  it('shows the lists report_stock sends (it has no rows), with units and the stock value', async () => {
    rpc.mockResolvedValue(STOCK);
    renderIt(<StockReportScreen />);
    const table = await screen.findByRole('table', { name: 'Running low' });
    expect(within(table).getByText('Milk')).toBeTruthy();
    expect(within(table).getByText('1,000 g')).toBeTruthy();
    expect(screen.getByText('1,633,337 IQD')).toBeTruthy();
    expect(screen.getByText('Right now. The period above does not change this list.')).toBeTruthy();
  });

  it('an empty list is good news, and count differences hide the matches by default', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(STOCK);
    renderIt(<StockReportScreen />);
    await screen.findByRole('table', { name: 'Running low' });
    await user.click(screen.getByRole('button', { name: 'Below par' }));
    expect(screen.getByText('Everything is at or above par.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Count differences' }));
    const counts = screen.getByRole('table', { name: 'Count differences' });
    expect(within(counts).getByText('Beans')).toBeTruthy();
    expect(within(counts).queryByText('Patty')).toBeNull();
    await user.click(screen.getByLabelText('Only counts that differ'));
    expect(within(screen.getByRole('table', { name: 'Count differences' })).getByText('Patty')).toBeTruthy();
  });

  it('each list opens the inventory screen that acts on it', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(STOCK);
    renderIt(<StockReportScreen />);
    await screen.findByRole('table', { name: 'Running low' });
    await user.click(screen.getByRole('button', { name: 'Open in inventory' }));
    expect(navigate).toHaveBeenCalledWith({ href: '/stock?filter=low' });
  });
});

// ---------------------------------------------------------------------------

describe('StaffActivityReportScreen', () => {
  const STAFF = {
    rows: [
      { staffId: 's1', name: 'Dev Cashier', role: 'cashier', isActive: true, ordersTaken: 292, bookingsCreated: 0, paymentsTaken: 80, discounts: { count: 37, amountIqd: 49802 }, voids: { count: 0, amountIqd: 0 }, refunds: { count: 0, amountIqd: 0 }, waiterCallResponse: { count: 6, avgSeconds: 300 }, dayCloses: [], shiftContext: { daysWorked: 3, busiestDayOrders: 192 } },
      { staffId: 's2', name: 'Dev Court Desk', role: 'court_desk', isActive: true, ordersTaken: 0, bookingsCreated: 173, paymentsTaken: 0, discounts: { count: 0, amountIqd: 0 }, voids: { count: 0, amountIqd: 0 }, refunds: { count: 0, amountIqd: 0 }, waiterCallResponse: { count: 0, avgSeconds: null }, dayCloses: [{ businessDate: '2026-09-02', cashVarianceIqd: 0 }, { businessDate: '2026-09-03', cashVarianceIqd: -188000 }], shiftContext: { daysWorked: 3, busiestDayOrders: 0 } },
    ],
    totals: null,
    comparison: null,
  };

  it('names roles in words, puts days active beside every figure, and never prints JSON', async () => {
    rpc.mockResolvedValue(STAFF);
    renderIt(<StaffActivityReportScreen />);
    const table = await screen.findByRole('table', { name: 'Activity' });
    expect(within(table).getByText('Court desk')).toBeTruthy();
    expect(within(table).queryByText('court_desk')).toBeNull();
    expect(within(table).getAllByRole('columnheader')[1]!.textContent).toBe('Days active');
    // No figure column sorts: this is not a leaderboard.
    expect(within(table).queryAllByRole('columnheader').some((h) => h.getAttribute('aria-sort'))).toBe(false);
    expect(within(table).queryAllByRole('button', { name: /Orders taken/ })).toHaveLength(0);
    expect(rpc).toHaveBeenCalledWith('report_staff_activity', { p_from: expect.any(String), p_to: expect.any(String), p_staff_id: null });
  });

  it('shows discounts, voids and refunds as amounts with how many times, and day closes with the cash result', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) => (fn === 'report_staff_activity' ? STAFF : DRILL));
    renderIt(<StaffActivityReportScreen />);
    await screen.findByRole('table', { name: 'Activity' });
    await user.click(screen.getByRole('button', { name: 'Discounts, voids & refunds' }));
    const exceptions = screen.getByRole('table', { name: 'Discounts, voids & refunds' });
    expect(within(exceptions).getByText('49,802 IQD')).toBeTruthy();
    expect(within(exceptions).getByText('×37')).toBeTruthy();
    expect(document.body.textContent).not.toContain('{"count"');
    await user.click(within(exceptions).getByText('Dev Cashier'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'discounts', p_key: 'staff:s1' })));
    await user.click(within(await screen.findByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]!);

    await user.click(screen.getByRole('button', { name: 'Day closes' }));
    const closes = screen.getByRole('table', { name: 'Day closes' });
    const rows = within(closes).getAllByRole('row').slice(1);
    // Newest first.
    expect(rows[0]!.textContent).toContain('-188,000 IQD');
    expect(rows[1]!.textContent).toContain('Matched');
  });

  it("the audit log for a person is one click from their row", async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(STAFF);
    renderIt(<StaffActivityReportScreen />);
    await screen.findByRole('table', { name: 'Activity' });
    await user.click(screen.getByRole('button', { name: 'Audit log for Dev Court Desk' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/audit', search: { actor: 's2' } });
    // The row's own drill did not fire as well.
    expect(rpc).not.toHaveBeenCalledWith('report_drill', expect.anything());
  });
});

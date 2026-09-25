import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// One report end to end, against the payload report_courts really returns
// (0097): camelCase keys, totals beside the rows, `byHour` and `trend` beside
// both. The previous version of this file mocked a snake_case payload the
// server never sends, which is how a screen that showed nothing useful on the
// running app passed every test.
//
// vitest.config sets `restoreMocks: true`, so every mock is armed in
// beforeEach — a value set inside a vi.mock factory is wiped before the first test.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
// The report tabs hide what the role cannot open.
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { role: 'owner' } }),
}));
// Inside Management, so the tabs are Financial's.
vi.mock('../../routes/__root', () => ({ useWorkspace: () => ({ active: 'owner' }) }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/queries', () => ({ QK: { courts: ['courts'] }, fetchActiveCourts: vi.fn() }));
vi.mock('../../lib/settings', () => ({ useCafeSettings: vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { fetchActiveCourts } from '../../lib/queries';
import { useCafeSettings } from '../../lib/settings';
import { CourtsReportScreen } from './CourtsReport';

const rpc = vi.mocked(appRpc);

function renderReport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <CourtsReportScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const court = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  courtId: id,
  courtNameEn: name,
  courtNameAr: name,
  isActive: true,
  bookings: 0,
  bookedMinutes: 0,
  availableMinutes: 600,
  occupancyPct: 0,
  revenueIqd: 0,
  revenuePerAvailableHourIqd: 0,
  cancellations: 0,
  noShows: 0,
  cancellationRatePct: null,
  noShowRatePct: null,
  peakBookings: 0,
  offPeakBookings: 0,
  ...extra,
});

const READY = {
  columns: [{ key: 'courtNameEn', kind: 'text' }],
  rows: [
    court('c1', 'Court 1', { bookings: 5, bookedMinutes: 450, occupancyPct: 62.5, revenueIqd: 250000, revenuePerAvailableHourIqd: 25000 }),
    court('c2', 'Court 2', { bookings: 2, bookedMinutes: 120, occupancyPct: 20, revenueIqd: 100000, revenuePerAvailableHourIqd: 10000, isActive: false, cancellations: 1, cancellationRatePct: 33.3 }),
  ],
  totals: { bookings: 7, bookedMinutes: 570, availableMinutes: 1200, occupancyPct: 47.5, revenueIqd: 350000, cancellations: 1, noShows: 0, peakBookings: 3, offPeakBookings: 4 },
  byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, bookings: hour === 18 ? 4 : 0 })),
  trend: [{ date: '2026-09-05', bookings: 7, revenueIqd: 350000 }],
  comparison: null,
};

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  vi.mocked(fetchActiveCourts).mockResolvedValue([{ id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', duration_options: [60], sort_order: 1 }]);
  vi.mocked(useCafeSettings).mockReturnValue({ isSuccess: true, isError: false, settings: { analytics_business_day_start_hour: 4 } } as never);
});

describe('CourtsReportScreen', () => {
  it("offers only Financial's reports as tabs, the open one selected", async () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderReport();
    const tabs = within(screen.getByRole('tablist', { name: 'Reports' })).getAllByRole('tab');
    // Staff activity is Observe's and stock value is Stock's: neither is duplicated here.
    expect(tabs.map((t) => t.textContent)).toEqual(['Revenue', 'Courts', 'Cafe']);
    expect(screen.getByRole('tab', { name: 'Courts' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'Cafe' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/reports/cafe' });
  });

  it('loading: header, period and a disabled export while the report waits', () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderReport();
    expect(screen.getByRole('heading', { name: 'Courts' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', true);
    // 0097: report_courts takes (p_from, p_to, p_filters) — no grouping, no view.
    expect(rpc).toHaveBeenCalledWith('report_courts', { p_from: expect.any(String), p_to: expect.any(String), p_filters: { courtId: null } });
  });

  it('leads with the period totals, once, and shows the by-court columns in words', async () => {
    rpc.mockResolvedValue(READY);
    renderReport();
    const table = await screen.findByRole('table', { name: 'By court' });
    expect(within(table).getByText('Court 1')).toBeTruthy();
    expect(within(table).getByText('Retired')).toBeTruthy();
    expect(within(table).getByText('62.5%')).toBeTruthy();
    expect(within(table).getByText('7.5 h')).toBeTruthy();
    expect(within(table).getByText('25,000 IQD')).toBeTruthy();
    // The total is in the band above, and not repeated as a footer row.
    const band = screen.getByRole('region', { name: 'Courts' });
    expect(within(band).getByText('350,000 IQD')).toBeTruthy();
    expect(within(table).queryByText('350,000 IQD')).toBeNull();
    expect(screen.getByText(/Occupancy is hours booked out of the hours the court was open/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toHaveProperty('disabled', false);
  });

  it('each breakdown shows its own figures', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(READY);
    renderReport();
    await screen.findByRole('table', { name: 'By court' });

    await user.click(screen.getByRole('button', { name: 'Cancellations' }));
    const cancellations = screen.getByRole('table', { name: 'Cancellations' });
    expect(within(cancellations).getByText('33.3%')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'By start time' }));
    const bars = screen.getByRole('region', { name: 'By start time' });
    expect(within(bars).getByText('18:00')).toBeTruthy();
    expect(within(bars).getByText('4')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'By day' }));
    expect(within(screen.getByRole('table', { name: 'By day' })).getByText('350,000 IQD')).toBeTruthy();
  });

  it('names the hours tournaments held: a figure in the band and a column by court, only when there were some', async () => {
    rpc.mockResolvedValue({
      ...READY,
      rows: [court('c1', 'Court 1', { bookings: 5, bookedMinutes: 450, eventMinutes: 240 }), READY.rows[1]],
      totals: { ...READY.totals, eventMinutes: 240 },
    });
    renderReport();
    const table = await screen.findByRole('table', { name: 'By court' });
    expect(within(table).getByRole('columnheader', { name: 'Event hours' })).toBeTruthy();
    expect(within(table).getByText('4 h')).toBeTruthy();
    const band = screen.getByRole('region', { name: 'Courts' });
    expect(within(band).getByText('Event hours')).toBeTruthy();
    expect(within(band).getByText('Held for tournaments, counted as open hours')).toBeTruthy();
    // Last in the band, so the lead figures keep their places with or without it.
    const text = band.textContent ?? '';
    expect(text.indexOf('Event hours')).toBeGreaterThan(text.indexOf('No-shows'));
    // The column is explained under the table, like the other derived columns.
    expect(screen.getByText(/Court hours held for tournaments\. They stay in open hours/)).toBeTruthy();
  });

  it('a period with no tournament shows no event line at all', async () => {
    rpc.mockResolvedValue(READY);
    renderReport();
    const table = await screen.findByRole('table', { name: 'By court' });
    expect(within(table).queryByRole('columnheader', { name: 'Event hours' })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Courts' })).queryByText('Event hours')).toBeNull();
    expect(screen.queryByText(/Court hours held for tournaments/)).toBeNull();
  });

  it('a court row opens its bookings with the contract key', async () => {
    const user = userEvent.setup();
    rpc.mockImplementation(async (fn) =>
      fn === 'report_courts' ? READY : { transactions: [{ id: 't1', at: '2026-09-01T10:00:00Z', kind: 'reservation', label: 'Court 1 · Sara', amountIqd: 50000, staffName: 'Desk' }] },
    );
    renderReport();
    const table = await screen.findByRole('table', { name: 'By court' });
    await user.click(within(table).getByText('Court 1'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'bookings', p_key: 'court:c1' })));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('50,000 IQD')).toBeTruthy();
    expect(within(dialog).getByText('Booking')).toBeTruthy();
    expect(dialog.getAttribute('aria-label') ?? dialog.textContent).toContain('Court 1');
  });

  it('empty: a period with nothing booked says so and offers a longer one, instead of a table of zeros', async () => {
    rpc.mockResolvedValue({ ...READY, rows: [court('c1', 'Court 1')], totals: { bookings: 0, cancellations: 0, noShows: 0 } });
    renderReport();
    expect(await screen.findByText('No bookings in this period')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    // The period presets have a "Last 30 days" too; the empty state's own one is the way out.
    const empty = screen.getByRole('heading', { name: 'No bookings in this period' }).parentElement!;
    expect(within(empty).getByRole('button', { name: 'Last 30 days' })).toBeTruthy();
  });

  it('error: shows the failure and a retry that calls the RPC again', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValueOnce(new Error('UNKNOWN')).mockResolvedValue(READY);
    renderReport();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('This could not be loaded.'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'By court' })).toBeTruthy();
  });

  it('the court filter goes to the server', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(READY);
    renderReport();
    await screen.findByRole('table', { name: 'By court' });
    // Our own listbox, so the options exist only once the panel is open.
    await user.click(await screen.findByRole('combobox', { name: 'Court' }));
    await user.click(await screen.findByRole('option', { name: 'Court 1' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('report_courts', expect.objectContaining({ p_filters: { courtId: 'c1' } })));
  });
});

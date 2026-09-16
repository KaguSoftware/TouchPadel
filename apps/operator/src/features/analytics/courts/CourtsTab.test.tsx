import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// The Courts tab through its data hook: skeletons first, the eight zones once
// the five RPCs (times two windows) resolve, the court filter in the URL, the
// error state with a retry, and the "no linked tab" empty text on the cafe
// cards. The RPC seam (`./api`) is the only thing mocked below the tab.
//
// vitest.config sets `restoreMocks: true`, so every mock is armed in
// beforeEach: a value set inside a vi.mock factory is wiped before the first test.

const navigate = vi.fn();
/** The URL search the tab reads; a test sets `court` on it before rendering. */
const searchState: { range: string; court?: string } = { range: '30d' };
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => searchState,
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const mutate = vi.fn();
vi.mock('../../../lib/settings', () => ({
  useCafeSettings: () => ({
    isSuccess: true,
    isError: false,
    error: null,
    settings: { analytics_business_day_start_hour: 4, analytics_excluded_item_ids: [], analytics_engagement_floor: null },
  }),
  useSetCafeSetting: () => ({ mutate, isPending: false, error: null }),
}));

// The stored AI sets (insights, patterns, rejections) read the tables through
// the supabase client directly; the rest of the module stays real.
vi.mock('../../../lib/analyticsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The venue revenue tile reads the cafe's daily sales on the cafe tab's own key.
  analyticsRpc: { dailySales: vi.fn(), saveInsights: vi.fn(), savePatterns: vi.fn() },
  fetchStoredInsights: vi.fn(),
  fetchStoredPatterns: vi.fn(),
  fetchRejections: vi.fn(),
  insights: vi.fn(),
}));

vi.mock('./api', () => ({ courtsRpc: vi.fn() }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
// The court filter lists the venue's courts, not the filtered payload's.
vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchActiveCourts: vi.fn(),
}));

import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { ToastProvider } from '../../../components/toast';
import { analyticsRpc, fetchRejections, fetchStoredInsights, fetchStoredPatterns, insights as callInsights } from '../../../lib/analyticsApi';
import { fetchActiveCourts } from '../../../lib/queries';
import { courtsRpc } from './api';
import { appRpc } from '../../../lib/appRpc';
import { CourtsTab } from './CourtsTab';
import { COURT_A, COURT_B, cafeNoLinksJson, fixtureFor } from './fixtures';

const rpc = vi.mocked(courtsRpc);

/** Resolve every RPC from the fixtures; the compare window is told apart by its range. */
function serveFixtures(cafe = fixtureFor('analytics_courts_cafe')) {
  rpc.mockImplementation(async (name, { from }) => fixtureFor(name, from >= todayMinus(35) ? 'current' : 'compare', cafe) as never);
}

/** ISO date `days` before today, so the current 30-day window is told apart from the one before it. */
function todayMinus(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            <CourtsTab />
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const skeletons = () => document.querySelectorAll('.tp-skel').length;

beforeEach(() => {
  navigate.mockReset();
  mutate.mockReset();
  rpc.mockReset();
  delete searchState.court;
  vi.mocked(analyticsRpc.dailySales).mockResolvedValue([] as never);
  vi.mocked(analyticsRpc.saveInsights).mockResolvedValue('set-1');
  vi.mocked(analyticsRpc.savePatterns).mockResolvedValue('set-2');
  vi.mocked(fetchActiveCourts).mockResolvedValue([
    { id: COURT_A, name_en: 'Court A', name_ar: 'ملعب أ', duration_options: [60, 90], sort_order: 0 },
    { id: COURT_B, name_en: 'Court B', name_ar: 'ملعب ب', duration_options: [60, 90], sort_order: 1 },
  ]);
  vi.mocked(fetchStoredInsights).mockResolvedValue([]);
  vi.mocked(fetchStoredPatterns).mockResolvedValue(null);
  vi.mocked(fetchRejections).mockResolvedValue([]);
});

describe('CourtsTab', () => {
  it('shows skeletons on first load, then the eight zones with the fixture figures', async () => {
    serveFixtures();
    renderTab();
    expect(skeletons()).toBeGreaterThan(0);
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });

    for (const name of ['Pulse', 'Insights', 'When', 'How people book', 'Courts', 'Losses', 'Guests', 'Court and cafe']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }

    // Every window and every RPC was asked for exactly once: five current, four
    // compare. The venue revenue tile shares the summary keys, so no tenth call.
    expect(rpc).toHaveBeenCalledTimes(9);
    expect(rpc.mock.calls.filter(([name]) => name === 'analytics_courts_guests')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('analytics_courts_summary', expect.objectContaining({ from: expect.any(String), to: expect.any(String), courtId: undefined }));

    // The Pulse tile prints the fixture's booking count.
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    const bookingsTile = within(pulse).getByText('Bookings').closest('div')!;
    expect(within(bookingsTile).getByText('48', { selector: 'strong' })).toBeTruthy();
    // Court revenue lands in money form, twice: the court tile and the venue tile (the cafe is empty here).
    expect(within(pulse).getAllByText('1,200,000 IQD', { selector: 'strong' })).toHaveLength(2);
    const venueTile = within(pulse).getByText('Venue revenue').closest('div')!;
    expect(within(venueTile).getByText('1,200,000 IQD', { selector: 'strong' })).toBeTruthy();
    // Case-insensitive: en-GB compact is '1.2M' or '1.2m' depending on the ICU build.
    expect(within(venueTile).getByText(/^0 cafe · 1\.2M courts$/i)).toBeTruthy();
    // The no-show count the panel shows sits under the rate.
    const noShowTile = within(pulse).getByText('No-show rate').closest('div')!;
    expect(within(noShowTile).getByText('4 no-shows')).toBeTruthy();
    // Price per booked hour is the tenth tile.
    const priceTile = within(pulse).getByText('Price per booked hour').closest('div')!;
    expect(within(priceTile).getByText('20,000 IQD', { selector: 'strong' })).toBeTruthy();
    // No error surfaced anywhere.
    expect(screen.queryByRole('alert')).toBeNull();

    // Losses as rates: the two new breakdowns render, and "who cancelled" says
    // both counts (by slot day, and cancelled during the period) with the freed money.
    const losses = screen.getByRole('region', { name: 'Losses' });
    expect(within(losses).getByText('Losses by court')).toBeTruthy();
    expect(within(losses).getByText('Losses by booking length')).toBeTruthy();
    expect(within(losses).getByText(/12 cancelled by slot day · 10 cancelled during this period/)).toBeTruthy();
    // After late cancellations: four slots resold for 80,000, two left empty for 40,000, 50,000 freed.
    const afterLate = within(losses).getByText('After late cancellations').closest('section') ?? losses;
    expect(within(afterLate).getByText('80,000 IQD')).toBeTruthy();
    expect(within(afterLate).getByText('40,000 IQD')).toBeTruthy();
    expect(within(afterLate).getByText('50,000 IQD', { selector: 'strong' })).toBeTruthy();
  });

  it('stores a generated set under the selected court and reads the stored sets by that court', async () => {
    searchState.court = COURT_A;
    serveFixtures();
    vi.mocked(callInsights).mockResolvedValue({
      degraded: true,
      model: null,
      insights: [{ text: 'Court A fills Friday 20:00 with 12 bookings', kind: 'occupancy', subjects: ['Court A'], metrics: {}, confidence: 'medium', sample: 12, status: 'new' }],
    });
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });
    // The stored sets were asked for with the court key, never the venue-wide NULL.
    expect(fetchStoredInsights).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'prev', 'en', 'courts', COURT_A);
    expect(fetchStoredPatterns).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'en', 'courts', COURT_A);
    // Court figures open their transactions for the selected court; venue revenue stays venue-wide.
    vi.mocked(appRpc).mockResolvedValue({ transactions: [] } as never);
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    await userEvent.click(within(pulse).getByRole('button', { name: 'Open the transactions behind No-show rate' }));
    await waitFor(() => expect(appRpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'noShows', p_key: `court:${COURT_A}` })));
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);
    await userEvent.click(within(pulse).getByRole('button', { name: 'Open the transactions behind Venue revenue' }));
    await waitFor(() => expect(appRpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'revenue', p_key: null })));
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!);

    await userEvent.click(screen.getByRole('button', { name: 'Generate insights' }));
    await waitFor(() => expect(analyticsRpc.saveInsights).toHaveBeenCalledTimes(1));
    expect(analyticsRpc.saveInsights).toHaveBeenCalledWith(expect.objectContaining({ scope: 'courts', courtId: COURT_A }));
    // The payload the model read carried the mined patterns as ground truth and
    // court NAMES; a pattern's own id may embed the court key, nothing else does.
    const req = vi.mocked(callInsights).mock.calls[0]![0];
    expect(req.scope).toBe('courts');
    const data = req.data as { patterns?: unknown[]; per_court: { name: string }[] };
    expect(Array.isArray(data.patterns)).toBe(true);
    expect(data.per_court.map((c) => c.name)).toEqual(['Court A', 'Court B']);
    expect(JSON.stringify({ ...data, patterns: undefined })).not.toContain(COURT_A);
    expect(JSON.stringify(data)).not.toMatch(/court_id|guest_id|phone/);
    expect(screen.getByText('Court A fills Friday 20:00 with 12 bookings')).toBeTruthy();
  });

  it('lists the fixture courts in the court filter and writes a choice to the URL', async () => {
    serveFixtures();
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });

    // The sticky bar's select is the first labelled "Court" (the cafe section has its own for the orders card).
    const select = screen.getAllByLabelText('Court')[0]!;
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(labels).toEqual(['All courts', 'Court A', 'Court B']);

    await userEvent.selectOptions(select, COURT_A);
    expect(navigate).toHaveBeenCalledWith({ to: '/analytics/courts', search: expect.objectContaining({ range: '30d', court: COURT_A }) });
  });

  it('keeps every court in the filter while one is selected, so A can switch to B', async () => {
    searchState.court = COURT_A;
    serveFixtures();
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });
    const select = screen.getAllByLabelText('Court')[0]!;
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['All courts', 'Court A', 'Court B']);
    expect((select as HTMLSelectElement).value).toBe(COURT_A);
    // The filtered payload was asked for court A; the venue revenue tile still asks venue-wide.
    expect(rpc).toHaveBeenCalledWith('analytics_courts_summary', expect.objectContaining({ courtId: COURT_A }));
    expect(rpc).toHaveBeenCalledWith('analytics_courts_summary', expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
    expect(rpc.mock.calls.some(([name, args]) => name === 'analytics_courts_summary' && args.courtId === undefined)).toBe(true);
  });

  it('breaks only the section whose RPC rejected', async () => {
    serveFixtures();
    rpc.mockImplementation(async (name, { from }) => {
      if (name === 'analytics_courts_guests') throw new Error('boom');
      return fixtureFor(name, from >= todayMinus(35) ? 'current' : 'compare') as never;
    });
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });
    const guests = screen.getByRole('region', { name: 'Guests' });
    expect(within(guests).getAllByRole('alert').length).toBeGreaterThan(0);
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    expect(within(pulse).queryByRole('alert')).toBeNull();
    expect(within(within(pulse).getByText('Bookings').closest('div')!).getByText('48', { selector: 'strong' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Losses' })).queryByRole('alert')).toBeNull();
  });

  it('renders the error state with a retry control when an RPC rejects', async () => {
    rpc.mockRejectedValue(new Error('boom'));
    renderTab();

    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 });
    expect(retry).toBeTruthy();
    // Every card says it broke rather than showing an empty frame or a zero.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(skeletons()).toBe(0);
    // The zones stay in place around the error.
    expect(screen.getByRole('heading', { level: 2, name: 'Pulse' })).toBeTruthy();
    // Every tile shows the dash glyph (U+2014) rather than a figure it does not have.
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    expect(within(pulse).getAllByText('\u2014', { selector: 'strong' }).length).toBe(10);

    // Retry asks the server again.
    serveFixtures();
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull(), { timeout: 5000 });
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows the "no linked tab" note on the court and cafe cards when nothing was linked', async () => {
    serveFixtures(cafeNoLinksJson);
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });

    const cafe = screen.getByRole('region', { name: 'Court and cafe' });
    const notes = within(cafe).getAllByText(/none has a linked tab yet/);
    // Every card in the zone carries the same explanation instead of an empty plot.
    expect(notes.length).toBeGreaterThanOrEqual(8);
    // 48 live bookings clear the twenty-booking floor, so the attach tile is an honest 0%.
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    expect(within(pulse).getByText('0%', { selector: 'strong' })).toBeTruthy();
  });
});

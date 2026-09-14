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
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useSearch: () => ({ range: '30d' }),
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
  fetchStoredInsights: vi.fn(),
  fetchStoredPatterns: vi.fn(),
  fetchRejections: vi.fn(),
  insights: vi.fn(),
}));

vi.mock('./api', () => ({ courtsRpc: vi.fn() }));

import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { ToastProvider } from '../../../components/toast';
import { fetchRejections, fetchStoredInsights, fetchStoredPatterns } from '../../../lib/analyticsApi';
import { courtsRpc } from './api';
import { CourtsTab } from './CourtsTab';
import { COURT_A, cafeNoLinksJson, fixtureFor } from './fixtures';

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

    // Every window and every RPC was asked for exactly once: five current, four compare.
    expect(rpc).toHaveBeenCalledTimes(9);
    expect(rpc.mock.calls.filter(([name]) => name === 'analytics_courts_guests')).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('analytics_courts_summary', expect.objectContaining({ from: expect.any(String), to: expect.any(String), courtId: undefined }));

    // The Pulse tile prints the fixture's booking count.
    const pulse = screen.getByRole('region', { name: 'Pulse' });
    const bookingsTile = within(pulse).getByText('Bookings').closest('div')!;
    expect(within(bookingsTile).getByText('48', { selector: 'strong' })).toBeTruthy();
    // Court revenue lands in money form.
    expect(within(pulse).getByText('1,200,000 IQD', { selector: 'strong' })).toBeTruthy();
    // No error surfaced anywhere.
    expect(screen.queryByRole('alert')).toBeNull();
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
    expect(within(pulse).getAllByText('\u2014', { selector: 'strong' }).length).toBe(8);

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

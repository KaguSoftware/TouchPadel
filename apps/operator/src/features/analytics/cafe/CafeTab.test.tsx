import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// The Cafe tab through its data hook: skeletons first, the five zones once
// the nine SQL queries resolve (PostHog unconfigured, so the engagement cards
// say so), the pulse figures from the settle-day rows, and one RPC failing
// leaves every other card standing. The RPC seam (`analyticsRpc`), the
// PostHog batch, the stored AI sets and the courts summary behind the venue
// revenue tile are the only things mocked below the tab.

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

vi.mock('../../../lib/analyticsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analyticsRpc: {
    dailySales: vi.fn(),
    soldItems: vi.fn(),
    bestSellers: vi.fn(),
    boughtTogether: vi.fn(),
    itemMargins: vi.fn(),
    promo: vi.fn(),
    menuSnapshot: vi.fn(),
    hourly: vi.fn(),
  },
  posthogQueries: vi.fn(),
  fetchStoredInsights: vi.fn(),
  fetchStoredPatterns: vi.fn(),
  fetchRejections: vi.fn(),
  insights: vi.fn(),
}));
vi.mock('../courts/api', () => ({ courtsRpc: vi.fn() }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { ToastProvider } from '../../../components/toast';
import { analyticsRpc, fetchRejections, fetchStoredInsights, fetchStoredPatterns, posthogQueries } from '../../../lib/analyticsApi';
import { courtsRpc } from '../courts/api';
import { appRpc } from '../../../lib/appRpc';
import { summaryJson } from '../courts/fixtures';
import { cafeFixtureFor } from '../fixtures';
import { CafeTab } from './CafeTab';

const rpc = vi.mocked(analyticsRpc);

function serveFixtures() {
  rpc.dailySales.mockImplementation(async (from) => cafeFixtureFor(from >= todayMinus(35) ? 'dailySales' : 'dailySalesPrev') as never);
  rpc.soldItems.mockResolvedValue(cafeFixtureFor('soldItems') as never);
  rpc.bestSellers.mockResolvedValue(cafeFixtureFor('bestSellers') as never);
  rpc.boughtTogether.mockResolvedValue(cafeFixtureFor('boughtTogether') as never);
  rpc.itemMargins.mockResolvedValue(cafeFixtureFor('itemMargins') as never);
  rpc.promo.mockResolvedValue(cafeFixtureFor('promo') as never);
  rpc.menuSnapshot.mockResolvedValue(cafeFixtureFor('menuSnapshot') as never);
  rpc.hourly.mockResolvedValue(cafeFixtureFor('hourly') as never);
  vi.mocked(courtsRpc).mockResolvedValue(summaryJson as never);
}

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
            <CafeTab />
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const skeletons = () => document.querySelectorAll('.tp-skel').length;

beforeEach(() => {
  navigate.mockReset();
  for (const fn of Object.values(rpc)) fn.mockReset();
  vi.mocked(courtsRpc).mockReset();
  vi.mocked(posthogQueries).mockResolvedValue({ configured: false, floor: null, results: {} });
  vi.mocked(fetchStoredInsights).mockResolvedValue([]);
  vi.mocked(fetchStoredPatterns).mockResolvedValue(null);
  vi.mocked(fetchRejections).mockResolvedValue([]);
  // The assistant-fed cards read the component cache on mount (one RPC, no model);
  // a miss with nothing written is the honest default here.
  vi.mocked(appRpc).mockImplementation(async (fn: string) =>
    fn === 'analytics_component'
      ? ({ hit: false, key: 'x', params_hash: 'h', last: null } as never)
      : fn === 'assistant_usage'
        ? ({ pricing: {}, fallback_micros_per_mtok: 0 } as never)
        : (undefined as never),
  );
});

describe('CafeTab', () => {
  it('shows skeletons on first load, then the five sections with the settle-day figures and the venue total', async () => {
    serveFixtures();
    renderTab();
    expect(skeletons()).toBeGreaterThan(0);
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Summary', 'What stands out', 'Menu', 'Sales and the guest menu', 'Busy times']);
    expect(rpc.dailySales).toHaveBeenCalledTimes(2);

    const pulse = screen.getByRole('region', { name: 'Summary' });
    // A lead figure is a tile; a supporting figure is a row in a named list.
    const tile = (label: string) => within(pulse).getByText(label).closest('div')!;
    const row = (label: string) => within(pulse).getByText(label).closest('li')!;
    expect(within(tile('Cafe sales')).getByText('700,000 IQD', { selector: 'strong' })).toBeTruthy();
    // Venue revenue = cafe net 700,000 + the venue-wide court revenue 1,200,000.
    expect(within(row('Venue revenue')).getByText('1,900,000 IQD', { selector: 'strong' })).toBeTruthy();
    // Case-insensitive: en-GB compact notation is '700K' in older ICU and '700k' in
    // the newer CLDR that CI's Node 22 ships. The figure is what is under test.
    expect(within(row('Venue revenue')).getByText(/^700K cafe · 1\.2M courts$/i)).toBeTruthy();
    // Cash and card are two rows with their units, not "630,000 / 350,000".
    expect(within(row('Cash')).getByText('630,000 IQD', { selector: 'strong' })).toBeTruthy();
    expect(within(row('Cash')).getByText('64% of cash and card')).toBeTruthy();
    expect(within(row('Card')).getByText('350,000 IQD', { selector: 'strong' })).toBeTruthy();
    expect(within(row('Refunds')).getByText('70,000 IQD', { selector: 'strong' })).toBeTruthy();
    // 0099: waste sits with the money given away, the panel's figure summed by day.
    expect(within(row('Waste')).getByText('21,000 IQD', { selector: 'strong' })).toBeTruthy();
    // The panel's cafe figures: before refunds (under the sales figure), orders, and their average.
    expect(within(tile('Cafe sales')).getByText('770,000 IQD before refunds')).toBeTruthy();
    expect(within(tile('Orders')).getByText('84', { selector: 'strong' })).toBeTruthy();
    expect(within(tile('Average order value')).getByText('9,167 IQD', { selector: 'strong' })).toBeTruthy();

    // A tile opens the panel's transaction list for its figure, over the page's dates.
    vi.mocked(appRpc).mockResolvedValue({ transactions: [{ id: 't1', at: '2026-09-01T10:00:00Z', kind: 'tab', label: 'Table 4', amountIqd: 12000 }] } as never);
    fireEvent.click(within(pulse).getByRole('button', { name: 'Open the transactions behind Cafe sales' }));
    await waitFor(() => expect(appRpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'cafeNet', p_key: null })));
    // The shared transactions window: titled by figure and dates, columns in words.
    expect(await screen.findByText(/^Cafe sales · /)).toBeTruthy();
    expect(await screen.findByText('Table 4')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeTruthy();
    expect(screen.queryByText('amountIqd')).toBeNull();
    fireEvent.click(within(pulse).getByRole('button', { name: 'Open the transactions behind Card' }));
    await waitFor(() => expect(appRpc).toHaveBeenCalledWith('report_drill', expect.objectContaining({ p_figure: 'card' })));
    expect(within(row('QR share of orders')).getByText('33%', { selector: 'strong' })).toBeTruthy();
    expect(within(row('QR share of orders')).getByText('28 QR · 56 till')).toBeTruthy();
    // The retired cards are gone.
    expect(screen.queryByText('Covers')).toBeNull();
    expect(screen.queryByText('Peak hours')).toBeNull();
    expect(screen.queryByText('Table activity')).toBeNull();
    expect(screen.queryByText('Language preference')).toBeNull();
    // Without PostHog the page says so ONCE, the guest-menu rows are left out of the
    // summary rather than printed as dashes, and nothing errors.
    expect(screen.getAllByText(/Guest analytics are not configured yet/)).toHaveLength(1);
    expect(within(pulse).queryByText('Menu views')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Each section opens with its answer; the refinements are folded and counted.
    const sales = screen.getByRole('region', { name: 'Sales and the guest menu' });
    expect(within(sales).getByText(/^Best seller: /)).toBeTruthy();
    expect(within(sales).queryByText('Looked, not bought')).toBeNull();
    fireEvent.click(within(sales).getByRole('button', { name: 'Show more (4)' }));
    expect(within(sales).getByText('Looked, not bought')).toBeTruthy();
    expect(within(sales).getAllByText('Needs guest menu data, which is not set up.').length).toBeGreaterThan(0);
  });

  it('keeps every other card standing when one RPC rejects', async () => {
    serveFixtures();
    rpc.bestSellers.mockRejectedValue(new Error('boom'));
    renderTab();
    await waitFor(() => expect(skeletons()).toBe(0), { timeout: 5000 });

    // The best-sellers card broke, and so did the two cards under What stands
    // out, which read every number on purpose; nothing else did.
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    const pulse = screen.getByRole('region', { name: 'Summary' });
    expect(within(pulse).getByText('700,000 IQD', { selector: 'strong' })).toBeTruthy();
    expect(within(pulse).queryByRole('alert')).toBeNull();
    const sales = screen.getByRole('region', { name: 'Sales and the guest menu' });
    expect(within(sales).getAllByRole('alert')).toHaveLength(1);
    // With best sellers missing, the section has no sentence to lead with rather than a half-true one.
    expect(within(sales).queryByText(/^Best seller: /)).toBeNull();
    expect(within(screen.getByRole('region', { name: 'What stands out' })).getAllByRole('alert')).toHaveLength(2);
    expect(within(screen.getByRole('region', { name: 'Menu' })).queryByRole('alert')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Busy times' })).queryByRole('alert')).toBeNull();
    // The bought-together pair still renders from its own query.
    expect(screen.getByText(/Kahi \+ Latte|Latte \+ Kahi/)).toBeTruthy();
  });
});

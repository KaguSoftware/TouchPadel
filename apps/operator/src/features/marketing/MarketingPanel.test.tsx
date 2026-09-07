import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { CampaignRow, MarketingOverview } from './marketingTypes';

// The panel's reason to exist is that it refuses to invent attribution: a
// campaign with no promotion is reported as reach only, never as a zero.

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { MarketingPanelScreen } from './MarketingPanel';

const rpc = vi.mocked(appRpc);

const campaign = (over: Partial<CampaignRow> = {}): CampaignRow => ({
  id: 'c1',
  name_en: 'Winter doubles',
  name_ar: 'زوجي الشتاء',
  channel: 'telegram',
  status: 'live',
  starts_at: '2026-09-01T00:00:00Z',
  ends_at: null,
  promotion_id: null,
  audience_id: null,
  audience_en: null,
  audience_ar: null,
  promotion_en: null,
  promotion_ar: null,
  reach: null,
  performance: {
    sends: 120,
    delivered: 118,
    failed: 2,
    lastSentAt: null,
    attributable: false,
    redemptions: null,
    discountIqd: null,
    revenueIqd: null,
  },
  ...over,
});

function overview(campaigns: CampaignRow[]): MarketingOverview {
  return {
    campaigns,
    audiences: [],
    counts: {
      live: campaigns.filter((c) => c.status === 'live').length,
      scheduled: campaigns.filter((c) => c.status === 'scheduled').length,
      draft: campaigns.filter((c) => c.status === 'draft').length,
    },
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MarketingPanelScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => rpc.mockReset());

describe('MarketingPanelScreen', () => {
  it('says a campaign with no promotion is not measurable, and never shows it as zero', async () => {
    rpc.mockResolvedValue(overview([campaign()]));
    renderPanel();
    expect(await screen.findByText('Not measurable')).toBeTruthy();
    // The distinction the screen exists for. Scoped to the table: the counts
    // strip above it legitimately reads 0 scheduled / 0 draft.
    const table = within(screen.getByRole('table'));
    expect(table.queryByText('0')).toBeNull();
    expect(table.getByText('—')).toBeTruthy();
    // Reach is still reported: the send happened, only the outcome is unknown.
    expect(table.getByText('120')).toBeTruthy();
  });

  it('shows real figures once a promotion makes the campaign measurable', async () => {
    rpc.mockResolvedValue(
      overview([
        campaign({
          promotion_id: 'p1',
          promotion_en: 'Two for one',
          performance: {
            sends: 120,
            delivered: 118,
            failed: 2,
            lastSentAt: null,
            attributable: true,
            redemptions: 14,
            discountIqd: 70_000,
            revenueIqd: 420_000,
          },
        }),
      ]),
    );
    renderPanel();
    expect(await screen.findByText('14')).toBeTruthy();
    expect(screen.getByText(/420,000/)).toBeTruthy();
    expect(screen.queryByText('Not measurable')).toBeNull();
  });

  it('offers only the transitions the server accepts', async () => {
    rpc.mockResolvedValue(overview([campaign({ status: 'draft' })]));
    renderPanel();
    // draft -> scheduled | cancelled, and nothing else.
    expect(await screen.findByRole('button', { name: 'Schedule' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel campaign' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set live' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('offers nothing on a finished campaign', async () => {
    rpc.mockResolvedValue(overview([campaign({ status: 'ended' })]));
    renderPanel();
    await screen.findByText('Ended');
    expect(screen.queryByRole('button', { name: 'Schedule' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set live' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel campaign' })).toBeNull();
  });

  it('sends the status the button names', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(overview([campaign({ status: 'draft' })]));
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_campaign_status', { p_id: 'c1', p_status: 'scheduled' }),
    );
  });

  it('shows the empty state rather than an empty table', async () => {
    rpc.mockResolvedValue(overview([]));
    renderPanel();
    expect(await screen.findByText('No campaigns yet')).toBeTruthy();
  });
});

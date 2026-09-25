import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { CampaignRow, MarketingOverview } from './marketingTypes';

// "From marketing" on /marketing (build-contracts-2026-09-23 §5.5): the drafts
// the marketing role suggested are ordinary drafts the owner completes and
// makes live, marked with who sent them, their note and a filter of their own.

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

const campaign = (id: string, over: Partial<CampaignRow> = {}): CampaignRow => ({
  id,
  name_en: `Campaign ${id}`,
  name_ar: `حملة ${id}`,
  channel: 'telegram',
  status: 'draft',
  starts_at: null,
  ends_at: null,
  promotion_id: null,
  audience_id: null,
  audience_en: null,
  audience_ar: null,
  promotion_en: null,
  promotion_ar: null,
  reach: null,
  performance: { sends: 0, delivered: 0, failed: 0, lastSentAt: null, attributable: false, redemptions: null, discountIqd: null, revenueIqd: null },
  ...over,
});

const overview: MarketingOverview = {
  campaigns: [campaign('c1'), campaign('c2', { status: 'live' }), campaign('c3')],
  audiences: [],
  counts: { live: 1, scheduled: 0, draft: 2 },
};

function renderPanel(suggestions: unknown) {
  rpc.mockImplementation(async (fn: string) => (fn === 'marketing_suggestions' ? suggestions : overview));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MarketingPanelScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

// Braces: a function returned from beforeEach is run as a teardown.
beforeEach(() => {
  rpc.mockReset();
});

describe('From marketing', () => {
  const suggestions = {
    drafts: [
      { campaign_id: 'c1', suggested_by: 's9', suggested_by_name: 'Dev Marketing', suggested_at: '2026-09-25T08:00:00Z', images: ['v/campaigns/a.jpg'], run_id: null, menu_item_id: null, suggestion_note: 'For the new dessert' },
    ],
  };

  it('marks a suggested draft with who sent it and their note', async () => {
    renderPanel(suggestions);
    // The name is bidi-isolated inside the sentence (§4), hence the pattern.
    const badge = await screen.findByText(/^From .Dev Marketing.$/);
    const row = badge.closest('tr')!;
    expect(within(row).getByText('Campaign c1')).toBeTruthy();
    expect(within(row).getByText(/Note: .*For the new dessert/)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Photos (1)' })).toBeTruthy();
    const other = screen.getByText('Campaign c3').closest('tr')!;
    expect(other.querySelector('[data-from-marketing]')).toBeNull();
    expect(screen.getByText('New from marketing: 1')).toBeTruthy();
  });

  it('filters the list to what marketing suggested', async () => {
    renderPanel(suggestions);
    await screen.findByText(/^From .Dev Marketing.$/);
    await userEvent.click(screen.getByRole('button', { name: /^From marketing/ }));
    expect(screen.getByText('Campaign c1')).toBeTruthy();
    expect(screen.queryByText('Campaign c2')).toBeNull();
    expect(screen.queryByText('Campaign c3')).toBeNull();
  });

  it('offers no filter and no marks when marketing suggested nothing, or the read fails', async () => {
    renderPanel({ drafts: [] });
    await screen.findByText('Campaign c1');
    expect(screen.queryByRole('button', { name: /^From marketing/ })).toBeNull();
    expect(document.querySelector('[data-from-marketing]')).toBeNull();
  });
});

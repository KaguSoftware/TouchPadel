import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // The result cell is words only — the reason, never a number.
    const result = table.getByText('Not measurable').parentElement!;
    expect(result.textContent).toBe('Not measurableNo promotion attached');
    expect(result.textContent).not.toMatch(/\d/);
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
    expect(await screen.findByText('Times used: 14')).toBeTruthy();
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

  it('shows three campaigns, then View more reveals the rest', async () => {
    const user = userEvent.setup();
    const names = ['Alpha night', 'Bravo night', 'Charlie night', 'Delta night', 'Echo night'];
    rpc.mockResolvedValue(overview(names.map((n, i) => campaign({ id: `c${i}`, name_en: n }))));
    renderPanel();
    expect(await screen.findByText('Charlie night')).toBeTruthy();
    expect(screen.queryByText('Delta night')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    expect(screen.getByText('Echo night')).toBeTruthy();
  });

  it('shows the empty state rather than an empty table', async () => {
    rpc.mockResolvedValue(overview([]));
    renderPanel();
    expect(await screen.findByText('No campaigns yet')).toBeTruthy();
  });
});

describe('New campaign and New audience, stepped', () => {
  function answer() {
    rpc.mockImplementation(async (fn: string) => (String(fn).startsWith('save_marketing') ? 'new-id' : overview([])));
  }
  const saved = (fn: string) => rpc.mock.calls.filter(([f]) => f === fn).map(([, a]) => a as Record<string, unknown>);

  it('a campaign: names first, the channel as cards, a backwards window held on When, saved from Review', async () => {
    const user = userEvent.setup();
    answer();
    renderPanel();
    await user.click((await screen.findAllByRole('button', { name: 'New campaign' }))[0]!);
    const dialog = within(await screen.findByRole('dialog', { name: 'New campaign' }));
    await user.click(dialog.getByTestId('campaign-new.step.review'));
    expect(dialog.getByText('Enter the name in both languages.')).toBeTruthy();
    await user.type(dialog.getByRole('textbox', { name: 'Name (English)' }), 'Ladies night');
    await user.type(dialog.getByRole('textbox', { name: 'Name (Arabic)' }), 'ليلة السيدات');
    await user.click(dialog.getByTestId('campaign-new.step.channel'));
    await user.click(dialog.getByTestId('campaign-new.channel.guest_site'));
    // No promotion: the hint says the campaign cannot be measured.
    expect(dialog.getByText(/hands out no promotion/)).toBeTruthy();
    await user.click(dialog.getByTestId('campaign-new.step.when'));
    const [starts, last] = Array.from(document.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
    fireEvent.change(starts!, { target: { value: '2026-11-30' } });
    fireEvent.change(last!, { target: { value: '2026-11-01' } });
    await user.click(dialog.getByTestId('campaign-new.step.review'));
    expect(dialog.getByText('Step 3 of 4')).toBeTruthy();
    expect(dialog.getAllByText('The last day cannot be before the start.').length).toBeGreaterThan(0);
    fireEvent.change(last!, { target: { value: '2026-12-01' } });
    await user.click(dialog.getByTestId('campaign-new.step.review'));
    // The menu's note and the Review row both name it.
    expect(dialog.getAllByText('Guest site')).toHaveLength(2);
    await user.click(dialog.getByTestId('campaign-new.submit'));
    await waitFor(() => expect(saved('save_marketing_campaign')).toHaveLength(1));
    expect(saved('save_marketing_campaign')[0]).toMatchObject({ p_id: null, p_name_en: 'Ladies night', p_channel: 'guest_site', p_promotion_id: null });
  });

  it('an audience: the rule and its language, said back, saved from Review', async () => {
    const user = userEvent.setup();
    answer();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'New audience' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New audience' }));
    await user.type(dialog.getByRole('textbox', { name: 'Name (English)' }), 'Regulars');
    await user.type(dialog.getByRole('textbox', { name: 'Name (Arabic)' }), 'الدائمون');
    await user.click(dialog.getByTestId('audience-new.step.who'));
    expect(dialog.getByTestId('audience-new.sentence').textContent).toBe('Every guest.');
    await user.type(dialog.getByRole('textbox', { name: 'At least this many bookings' }), '3');
    await user.type(dialog.getByRole('textbox', { name: 'Played within this many days' }), '30');
    await user.click(dialog.getByRole('checkbox', { name: 'Have a phone number' }));
    // The preview's sentence, word for word.
    expect(dialog.getByTestId('audience-new.sentence').textContent?.replace(/[\u2066-\u2069]/g, '')).toBe(
      'Guests with 3 or more bookings who played in the last 30 days, in any language, with a phone number.',
    );
    await user.click(dialog.getByRole('button', { name: 'Arabic' }));
    expect(dialog.getByTestId('audience-new.sentence').textContent?.replace(/[\u2066-\u2069]/g, '')).toBe(
      'Guests with 3 or more bookings who played in the last 30 days, in Arabic, with a phone number.',
    );
    await user.click(dialog.getByTestId('audience-new.step.review'));
    await user.click(dialog.getByTestId('audience-new.submit'));
    await waitFor(() => expect(saved('save_marketing_audience')).toHaveLength(1));
    expect(saved('save_marketing_audience')[0]).toMatchObject({
      p_id: null,
      p_name_en: 'Regulars',
      p_rule: { minBookings: 3, lastSeenDays: 30, lang: 'ar', hasPhone: true },
    });
  });
});

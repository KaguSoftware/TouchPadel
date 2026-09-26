import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { MarketingOverview } from './marketingTypes';

// "Requests to marketing" on /marketing (build-contracts-2026-09-23 §2.24.11,
// §5.5): what staff asked marketing for and what marketing answered, read by
// the owner. Nothing on it answers: marketing does that on the phone.

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

const overview: MarketingOverview = { campaigns: [], audiences: [], counts: { live: 0, scheduled: 0, draft: 0 } };

const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  title: 'A post about the pistachio cake',
  body: 'It launches on Friday. A photo of it on the counter would be good.',
  want_by: '2026-10-02',
  menu_item_id: 'm1',
  item_name_en: 'Pistachio cake',
  item_name_ar: 'كيكة الفستق',
  photos: ['v1/requests/s1/cake.jpg', 'v1/requests/s1/counter.jpg'],
  status: 'open',
  answer: null,
  answered_by_name: null,
  answered_at: null,
  created_at: '2026-09-25T07:00:00Z',
  requested_by_name: 'Maha',
  requested_by_role: 'cashier',
  ...over,
});

const answered = request({
  id: 'r2',
  title: 'Photos of the new courts',
  menu_item_id: null,
  item_name_en: null,
  item_name_ar: null,
  photos: [],
  want_by: null,
  status: 'done',
  answer: 'Posted on Instagram this morning.',
  answered_by_name: 'Dev Marketing',
  answered_at: '2026-09-25T09:00:00Z',
  requested_by_name: 'Hussein',
  requested_by_role: 'court_desk',
});

let pages: Record<string, unknown>;

function renderPanel() {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'marketing_requests_page') return pages[String(args?.p_filter)];
    if (fn === 'marketing_suggestions') return { drafts: [] };
    return overview;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MarketingPanelScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  pages = {
    open: { requests: [request()], open_count: 1, total: 1 },
    answered: { requests: [answered], open_count: 1, total: 1 },
    all: { requests: [request(), answered], open_count: 1, total: 2 },
  };
});

// The page reader and isPastWanted are node-tested in marketingStaffLogic.test.ts.

describe('Requests to marketing', () => {
  it('lists the waiting requests with who asked, the item and the photos, and nothing to answer with', async () => {
    renderPanel();
    const panel = await screen.findByTestId('marketing-requests');
    const row = (await within(panel).findByText('A post about the pistachio cake')).closest('li')!;
    expect(within(row).getByText('Waiting for marketing')).toBeTruthy();
    expect(row.querySelector('[data-asked-by]')!.textContent).toMatch(/^Maha · Cashier · /);
    expect(within(row).getByText(/About .Pistachio cake./)).toBeTruthy();
    expect(within(row).getByText(/^Wanted by /)).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Photos (2)' })).toBeTruthy();
    expect(within(panel).getByText('1 waiting')).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('marketing_requests_page', { p_filter: 'open', p_limit: 50 });
    // Read-only: the only buttons are the filter and the photos.
    expect(within(panel).getAllByRole('button')).toHaveLength(4);
    for (const name of ['Waiting', 'Answered', 'All', 'Photos (2)']) expect(within(panel).getByRole('button', { name })).toBeTruthy();
  });

  it('shows marketing’s answer under Answered', async () => {
    renderPanel();
    const panel = await screen.findByTestId('marketing-requests');
    await within(panel).findByText('A post about the pistachio cake');
    await userEvent.click(within(panel).getByRole('button', { name: 'Answered' }));
    const row = (await within(panel).findByText('Photos of the new courts')).closest('li')!;
    expect(within(row).getByText('Done')).toBeTruthy();
    expect(within(row).getByText('Posted on Instagram this morning.')).toBeTruthy();
    expect(within(row).getByText(/^Answer from .Dev Marketing. · /)).toBeTruthy();
    expect(row.querySelector('[data-asked-by]')!.textContent).toMatch(/^Hussein · Court desk · /);
    expect(within(panel).queryByText('A post about the pistachio cake')).toBeNull();
  });

  it('says so when nothing is waiting, with no count', async () => {
    pages.open = { requests: [], open_count: 0, total: 0 };
    renderPanel();
    const panel = await screen.findByTestId('marketing-requests');
    expect(await within(panel).findByText('Nothing is waiting for marketing.')).toBeTruthy();
    expect(within(panel).queryByText(/waiting$/)).toBeNull();
  });

  it('shows a failed read inside the panel only, and keeps the campaigns', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'marketing_requests_page') throw new Error('offline');
      if (fn === 'marketing_suggestions') return { drafts: [] };
      return overview;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <MarketingPanelScreen />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    const panel = await screen.findByTestId('marketing-requests');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Try again' })).toBeTruthy());
    expect(screen.getByText('No campaigns yet')).toBeTruthy();
  });
});

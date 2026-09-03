import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// The panel is the owner's landing screen: it must show each of its four
// states without a server, and it must never invent a figure — everything on
// it is the `panel_headline` payload rendered as given.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { ManagementPanelScreen } from './ManagementPanel';

const rpc = vi.mocked(appRpc);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ManagementPanelScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
});

describe('ManagementPanelScreen — four states', () => {
  it('loading: shows the skeleton and no figures', () => {
    rpc.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Management panel' })).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('15,000 IQD')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('panel_headline', expect.objectContaining({ p_compare: 'previousPeriod' }));
  });

  it('ready: renders the server figures verbatim, with comparison', async () => {
    rpc.mockResolvedValue({
      figures: [
        { key: 'revenue', value: 15000, previous: 12000, changeAbs: 3000, changePct: 25 },
        { key: 'cafeRevenue', value: 5000, previous: 5000, changeAbs: 0, changePct: 0 },
        { key: 'orders', value: 42, previous: 40, changeAbs: 2, changePct: 5 },
        { key: 'mystery', value: 9 },
      ],
    });
    renderPanel();
    expect(await screen.findByText('15,000 IQD')).toBeTruthy();
    expect(screen.getByText('5,000 IQD')).toBeTruthy();
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('(+25.0%)')).toBeTruthy();
    // Unknown keys are dropped, never guessed at.
    expect(screen.queryByText('mystery')).toBeNull();
    expect(screen.getByRole('button', { name: /Courts report/ })).toBeTruthy();
  });

  it('empty: a period with no trading says so and offers another range', async () => {
    rpc.mockResolvedValue({ figures: [{ key: 'revenue', value: 0 }, { key: 'orders', value: null }] });
    renderPanel();
    expect(await screen.findByText('No trading in this period')).toBeTruthy();
    expect(screen.getByText('Nothing was sold or booked between these dates. Pick another period.')).toBeTruthy();
    // The empty state offers a wider range on top of the preset strip.
    expect(screen.getAllByRole('button', { name: 'Last 30 days' }).length).toBeGreaterThan(1);
  });

  it('error: surfaces the failure with a retry', async () => {
    rpc.mockRejectedValue(new Error('FORBIDDEN'));
    renderPanel();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('This could not be loaded.'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  });
});

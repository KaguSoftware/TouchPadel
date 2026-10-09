import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// On hand's header actions follow the stock scope: the café's page links to
// /stock, the shop desk's to its own /shop pages, and only the café records
// waste (the shop desk has no Waste page, 2026-10-08).

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate, useSearch: () => ({}) }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
// Every read comes back empty: the header is what is under test.
vi.mock('./stockKeys', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchOnHand: vi.fn(async () => []),
  fetchSummary: vi.fn(async () => ({ expired: [], expiringSoon: [] })),
  fetchAlertCount: vi.fn(async () => 0),
  fetchLastCount: vi.fn(async () => null),
  fetchUnfinishedCounts: vi.fn(async () => []),
  fetchByStore: vi.fn(async () => []),
  fetchNeedsCostCount: vi.fn(async () => 0),
}));

import { OnHand } from './OnHand';
import { StockScopeProvider } from './stockScope';

function renderScreen(scope: 'venue' | 'shop') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <StockScopeProvider scope={scope}>
          <OnHand />
        </StockScopeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigate.mockReset();
});

describe('On hand header actions', () => {
  it('on the shop desk: no Waste, and goods in and counts open the shop pages', async () => {
    renderScreen('shop');
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Record waste' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Record a delivery' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/shop/receive' });
    await user.click(screen.getByRole('button', { name: 'Count stock' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/shop/counts' });
  });

  it('in the café: Waste stays, and goods in and counts open the /stock pages', async () => {
    renderScreen('venue');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record waste' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/stock/waste' });
    await user.click(screen.getByRole('button', { name: 'Record a delivery' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/stock/receive' });
    await user.click(screen.getByRole('button', { name: 'Count stock' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/stock/counts' });
  });
  it('on the shop desk with no stock: the empty state opens Products, not the café’s ingredients', async () => {
    renderScreen('shop');
    const user = userEvent.setup();
    expect(await screen.findByText('No shop stock yet')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open Products' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/shop/products' });
  });

  it('in the café with no stock: the empty state still opens ingredients', async () => {
    renderScreen('venue');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add ingredients' }));
    expect(navigate).toHaveBeenLastCalledWith({ href: '/stock/ingredients' });
  });
});

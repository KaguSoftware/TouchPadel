import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as AuthModule from '../../lib/auth';
import type * as StockKeysModule from './stockKeys';

// Stock ▸ Stock count by store (wave5-addendum-2026-09-25 §2.8.2 D7, §5.2):
// the store is picked before Start, each tab reads the manager's own open
// count at that store, and the kitchen's blind counts from the phone wait
// above the tabs for a manager to apply (lines editable) or discard.

const navigate = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn(async (_opts: { kind?: string }) => true));
const data = vi.hoisted(() => ({
  counts: [] as unknown[],
  open: {} as Record<string, unknown>,
  lines: {} as Record<string, unknown[]>,
  openAsked: [] as string[],
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => confirm }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, usePermissions: () => mod.permissionsFor('manager') };
});
vi.mock('./stockKeys', async (importOriginal) => {
  const mod = await importOriginal<typeof StockKeysModule>();
  return {
    ...mod,
    fetchIngredients: async () => [
      { id: 'flour', kind: 'purchased', name_en: 'Flour', name_ar: 'طحين', unit: 'g', pack_size: null, is_active: true },
      { id: 'butter', kind: 'purchased', name_en: 'Butter', name_ar: 'زبدة', unit: 'g', pack_size: null, is_active: true },
    ],
    fetchUnfinishedCounts: async () => data.counts,
    fetchOpenCount: async (location: string) => {
      data.openAsked.push(location);
      return data.open[location] ?? null;
    },
    fetchLastCount: async () => null,
    fetchCountLines: async (id: string) => data.lines[id] ?? [],
  };
});

import { appRpc } from '../../lib/appRpc';
import { CountScreen } from './CountScreen';

const rpc = vi.mocked(appRpc);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <CountScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const phoneCount = { id: 'pc1', location: 'bakery', source: 'phone', started_at: '2026-09-26T06:00:00Z', staff: { display_name: 'Tiba' } };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({});
  confirm.mockClear();
  navigate.mockReset();
  data.counts = [];
  data.open = {};
  data.lines = {};
  data.openAsked = [];
});

describe('Stock count by store', () => {
  it('counts the store whose tab is chosen, and reads only that store’s own open count', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('count-start-cafe');
    await user.click(screen.getByRole('tab', { name: 'Bakery store' }));
    await screen.findByTestId('count-start-bakery');
    expect(data.openAsked).toEqual(expect.arrayContaining(['cafe', 'bakery']));
    await user.click(within(screen.getByTestId('count-start-bakery')).getByRole('button', { name: 'Start count' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('start_count', { p_location: 'bakery' }));
  });

  it('lists a phone count waiting for a manager, and holds Start at its store only', async () => {
    const user = userEvent.setup();
    data.counts = [phoneCount];
    data.lines = { pc1: [{ ingredient_id: 'flour', theoretical_qty: 5000, counted_qty: 4800 }] };
    mount();
    const panel = await screen.findByTestId('phone-counts');
    expect(within(panel).getByText('Waiting: 1')).toBeTruthy();
    expect(within(panel).getByText('Bakery store')).toBeTruthy();
    // The cafe store can still be counted.
    const cafeStart = within(await screen.findByTestId('count-start-cafe')).getByRole('button', { name: 'Start count' }) as HTMLButtonElement;
    expect(cafeStart.disabled).toBe(false);
    await user.click(screen.getByRole('tab', { name: 'Bakery store' }));
    const bakeryStart = within(await screen.findByTestId('count-start-bakery')).getByRole('button', { name: 'Start count' }) as HTMLButtonElement;
    expect(bakeryStart.disabled).toBe(true);
    expect(screen.getAllByText('A count from the phone is waiting for the bakery store. Apply or discard it first.').length).toBeGreaterThan(0);
  });

  it('applies a phone count with the manager’s correction, after a plain confirm', async () => {
    const user = userEvent.setup();
    data.counts = [phoneCount];
    data.lines = {
      pc1: [
        { ingredient_id: 'flour', theoretical_qty: 5000, counted_qty: 4800 },
        { ingredient_id: 'butter', theoretical_qty: 1000, counted_qty: 1000 },
      ],
    };
    mount();
    const review = await screen.findByTestId('phone-count-pc1');
    // Blind on the phone; here the records and the difference are shown.
    expect(await within(review).findByText('−200 g')).toBeTruthy();
    expect(within(review).getByText('missing')).toBeTruthy();
    const flour = within(review).getByRole('textbox', { name: 'Flour' });
    await user.clear(flour);
    await user.type(flour, '4900');
    await user.click(within(review).getByTestId('phone-count-apply'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![0]).toMatchObject({ kind: 'primary' });
    expect(rpc).toHaveBeenCalledWith('finalize_count', {
      p_count_id: 'pc1',
      p_lines: expect.arrayContaining([
        { ingredient_id: 'flour', counted_qty: 4900 },
        { ingredient_id: 'butter', counted_qty: 1000 },
      ]),
    });
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/variance' });
  });

  it('discards a phone count behind a red confirm, and stock stays as it is', async () => {
    const user = userEvent.setup();
    data.counts = [phoneCount];
    data.lines = { pc1: [{ ingredient_id: 'flour', theoretical_qty: 5000, counted_qty: 4800 }] };
    mount();
    const review = await screen.findByTestId('phone-count-pc1');
    await user.click(await within(review).findByTestId('phone-count-discard'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('discard_count', { p_count_id: 'pc1' }));
    expect(confirm.mock.calls[0]![0]).toMatchObject({ kind: 'danger' });
  });

  it('discards the manager’s own open count behind a red confirm', async () => {
    const user = userEvent.setup();
    data.counts = [{ id: 'oc1', location: 'cafe', source: 'operator', started_at: '2026-09-26T07:00:00Z', staff: { display_name: 'Omar' } }];
    data.open = { cafe: { id: 'oc1', started_at: '2026-09-26T07:00:00Z', finalized_at: null, location: 'cafe', source: 'operator' } };
    data.lines = { oc1: [{ ingredient_id: 'flour', theoretical_qty: 5000, counted_qty: 5000 }] };
    mount();
    // The tab says the store is being counted.
    expect(await screen.findByRole('tab', { name: 'Cafe store · Counting' })).toBeTruthy();
    await screen.findByTestId('count-open-cafe');
    await user.click(screen.getByTestId('count-discard'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('discard_count', { p_count_id: 'oc1' }));
    expect(confirm.mock.calls[0]![0]).toMatchObject({ kind: 'danger' });
  });
});

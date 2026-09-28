import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as StockKeysModule from './stockKeys';

// Goods in ▸ "Put it in: Cafe store / Bakery store" (wave5-addendum-2026-09-25
// §2.8.2 D4, §5.2, M5): every delivery names its store, the cafe store by
// default; a store a manager is counting takes no delivery, said before the
// delivery is typed. Since 0245 shop stock is received at the shop desk, into
// the shop store only: the café's Goods in never lists it.

const data = vi.hoisted(() => ({ counts: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn(), useSearch: () => ({}) }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('./stockKeys', async (importOriginal) => {
  const mod = await importOriginal<typeof StockKeysModule>();
  const ing = (id: string, name: string, kind: string, unit: string) => ({
    id,
    kind,
    name_en: name,
    name_ar: name,
    unit,
    pack_size: null,
    pack_cost_iqd: null,
    supplier_name: null,
    shelf_life_days: null,
    yield_percent: 100,
    waste_allowance_percent: 0,
    par_level: null,
    low_stock_threshold: null,
    is_active: true,
  });
  return {
    ...mod,
    fetchIngredients: async () => [ing('flour', 'Flour', 'purchased', 'g'), ing('water', 'Water bottle', 'retail', 'pc')],
    fetchSuppliers: async () => [],
    fetchUnfinishedCounts: async () => data.counts,
    fetchStaffLogs: async () => [],
  };
});

import { appRpc } from '../../lib/appRpc';
import { ReceiveDelivery } from './ReceiveDelivery';
import { StockScopeProvider } from './stockScope';

const rpc = vi.mocked(appRpc);

function mount(scope: 'venue' | 'shop' = 'venue') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <StockScopeProvider scope={scope}>
          <ReceiveDelivery />
        </StockScopeProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function chooseIngredient(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }));
}

const storeButton = (name: string) => within(screen.getByTestId('goods-in-store')).getByRole('button', { name }) as HTMLButtonElement;

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string) => (fn === 'purchases_to_receive' ? { count: 0, purchases: [] } : { delivery_id: 'd1' }));
  data.counts = [];
});

describe('Goods in ▸ the store', () => {
  it('records into the store picked, the cafe store by default', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('goods-in-store');
    expect(storeButton('Cafe store').getAttribute('aria-pressed')).toBe('true');
    await user.click(storeButton('Bakery store'));
    await chooseIngredient(user, /Flour$/);
    await user.type(screen.getByRole('textbox', { name: /^Received/ }), '5000');
    await user.type(screen.getByRole('textbox', { name: /^Cost per/ }), '1.5');
    await user.click(screen.getByRole('button', { name: 'Record delivery' }));
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === 'receive_delivery')).toBe(true));
    expect(rpc.mock.calls.find(([fn]) => fn === 'receive_delivery')![1]).toMatchObject({ p_location: 'bakery' });
  });

  it('never lists the shop’s products on the café’s Goods in, in either store (0245)', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('goods-in-store');
    expect(within(screen.getByTestId('goods-in-store')).queryByRole('button', { name: 'Shop store' })).toBeNull();
    for (const store of ['Cafe store', 'Bakery store']) {
      await user.click(storeButton(store));
      await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
      const list = within(screen.getByRole('listbox'));
      expect(list.getByRole('option', { name: /Flour$/ })).toBeTruthy();
      expect(list.queryByRole('option', { name: /Water bottle$/ })).toBeNull();
      await user.keyboard('{Escape}');
    }
  });

  it('receives the shop desk’s deliveries into the shop store, shop stock only, with no store to pick', async () => {
    const user = userEvent.setup();
    mount('shop');
    await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
    const list = within(screen.getByRole('listbox'));
    expect(list.getByRole('option', { name: /Water bottle$/ })).toBeTruthy();
    expect(list.queryByRole('option', { name: /Flour$/ })).toBeNull();
    await user.click(list.getByRole('option', { name: /Water bottle$/ }));
    expect(screen.queryByTestId('goods-in-store')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: /^Received/ }), '12');
    await user.type(screen.getByRole('textbox', { name: /^Cost per/ }), '500');
    await user.click(screen.getByRole('button', { name: 'Record delivery' }));
    await waitFor(() => expect(rpc.mock.calls.some(([fn]) => fn === 'receive_delivery')).toBe(true));
    expect(rpc.mock.calls.find(([fn]) => fn === 'receive_delivery')![1]).toMatchObject({ p_location: 'shop' });
    // The café's receipts, driver purchases and staff additions are not the shop desk's.
    expect(rpc.mock.calls.some(([fn]) => fn === 'purchases_to_receive')).toBe(false);
  });

  it('holds Record while a manager counts the store, before the delivery is typed', async () => {
    const user = userEvent.setup();
    data.counts = [{ id: 'c1', location: 'cafe', source: 'operator', started_at: '2026-09-26T07:00:00Z', staff: { display_name: 'Omar' } }];
    mount();
    expect(await screen.findByText(/A count of the cafe store is open/)).toBeTruthy();
    await chooseIngredient(user, /Flour$/);
    await user.type(screen.getByRole('textbox', { name: /^Received/ }), '5000');
    await user.type(screen.getByRole('textbox', { name: /^Cost per/ }), '1.5');
    expect((screen.getByRole('button', { name: 'Record delivery' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTitle('Held until that count is finished or discarded.')).toBeTruthy();
  });
});

// The invoice layout (2026-09-27): each line shows its value, and the foot the
// delivery's total and how many lines arrived short, to tick against the paper.
describe('Goods in ▸ the invoice table', () => {
  it('totals each line and the delivery, and counts the short lines', async () => {
    const user = userEvent.setup();
    mount();
    await chooseIngredient(user, /Flour$/);
    await user.type(screen.getByRole('textbox', { name: /^Received/ }), '5000');
    await user.type(screen.getByRole('textbox', { name: /^Ordered/ }), '6000');
    await user.type(screen.getByRole('textbox', { name: /^Cost per/ }), '1.5');
    const line = screen.getByTestId('goods-in-line');
    expect(within(line).getByText('7,500')).toBeTruthy();
    expect(screen.getByText(/7,500\s*IQD|IQD\s*7,500/)).toBeTruthy();
    expect(screen.getByText('Lines: 1')).toBeTruthy();
    expect(screen.getByText('Short: 1')).toBeTruthy();
  });

  it('shows no waiting row when nothing waits to be received', async () => {
    mount();
    await screen.findByTestId('goods-in-store');
    expect(screen.queryByRole('group', { name: 'Waiting to receive' })).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as StockKeysModule from './stockKeys';

// Goods in ▸ "Put it in: Cafe store / Bakery store" (wave5-addendum-2026-09-25
// §2.8.2 D4, §5.2, V14, M5): every delivery names its store, the cafe store by
// default; shop stock never goes into the bakery store; and a store a manager
// is counting takes no delivery, said before the delivery is typed.

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

const rpc = vi.mocked(appRpc);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ReceiveDelivery />
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

  it('keeps the bakery store off while a shop product is on the delivery, and says why', async () => {
    const user = userEvent.setup();
    mount();
    await chooseIngredient(user, /Water bottle$/);
    expect(storeButton('Bakery store').disabled).toBe(true);
    expect(within(screen.getByTestId('goods-in-store')).getByText(/Shop stock stays in the cafe store/)).toBeTruthy();
  });

  it('leaves the shop’s products out of the list while the bakery store is picked', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByTestId('goods-in-store');
    await user.click(storeButton('Bakery store'));
    await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
    const list = within(screen.getByRole('listbox'));
    expect(list.getByRole('option', { name: /Flour$/ })).toBeTruthy();
    expect(list.queryByRole('option', { name: /Water bottle$/ })).toBeNull();
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
    expect(screen.getByText('Held until that count is finished or discarded.')).toBeTruthy();
  });
});

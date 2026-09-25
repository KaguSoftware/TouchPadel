import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import type * as AuthModule from '../../../lib/auth';
import type * as StockKeysModule from '../stockKeys';
import type { ShopCatalogue } from '../stockKeys';

// Stock ▸ Products for a manager (build-contracts-2026-09-23 §5.5, #51, #53):
// a product on sale keeps its prices and offers "Change the price" in place
// of "Add size"; a hidden draft keeps its prices editable and offers "Put on
// sale"; a new product is saved hidden. The owner's screen is unchanged.

const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
const who = vi.hoisted(() => ({ role: 'manager' }));
const stock = vi.hoisted(() => ({ catalogue: null as unknown }));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: rpc.appRpc,
}));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, useAuth: () => ({ staff: { role: who.role } }) };
});
vi.mock('../stockKeys', async (importOriginal) => {
  const mod = await importOriginal<typeof StockKeysModule>();
  return {
    ...mod,
    fetchShopCatalogue: async () => stock.catalogue,
    fetchIngredients: async () => [],
    fetchOnHand: async () => [],
    fetchSuppliers: async () => [],
  };
});

import { ProductsAdmin } from './ProductsAdmin';

const ON_SALE = 'b0000000-0000-4000-8000-000000000001';
const DRAFT = 'b0000000-0000-4000-8000-000000000002';
const size = (id: string, item: string, price: number) => ({
  id,
  item_id: item,
  name_en: 'One size',
  name_ar: 'مقاس واحد',
  price_iqd: price,
  is_default: true,
  sort_order: 0,
  sku: null,
  barcode: null,
});
const catalogue: ShopCatalogue = {
  sections: [{ id: 's1', name_en: 'Rackets', name_ar: 'مضارب', is_active: true }],
  products: [
    { id: ON_SALE, category_id: 's1', name_en: 'Vertex', name_ar: 'فيرتكس', is_active: true, launched_at: '2026-03-01T09:00:00Z', sort_order: 0, menu_item_variants: [size('v1', ON_SALE, 290_000)] },
    { id: DRAFT, category_id: 's1', name_en: 'Hack', name_ar: 'هاك', is_active: false, launched_at: null, sort_order: 1, menu_item_variants: [size('v2', DRAFT, 310_000)] },
  ],
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ProductsAdmin />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const row = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  rpc.appRpc.mockReset();
  rpc.appRpc.mockResolvedValue('new-item');
  nav.navigate.mockReset();
  who.role = 'manager';
  stock.catalogue = catalogue;
});

describe('ProductsAdmin as a manager', () => {
  it('offers Change the price on a product on sale and Put on sale on a hidden draft', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Vertex');
    expect(screen.getByText(/Prices of products on sale change through/)).toBeTruthy();

    expect(within(row('Vertex')).queryByRole('button', { name: 'Add size' })).toBeNull();
    await user.click(within(row('Vertex')).getByRole('button', { name: 'Change the price: Vertex' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'price', item: ON_SALE } });

    // A draft's sizes and prices are still the manager's.
    expect(within(row('Hack')).getByRole('button', { name: 'Add size' })).toBeTruthy();
    await user.click(within(row('Hack')).getByRole('button', { name: 'Put on sale: Hack' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'shop_launch', item: DRAFT } });
  });

  it('keeps the price read-only when editing a product on sale, and the rest editable', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Vertex');
    await user.click(within(row('Vertex')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Price (IQD)') as HTMLInputElement).disabled).toBe(true);
    expect((within(dialog).getByLabelText(/^SKU/) as HTMLInputElement).disabled).toBe(false);
    expect(within(dialog).getByText(/This product is on sale/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Change the price' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'price', item: ON_SALE } });
  });

  it('saves a new product hidden', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Vertex');
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/A new product is saved hidden/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Product name (English)'), 'Wilson');
    await user.type(within(dialog).getByLabelText('Product name (Arabic)'), 'ويلسون');
    await user.type(within(dialog).getByLabelText('Price (IQD)'), '250000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_menu_item', expect.objectContaining({ p_name_en: 'Wilson', p_is_active: false })));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_retail_variant', expect.objectContaining({ p_item_id: 'new-item', p_price_iqd: 250_000 })));
  });
});

describe('ProductsAdmin as the owner', () => {
  it('is unchanged: Add size everywhere, no starts, a new product saved as before', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    renderScreen();
    await screen.findByText('Vertex');
    expect(screen.queryByText(/Prices of products on sale change through/)).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Add size' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Change the price/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Put on sale/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Product name (English)'), 'Wilson');
    await user.type(within(dialog).getByLabelText('Product name (Arabic)'), 'ويلسون');
    await user.type(within(dialog).getByLabelText('Price (IQD)'), '250000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_menu_item', expect.not.objectContaining({ p_is_active: false })));
  });
});

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
const stock = vi.hoisted(() => ({ catalogue: null as unknown, watches: [] as unknown[], ingredients: [] as unknown[], watchesGate: Promise.resolve() }));
const confirmSpy = vi.hoisted(() => vi.fn(async () => true));

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => nav.navigate }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => confirmSpy }));
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
    fetchIngredients: async () => stock.ingredients,
    fetchOnHand: async () => [],
    fetchSuppliers: async () => [],
  };
});
vi.mock('../../shop/priceWatch/priceWatchData', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPriceWatches: async () => {
    await stock.watchesGate;
    return stock.watches;
  },
}));

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
  stock.watches = [];
  stock.ingredients = [];
  stock.watchesGate = Promise.resolve();
  confirmSpy.mockClear();
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
    // The locked price reads as a figure beside a lock, never a box that looks editable.
    const price = within(dialog).getByRole('group', { name: 'Price (IQD)' });
    expect(within(price).queryByRole('textbox')).toBeNull();
    expect(price.textContent).toMatch(/290,000/);
    expect((within(dialog).getByLabelText(/^SKU/) as HTMLInputElement).disabled).toBe(false);
    expect(within(dialog).getByText(/This product is on sale/)).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Change the price' }));
    expect(nav.navigate).toHaveBeenLastCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'price', item: ON_SALE } });
  });

  // Wave 5 (wave5-addendum-2026-09-25 §2.2, #9): a size on sale is renamed
  // through a price change, so its names lock with its price and go back as
  // stored; a draft's stay the manager's.
  it("locks a size on sale's names with its price, and sends them back as stored", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Vertex');
    await user.click(within(row('Vertex')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    // Read as text, not as greyed boxes.
    expect(within(dialog).getByRole('group', { name: 'Size (English)' }).textContent).toContain('One size');
    expect(within(dialog).getByRole('group', { name: 'Size (Arabic)' }).textContent).toContain('مقاس واحد');
    expect(within(dialog).queryByRole('textbox', { name: 'Size (English)' })).toBeNull();
    expect(within(dialog).getByText(/its sizes’ prices and names change through “Change the price”/)).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/^SKU/), 'VX-1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith(
        'upsert_retail_variant',
        expect.objectContaining({ p_name_en: 'One size', p_name_ar: 'مقاس واحد', p_price_iqd: 290_000 }),
      ),
    );
  });

  it("leaves a hidden draft's size names editable", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Size (English)') as HTMLInputElement).disabled).toBe(false);
  });

  it('says where a rename goes when the server refuses one', async () => {
    const user = userEvent.setup();
    const { AppRpcError } = await import('../../../lib/appRpc');
    rpc.appRpc.mockRejectedValue(new AppRpcError('PRICE_VIA_PROTOCOL', 'PRICE_VIA_PROTOCOL', 'name'));
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Size (English)'), ' 2');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText('Renaming a size or an option that is on sale goes through “Change the price”, with the owner’s OK.'),
    ).toBeTruthy();
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

// Supplier price watch (0322): the shop desk PC read a supplier price that is
// not the shop's; Products lists it, "Apply new price" fills it into the size
// form, and the size form keeps the supplier link.
const watchRow = (variant_id: string, part: Record<string, unknown> = {}) => ({
  variant_id,
  url: `https://supplier.example.iq/p/${variant_id}`,
  supplier_price_iqd: null,
  previous_price_iqd: null,
  price_changed_at: null,
  checked_at: null,
  read_ok_at: null,
  last_error: null,
  ...part,
});

describe('ProductsAdmin supplier price watch', () => {
  beforeEach(() => {
    rpc.appRpc.mockImplementation(async (fn: string) =>
      fn === 'upsert_menu_item' ? 'new-item' : fn === 'upsert_retail_variant' ? { variant_id: 'new-size', ingredient_id: 'ing' } : { variant_id: 'x', url: null },
    );
  });

  it('lists a changed supplier price, marks the row, and Apply fills the price in for Save', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    stock.watches = [
      watchRow('v1', { supplier_price_iqd: 300_000, previous_price_iqd: 290_000, price_changed_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T09:00:00Z', read_ok_at: '2026-10-08T09:00:00Z' }),
      // Same as the shop price: nothing to do.
      watchRow('v2', { supplier_price_iqd: 310_000, checked_at: '2026-10-08T09:00:00Z', read_ok_at: '2026-10-08T09:00:00Z' }),
    ];
    renderScreen();
    const panel = await screen.findByTestId('supplier-price-alerts');
    expect(within(panel).getByText('Supplier price changes')).toBeTruthy();
    expect(within(panel).queryByTestId('supplier-price-alert-v2')).toBeNull();
    const alert = within(panel).getByTestId('supplier-price-alert-v1');
    expect(alert.textContent).toMatch(/290,000/);
    expect(alert.textContent).toMatch(/300,000/);
    expect(within(row('Hack')).queryByText(/^Supplier price:/)).toBeNull();
    expect(screen.getAllByText('Supplier price: 300,000 IQD').length).toBeGreaterThan(0);

    await user.click(within(alert).getByRole('button', { name: 'Apply new price: Vertex · One size' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Price (IQD)') as HTMLInputElement).value).toBe('300000');
    expect(within(dialog).getByText('Supplier’s new price filled in (was 290,000 IQD). Save to apply.')).toBeTruthy();
    // The stored link and what the shop desk PC read from it.
    expect((within(dialog).getByLabelText(/^Supplier link/) as HTMLInputElement).value).toBe('https://supplier.example.iq/p/v1');
    expect(within(dialog).getByTestId('supplier-link-status').textContent).toMatch(/Price read: 300,000 IQD/);

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith('upsert_retail_variant', expect.objectContaining({ p_id: 'v1', p_price_iqd: 300_000, p_name_en: 'One size' })),
    );
    // The link did not change, so the watch is left alone.
    expect(rpc.appRpc).not.toHaveBeenCalledWith('set_shop_price_watch', expect.anything());
  });

  it("offers the price change protocol, not Apply, where the manager's price is locked", async () => {
    stock.watches = [
      watchRow('v1', { supplier_price_iqd: 300_000, price_changed_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T09:00:00Z' }),
      watchRow('v2', { supplier_price_iqd: 320_000, price_changed_at: '2026-10-08T08:00:00Z', checked_at: '2026-10-08T09:00:00Z' }),
    ];
    renderScreen();
    const panel = await screen.findByTestId('supplier-price-alerts');
    const onSale = within(panel).getByTestId('supplier-price-alert-v1');
    expect(within(onSale).queryByRole('button', { name: /^Apply new price/ })).toBeNull();
    expect(within(onSale).getByText('The owner or the shop staff apply a supplier’s price.')).toBeTruthy();
    expect(within(onSale).getByRole('button', { name: 'Change the price: Vertex · One size' })).toBeTruthy();
    // A hidden draft's price is still the manager's own.
    expect(within(within(panel).getByTestId('supplier-price-alert-v2')).getByRole('button', { name: 'Apply new price: Hack · One size' })).toBeTruthy();
  });

  it("saves a size's supplier link with set_shop_price_watch, and checks it first", async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByLabelText(/^Supplier link/) as HTMLInputElement;
    expect(link.getAttribute('dir')).toBe('ltr');

    await user.type(link, 'http://supplier.example.iq/p/hack');
    expect(within(dialog).getByText('The link must start with https://')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).getAttribute('aria-disabled') === 'true' || (within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(link);
    await user.type(link, 'https://supplier.example.iq/p/hack');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith('set_shop_price_watch', { p_variant_id: 'v2', p_url: 'https://supplier.example.iq/p/hack' }),
    );
    // After the size itself (this one has no stock row yet, so it is saved too), never before.
    const order = rpc.appRpc.mock.calls.map((c) => c[0]);
    expect(order.indexOf('upsert_retail_variant')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('upsert_retail_variant')).toBeLessThan(order.indexOf('set_shop_price_watch'));
  });

  it('a link-only edit saves the link and leaves the size alone', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    stock.ingredients = [
      { id: 'ing2', kind: 'retail', name_en: 'Hack', name_ar: 'هاك', unit: 'pc', pack_size: null, pack_cost_iqd: null, supplier_name: null, shelf_life_days: null, yield_percent: 100, waste_allowance_percent: 0, par_level: null, low_stock_threshold: null, is_active: true, variant_id: 'v2' },
    ];
    stock.watches = [watchRow('v2')];
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByLabelText(/^Supplier link/) as HTMLInputElement;
    await user.clear(link);
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('set_shop_price_watch', { p_variant_id: 'v2', p_url: null }));
    expect(rpc.appRpc).not.toHaveBeenCalledWith('upsert_retail_variant', expect.anything());
  });

  it("links a new product's first size by the id the save returns", async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    renderScreen();
    await screen.findByText('Vertex');
    await user.click(screen.getByRole('button', { name: 'New product' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Product name (English)'), 'Wilson');
    await user.type(within(dialog).getByLabelText('Product name (Arabic)'), 'ويلسون');
    await user.type(within(dialog).getByLabelText('Price (IQD)'), '250000');
    await user.type(within(dialog).getByLabelText(/^Supplier link/), 'https://supplier.example.iq/p/wilson');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(rpc.appRpc).toHaveBeenCalledWith('set_shop_price_watch', { p_variant_id: 'new-size', p_url: 'https://supplier.example.iq/p/wilson' }),
    );
  });

  it('says under the link when the server refuses it, and keeps an edited size open', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    const { AppRpcError } = await import('../../../lib/appRpc');
    rpc.appRpc.mockImplementation(async (fn: string) => {
      if (fn === 'set_shop_price_watch') throw new AppRpcError('SUPPLIER_URL_INVALID', 'SUPPLIER_URL_INVALID');
      return { variant_id: 'v2', ingredient_id: 'ing' };
    });
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Supplier link/), 'https://supplier.example.iq/p/hack');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('This is not a product page link. Copy it from the browser’s address bar.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('says in words why the last read failed', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    stock.watches = [watchRow('v2', { checked_at: '2026-10-08T09:00:00Z', last_error: 'ambiguous' })];
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('supplier-link-status').textContent).toMatch(/more than one price/);
  });
  it('Apply then Cancel leaves without asking; an edit made here still asks', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    stock.watches = [watchRow('v2', { supplier_price_iqd: 320_000, price_changed_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T09:00:00Z' })];
    renderScreen();
    const panel = await screen.findByTestId('supplier-price-alerts');
    await user.click(within(panel).getByRole('button', { name: 'Apply new price: Hack · One size' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirmSpy).not.toHaveBeenCalled();

    await user.click(within(panel).getByRole('button', { name: 'Apply new price: Hack · One size' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^SKU/), 'H1');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
  });

  it('a link that loads after the form opened fills the field and is not removed on Save', async () => {
    const user = userEvent.setup();
    who.role = 'owner';
    let release!: () => void;
    stock.watchesGate = new Promise<void>((r) => (release = r));
    stock.watches = [watchRow('v2', { supplier_price_iqd: 310_000, checked_at: '2026-10-08T09:00:00Z', read_ok_at: '2026-10-08T09:00:00Z' })];
    renderScreen();
    await screen.findByText('Hack');
    await user.click(within(row('Hack')).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByLabelText(/^Supplier link/) as HTMLInputElement;
    expect(link.value).toBe('');
    release();
    await waitFor(() => expect(link.value).toBe('https://supplier.example.iq/p/v2'));
    expect(within(dialog).getByTestId('supplier-link-status')).toBeTruthy();
    await user.clear(within(dialog).getByLabelText('Price (IQD)'));
    await user.type(within(dialog).getByLabelText('Price (IQD)'), '315000');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_retail_variant', expect.objectContaining({ p_id: 'v2', p_price_iqd: 315_000 })));
    expect(rpc.appRpc).not.toHaveBeenCalledWith('set_shop_price_watch', expect.anything());
  });

  it('marks a size whose link could not be read, and says so beside a listed change', async () => {
    who.role = 'owner';
    stock.watches = [
      watchRow('v1', { checked_at: '2026-10-08T10:00:00Z', last_error: 'no_price' }),
      watchRow('v2', { supplier_price_iqd: 320_000, price_changed_at: '2026-10-08T09:00:00Z', read_ok_at: '2026-10-08T09:00:00Z', checked_at: '2026-10-08T10:00:00Z', last_error: 'http_error' }),
    ];
    renderScreen();
    const panel = await screen.findByTestId('supplier-price-alerts');
    // v1 never read a price: no alert, but its row says the link is not read.
    expect(within(panel).queryByTestId('supplier-price-alert-v1')).toBeNull();
    expect(within(row('Vertex')).getByText('Supplier link not read')).toBeTruthy();
    // v2 has a change to apply; its latest read failed, and the panel says so.
    expect(within(row('Hack')).queryByText('Supplier link not read')).toBeNull();
    expect(within(panel).getByTestId('supplier-price-alert-failed-v2').textContent).toMatch(/refused the page/);
    expect(within(panel).getByRole('button', { name: 'Apply new price: Hack · One size' })).toBeTruthy();
  });
});

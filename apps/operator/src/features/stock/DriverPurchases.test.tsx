import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Goods in ▸ "Bought by the driver": the driver's purchases, and one of them
// received into stock in one call. The lines are the driver's; the manager
// says only what arrived and when it expires.

const navigate = vi.hoisted(() => vi.fn());
const confirm = vi.hoisted(() => vi.fn(async () => true));
/** Counts not yet applied (wave 5): a manager's open count holds its store. */
const openCounts = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => confirm }));
vi.mock('../../lib/supabase', () => {
  // Ingredients (for the shelf-life hint) and suppliers are plain reads.
  const rows: Record<string, unknown[]> = {
    ingredients: [
      { id: 'ing-milk', kind: 'purchased', name_en: 'Milk', name_ar: 'حليب', unit: 'ml', shelf_life_days: 5, is_active: true },
      // Shop stock (wave 5): it lives in the cafe store only.
      { id: 'ing-water', kind: 'retail', name_en: 'Water bottle', name_ar: 'قنينة ماء', unit: 'pc', shelf_life_days: null, is_active: true },
    ],
    suppliers: [],
  };
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.is = () => chain;
    chain.order = () => Promise.resolve({ data: table === 'stock_counts' ? openCounts.rows : (rows[table] ?? []), error: null });
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { AppRpcError } from '../../lib/appRpc';
import { DriverPurchaseReceive, DriverPurchasesPanel } from './DriverPurchases';

const rpc = vi.mocked(appRpc);

const line = (over: Record<string, unknown>) => ({
  id: 'l-milk',
  ingredient_id: 'ing-milk',
  ingredient_active: true,
  name_en: 'Milk',
  name_ar: 'حليب',
  unit: 'ml',
  pack_size: 1000,
  label: null,
  qty: 2000,
  price_iqd: 6000,
  status: 'to_receive',
  ...over,
});

const purchase = (lines: unknown[], over: Record<string, unknown> = {}) => ({
  id: 'p1',
  staff_name: 'Dev Driver',
  bought_at: '2026-09-25T07:30:00Z',
  shop_name: 'Al-Noor market',
  total_iqd: 9500,
  receipt_path: null,
  delivered_at: null,
  delivered_by_name: null,
  lines,
  ...over,
});

let payload: unknown;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

function mount(node: React.ReactNode) {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args: args ?? {} });
    if (fn === 'purchases_to_receive') {
      if (payload instanceof Error) throw payload;
      return payload;
    }
    return { delivery_id: 'd1', received_line_ids: ['l-milk'] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>{node}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  confirm.mockClear();
  calls.length = 0;
  openCounts.rows = [];
});

// The payload reader, line kinds, draft checks and unit cost are node-tested
// in driverPurchasesLogic.test.ts; the keystroke filter in decimalInput.test.ts.

describe('DriverPurchasesPanel', () => {
  it('lists what the driver bought, and opens one to receive it', async () => {
    payload = { count: 1, purchases: [purchase([line({}), line({ id: 'l-bags', ingredient_id: null, ingredient_active: null, label: 'Bin bags', unit: 'pack', qty: 1, price_iqd: 3500 })])] };
    mount(<DriverPurchasesPanel />);
    const panel = await screen.findByTestId('driver-purchases');
    // Name and shop are isolated one by one, so an Arabic line keeps them in order.
    expect(within(panel).getByRole('listitem').textContent).toContain('Dev Driver · Al-Noor market');
    expect(within(panel).getByText(/Items: 2/)).toBeTruthy();
    expect(within(panel).getByText('1 to receive')).toBeTruthy();
    await userEvent.click(within(panel).getByRole('button', { name: 'Receive' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/receive', search: { purchase: 'p1' } });
  });

  it('says which purchases the driver confirmed as delivered, and offers Receive on both', async () => {
    payload = {
      count: 2,
      purchases: [
        purchase([line({})], { delivered_at: '2026-09-25T08:05:00Z', delivered_by_name: 'Dev Driver' }),
        purchase([line({ id: 'l-2' })], { id: 'p2', shop_name: 'Baghdad Mall' }),
      ],
    };
    mount(<DriverPurchasesPanel />);
    const panel = await screen.findByTestId('driver-purchases');
    const [first, second] = within(panel).getAllByRole('listitem');
    expect(within(first!).getByText(/^Delivered 11:05\sAM by .Dev Driver.$/)).toBeTruthy();
    expect(within(second!).getByText('Delivery not confirmed yet')).toBeTruthy();
    // Receiving never waits for the confirmation.
    expect(within(second!).getByRole('button', { name: 'Receive' })).toBeTruthy();
    expect(within(first!).getByRole('button', { name: 'Receive' })).toBeTruthy();
  });

  it('shows nothing when there is nothing to receive', async () => {
    payload = { count: 0, purchases: [] };
    mount(<DriverPurchasesPanel />);
    await waitFor(() => expect(calls.some((c) => c.fn === 'purchases_to_receive')).toBe(true));
    expect(screen.queryByTestId('driver-purchases')).toBeNull();
  });
});

describe('DriverPurchaseReceive', () => {
  it('prefills what was bought, and receives the stock lines in one call with a key', async () => {
    payload = { count: 1, purchases: [purchase([line({}), line({ id: 'l-bags', ingredient_id: null, ingredient_active: null, label: 'Bin bags', unit: 'pack', qty: 1, price_iqd: 3500 })])] };
    const onBack = vi.fn();
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={onBack} />);
    const box = (await screen.findByLabelText(/^Received/)) as HTMLInputElement;
    expect(box.value).toBe('2000');
    expect(screen.getByText(/Paid 6,000 IQD, 3 IQD per ml/)).toBeTruthy();
    await userEvent.clear(box);
    await userEvent.type(box, '1500');
    expect(screen.getByText('Short by 500')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Receive into stock' }));
    await waitFor(() => expect(calls.some((c) => c.fn === 'receive_purchase')).toBe(true));
    const call = calls.find((c) => c.fn === 'receive_purchase')!;
    expect(call.args).toMatchObject({
      p_purchase_id: 'p1',
      p_lines: [{ purchase_line_id: 'l-milk', qty_received: 1500, expiry_date: null }],
      p_supplier_id: null,
      p_supplier_name: null,
    });
    expect(String(call.args.p_idempotency_key)).toMatch(/^purchase\.receive:/);
    // The bin bags are still to check, so the page stays on this purchase.
    expect(onBack).not.toHaveBeenCalled();
  });

  it('receives into the cafe store unless the manager picks the bakery store (wave 5)', async () => {
    payload = { count: 1, purchases: [purchase([line({})])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const picker = await screen.findByTestId('purchase-store');
    expect(within(picker).getByRole('button', { name: 'Cafe store' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(picker).getByRole('button', { name: 'Bakery store' }));
    await userEvent.click(screen.getByRole('button', { name: 'Receive into stock' }));
    await waitFor(() => expect(calls.some((c) => c.fn === 'receive_purchase')).toBe(true));
    expect(calls.find((c) => c.fn === 'receive_purchase')!.args).toMatchObject({ p_location: 'bakery' });
  });

  it('keeps the bakery store off while shop stock is on the purchase, and says why', async () => {
    payload = { count: 1, purchases: [purchase([line({}), line({ id: 'l-water', ingredient_id: 'ing-water', name_en: 'Water bottle', unit: 'pc', qty: 24, price_iqd: 6000 })])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const picker = await screen.findByTestId('purchase-store');
    await waitFor(() => expect((within(picker).getByRole('button', { name: 'Bakery store' }) as HTMLButtonElement).disabled).toBe(true));
    expect(within(picker).getByText(/Shop stock stays in the cafe store/)).toBeTruthy();
  });

  it('holds Receive while a manager counts the store it goes into', async () => {
    openCounts.rows = [{ id: 'c1', location: 'cafe', source: 'operator', started_at: '2026-09-25T07:00:00Z', staff: { display_name: 'Omar' } }];
    payload = { count: 1, purchases: [purchase([line({})])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    expect(await screen.findByText(/A count of the cafe store is open/)).toBeTruthy();
    const receive = screen.getByRole('button', { name: 'Receive into stock' }) as HTMLButtonElement;
    expect(receive.disabled).toBe(true);
    expect(screen.getByTitle('Held until that count is finished or discarded.')).toBeTruthy();
    // The bakery store is not being counted: picking it lets the purchase in.
    await userEvent.click(within(screen.getByTestId('purchase-store')).getByRole('button', { name: 'Bakery store' }));
    expect((screen.getByRole('button', { name: 'Receive into stock' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says on the purchase whether the delivery was confirmed', async () => {
    payload = { count: 1, purchases: [purchase([line({})], { delivered_at: '2026-09-25T08:05:00Z', delivered_by_name: 'Dev Manager' })] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    expect(await screen.findByText('Delivery')).toBeTruthy();
    expect(screen.getByText(/^Delivered 11:05\sAM by .Dev Manager.$/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Receive into stock' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('holds the receive while a switched-off line is not yet checked, and checks it after asking', async () => {
    payload = { count: 1, purchases: [purchase([line({}), line({ id: 'l-off', name_en: 'Oat milk', ingredient_active: false })])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const receive = await screen.findByRole('button', { name: 'Receive into stock' });
    expect((receive as HTMLButtonElement).disabled).toBe(true);
    // Listed in Into stock, above the button it holds, not in a panel below it.
    expect(within(receive.closest('section')!).getByText(/switched off after it was bought/)).toBeTruthy();
    expect(screen.queryByText('Not for stock')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mark checked' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(calls.find((c) => c.fn === 'acknowledge_purchase_line')?.args).toEqual({ p_line_id: 'l-off' }));
  });

  it('shows a failed Mark checked under that line, not beside Receive into stock', async () => {
    payload = { count: 1, purchases: [purchase([line({}), line({ id: 'l-bags', ingredient_id: null, ingredient_active: null, label: 'Bin bags', unit: 'pack', qty: 1 })])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const receive = await screen.findByRole('button', { name: 'Receive into stock' });
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'purchases_to_receive') return payload;
      throw new AppRpcError('UNKNOWN', 'network down');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Mark checked' }));
    const row = document.querySelector('[data-line="l-bags"]') as HTMLElement;
    expect(await within(row).findByRole('alert')).toBeTruthy();
    expect(within(receive.closest('section')!).queryByRole('alert')).toBeNull();
  });

  it('goes back to Goods in once the last line is checked', async () => {
    payload = { count: 1, purchases: [purchase([line({ id: 'l-bags', ingredient_id: null, ingredient_active: null, label: 'Bin bags', unit: 'pack', qty: 1 })])] };
    const onBack = vi.fn();
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={onBack} />);
    expect(screen.queryByRole('button', { name: 'Receive into stock' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Mark checked' }));
    // A line that is not stock is checked without a question.
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('says so when the purchase is no longer waiting', async () => {
    payload = { count: 0, purchases: [] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    expect(await screen.findByText('This purchase is not waiting to be received')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says a failed read failed, offers a retry, and never claims the purchase was received', async () => {
    payload = new AppRpcError('UNKNOWN', 'network down');
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const failed = await screen.findByTestId('driver-purchase-read-failed');
    expect(screen.queryByText('This purchase is not waiting to be received')).toBeNull();
    // The read comes back: the retry reads again and the purchase opens.
    payload = { count: 1, purchases: [purchase([line({})])] };
    await userEvent.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Receive into stock' })).toBeTruthy();
    expect(calls.filter((c) => c.fn === 'purchases_to_receive')).toHaveLength(2);
  });

  it('reads digits typed on an Arabic keyboard, and stops an extra-zero typo at ten digits', async () => {
    payload = { count: 1, purchases: [purchase([line({})])] };
    mount(<DriverPurchaseReceive purchaseId="p1" onBack={vi.fn()} />);
    const box = (await screen.findByLabelText(/^Received/)) as HTMLInputElement;
    await userEvent.clear(box);
    await userEvent.type(box, '١٥٠٠');
    expect(box.value).toBe('1500');
    expect(screen.getByText('Short by 500')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Receive into stock' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.clear(box);
    await userEvent.type(box, '123456789012');
    expect(box.value).toBe('1234567890');
  });
});

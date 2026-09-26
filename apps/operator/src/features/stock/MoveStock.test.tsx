import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as StockKeysModule from './stockKeys';

// Stock ▸ Move stock (wave5-addendum-2026-09-25 §2.8.2 D6, §5.2, §7.4): one
// direction control, lines of what was moved with what the source store
// shows, app.transfer_stock with one key per move, and the first day's
// opening-move call-out. The server stays the wall: these pin what the form
// says before it asks.

const navigate = vi.hoisted(() => vi.fn());
const data = vi.hoisted(() => ({
  transferCount: 0,
  transfers: [] as unknown[],
  counts: [] as unknown[],
  byStore: [] as unknown[],
  ingredients: [] as unknown[],
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('./stockKeys', async (importOriginal) => {
  const mod = await importOriginal<typeof StockKeysModule>();
  return {
    ...mod,
    fetchIngredients: async () => data.ingredients,
    fetchByStore: async () => data.byStore,
    fetchTransferCount: async () => data.transferCount,
    fetchTransfers: async () => data.transfers,
    fetchUnfinishedCounts: async () => data.counts,
  };
});

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { MoveStock } from './MoveStock';

const rpc = vi.mocked(appRpc);

const ingredient = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'purchased',
  name_en: name,
  name_ar: name,
  unit: 'g',
  pack_size: null,
  pack_cost_iqd: null,
  supplier_name: null,
  shelf_life_days: null,
  yield_percent: 100,
  waste_allowance_percent: 0,
  par_level: null,
  low_stock_threshold: null,
  is_active: true,
  ...over,
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <MoveStock />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
  await user.click(within(screen.getByRole('listbox')).getByRole('option', { name }));
}

beforeEach(() => {
  rpc.mockReset();
  navigate.mockReset();
  data.transferCount = 0;
  data.transfers = [];
  data.counts = [];
  data.ingredients = [
    ingredient('flour', 'Flour', { pack_size: 1000 }),
    ingredient('milk', 'Milk', { unit: 'ml' }),
    ingredient('water', 'Water bottle', { kind: 'retail', unit: 'pc' }),
    ingredient('old', 'Old syrup', { is_active: false }),
  ];
  data.byStore = [
    { ingredient_id: 'flour', location: 'cafe', on_hand: 5000 },
    { ingredient_id: 'flour', location: 'bakery', on_hand: 0 },
    { ingredient_id: 'milk', location: 'cafe', on_hand: 800 },
    { ingredient_id: 'water', location: 'cafe', on_hand: 24 },
  ];
});

describe('Move stock', () => {
  it('asks for the opening move on the first day only', async () => {
    mount();
    expect(await screen.findByTestId('move-first-day')).toBeTruthy();
    expect(screen.getByText('First day with two stores')).toBeTruthy();
  });

  it('hides the first-day call-out once a move was recorded', async () => {
    data.transferCount = 3;
    mount();
    await screen.findByTestId('move-form');
    await waitFor(() => expect(screen.getByTestId('recent-moves')).toBeTruthy());
    expect(screen.queryByTestId('move-first-day')).toBeNull();
  });

  it('offers only what the source store holds, never shop stock or a switched-off item', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('combobox', { name: 'Ingredient' }));
    const list = within(screen.getByRole('listbox'));
    expect(list.getByRole('option', { name: 'Flour' })).toBeTruthy();
    expect(list.getByRole('option', { name: 'Milk' })).toBeTruthy();
    expect(list.queryByRole('option', { name: 'Water bottle' })).toBeNull();
    expect(list.queryByRole('option', { name: 'Old syrup' })).toBeNull();
  });

  it('says early when a line is more than the source shows, and holds Move', async () => {
    const user = userEvent.setup();
    mount();
    await pick(user, 'Flour');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '6000');
    expect(await screen.findByText('More than the cafe store shows (5,000 g). Move what it shows, or count it first.')).toBeTruthy();
    expect((screen.getByTestId('move-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('moves the lines with one key, kept across a retry and renewed after the move', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let first = true;
    rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
      expect(fn).toBe('transfer_stock');
      keys.push(String(args?.p_idempotency_key));
      if (first) {
        first = false;
        throw new AppRpcError('UNKNOWN', 'network down');
      }
      return { transfer_id: 't1' };
    });
    mount();
    await pick(user, 'Flour');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '2');
    // Flour comes in packs of 1 kg: move two packs.
    await user.click(screen.getByRole('button', { name: /Packs of/ }));
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1]![1]).toEqual({
      p_from: 'cafe',
      p_to: 'bakery',
      p_lines: [{ ingredient_id: 'flour', qty: 2, unit: 'pack' }],
      p_idempotency_key: keys[0],
    });
    expect(keys[0]).toMatch(/^stock\.move:/);
    expect(keys[1]).toBe(keys[0]);
    // The form resets, and the next move gets a key of its own.
    await waitFor(() => expect((screen.getByRole('textbox', { name: /Quantity/ }) as HTMLInputElement).value).toBe(''));
    await pick(user, 'Milk');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '100');
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(keys[2]).toMatch(/^stock\.move:/);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('gives an edited move a key of its own after a lost answer, so it is never replayed as the first', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    rpc.mockImplementation(async (_fn: string, args?: Record<string, unknown>) => {
      keys.push(String(args?.p_idempotency_key));
      if (keys.length === 1) throw new AppRpcError('UNKNOWN', 'network down');
      return { transfer_id: 't1' };
    });
    mount();
    await pick(user, 'Milk');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '10');
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    // The answer was lost; the line is changed before sending again.
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '0');
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_lines: [{ ingredient_id: 'milk', qty: 100 }] });
    expect(keys[1]).toMatch(/^stock\.move:/);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('turns the direction with one control, so the two stores are never the same', async () => {
    const user = userEvent.setup();
    data.byStore = [...data.byStore, { ingredient_id: 'milk', location: 'bakery', on_hand: 300 }];
    rpc.mockResolvedValue({ transfer_id: 't2' });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Bakery store to cafe store' }));
    await pick(user, 'Milk');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '300');
    await user.click(screen.getByTestId('move-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_from: 'bakery', p_to: 'cafe', p_lines: [{ ingredient_id: 'milk', qty: 300 }] });
  });

  it('shows what the store showed when the server refuses a line (TRANSFER_SHORT)', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValue(new AppRpcError('TRANSFER_SHORT', 'short', 'flour', '1500'));
    mount();
    await pick(user, 'Flour');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '2000');
    await user.click(screen.getByTestId('move-submit'));
    // The server's figure, not the one the form read before the move.
    expect(await screen.findByText('More than the cafe store shows (1,500 g). Move what it shows, or count it first.')).toBeTruthy();
  });

  it('holds every move while a manager counts either store, and points at the count', async () => {
    const user = userEvent.setup();
    data.counts = [{ id: 'c1', location: 'bakery', source: 'operator', started_at: '2026-09-26T07:00:00Z', staff: { display_name: 'Omar' } }];
    mount();
    expect(await screen.findByText('Moves wait while the bakery store is being counted. Finish or discard that count first.')).toBeTruthy();
    await pick(user, 'Flour');
    await user.type(screen.getByRole('textbox', { name: /Quantity/ }), '100');
    expect((screen.getByTestId('move-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Held until that count is finished or discarded.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open the count' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/counts' });
  });

  it('never holds a move for a phone count waiting for a manager', async () => {
    data.counts = [{ id: 'c2', location: 'bakery', source: 'phone', started_at: '2026-09-26T07:00:00Z', staff: { display_name: 'Tiba' } }];
    mount();
    await screen.findByTestId('move-form');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Ingredient' })).toBeTruthy());
    expect(screen.queryByText(/Moves wait while/)).toBeNull();
  });

  it('says the source store holds nothing on record, and where stock comes in', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Bakery store to cafe store' }));
    expect(await screen.findByText('Nothing is on record in the bakery store')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open Goods in' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/receive' });
  });

  it('lists the recent moves with who moved what, and no cost', async () => {
    data.transferCount = 1;
    data.transfers = [
      {
        id: 't9',
        from_location: 'cafe',
        to_location: 'bakery',
        moved_at: '2026-09-26T07:30:00Z',
        staff: { display_name: 'Hasan' },
        stock_transfer_lines: [{ ingredient_id: 'flour', qty: 2000 }],
      },
    ];
    mount();
    const recent = await screen.findByTestId('recent-moves');
    expect(await within(recent).findByText('Hasan')).toBeTruthy();
    expect(within(recent).getByText('Cafe store to bakery store')).toBeTruthy();
    expect(within(recent).getByText(/Flour 2,000 g/)).toBeTruthy();
    expect(recent.textContent).not.toMatch(/IQD/);
  });
});

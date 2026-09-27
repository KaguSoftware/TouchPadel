import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Waste and production's "Made today": every batch recorded this business day,
// here or on the kitchen's phones (app.production_log_today), with no cost.

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/mutate', () => ({ mutate: vi.fn() }));
// Reads by table: the ingredients and what each store holds (wave 5); empty unless a case fills them.
const tables = vi.hoisted(() => ({ rows: {} as Record<string, unknown[]> }));
vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => Promise.resolve({ data: tables.rows[table] ?? [], error: null });
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { WasteAndProduction } from './WasteAndProduction';

const rpc = vi.mocked(appRpc);
const queued = vi.mocked(mutate);

function renderScreen(payload: unknown) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'production_log_today') return payload;
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <WasteAndProduction />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

// Braces: a function returned from beforeEach is run as a teardown.
beforeEach(() => {
  rpc.mockReset();
  queued.mockReset();
  tables.rows = {};
});

describe('Made today', () => {
  it('lists the batches with who made them, reading the bigint movement id the server sends', async () => {
    renderScreen({
      rows: [
        // stock_movements.id is a bigint, so the id arrives as a number.
        { movement_id: 186, ingredient_id: 'g', name_en: 'Garlic Sauce', name_ar: 'صوص الثوم', qty: 500, unit: 'ml', staff_name: 'Dev Chef', at: '2026-09-25T03:45:15Z' },
      ],
    });
    const panel = await screen.findByTestId('made-today');
    expect(await within(panel).findByText('Garlic Sauce')).toBeTruthy();
    expect(within(panel).getByText('500 ml')).toBeTruthy();
    expect(within(panel).getByText('Dev Chef')).toBeTruthy();
    // No cost anywhere on the list.
    expect(panel.textContent).not.toMatch(/IQD/);
  });

  it('says so when nothing was made yet', async () => {
    renderScreen({ rows: [] });
    expect(await screen.findByText('Nothing made yet today.')).toBeTruthy();
  });

  it('says a failed read failed, and reads again on Try again', async () => {
    let fail = true;
    rpc.mockImplementation(async (fn: string) => {
      if (fn !== 'production_log_today') throw new Error(`unexpected ${fn}`);
      if (fail) throw new AppRpcError('UNKNOWN', 'network down');
      return { rows: [] };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <WasteAndProduction />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    const panel = await screen.findByTestId('made-today');
    fail = false;
    await userEvent.click(await within(panel).findByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText('Nothing made yet today.')).toBeTruthy();
  });
});

describe('the quantity boxes', () => {
  it('read digits typed on an Arabic keyboard and drop anything that is not a number, as Goods in does', async () => {
    renderScreen({ rows: [] });
    const box = (await screen.findByLabelText(/^Quantity/)) as HTMLInputElement;
    await userEvent.type(box, '١٢٫٥kg');
    expect(box.value).toBe('12.5');
    expect(screen.queryByText('Enter a number above zero.')).toBeNull();
  });
});

describe('the stores (wave5-addendum-2026-09-25 §2.8.2 D3, §5.2)', () => {
  const ing = (id: string, name: string, kind: string, unit = 'g') => ({ id, kind, name_en: name, name_ar: name, unit, pack_size: null, is_active: true });
  beforeEach(() => {
    tables.rows = {
      ingredients: [ing('milk', 'Milk', 'purchased', 'ml'), ing('water', 'Water bottle', 'retail', 'pc'), ing('dough', 'Dough', 'prepared')],
      v_stock_by_location: [
        { ingredient_id: 'milk', location: 'cafe', on_hand: 800 },
        { ingredient_id: 'milk', location: 'bakery', on_hand: 200 },
        { ingredient_id: 'dough', location: 'bakery', on_hand: 1500 },
      ],
    };
  });

  const choose = async (field: string, option: string) => {
    await userEvent.click(await screen.findByRole('combobox', { name: field }));
    await userEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: option }));
  };

  it('takes waste from the store picked, the cafe store unless the manager says otherwise, and shows that store’s figure', async () => {
    queued.mockResolvedValue({ queued: false } as never);
    renderScreen({ rows: [] });
    await choose('Ingredient', 'Milk');
    expect(await screen.findByText('In the cafe store: 800 ml')).toBeTruthy();
    await userEvent.click(within(screen.getByTestId('waste-store')).getByRole('button', { name: 'Bakery store' }));
    expect(screen.getByText('In the bakery store: 200 ml')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Quantity/), '50');
    await userEvent.type(screen.getByLabelText(/^Note/), 'dropped a jug');
    await userEvent.click(screen.getByRole('button', { name: 'Record waste' }));
    await waitFor(() => expect(queued).toHaveBeenCalledTimes(1));
    expect(queued.mock.calls[0]![1]).toMatchObject({ ingredientId: 'milk', qty: 50, location: 'bakery' });
  });

  it('keeps shop stock in the cafe store: the bakery store is off for it', async () => {
    renderScreen({ rows: [] });
    await choose('Ingredient', 'Water bottle');
    const bakery = within(screen.getByTestId('waste-store')).getByRole('button', { name: 'Bakery store' }) as HTMLButtonElement;
    expect(bakery.disabled).toBe(true);
    expect(screen.getByText(/Shop stock stays in the cafe store/)).toBeTruthy();
  });

  it('makes production in the bakery store by default', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'production_log_today') return { rows: [] };
      if (fn === 'record_production') return { batch_id: 'b1', unit_cost_iqd: 2 };
      throw new Error(`unexpected ${fn}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <WasteAndProduction />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    const picker = await screen.findByTestId('production-store');
    expect(within(picker).getByRole('button', { name: 'Bakery store' }).getAttribute('aria-pressed')).toBe('true');
    await choose('Prepared item', 'Dough');
    expect(await screen.findByText('In the bakery store: 1,500 g')).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Amount made/), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Record production' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('record_production', { p_ingredient_id: 'dough', p_qty: 1000, p_location: 'bakery' }));
  });
});

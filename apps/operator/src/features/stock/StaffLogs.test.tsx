import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as StockKeysModule from './stockKeys';

// Goods in ▸ "Added by staff" (wave5-addendum-2026-09-25 §2.8.2 D5, §5.2,
// §8 Q23-Q24): what staff added on the phone, booked at an estimate they never
// saw; a manager sets the real cost inline (app.price_logged_stock).

const data = vi.hoisted(() => ({ logs: [] as unknown[] | Error, ingredients: [] as unknown[] }));
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
    fetchStaffLogs: async () => {
      if (data.logs instanceof Error) throw data.logs;
      return data.logs;
    },
  };
});

import { appRpc } from '../../lib/appRpc';
import { StaffLogs } from './StaffLogs';

const rpc = vi.mocked(appRpc);

const log = (id: string, lines: unknown[], over: Record<string, unknown> = {}) => ({
  id,
  location: 'cafe',
  received_at: '2026-09-25T08:00:00Z',
  staff: { display_name: 'Bareq' },
  delivery_lines: lines,
  ...over,
});
const dl = (id: string, ingredient: string, cost_source: string, unit_cost_iqd: number, qty = 2000) => ({
  id,
  ingredient_id: ingredient,
  qty_received: qty,
  unit_cost_iqd,
  cost_source,
  expiry_date: null,
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <StaffLogs />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockReset();
  data.ingredients = [
    { id: 'milk', kind: 'purchased', name_en: 'Milk', name_ar: 'حليب', unit: 'ml', pack_size: 1000, is_active: true },
    { id: 'sugar', kind: 'purchased', name_en: 'Sugar', name_ar: 'سكر', unit: 'g', pack_size: null, is_active: true },
  ];
  data.logs = [];
});

describe('Added by staff', () => {
  it('is not there at all while staff added nothing', async () => {
    mount();
    // Let the read settle, then nothing is drawn.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('staff-logs')).toBeNull();
  });

  it('puts what needs a cost first and folds what is already costed', async () => {
    const user = userEvent.setup();
    data.logs = [
      log('d-new', [dl('l1', 'sugar', 'last_batch', 2.5)], { received_at: '2026-09-26T08:00:00Z', location: 'bakery', staff: { display_name: 'Rusul' } }),
      log('d-old', [dl('l2', 'milk', 'none', 0)]),
    ];
    mount();
    const card = await screen.findByTestId('staff-logs');
    expect(within(card).getByText('Need a cost: 1')).toBeTruthy();
    // Only the log needing a cost shows until asked.
    expect(within(card).getByText('Needs a cost')).toBeTruthy();
    expect(within(card).queryByText('Sugar')).toBeNull();
    await user.click(within(card).getByTestId('staff-logs-toggle'));
    expect(within(card).getByText('Sugar')).toBeTruthy();
    expect(within(card).getByText('Estimated from the last delivery')).toBeTruthy();
    expect(within(card).getByText('Bakery store')).toBeTruthy();
  });

  it('shrinks to one line when every addition has a cost, and opens into the list', async () => {
    const user = userEvent.setup();
    data.logs = [log('d-new', [dl('l1', 'sugar', 'last_batch', 2.5)], { received_at: '2026-09-26T08:00:00Z' })];
    mount();
    const line = await screen.findByTestId('staff-logs');
    expect(within(line).getByText(/Every addition of the last 14 days has a cost\./)).toBeTruthy();
    expect(within(line).queryByText('Sugar')).toBeNull();
    await user.click(within(line).getByTestId('staff-logs-toggle'));
    expect(within(await screen.findByTestId('staff-logs')).getByText('Sugar')).toBeTruthy();
  });

  it('sets a cost per pack as the cost per base unit, inline', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({ delivery_id: 'd-old', updated: 1 });
    data.logs = [log('d-old', [dl('l2', 'milk', 'none', 0)])];
    mount();
    await user.click(await screen.findByTestId('set-cost-l2'));
    await user.click(screen.getByRole('button', { name: /One pack of/ }));
    await user.type(screen.getByRole('textbox', { name: /Cost/ }), '1500');
    await user.click(screen.getByTestId('save-cost-l2'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    // 1,500 IQD for a 1,000 ml pack is 1.5 IQD per ml.
    expect(rpc).toHaveBeenCalledWith('price_logged_stock', { p_delivery_id: 'd-old', p_lines: [{ delivery_line_id: 'l2', unit_cost_iqd: 1.5 }] });
  });

  it('holds Save until the cost is a number of 0 or more', async () => {
    const user = userEvent.setup();
    data.logs = [log('d-old', [dl('l3', 'sugar', 'none', 0)])];
    mount();
    await user.click(await screen.findByTestId('set-cost-l3'));
    expect((screen.getByTestId('save-cost-l3') as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: /Cost/ }), '0');
    expect((screen.getByTestId('save-cost-l3') as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so when the list cannot be read, with a retry', async () => {
    data.logs = new Error('offline');
    mount();
    const card = await screen.findByTestId('staff-logs');
    expect(within(card).getByRole('button', { name: /Try again|Retry/ })).toBeTruthy();
  });
});

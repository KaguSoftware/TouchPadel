import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// 0389 (F-36): a manager approves a new product a driver bought; it becomes a
// shop product in one call, saved hidden for a manager, and the price box
// takes English digits only and says so (F-35).

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'm1', displayName: 'Omar', role: 'manager' } }),
}));
vi.mock('../stockKeys', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchShopCatalogue: vi.fn(async () => ({ sections: [{ id: 's1', name_en: 'Rackets', name_ar: 'مضارب', is_active: true }], products: [] })),
}));
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    return { item_id: 'i1', variant_id: 'v1', ingredient_id: 'g1', purchase_id: 'p1', delivery_id: 'd1' };
  }),
}));

import { NewProductFromPurchase } from './NewProductFromPurchase';

const LINE = {
  id: 'l1',
  ingredient_id: null,
  ingredient_active: null,
  name_en: null,
  name_ar: null,
  unit: null,
  label: 'Bullpadel Vertex',
  qty: 2,
  price_iqd: 120000,
  status: 'to_receive' as const,
};

function mount(onDone = vi.fn()) {
  localStorage.setItem('touch-operator-locale', 'en');
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <NewProductFromPurchase line={LINE} onClose={vi.fn()} onDone={onDone} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return onDone;
}

beforeEach(() => {
  calls.length = 0;
});

describe('NewProductFromPurchase (0389, F-36)', () => {
  it('refuses Arabic digits with a clear line, then approves the product in one call, hidden for a manager', async () => {
    const user = userEvent.setup();
    const onDone = mount();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Saved hidden/)).toBeTruthy();
    const price = within(dialog).getByTestId('newProduct.price');
    await user.type(price, '٢٥٠٠٠٠');
    await waitFor(() => expect((within(dialog).getByTestId('newProduct.approve') as HTMLButtonElement).disabled).toBe(false));
    await user.click(within(dialog).getByTestId('newProduct.approve'));
    expect(await within(dialog).findByText('Use English digits (0-9). Arabic digits are not accepted here.')).toBeTruthy();
    expect(calls.some((c) => c.fn === 'create_shop_product')).toBe(false);
    await user.clear(price);
    await user.type(price, '250000');
    await user.click(within(dialog).getByTestId('newProduct.approve'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls.find((c) => c.fn === 'create_shop_product')?.args).toMatchObject({
      p_category_id: 's1',
      p_name_en: 'Bullpadel Vertex',
      p_price_iqd: 250000,
      p_pack_cost_iqd: 60000,
      p_is_active: false,
      p_purchase_line_id: 'l1',
      p_idempotency_key: expect.stringMatching(/^shop\.product:/),
    });
  });
});

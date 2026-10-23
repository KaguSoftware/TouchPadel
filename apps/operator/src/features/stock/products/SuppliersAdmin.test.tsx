import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import type * as StockKeysModule from '../stockKeys';

// New supplier is a stepped dialog (Sait, 2026-10-22): the name, then the
// contact; editing one keeps the single form.

const m = vi.hoisted(() => ({ appRpc: vi.fn() }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), appRpc: m.appRpc }));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../stockKeys', async (importOriginal) => ({
  ...(await importOriginal<typeof StockKeysModule>()),
  fetchSuppliers: async () => [{ id: 's1', name: 'Padel Pro Iraq', phone: null, notes: null, is_active: true }],
}));

import { SuppliersAdmin } from './SuppliersAdmin';

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <SuppliersAdmin />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.appRpc.mockReset();
  m.appRpc.mockResolvedValue('s2');
});

describe('SuppliersAdmin', () => {
  it('adds a supplier step by step and saves from Review', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Padel Pro Iraq');
    await user.click(screen.getByRole('button', { name: 'New supplier' }));
    const dialog = screen.getByRole('dialog', { name: 'New supplier' });
    const next = (name: string) => within(dialog).getAllByRole('button', { name }).at(-1)!;
    await user.click(next('Contact'));
    expect(within(dialog).getByText('Enter a name.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Al-Rafidain Foods');
    await user.click(next('Contact'));
    await user.type(within(dialog).getByLabelText(/^Phone/), '0790 222 3344');
    expect(within(dialog).getByText('Shows in deliveries and product forms.')).toBeTruthy();
    await user.click(next('Review'));
    expect(within(dialog).getByText('0790 222 3344')).toBeTruthy();
    expect(within(dialog).getByText('Yes')).toBeTruthy();
    await user.click(within(dialog).getByTestId('supplier-new.submit'));
    await waitFor(() =>
      expect(m.appRpc).toHaveBeenCalledWith('upsert_supplier', { p_id: null, p_name: 'Al-Rafidain Foods', p_phone: '0790 222 3344', p_notes: null, p_is_active: true }),
    );
  });

  it('keeps the single form for editing', async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText('Padel Pro Iraq');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit supplier' });
    expect(within(dialog).queryByText(/^Step 1 of/)).toBeNull();
    expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Padel Pro Iraq');
  });
});

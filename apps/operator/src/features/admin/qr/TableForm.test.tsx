import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// Add table is stepped (the table, where and its seats, Review); Edit table stays one page.

vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../../lib/appRpc';
import { NEW_TABLE, TableForm, type TableDraft } from './TableForm';

const rpc = vi.mocked(appRpc);

function mount(initial: TableDraft, onClose = vi.fn()) {
  rpc.mockResolvedValue('t1');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <TableForm initial={initial} onClose={onClose} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe('TableForm', () => {
  it('adding: holds the table step until it has a number, then sends from Review', async () => {
    const user = userEvent.setup();
    const onClose = mount(NEW_TABLE);
    const dialog = within(await screen.findByRole('dialog', { name: 'Add table' }));
    await user.click(dialog.getByTestId('table-form.step.review'));
    expect(dialog.getByText('Enter a table number.')).toBeTruthy();
    await user.type(dialog.getByRole('textbox', { name: 'Table number' }), '12');
    await user.click(dialog.getByTestId('table-form.step.where'));
    await user.type(dialog.getByRole('textbox', { name: 'Zone' }), 'Terrace');
    await user.type(dialog.getByRole('spinbutton', { name: 'Seats' }), '4');
    // In use says what it means.
    expect(dialog.getByText('The card works and the table appears at the café cashier.')).toBeTruthy();
    await user.click(dialog.getByTestId('table-form.step.review'));
    expect(dialog.getByText('Terrace · 4 seats')).toBeTruthy();
    await user.click(dialog.getByTestId('table-form.submit'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('upsert_cafe_table', { p_id: null, p_table_number: '12', p_zone: 'Terrace', p_capacity: 4, p_is_active: true }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('editing stays one page', async () => {
    mount({ id: 't1', table_number: '7', zone: '', capacity: null, is_active: true });
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit table' }));
    expect(dialog.getByDisplayValue('7')).toBeTruthy();
    expect(dialog.queryByTestId('table-form.step.review')).toBeNull();
    expect(dialog.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

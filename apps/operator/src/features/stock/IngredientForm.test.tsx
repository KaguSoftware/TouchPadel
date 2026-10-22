import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// New ingredient is a stepped dialog (Sait, 2026-10-22): what it is, buying
// it, how much to keep, recipe maths, then Review.

const m = vi.hoisted(() => ({ appRpc: vi.fn(), confirm: vi.fn(async () => true) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), appRpc: m.appRpc }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => m.confirm }));

import { IngredientForm } from './IngredientForm';

function renderNew() {
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <IngredientForm row={null} onHand={null} onDone={onDone} onCancel={onCancel} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'New ingredient' });
  const next = (name: string) => within(dialog).getAllByRole('button', { name }).at(-1)!;
  return { dialog, next, onDone, onCancel };
}

beforeEach(() => {
  m.appRpc.mockReset();
  m.appRpc.mockResolvedValue('i1');
  m.confirm.mockClear();
});

describe('IngredientForm, new', () => {
  it('walks the four steps and saves from Review', async () => {
    const user = userEvent.setup();
    const { dialog, next, onDone } = renderNew();
    expect(within(dialog).getByText('Step 1 of 4')).toBeTruthy();
    await user.click(next('Buying it'));
    expect(within(dialog).getByText('Fill in both names first.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Oat milk');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'حليب الشوفان');
    await user.click(within(dialog).getByRole('button', { name: 'Millilitres (ml)' }));
    await user.click(within(dialog).getByRole('button', { name: /^Bought from a supplier/ }));
    await user.click(next('Buying it'));
    await user.type(within(dialog).getByRole('textbox', { name: 'Supplier' }), 'Al-Rafidain Foods');
    await user.type(within(dialog).getByLabelText(/^Pack size \(ml\)/), '1000');
    await user.type(within(dialog).getByLabelText(/^Pack price/), '6500');
    await user.click(next('How much to keep'));
    await user.type(within(dialog).getByLabelText(/^Par \(ml\)/), '4000');
    await user.type(within(dialog).getByLabelText(/^Reorder point/), '12000');
    await user.click(next('Recipe maths'));
    // The reorder point above par holds the step.
    expect(within(dialog).getByText('Step 3 of 4')).toBeTruthy();
    await user.clear(within(dialog).getByLabelText(/^Par \(ml\)/));
    await user.type(within(dialog).getByLabelText(/^Par \(ml\)/), '12000');
    await user.clear(within(dialog).getByLabelText(/^Reorder point/));
    await user.type(within(dialog).getByLabelText(/^Reorder point/), '4000');
    await user.click(next('Recipe maths'));
    await user.click(next('Review'));
    const text = dialog.textContent ?? '';
    expect(text).toContain('Oat milk · حليب الشوفان');
    expect(text).toContain('Bought · millilitres');
    expect(text).toContain('Al-Rafidain Foods · 1,000 ml for 6,500 IQD');
    expect(text).toContain('Par 12,000 ml · reorder at 4,000 ml');
    expect(text).toContain('100% usable · 0% waste · in use');
    await user.click(within(dialog).getByTestId('ingredient-new.submit'));
    await waitFor(() =>
      expect(m.appRpc).toHaveBeenCalledWith(
        'upsert_ingredient',
        expect.objectContaining({ p_id: null, p_name_en: 'Oat milk', p_unit: 'ml', p_kind: 'purchased', p_pack_size: 1000, p_pack_cost_iqd: 6500, p_par_level: 12000, p_low_stock_threshold: 4000 }),
      ),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it('asks before throwing away a started draft', async () => {
    const user = userEvent.setup();
    const { dialog } = renderNew();
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Oat');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(1));
  });
});

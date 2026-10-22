import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// New shop section is a stepped dialog (Sait, 2026-10-22): the name in both
// languages, the tax group as cards, then Review.

const m = vi.hoisted(() => ({ appRpc: vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), appRpc: m.appRpc }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: async () => ({
          data: [
            { id: 't1', name_en: 'Standard rate', name_ar: 'النسبة العادية' },
            { id: 't2', name_en: 'No tax', name_ar: 'دون ضريبة' },
          ],
          error: null,
        }),
      }),
    }),
  },
}));

import { ShopSectionDialog } from './ShopSectionDialog';

beforeEach(() => {
  m.appRpc.mockReset();
  m.appRpc.mockResolvedValue('sec-1');
});

describe('ShopSectionDialog, stepped', () => {
  it('holds the name step, then saves from Review with the tax group picked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LocaleProvider>
          <ShopSectionDialog onClose={onClose} />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    const dialog = screen.getByRole('dialog', { name: 'New shop section' });
    const next = (name: string) => within(dialog).getAllByRole('button', { name }).at(-1)!;
    await user.click(next('Tax group'));
    expect(within(dialog).getByText('Fill in both names first.')).toBeTruthy();
    await user.type(within(dialog).getByLabelText('Name (English)'), 'Rackets');
    await user.type(within(dialog).getByLabelText('Name (Arabic)'), 'مضارب');
    await user.click(next('Tax group'));
    // The first group is the one picked to start with, as the old select did.
    expect(await within(dialog).findByRole('button', { name: 'Standard rate', pressed: true })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'No tax' }));
    await user.click(next('Review'));
    expect(dialog.querySelector('dd')?.textContent).toBe('Rackets · مضارب');
    await user.click(within(dialog).getByTestId('shop-section.submit'));
    await waitFor(() => expect(m.appRpc).toHaveBeenCalledWith('upsert_shop_category', { p_name_en: 'Rackets', p_name_ar: 'مضارب', p_tax_group_id: 't2' }));
    expect(onClose).toHaveBeenCalled();
  });
});

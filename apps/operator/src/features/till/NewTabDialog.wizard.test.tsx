import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as AuthModule from '../../lib/auth';

// New order is a stepped dialog (Sait, 2026-10-22): its name, then the court
// booking it goes on, then Review, whose submit opens the tab as before.

const m = vi.hoisted(() => ({ mutate: vi.fn(), role: 'cashier', rows: [] as unknown[] }));

vi.mock('../../lib/mutate', () => ({ mutate: m.mutate }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, useAuth: () => ({ staff: { role: m.role } }) };
});
vi.mock('../desk/useTradingNight', () => ({
  tonightScope: async () => ({ start: '2026-10-22T00:00:00Z', end: '2026-10-23T00:00:00Z', isTonight: () => true }),
}));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'in', 'gte', 'lt']) chain[k] = () => chain;
  chain.order = async () => ({ data: m.rows, error: null });
  return { supabase: { from: () => chain } };
});

import { NewTabDialog } from './NewTabDialog';

const booking = {
  id: 'r1',
  start_at: '2026-10-22T16:00:00Z',
  kind: 'booking',
  guest_id: 'g1',
  guest_name: 'Ali Hassan',
  court: { name_en: 'Court 1', name_ar: 'الملعب 1' },
  tabs: [],
};

function renderDialog(props: Partial<Parameters<typeof NewTabDialog>[0]> = {}) {
  const onOpened = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <NewTabDialog onClose={vi.fn()} onOpened={onOpened} {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onOpened, dialog: screen.getByRole('dialog', { name: 'New order' }) };
}

beforeEach(() => {
  m.mutate.mockReset();
  m.mutate.mockResolvedValue({ result: { tab_id: 'tab-1' }, idempotencyKey: 'k', localId: 'l' });
  m.role = 'cashier';
  m.rows = [booking];
});

describe('NewTabDialog, stepped', () => {
  it('names the order, ties it to a booking picked as a card, and starts it from Review', async () => {
    const user = userEvent.setup();
    const { dialog, onOpened } = renderDialog();
    expect(within(dialog).getByText('Café till')).toBeTruthy();
    await user.type(within(dialog).getByLabelText(/^Name or number/), 'Ali');
    await user.click(within(dialog).getAllByRole('button', { name: 'Court booking' }).at(-1)!);
    expect(within(dialog).getByRole('button', { name: /^No booking/, pressed: true })).toBeTruthy();
    await user.click(await within(dialog).findByRole('button', { name: /Ali Hassan/ }));
    await user.click(within(dialog).getAllByRole('button', { name: 'Review' }).at(-1)!);
    const review = dialog;
    expect(review.textContent).toContain('Ali');
    expect(review.textContent).toMatch(/Court 1/);
    await user.click(within(dialog).getByTestId('new-order.submit'));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledWith('tab.open', { label: 'Ali', reservationId: 'r1' }));
    expect(onOpened).toHaveBeenCalledWith('tab-1');
  });

  it('left unnamed, Review says it takes the next counter number', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog();
    await user.click(within(dialog).getByTestId('new-order.step.review'));
    expect(within(dialog).getByText('Next counter number')).toBeTruthy();
    expect(within(dialog).getAllByText('No booking').length).toBeGreaterThan(0);
    await user.click(within(dialog).getByTestId('new-order.submit'));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledWith('tab.open', {}));
  });

  it('has no booking step for a role that cannot read bookings', () => {
    m.role = 'waiter';
    const { dialog } = renderDialog();
    expect(within(dialog).getByText('Step 1 of 1')).toBeTruthy();
    expect(within(dialog).queryByTestId('new-order.step.booking')).toBeNull();
  });
});

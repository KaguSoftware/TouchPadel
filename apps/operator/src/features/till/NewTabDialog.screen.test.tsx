import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as AuthModule from '../../lib/auth';
import type * as LoyaltyModule from '../loyalty/useLoyalty';

// New order is one screen (Majed, 2026-11-20): a name, or a member card scanned into the same
// field, then Start order. No booking step, no Review.

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  identify: vi.fn(),
  attach: vi.fn(),
  role: 'cashier',
  rows: [] as unknown[],
}));

vi.mock('../../lib/mutate', () => ({ mutate: m.mutate }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, useAuth: () => ({ staff: { role: m.role } }) };
});
vi.mock('../loyalty/useLoyalty', async (importOriginal) => {
  const mod = await importOriginal<typeof LoyaltyModule>();
  return { ...mod, identifyMember: m.identify, setTabCustomer: m.attach, invalidateTabLoyalty: vi.fn() };
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
  m.identify.mockReset();
  m.attach.mockReset();
  m.attach.mockResolvedValue(undefined);
  m.role = 'cashier';
  m.rows = [booking];
});

describe('NewTabDialog, one screen', () => {
  it('a typed name starts the order straight away, with no booking step or Review', async () => {
    const user = userEvent.setup();
    const { dialog, onOpened } = renderDialog();
    expect(within(dialog).queryByText('Court booking')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Review' })).toBeNull();
    await user.type(within(dialog).getByLabelText(/^Name or member card/), 'Ali');
    await user.click(within(dialog).getByTestId('new-order.submit'));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledWith('tab.open', { label: 'Ali' }));
    expect(onOpened).toHaveBeenCalledWith('tab-1');
    expect(m.identify).not.toHaveBeenCalled();
  });

  it('left empty, Enter opens the next counter number', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByTestId('new-order.name'), '{Enter}');
    await waitFor(() => expect(m.mutate).toHaveBeenCalledWith('tab.open', {}));
  });

  it('a scanned member card opens the order under their name and puts them on the bill', async () => {
    const user = userEvent.setup();
    m.identify.mockResolvedValue({ customer_id: 'c1', display_name: 'Sara K' });
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'tp-abcd1234-456789');
    expect(screen.getByText('Member card: the member goes on this bill.')).toBeTruthy();
    await user.type(screen.getByTestId('new-order.name'), '{Enter}');
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    expect(m.identify).toHaveBeenCalledWith('TP-ABCD1234-456789');
    expect(m.mutate).toHaveBeenCalledWith('tab.open', { label: 'Sara K' });
    expect(m.attach).toHaveBeenCalledWith('tab-1', 'c1');
  });

  it('an unknown card opens nothing', async () => {
    const user = userEvent.setup();
    m.identify.mockRejectedValue(Object.assign(new Error('MEMBER_NOT_FOUND'), { code: 'MEMBER_NOT_FOUND' }));
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'TP-ABCD1234-456789{Enter}');
    await waitFor(() => expect(m.identify).toHaveBeenCalled());
    expect(m.mutate).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it('the desk-chosen booking is still bound, with no picker', async () => {
    const user = userEvent.setup();
    const { dialog } = renderDialog({ initialReservationId: 'r1' });
    expect(await within(dialog).findByText('Bound to booking')).toBeTruthy();
    await user.click(within(dialog).getByTestId('new-order.submit'));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledWith('tab.open', { reservationId: 'r1' }));
  });
});

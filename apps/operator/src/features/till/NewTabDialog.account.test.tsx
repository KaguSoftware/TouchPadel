import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type * as AuthModule from '../../lib/auth';
import type * as LoyaltyModule from '../loyalty/useLoyalty';

// 0448 at the till (Majed, 2026-11-21): a phone number under a typed name makes
// the guest a customer, who goes on the bill. The order opens first and never
// waits for it; a number that is somebody's under another name is not put on
// the bill by word of mouth.

const m = vi.hoisted(() => ({
  mutate: vi.fn(),
  attach: vi.fn(),
  edge: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../lib/mutate', () => ({ mutate: m.mutate }));
vi.mock('../../lib/edge', () => ({ callEdge: m.edge }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: m.info }) }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return { ...mod, useAuth: () => ({ staff: { role: 'cashier' } }) };
});
vi.mock('../loyalty/useLoyalty', async (importOriginal) => {
  const mod = await importOriginal<typeof LoyaltyModule>();
  return { ...mod, identifyMember: vi.fn(), setTabCustomer: m.attach, invalidateTabLoyalty: vi.fn() };
});
vi.mock('../desk/useTradingNight', () => ({
  tonightScope: async () => ({ start: '2026-10-22T00:00:00Z', end: '2026-10-23T00:00:00Z', isTonight: () => true }),
}));
vi.mock('../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'in', 'gte', 'lt']) chain[k] = () => chain;
  chain.order = async () => ({ data: [], error: null });
  return { supabase: { from: () => chain } };
});

import { NewTabDialog } from './NewTabDialog';

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
  return { onOpened };
}

beforeEach(() => {
  m.mutate.mockReset();
  m.mutate.mockResolvedValue({ result: { tab_id: 'tab-1' }, idempotencyKey: 'k', localId: 'l' });
  m.attach.mockReset();
  m.attach.mockResolvedValue(undefined);
  m.edge.mockReset();
  m.info.mockReset();
});

describe('New order: a name and a phone number make a customer (0448)', () => {
  it('opens the order at once, then saves the guest and puts them on the bill', async () => {
    m.edge.mockResolvedValue({ id: 'c-new', customer: { full_name: 'Ali', phone: '07701234567', gender: null } });
    const user = userEvent.setup();
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'Ali');
    await user.type(screen.getByTestId('new-order.phone'), '0770 123 4567');
    await user.click(screen.getByTestId('new-order.submit'));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    // The order is the typed name's, exactly as before.
    expect(m.mutate).toHaveBeenCalledWith('tab.open', { label: 'Ali' });
    await waitFor(() => expect(m.attach).toHaveBeenCalledWith('tab-1', 'c-new'));
    expect(m.edge).toHaveBeenCalledWith(
      'desk-customer-create',
      { fullName: 'Ali', phone: '0770 123 4567', preferredLang: 'en', ifExists: 'return' },
      expect.anything(),
    );
    expect(m.info).toHaveBeenCalledWith(expect.stringContaining('is saved as a customer'));
  });

  it("a number that is somebody else's opens the order but stays off the bill", async () => {
    m.edge.mockResolvedValue({ id: 'c-old', existing: true, claimed: true, customer: { full_name: 'Omar Saleh', phone: '07701234567', gender: 'male' } });
    const user = userEvent.setup();
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'Ali');
    await user.type(screen.getByTestId('new-order.phone'), '07701234567');
    await user.click(screen.getByTestId('new-order.submit'));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    await waitFor(() => expect(m.info).toHaveBeenCalledWith(expect.stringContaining('This number belongs to')));
    expect(m.attach).not.toHaveBeenCalled();
  });

  it('a name alone is saved as an incomplete customer on the bill, without a toast per order', async () => {
    m.edge.mockResolvedValue({ id: 'c-draft', incomplete: true, customer: { full_name: 'Ali', phone: null, gender: null } });
    const user = userEvent.setup();
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'Ali');
    await user.click(screen.getByTestId('new-order.submit'));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    await waitFor(() => expect(m.attach).toHaveBeenCalledWith('tab-1', 'c-draft'));
    expect(m.edge).toHaveBeenCalledWith('desk-customer-create', { fullName: 'Ali', preferredLang: 'en', ifExists: 'return' }, expect.anything());
    expect(m.info).not.toHaveBeenCalled();
  });

  it('an order with no name is the counter\'s number: nobody is saved', async () => {
    const user = userEvent.setup();
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.phone'), '07701234567');
    await user.click(screen.getByTestId('new-order.submit'));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    expect(m.edge).not.toHaveBeenCalled();
    expect(m.attach).not.toHaveBeenCalled();
  });

  it('a function that does not answer never holds the order up', async () => {
    m.edge.mockRejectedValue(new Error('down'));
    const user = userEvent.setup();
    const { onOpened } = renderDialog();
    await user.type(screen.getByTestId('new-order.name'), 'Ali');
    await user.type(screen.getByTestId('new-order.phone'), '07701234567');
    await user.click(screen.getByTestId('new-order.submit'));
    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('tab-1'));
    expect(m.attach).not.toHaveBeenCalled();
  });

  it("a booking's bill asks for no number: the booking already has its guest", () => {
    renderDialog({ initialReservationId: 'r1' });
    expect(screen.queryByTestId('new-order.phone')).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { mutate } from '../../../lib/mutate';
import { appRpc } from '../../../lib/appRpc';
import { CourtBillView } from './CourtBillPanel';
import type { BookingBill, LiveTab } from './deskPaymentLogic';

// The bill panel over a real query client. Writes are mocked at mutate() and
// appRpc(); the signed-in role at useAuth, so permissionsFor and canAccess run
// for real — the panel must show each role exactly what it may do.

let role = 'court_desk';

vi.mock('../../../lib/mutate', () => ({
  mutate: vi.fn(async () => ({ queued: false, localId: '', idempotencyKey: '', result: { tab_id: 't-new', change_iqd: null, status: 'settled' } })),
  isElectron: () => false,
}));
vi.mock('../../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    constructor(
      public code: string,
      message?: string,
      public hint?: string,
      public details?: string,
    ) {
      super(message ?? code);
    }
  },
  appRpc: vi.fn(async () => ({})),
}));
vi.mock('../../../lib/idem', () => ({ deviceId: () => 'DESK-1' }));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

function bill(over: Partial<BookingBill> = {}, status = 'confirmed'): BookingBill {
  return {
    reservation: {
      id: 'r1',
      kind: 'booking',
      status,
      price_iqd: 30000,
      guest_name: 'Sara',
      start_at: '2099-09-03T17:00:00.000Z',
      end_at: '2099-09-03T18:00:00.000Z',
      court_id: 'c1',
      court_name_en: 'Court 1',
      court_name_ar: 'ملعب 1',
    },
    live: true,
    day_open: true,
    live_tab: null,
    court_paid_iqd: 0,
    court_remaining_iqd: 30000,
    court_refund_due_iqd: 0,
    settled_tabs: [],
    ...over,
  };
}

function tab(over: Partial<LiveTab> = {}): LiveTab {
  return {
    id: 't1',
    status: 'open',
    day_session_id: 'd1',
    subtotal_iqd: 15000,
    discount_iqd: 0,
    tax_iqd: 0,
    court_iqd: 30000,
    total_iqd: 45000,
    paid_iqd: 0,
    due_iqd: 45000,
    over_paid_iqd: 0,
    item_count: 3,
    has_orders: true,
    has_payments: false,
    has_adjustments: false,
    ...over,
  };
}

function view(b: BookingBill, onRefetch = vi.fn(async () => undefined)) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CourtBillView bill={b} tz="Asia/Baghdad" onRefetch={onRefetch} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onRefetch };
}

beforeEach(() => {
  role = 'court_desk';
  vi.mocked(mutate).mockClear();
  vi.mocked(appRpc).mockClear();
});

describe('CourtBillView', () => {
  it('not charged: says what is owed and opens the booking bill when the clerk takes cash', async () => {
    const user = userEvent.setup();
    const { onRefetch } = view(bill());
    expect(screen.getByText(/^The court fee of .* has not been paid\.$/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    expect(mutate).toHaveBeenCalledWith('tab.open', { reservationId: 'r1' });
    await waitFor(() => expect(onRefetch).toHaveBeenCalled());
  });

  it('bill open: shows the server breakdown and records a card payment against the total the clerk saw', async () => {
    const user = userEvent.setup();
    view(bill({ live_tab: tab() }));
    expect(screen.getByText('Court fee')).toBeTruthy();
    expect(screen.getByText('Cafe items · 3')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Card' }));
    const pane = within(await screen.findByRole('dialog'));
    await user.click(pane.getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith('tab.settle', { tabId: 't1', method: 'card', expectedTotalIqd: 45000 }),
    );
    expect(vi.mocked(mutate).mock.calls.some(([type]) => type === 'tab.open')).toBe(false);
  });

  it('no trading day: payment buttons are refused with the reason, and nothing is opened', async () => {
    view(bill({ day_open: false }));
    expect(screen.getByText(/The trading day is not open/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Cash' }) as HTMLButtonElement).getAttribute('aria-disabled') ?? (screen.getByRole('button', { name: 'Cash' }) as HTMLButtonElement).disabled.toString()).toMatch(/true/);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('a no-show with an empty open bill: closes it with the booking state as the reason', async () => {
    const user = userEvent.setup();
    view(bill({ live: false, court_remaining_iqd: 0, live_tab: tab({ court_iqd: 0, subtotal_iqd: 0, total_iqd: 0, due_iqd: 0, item_count: 0, has_orders: false }) }, 'no_show'));
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close the bill' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Close the bill' }));
    // Item 9 (0120): the removal rides the durable queue as tab.cancel.
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('tab.cancel', { tabId: 't1', reasonCode: 'booking_no_show' }));
  });

  it('a bill that held voided items closes at zero instead of being removed', async () => {
    const user = userEvent.setup();
    view(bill({ live: false, court_remaining_iqd: 0, live_tab: tab({ court_iqd: 0, subtotal_iqd: 0, total_iqd: 0, due_iqd: 0, item_count: 0, has_orders: true }) }, 'cancelled'));
    await user.click(screen.getByRole('button', { name: 'Close the bill' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close the bill' }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith('tab.settle_zero', { tabId: 't1', reasonCode: 'booking_cancelled' }),
    );
  });

  it('money owed back: the desk is told a manager refunds it, and is offered no payment and no till', () => {
    view(bill({ court_paid_iqd: 30000, court_remaining_iqd: 0, court_refund_due_iqd: 10000 }));
    expect(screen.getByText(/A manager refunds it at the till/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open on till' })).toBeNull();
  });

  it('paid: lists the payments taken, with who took them', () => {
    view(
      bill({
        court_paid_iqd: 30000,
        court_remaining_iqd: 0,
        settled_tabs: [
          {
            tab_id: 't0',
            settled_at: '2099-09-03T18:05:00.000Z',
            court_iqd: 30000,
            total_iqd: 30000,
            refunds_iqd: 0,
            payments: [{ id: 'p1', method: 'cash', amount_iqd: 30000, tendered_iqd: 50000, change_iqd: 20000, created_at: '2099-09-03T18:05:00.000Z', recorded_by_name: 'Desk Dana' }],
          },
        ],
      }),
    );
    expect(screen.getByText('The court fee is paid.')).toBeTruthy();
    expect(screen.getByText(/· Cash · by Desk Dana$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
  });

  it('a role without court payment sees the state but no buttons', () => {
    role = 'prep';
    view(bill({ live_tab: tab() }));
    expect(screen.getByText(/This booking has an open bill/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a cafe bill' })).toBeNull();
  });
});

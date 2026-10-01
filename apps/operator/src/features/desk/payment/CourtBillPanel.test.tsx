import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { mutate } from '../../../lib/mutate';
import { appRpc } from '../../../lib/appRpc';
import { CourtBillView } from './CourtBillPanel';
import type { BookingBill, BookingBillMatch, LiveTab } from './deskPaymentLogic';

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

  it('a deposit paid online: says the rest is owed, shows "Paid online", and takes the rest at Cash', async () => {
    const user = userEvent.setup();
    view(
      bill({
        court_paid_iqd: 15000,
        court_remaining_iqd: 15000,
        online_paid_iqd: 15000,
        online_payments: [{ id: 'op1', status: 'succeeded', amount_iqd: 15000, refund_amount_iqd: null, succeeded_at: '2099-09-01T09:00:00.000Z', refunded_at: null, sandbox: false }],
      }),
    );
    expect(screen.getByText(/paid a deposit online/)).toBeTruthy();
    expect(screen.queryByText(/costs more/)).toBeNull();
    expect(within(screen.getByTestId('paid-online')).getByText('Paid online')).toBeTruthy();
    expect(screen.getByText(/Paid online in the app$/)).toBeTruthy();
    expect(screen.queryByText('Test')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cash' }));
    expect(mutate).toHaveBeenCalledWith('tab.open', { reservationId: 'r1' });
  });

  it('an open bill after a deposit names its court line as the rest', () => {
    view(bill({ court_paid_iqd: 15000, court_remaining_iqd: 15000, online_paid_iqd: 15000, live_tab: tab({ court_iqd: 15000, total_iqd: 30000, due_iqd: 30000 }) }));
    expect(screen.getByText('Court fee, after the online deposit')).toBeTruthy();
    expect(screen.queryByText('Court fee')).toBeNull();
  });

  it('a cancelled booking with a sandbox deposit: the refund state and the test marker are shown', () => {
    view(
      bill(
        {
          live: false,
          court_paid_iqd: 0,
          court_remaining_iqd: 0,
          online_paid_iqd: 15000,
          online_payments: [{ id: 'op1', status: 'refund_pending', amount_iqd: 15000, refund_amount_iqd: 15000, succeeded_at: '2099-09-01T09:00:00.000Z', refunded_at: null, sandbox: true }],
        },
        'cancelled',
      ),
    );
    expect(screen.getByText('Refund on its way')).toBeTruthy();
    expect(screen.getAllByText('Test').length).toBeGreaterThan(0);
  });

  it('a role without court payment sees the state but no buttons', () => {
    role = 'prep';
    view(bill({ live_tab: tab() }));
    expect(screen.getByText(/This booking has an open bill/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a cafe bill' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// An open match's booking (docs/design/open-matches/operator.md §5.14)
// ---------------------------------------------------------------------------

function matchMoney(over: Partial<BookingBillMatch> = {}): BookingBillMatch {
  return {
    id: 'm1',
    status: 'booked',
    phase: 'started',
    price_iqd: 40000,
    booking_price_iqd: 40000,
    price_delta_iqd: 0,
    unassigned_iqd: 0,
    delta_owed_iqd: 0,
    owed_iqd: 20000,
    written_off_iqd: 0,
    open_iqd: 0,
    over_iqd: 0,
    ...over,
  };
}

function viewMatch(b: BookingBill, match = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CourtBillView bill={b} tz="Asia/Baghdad" match={match} onRefetch={vi.fn(async () => undefined)} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('CourtBillView — an open match booking', () => {
  it('says what the players owe between them, keeps Cash and Card, and offers no cafe bill (DF-16)', () => {
    viewMatch(bill({ match: matchMoney(), court_remaining_iqd: 40000 }));
    expect(screen.getByText(/^Players owe 20,000 IQD between them\. Take each share under Players/)).toBeTruthy();
    // The booking-level bill still takes money: the offline path, a price rise (DF-4).
    expect(screen.getByRole('button', { name: 'Cash' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a cafe bill' })).toBeNull();
  });

  it('adds rows for a write-off, a price change after booking and money not yet assigned, with the server figures', () => {
    viewMatch(bill({ court_written_off_iqd: 10000, match: matchMoney({ owed_iqd: 0, price_delta_iqd: 5000, unassigned_iqd: 15000 }) }));
    const rows = within(screen.getByTestId('match-bill-rows'));
    expect(rows.getByText('Written off')).toBeTruthy();
    expect(rows.getByText('Price changed after booking')).toBeTruthy();
    expect(rows.getByText('Not assigned to players yet')).toBeTruthy();
    expect(rows.getByText('15,000 IQD')).toBeTruthy();
    // Nobody owes a share: no players sentence.
    expect(screen.queryByText(/^Players owe/)).toBeNull();
  });

  it('names the seats a settled payment went to', () => {
    viewMatch(
      bill({
        court_paid_iqd: 20000,
        court_remaining_iqd: 20000,
        match: matchMoney(),
        settled_tabs: [
          {
            tab_id: 't0',
            settled_at: '2099-09-03T18:05:00.000Z',
            court_iqd: 20000,
            total_iqd: 20000,
            refunds_iqd: 0,
            payments: [
              {
                id: 'p1',
                method: 'cash',
                amount_iqd: 20000,
                tendered_iqd: 20000,
                change_iqd: 0,
                created_at: '2099-09-03T18:05:00.000Z',
                recorded_by_name: 'Desk Dana',
                seats: [
                  { seat_no: 2, amount_iqd: 10000 },
                  { seat_no: 1, amount_iqd: 10000 },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(screen.getByText('Seats: 1, 2')).toBeTruthy();
  });

  it('hides the cafe bill on the booking screen’s word before the bill carries the match (a server before 0262)', () => {
    viewMatch(bill(), true);
    expect(screen.queryByRole('button', { name: 'Add a cafe bill' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cash' })).toBeTruthy();
  });
});

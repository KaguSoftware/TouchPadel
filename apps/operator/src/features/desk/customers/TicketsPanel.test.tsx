import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isolateLtr } from '@touch/i18n';
import { LocaleProvider } from '../../../lib/i18n';

// operator.md §5.15.1 (R13): Cash out is a manager's, per purchase, and the
// server decides whether a purchase may go: allowed → the button with the
// server's count and amount; in_use / reserved / restorable → the button
// disabled with the sentence that says until when; a TICKET_IN_USE refusal
// reads the same sentences from its detail.

type Caps = Record<'runMatches' | 'takeSeatPayment' | 'writeOffSeat' | 'cashOutTickets' | 'banFromMatches' | 'reviewMatchReports', boolean>;
const MANAGER: Caps = { runMatches: true, takeSeatPayment: true, writeOffSeat: true, cashOutTickets: true, banFromMatches: true, reviewMatchReports: true };
let caps: Caps = MANAGER;

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../matches/useMatches', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMatchCaps: () => caps,
}));
vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad' }),
}));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { TicketsPanel } from './TicketsPanel';

const rpc = vi.mocked(appRpc);
// countPhrase isolates the digits (R38): "Cash out <LRI>2<PDI> tickets · 20,000 IQD".
const TWO = `${isolateLtr('2')} tickets`;

function purchase(id: string, cashout: Record<string, unknown> | null, over: Record<string, unknown> = {}) {
  return {
    payment_id: id,
    request_id: `req-${id}`,
    status: 'succeeded',
    ticket_count: 2,
    unit_price_iqd: 10000,
    amount_iqd: 20000,
    bought_at: '2026-09-20T10:00:00Z',
    refund_reason: null,
    refund_amount_iqd: null,
    refunded_at: null,
    sandbox: false,
    cashout,
    ...over,
  };
}

const TICKETS = {
  customer_id: 'c1',
  price_iqd: 10000,
  available: 3,
  reserved: 1,
  in_use: 1,
  forfeited: 1,
  cashed_out: 2,
  tickets: [],
  purchases: [
    purchase('p-ok', { allowed: true, reason: null, tickets: 2, amount_iqd: 20000, until_at: null }),
    purchase('p-inuse', { allowed: false, reason: 'in_use', tickets: 1, amount_iqd: 10000, until_at: '2026-09-29T21:00:00Z' }),
    purchase('p-reserved', { allowed: false, reason: 'reserved', tickets: 1, amount_iqd: 10000, until_at: '2026-09-30T15:00:00Z' }),
    purchase('p-restorable', { allowed: false, reason: 'restorable', tickets: 1, amount_iqd: 10000, until_at: null }),
    purchase('p-done', { allowed: false, reason: 'done', tickets: 0, amount_iqd: 0, until_at: null }, { status: 'refunded', refunded_at: '2026-09-25T09:00:00Z', sandbox: true }),
  ],
  pending: null,
  server_now: '2026-09-29T12:00:00Z',
};

let cashoutAnswer: () => unknown = () => ({ duplicate: false, tickets_cashed_out: 2, refund_amount_iqd: 20000, status: 'refund_pending' });

function mount() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'guest_tickets') return TICKETS;
    if (fn === 'ticket_cashout') return cashoutAnswer();
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <TicketsPanel customerId="c1" />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const rowOf = (id: string) => screen.getAllByTestId('ticket-purchase')[TICKETS.purchases.findIndex((p) => p.payment_id === id)]!;
const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  caps = MANAGER;
  cashoutAnswer = () => ({ duplicate: false, tickets_cashed_out: 2, refund_amount_iqd: 20000, status: 'refund_pending' });
  rpc.mockReset();
});

describe('TicketsPanel', () => {
  it('shows the wallet counts and that tickets work at every branch', async () => {
    mount();
    expect(await screen.findByText('Held for a request')).toBeTruthy();
    expect(screen.getByText('Tickets work at every branch.')).toBeTruthy();
    expect(screen.getByText('Cashed out')).toBeTruthy();
    expect(calls('guest_tickets')[0]![1]).toEqual({ p_customer_id: 'c1' });
  });

  it('allowed: Cash out with the server’s figures, confirmed, for that purchase', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId('ticket-purchase');
    await user.click(within(rowOf('p-ok')).getByRole('button', { name: `Cash out ${TWO} · 20,000 IQD` }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(`Refund ${TWO} (20,000 IQD) to the card they were bought with?`)).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Cash out' }));
    await waitFor(() => expect(calls('ticket_cashout')).toHaveLength(1));
    expect(calls('ticket_cashout')[0]![1]).toEqual({ p_customer_id: 'c1', p_purchase_payment_id: 'p-ok' });
  });

  it('Arabic: after the verbal nouns the dual is genitive (استرداد تذكرتين، ردّ تذكرتين)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('touch-operator-locale', 'ar');
    try {
      mount();
      await screen.findAllByTestId('ticket-purchase');
      const button = within(rowOf('p-ok')).getByRole('button', { name: /^استرداد تذكرتين · / });
      await user.click(button);
      expect(within(await screen.findByRole('dialog')).getByText(/^ردّ تذكرتين \(/)).toBeTruthy();
    } finally {
      localStorage.removeItem('touch-operator-locale');
    }
  });

  it('shows three purchases, then View more reveals the rest and Show less folds them', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findAllByTestId('ticket-purchase')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    expect(screen.getAllByTestId('ticket-purchase')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getAllByTestId('ticket-purchase')).toHaveLength(3);
  });

  it('the three waiting reasons: the button disabled and the sentence that says until when', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId('ticket-purchase');
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    const inUse = within(rowOf('p-inuse'));
    expect((inUse.getByRole('button', { name: /^Cash out one ticket/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(inUse.getByText(/^A ticket from this purchase is in a match until .+\. Cash out after that\.$/)).toBeTruthy();
    expect(within(rowOf('p-reserved')).getByText(/^A ticket from this purchase is held for a request until .+\.$/)).toBeTruthy();
    expect(
      within(rowOf('p-restorable')).getByText('A ticket from this purchase was lost today and can still be given back until the day is closed. Cash out after day close.'),
    ).toBeTruthy();
  });

  it('a purchase already refunded offers no button and says when', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findAllByTestId('ticket-purchase');
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    const done = within(rowOf('p-done'));
    expect(done.queryByRole('button')).toBeNull();
    expect(done.getByText(/^Refunded /)).toBeTruthy();
    expect(done.getByText('Test')).toBeTruthy();
  });

  it('court_desk sees the wallet but no cash-out', async () => {
    caps = { ...MANAGER, cashOutTickets: false, banFromMatches: false, reviewMatchReports: false };
    mount();
    await screen.findAllByTestId('ticket-purchase');
    expect(screen.queryByRole('button', { name: /^Cash out/ })).toBeNull();
    expect(screen.queryByText(/in a match until/)).toBeNull();
  });

  it('a TICKET_IN_USE refusal reads its detail into the same sentence', async () => {
    const user = userEvent.setup();
    cashoutAnswer = () => {
      throw new AppRpcError('TICKET_IN_USE', 'TICKET_IN_USE', undefined, JSON.stringify({ reason: 'reserved', count: 1, until_at: '2026-09-30T15:00:00Z' }));
    };
    mount();
    await screen.findAllByTestId('ticket-purchase');
    await user.click(within(rowOf('p-ok')).getByRole('button', { name: `Cash out ${TWO} · 20,000 IQD` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cash out' }));
    expect(await within(rowOf('p-ok')).findByText(/^A ticket from this purchase is held for a request until .+\.$/)).toBeTruthy();
    // The reading was stale: the purchases are read again.
    await waitFor(() => expect(calls('guest_tickets').length).toBeGreaterThan(1));
  });

  it('shows nothing on a server without open matches, and nothing to a role without runMatches', async () => {
    rpc.mockImplementation(async () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <LocaleProvider>
          <TicketsPanel customerId="c1" />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(container.querySelector('[data-testid="customer-tickets"]')).toBeNull());
    caps = { ...MANAGER, runMatches: false };
    mount();
    expect(screen.queryByTestId('customer-tickets')).toBeNull();
  });
});

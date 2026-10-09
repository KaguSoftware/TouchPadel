import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { appRpc } from '../../lib/appRpc';
import { DepositSettingsPanel } from './DepositSettingsPanel';
import { DepositAttentionPanel } from './DepositAttentionPanel';
import type { DepositAttentionRow, DepositSettings } from './depositApi';

// Both panels over a real query client; the server is appRpc, mocked per RPC
// name, so what each screen SENDS is what is asserted.

const SETTINGS: DepositSettings = {
  venue_id: 'v1',
  deposit_mode: 'off',
  deposit_percent_bp: 5000,
  deposit_min_iqd: 10000,
  deposit_max_iqd: null,
  deposit_window_seconds: 900,
  deposit_forfeit_no_show: true,
};

let settings: DepositSettings = SETTINGS;
let attention: DepositAttentionRow[] = [];

vi.mock('../../lib/appRpc', () => ({
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
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'deposit_settings') return settings;
    if (fn === 'set_deposit_settings') return { ...settings, ...(args.p_patch as object) };
    if (fn === 'deposit_attention') return attention;
    return {};
  }),
}));
vi.mock('../../lib/idem', () => ({ deviceId: () => 'DESK-1' }));
const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad' }) };
});
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));

function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

function row(over: Partial<DepositAttentionRow> = {}): DepositAttentionRow {
  return {
    id: 'pay-1',
    request_id: 'req-1',
    reservation_id: 'res-1',
    guest_name: 'Sara',
    guest_phone: '+9647700000000',
    amount_iqd: 20000,
    refund_amount_iqd: 20000,
    status: 'refund_failed',
    refund_reason: 'guest_cancel',
    refund_requested_at: '2026-09-25T10:00:00Z',
    refund_attempts: 3,
    succeeded_at: '2026-09-24T09:00:00Z',
    sandbox: false,
    court_name_en: 'Court 1',
    court_name_ar: 'ملعب 1',
    start_at: '2026-09-26T17:00:00Z',
    ...over,
  };
}

const calls = (fn: string) => vi.mocked(appRpc).mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  settings = SETTINGS;
  attention = [];
  vi.mocked(appRpc).mockClear();
});

describe('DepositSettingsPanel', () => {
  it('the owner turns deposits on: only the changed keys go, in the server units, for this branch', async () => {
    const user = userEvent.setup();
    mount(<DepositSettingsPanel canEdit />);
    await user.click(await screen.findByRole('radio', { name: /Optional/ }));
    const percent = screen.getByRole('textbox', { name: /^Deposit size/ });
    await user.clear(percent);
    await user.type(percent, '30');
    const payWindow = screen.getByRole('textbox', { name: /^Time to pay/ });
    await user.clear(payWindow);
    await user.type(payWindow, '10');
    await user.click(screen.getByRole('button', { name: 'Save deposit rules' }));
    await waitFor(() => expect(calls('set_deposit_settings')).toHaveLength(1));
    expect(calls('set_deposit_settings')[0]![1]).toEqual({
      p_patch: { deposit_mode: 'optional', deposit_percent_bp: 3000, deposit_window_seconds: 600 },
      p_venue_id: null,
    });
  });

  it('a cap below the minimum is refused before anything is sent', async () => {
    const user = userEvent.setup();
    mount(<DepositSettingsPanel canEdit />);
    await user.type(await screen.findByRole('textbox', { name: /Largest deposit/ }), '5000');
    await user.click(screen.getByRole('button', { name: 'Save deposit rules' }));
    expect(await screen.findByText('The largest deposit cannot be less than the smallest.')).toBeTruthy();
    expect(calls('set_deposit_settings')).toHaveLength(0);
  });

  it('a manager reads the rules and is told who changes them', async () => {
    mount(<DepositSettingsPanel canEdit={false} />);
    expect(await screen.findByText('Only the owner can change the online deposit rules.')).toBeTruthy();
    expect(screen.getByText('50% of the court price')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('DepositAttentionPanel', () => {
  it('says nothing on the home while deposits are off and nothing waits', async () => {
    mount(<DepositAttentionPanel />);
    await waitFor(() => expect(calls('deposit_settings')).toHaveLength(1));
    expect(screen.queryByTestId('deposit-attention')).toBeNull();
  });

  it('shows its empty state once deposits are on', async () => {
    settings = { ...SETTINGS, deposit_mode: 'optional' };
    mount(<DepositAttentionPanel />);
    expect(await screen.findByText('Nothing waiting. Every online refund has gone through.')).toBeTruthy();
  });

  // Owner call 2026-10-08: three rows, then "View more".
  it('shows three refunds and folds the rest behind "View more"', async () => {
    const user = userEvent.setup();
    attention = ['Ali', 'Bana', 'Dalia', 'Huda', 'Zaid'].map((name, i) => row({ id: `pay-${i}`, guest_name: name }));
    mount(<DepositAttentionPanel hideWhenEmpty />);
    const panel = within(await screen.findByTestId('deposit-attention'));
    await waitFor(() => expect(panel.getAllByText('Refund failed')).toHaveLength(3));
    await user.click(panel.getByRole('button', { name: 'View more (2)' }));
    expect(panel.getAllByText('Refund failed')).toHaveLength(5);
  });

  it('a failed refund: Retry sends it again', async () => {
    const user = userEvent.setup();
    attention = [row()];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    expect(await screen.findByText('Refund failed')).toBeTruthy();
    expect(screen.getByText(/Why: the guest cancelled/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls('deposit_refund_retry')).toHaveLength(1));
    expect(calls('deposit_refund_retry')[0]![1]).toEqual({ p_payment_id: 'pay-1' });
  });

  it('R23: a slow refund offers no Settle and no Retry, and says it waits on Qi', async () => {
    attention = [row({ status: 'refund_pending' })];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    expect(await screen.findByText('Refund not confirmed')).toBeTruthy();
    expect(screen.getByText("Qi hasn't answered yet. It is retried on its own and moves here as failed if it keeps failing.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Settled another way' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('settled another way: needs a note and a PIN, and sends both with this station', async () => {
    const user = userEvent.setup();
    attention = [row({ status: 'refund_failed', sandbox: true })];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    expect(await screen.findByText('Test')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Settled another way' }));
    const dialog = within(await screen.findByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: 'Mark as settled' });
    await user.type(dialog.getByRole('textbox', { name: /How was it settled/ }), 'Cash at the desk');
    await user.click(confirm);
    expect(calls('deposit_refund_manual')).toHaveLength(0);
    await user.type(dialog.getByLabelText(/^PIN/), '4821');
    await user.click(confirm);
    await waitFor(() => expect(calls('deposit_refund_manual')).toHaveLength(1));
    expect(calls('deposit_refund_manual')[0]![1]).toEqual({ p_payment_id: 'pay-1', p_pin: '4821', p_note: 'Cash at the desk', p_device_id: 'DESK-1' });
  });

  it('a ticket refund: tickets and name, any branch can settle it, and it opens the customer', async () => {
    const user = userEvent.setup();
    attention = [
      row({
        purpose: 'ticket',
        reservation_id: null,
        court_name_en: null,
        court_name_ar: null,
        start_at: null,
        ticket_count: 2,
        customer_id: 'cust-1',
        refund_reason: 'ticket_cashout',
      }),
    ];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    expect(await screen.findByText(/^Ticket refund · .*2.* tickets · .*Sara/)).toBeTruthy();
    expect(screen.getByText('Any branch can settle this')).toBeTruthy();
    expect(screen.getByText(/Why: tickets cashed out/)).toBeTruthy();
    // A failed ticket refund is retried or settled like a deposit's.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settled another way' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open customer' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/customers/$id', params: { id: 'cust-1' } });
  });

  // Coaching (coaching operator.md §5.17).
  it('a lesson refund: "Lesson refund · {name}", its reason, and it opens the lesson and the customer', async () => {
    const user = userEvent.setup();
    attention = [
      row({
        purpose: 'lesson',
        reservation_id: null,
        court_name_en: null,
        court_name_ar: null,
        lesson_id: 'lesson-1',
        enrolment_id: 'enr-1',
        customer_id: 'cust-1',
        refund_reason: 'coach_cancel',
      }),
    ];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    expect(await screen.findByText(/^Lesson refund · .*Sara/)).toBeTruthy();
    expect(screen.getByText(/Why: the coach cancelled/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open lesson' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/lessons/$id', params: { id: 'lesson-1' } });
    await user.click(screen.getByRole('button', { name: 'Open customer' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/desk/customers/$id', params: { id: 'cust-1' } });
  });

  it('PAYMENT_STATE lesson_live: refunding a lesson still on says to cancel the sign-up first', async () => {
    const user = userEvent.setup();
    attention = [
      row({ purpose: 'lesson', lesson_id: 'lesson-1', customer_id: 'cust-1', status: 'succeeded', refund_amount_iqd: null, refund_requested_at: null, refund_reason: null }),
    ];
    const { AppRpcError } = await import('../../lib/appRpc');
    vi.mocked(appRpc).mockImplementation(async (fn: string) => {
      if (fn === 'deposit_attention') return attention;
      if (fn === 'deposit_refund_request') throw new AppRpcError('PAYMENT_STATE', 'PAYMENT_STATE', undefined, 'lesson_live');
      return {};
    });
    mount(<DepositAttentionPanel hideWhenEmpty />);
    await user.click(await screen.findByRole('button', { name: 'Refund to guest' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText("This lesson is still on. Cancel the sign-up from the lesson's screen; its refund follows.")).toBeTruthy();
  });

  it('a paid deposit on a booking that is no longer on is refunded after a confirm', async () => {
    const user = userEvent.setup();
    attention = [row({ status: 'succeeded', refund_amount_iqd: null, refund_requested_at: null, refund_reason: null })];
    mount(<DepositAttentionPanel hideWhenEmpty />);
    await user.click(await screen.findByRole('button', { name: 'Refund to guest' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Refund' }));
    await waitFor(() => expect(calls('deposit_refund_request')).toHaveLength(1));
    expect(calls('deposit_refund_request')[0]![1]).toEqual({ p_payment_id: 'pay-1' });
  });
});

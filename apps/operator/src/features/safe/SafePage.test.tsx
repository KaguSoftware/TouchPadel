import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';

// /safe (0343): the balance, the always-open Pay form, Move cash and Count,
// and the month's movements. Every figure is the server's.

const navigate = vi.fn();
const toastOk = vi.fn();
// The query the page opened with: `?show=payments` is Pay › Bills & suppliers.
let search: Record<string, string> = {};
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate, useSearch: () => search }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: toastOk, info: vi.fn(), err: vi.fn() }) }));

const overview = () => ({
  month: '2026-10-01',
  current_month: '2026-10-01',
  today: '2026-10-16',
  balance_iqd: 900000,
  today_figures: { in_iqd: 1000000, out_iqd: 100000 },
  last_count: null,
  costs: [{ category: 'supplier', total_iqd: 200000, count: 1, from_bank_iqd: 200000 }],
  costs_total_iqd: 200000,
  entries: [
    {
      id: 'e-adv', kind: 'payment', amount_iqd: 100000, delta_iqd: -100000, paid_from: 'safe', category: 'advance',
      payee: null, payee_hidden: true, note: null, box: null, source: 'wage_advance', occurred_on: '2026-10-16',
      logged_at: '2026-10-16T12:00:00Z', logged_by_name: 'Owner', voided_at: null, voided_by_name: null, void_reason: null,
      balance_after_iqd: 900000,
    },
    {
      id: 'e-in', kind: 'hand_in', amount_iqd: 1000000, delta_iqd: 1000000, paid_from: null, category: null,
      payee: null, payee_hidden: false, note: null, box: 'desk', source: 'day_close', occurred_on: '2026-10-16',
      logged_at: '2026-10-16T01:00:00Z', logged_by_name: 'Maha', voided_at: null, voided_by_name: null, void_reason: null,
      balance_after_iqd: 1000000,
    },
  ],
  payees: [{ category: 'supplier', payee: 'Ice supplier' }],
  boxes: ['cafe', 'desk'],
  is_owner: false,
});

let payResult: () => unknown = () => ({ id: 'new', balance_iqd: 650000 });
const calls: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'main_cash_overview':
        return overview();
      case 'main_cash_pay':
        return payResult();
      case 'main_cash_move':
        return { id: 'm', balance_iqd: 1200000 };
      case 'main_cash_count':
        return { id: 'c', balance_iqd: 895000, difference_iqd: -5000 };
      case 'main_cash_void':
        return { id: args.p_id, status: 'voided', balance_iqd: 0 };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { SafePageScreen } from './SafePage';

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <SafePageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  payResult = () => ({ id: 'new', balance_iqd: 650000 });
  calls.length = 0;
  toastOk.mockClear();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('SafePageScreen', () => {
  it('pays a cost in three choices, with the button saying what it will do', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('safe.today');

    const submit = screen.getByTestId('safe.pay.submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(screen.getByTestId('safe.pay')).getAllByRole('textbox')[0]!, '250000');
    await user.click(screen.getByTestId('safe.pay.category.supplier'));
    await user.type(screen.getByTestId('safe.pay.payee'), 'Ice supplier');
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(submit.textContent).toMatch(/from the safe/);

    await user.click(submit);
    await waitFor(() => expect(calls.some((c) => c.fn === 'main_cash_pay')).toBe(true));
    const sent = calls.find((c) => c.fn === 'main_cash_pay')!.args;
    expect(sent).toMatchObject({ p_amount_iqd: 250000, p_category: 'supplier', p_payee: 'Ice supplier', p_paid_from: 'safe', p_note: null });
    expect(String(sent.p_idempotency_key)).toMatch(/^safe\.pay:/);
    await waitFor(() => expect(toastOk).toHaveBeenCalled());
  });

  it('logs a bank transfer, and warns before taking the safe below zero', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('safe.today');
    await user.type(within(screen.getByTestId('safe.pay')).getAllByRole('textbox')[0]!, '1000000');
    await user.click(screen.getByTestId('safe.pay.category.rent'));
    expect(screen.getByText(/takes it below zero/)).toBeTruthy();

    await user.click(screen.getByTestId('safe.pay.from.bank'));
    expect(screen.queryByText(/takes it below zero/)).toBeNull();
    expect(screen.getByTestId('safe.pay.submit').textContent).toMatch(/paid by bank/);
    await user.click(screen.getByTestId('safe.pay.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'main_cash_pay')?.args).toMatchObject({ p_paid_from: 'bank', p_category: 'rent' }));
  });

  it('shows a refusal beside the form', async () => {
    payResult = () => {
      throw new AppRpcError('FORBIDDEN', 'FORBIDDEN');
    };
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('safe.today');
    await user.type(within(screen.getByTestId('safe.pay')).getAllByRole('textbox')[0]!, '5000');
    await user.click(screen.getByTestId('safe.pay.category.other'));
    await user.click(screen.getByTestId('safe.pay.submit'));
    await waitFor(() => expect(within(screen.getByTestId('safe.pay')).getByRole('alert')).toBeTruthy());
    expect(toastOk).not.toHaveBeenCalled();
  });

  it('moves a drawer box into the safe', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('safe.today');
    await user.click(screen.getByTestId('safe.mode.move'));
    await user.click(screen.getByTestId('safe.move.party.desk'));
    await user.type(within(screen.getByTestId('safe.move')).getAllByRole('textbox')[0]!, '300000');
    expect(screen.getByTestId('safe.move.submit').textContent).toMatch(/into the safe/);
    await user.click(screen.getByTestId('safe.move.submit'));
    await waitFor(() =>
      expect(calls.find((c) => c.fn === 'main_cash_move')?.args).toMatchObject({ p_kind: 'hand_in', p_box: 'desk', p_amount_iqd: 300000 }),
    );
  });

  it('counts against the balance it showed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('safe.today');
    await user.click(screen.getByTestId('safe.mode.count'));
    await user.type(within(screen.getByTestId('safe.count')).getAllByRole('textbox')[0]!, '895000');
    await user.click(screen.getByTestId('safe.count.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'main_cash_count')?.args).toMatchObject({ p_counted_iqd: 895000, p_expected_iqd: 900000 }));
    await waitFor(() => expect(toastOk).toHaveBeenCalledWith(expect.stringMatching(/short/)));
  });

  it('hides the person on an advance from a manager, and sends a wage row to its page', async () => {
    renderPage();
    const row = await screen.findByTestId('safe.entry.e-adv');
    expect(row.textContent).toMatch(/A staff member/);
    expect(row.textContent).toMatch(/Wages page/);
    expect(screen.queryByTestId('safe.entry.void.e-adv')).toBeNull();
    expect(screen.getByTestId('safe.entry.void.e-in')).toBeTruthy();
  });

  it('takes back a row with a reason', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('safe.entry.void.e-in'));
    expect((screen.getByTestId('safe.void.confirm') as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByTestId('safe.void.reason'), 'Logged twice');
    await user.click(screen.getByTestId('safe.void.confirm'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'main_cash_void')?.args).toEqual({ p_id: 'e-in', p_reason: 'Logged twice' }));
  });

  it('opens on what was paid out when reached as Bills & suppliers', async () => {
    search = { show: 'payments' };
    renderPage();
    expect((await screen.findByTestId('safe.ledger.filter.payments')).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('safe.entry.void.e-in')).toBeNull();
  });

  it('reads in Arabic', async () => {
    renderPage('ar');
    expect(await screen.findByText('في القاصة')).toBeTruthy();
    expect(screen.getByTestId('safe.pay.category.supplier').textContent).toMatch('مورّد');
  });
});

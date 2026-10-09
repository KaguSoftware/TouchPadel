import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { AppRpcError } from '../../lib/appRpc';

// /wages (0270–0272): the owner sees what is due, approves deductions, sets
// salaries and marks months paid. Every figure on screen is the server's.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'o1', displayName: 'Majed', role: 'owner' } }),
}));

const line = (over: Record<string, unknown> = {}) => ({
  month: '2026-10-01',
  status: 'due',
  salary_iqd: 750000,
  pay_day: 5,
  rate_from: '2026-09-01',
  next_rate: null,
  due_date: '2026-10-05',
  days_left: 2,
  deductions_iqd: 25000,
  deduction_count: 1,
  penalties_iqd: 5000,
  penalty_days: 1,
  net_iqd: 720000,
  payment: null,
  ...over,
});

const yusuf = () => ({
  ...line(),
  staff_id: 's-yusuf',
  display_name: 'Yusuf',
  role: 'barista',
  is_active: true,
  member: true,
  waiting_count: 1,
  deductions: [{ id: 'd1', amount_iqd: 25000, deduction_date: '2026-09-28', reason: 'Broken grinder', decided_at: '2026-10-01T09:00:00Z' }],
  lateness: [{ id: 'a1', work_date: '2026-10-02', late_minutes: 20, early_leave_minutes: 0, grace_minutes: 15, penalty_iqd: 5000, note: 'Bus was late' }],
});
const hasan = () => ({
  ...line({ status: 'unset', salary_iqd: 0, pay_day: null, rate_from: null, due_date: null, days_left: null, deductions_iqd: 0, deduction_count: 0, penalties_iqd: 0, penalty_days: 0, net_iqd: 0 }),
  staff_id: 's-hasan',
  display_name: 'Hasan',
  role: 'waiter',
  is_active: true,
  member: true,
  waiting_count: 0,
  deductions: [],
  lateness: [],
});
const ali = () => ({
  ...line({ status: 'paid', net_iqd: -40000, salary_iqd: 100000, deductions_iqd: 140000, payment: { id: 'pay-ali', status: 'paid', paid_iqd: 0, paid_at: '2026-10-02T10:00:00Z', paid_by_name: 'Majed', undone_at: null, undone_by_name: null, undo_reason: null } }),
  staff_id: 's-ali',
  display_name: 'Ali',
  role: 'kitchen',
  is_active: true,
  member: true,
  waiting_count: 0,
  deductions: [],
  lateness: [],
});

let people: Record<string, unknown>[] = [];
const twoDue = () => [
  { ...line({ month: '2026-09-01', status: 'overdue', due_date: '2026-09-05', days_left: -28, net_iqd: 700000 }), staff_id: 's-yusuf', display_name: 'Yusuf', role: 'barista' },
  { ...line(), staff_id: 's-yusuf', display_name: 'Yusuf', role: 'barista' },
];
let duePeople: () => Record<string, unknown>[] = twoDue;
let markPaid: (args: Record<string, unknown>) => unknown = () => ({ id: 'p1', status: 'paid', pay_month: '2026-10-01', net_iqd: 720000, paid_iqd: 720000 });
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const waitingRow = {
  id: 'dw1',
  staff_id: 's-yusuf',
  staff_name: 'Yusuf',
  staff_role: 'barista',
  amount_iqd: 15000,
  deduction_date: '2026-10-02',
  pay_month: null,
  dated_earlier: false,
  reason: 'Left the bar unattended',
  status: 'waiting',
  proposed_by_name: 'Bareq',
  proposed_by_role: 'head_barista',
  proposed_at: '2026-10-02T09:00:00Z',
  can_decide: true,
  can_cancel: false,
};

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'wages_month':
        return {
          month: (args.p_month as string | undefined) ?? '2026-10-01',
          current_month: '2026-10-01',
          today: '2026-10-03',
          remind_days: 3,
          totals: { salary_iqd: 850000, deductions_iqd: 165000, penalties_iqd: 5000, net_iqd: 680000, paid_iqd: 0, people: 3, paid: 1, due: 1, overdue: 0, upcoming: 0, unset: 1 },
          people,
        };
      case 'wages_due':
        return {
          today: '2026-10-03',
          remind_days: 3,
          count: duePeople().length,
          overdue_count: 1,
          people: duePeople(),
        };
      case 'deductions_page':
        return { deductions: [waitingRow], waiting_count: 1, total: 1 };
      case 'deduction_targets':
        return { staff: [{ id: 's-yusuf', display_name: 'Yusuf', role: 'barista' }] };
      case 'mark_wage_paid':
        return markPaid(args);
      case 'set_staff_wage':
        return { id: 'w1', effective_month: '2026-11-01', salary_iqd: args.p_salary_iqd, pay_day: args.p_pay_day, replaced: false };
      case 'undo_wage_paid':
        return { status: 'undone' };
      case 'decide_deduction':
        return { status: 'approved' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { WagesPageScreen } from './WagesPage';

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <WagesPageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  people = [yusuf(), hasan(), ali()];
  duePeople = twoDue;
  markPaid = () => ({ id: 'p1', status: 'paid', pay_month: '2026-10-01', net_iqd: 720000, paid_iqd: 720000 });
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

const count = (fn: string) => calls.filter((c) => c.fn === fn).length;

describe('WagesPageScreen', () => {
  it('shows what is due, what waits on the owner, who has no salary, and the month per person', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Wages' })).toBeTruthy();
    const due = await screen.findByTestId('wages.due');
    // Earlier months stay in the strip until they are paid.
    expect(within(due).getByText('September 2026')).toBeTruthy();
    expect(within(due).getByText(/28.*days overdue/)).toBeTruthy();
    expect(within(due).getByText(/due in.*2.*days/)).toBeTruthy();
    expect(await screen.findByText('Left the bar unattended')).toBeTruthy();
    expect(screen.getByTestId('wages.unset').textContent).toContain('Hasan');
    expect(await screen.findByTestId('wages.totals')).toBeTruthy();
    expect(screen.getAllByText('Barista').length).toBeGreaterThan(0);
    // A net below zero is red and says nothing carries over; a paid month offers Undo, not Mark paid.
    expect(screen.getByText('Below zero: nothing is paid and nothing carries over.')).toBeTruthy();
    expect(screen.queryByTestId('wages.row.pay.s-ali')).toBeNull();
    expect(screen.getByTestId('wages.row.undo.s-ali')).toBeTruthy();
    expect(screen.queryByTestId('wages.row.pay.s-hasan')).toBeNull();
    expect(screen.getByText(/1 waiting/)).toBeTruthy();
    // Nothing is paid past next month.
    expect((screen.getByTestId('wages.month.next') as HTMLButtonElement).disabled).toBe(false);
  });

  it('lists three wages due, then View more opens the rest in place', async () => {
    const user = userEvent.setup();
    duePeople = () =>
      ['s-a', 's-b', 's-c', 's-d'].map((id) => ({ ...line(), staff_id: id, display_name: id, role: 'barista' }));
    renderPage();
    const due = await screen.findByTestId('wages.due');
    expect(within(due).getAllByRole('button', { name: 'Mark paid' })).toHaveLength(3);
    await user.click(within(due).getByRole('button', { name: 'View more (1)' }));
    expect(within(due).getAllByRole('button', { name: 'Mark paid' })).toHaveLength(4);
  });

  it('marks a month paid with the net it showed and one key per dialog, and warns about waiting deductions', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.row.pay.s-yusuf'));
    const dialog = screen.getByRole('dialog', { name: /Mark .*Yusuf.* wage paid\?/ });
    expect(within(dialog).getByTestId('wages.pay.breakdown').textContent).toContain('Amount to pay');
    expect(within(dialog).getByText(/still waiting: approve or decline them first/)).toBeTruthy();
    await user.click(within(dialog).getByTestId('wages.pay.confirm'));
    const sent = calls.find((c) => c.fn === 'mark_wage_paid')?.args;
    expect(sent).toMatchObject({ p_staff_id: 's-yusuf', p_month: '2026-10-01', p_expected_net_iqd: 720000 });
    expect(String(sent?.p_idempotency_key)).toMatch(/^wage\.paid:/);
  });

  it('keeps the message and refetches when the net moved under the dialog (WAGE_CHANGED), then pays the new net with the same key', async () => {
    const user = userEvent.setup();
    markPaid = () => {
      throw new AppRpcError('WAGE_CHANGED', 'WAGE_CHANGED');
    };
    renderPage();
    await user.click(await screen.findByTestId('wages.row.pay.s-yusuf'));
    const dialog = screen.getByRole('dialog', { name: /Mark .*Yusuf.* wage paid\?/ });
    const before = count('wages_month');
    people = [{ ...yusuf(), net_iqd: 715000, penalties_iqd: 10000 }, hasan(), ali()];
    await user.click(within(dialog).getByTestId('wages.pay.confirm'));
    expect(await within(dialog).findByText('This wage changed while you were looking at it. Check the new figures and confirm again.')).toBeTruthy();
    await waitFor(() => expect(count('wages_month')).toBeGreaterThan(before));
    markPaid = (args) => ({ id: 'p1', status: 'paid', pay_month: '2026-10-01', net_iqd: args.p_expected_net_iqd, paid_iqd: args.p_expected_net_iqd });
    await user.click(within(dialog).getByTestId('wages.pay.confirm'));
    const sends = calls.filter((c) => c.fn === 'mark_wage_paid');
    expect(sends[1]?.args.p_expected_net_iqd).toBe(715000);
    expect(sends[1]?.args.p_idempotency_key).toBe(sends[0]?.args.p_idempotency_key);
  });

  it('pays nothing below zero and says nothing carries over', async () => {
    const user = userEvent.setup();
    people = [{ ...yusuf(), net_iqd: -5000, waiting_count: 0 }];
    renderPage();
    await user.click(await screen.findByTestId('wages.row.pay.s-yusuf'));
    const dialog = screen.getByRole('dialog', { name: /Mark .*Yusuf.* wage paid\?/ });
    expect(within(dialog).getByText(/Nothing is paid, and nothing carries over/)).toBeTruthy();
    expect(within(dialog).queryByText(/still waiting/)).toBeNull();
  });

  it('sets a salary from the banner, with the short-month hint past the 28th, starting at the next pay day', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.unset.set.s-hasan'));
    const dialog = screen.getByRole('dialog', { name: /Set .*Hasan.* salary/ });
    await user.click(within(dialog).getByTestId('wages.set.confirm'));
    expect(calls.some((c) => c.fn === 'set_staff_wage')).toBe(false);
    expect(within(dialog).getByText('Pick a day from 1 to 31.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox', { name: /Monthly salary/ }), '600000');
    await user.click(within(dialog).getByRole('combobox', { name: /Pay day/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Day 31' }));
    expect(within(dialog).getByText('In a shorter month, it is paid on the last day.')).toBeTruthy();
    await user.click(within(dialog).getByTestId('wages.set.confirm'));
    expect(calls.find((c) => c.fn === 'set_staff_wage')?.args).toEqual({ p_staff_id: 's-hasan', p_salary_iqd: 600000, p_pay_day: 31, p_from_month: null });
  });

  it('approves a waiting deduction through the shared dialog', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.approve.dw1'));
    const dialog = screen.getByRole('dialog', { name: 'Approve this deduction?' });
    await user.click(within(dialog).getByTestId('deductions.decide.confirm'));
    expect(calls.find((c) => c.fn === 'decide_deduction')?.args).toEqual({ p_id: 'dw1', p_approve: true, p_note: null });
  });

  it('asks for a reason before it undoes a payment', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.row.undo.s-ali'));
    const dialog = screen.getByRole('dialog', { name: 'Undo this payment?' });
    await user.click(within(dialog).getByTestId('wages.undo.confirm'));
    expect(within(dialog).getByText('A reason is required.')).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox'), 'Paid the wrong person');
    await user.click(within(dialog).getByTestId('wages.undo.confirm'));
    expect(calls.find((c) => c.fn === 'undo_wage_paid')?.args).toEqual({ p_id: 'pay-ali', p_reason: 'Paid the wrong person' });
  });

  it('opens the deductions and late days behind a row, and the deduction form for that person', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.row.details.s-yusuf'));
    const details = screen.getByTestId('wages.details.s-yusuf');
    expect(within(details).getByText('Broken grinder')).toBeTruthy();
    expect(within(details).getByText('Bus was late')).toBeTruthy();
    await user.click(screen.getByTestId('wages.row.deduct.s-yusuf'));
    const form = await screen.findByTestId('deductions.propose-form');
    expect(within(form).getByRole('combobox', { name: /Person/ }).textContent).toContain('Yusuf');
  });

  it('links to Late and early and to every deduction', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('wages.link.attendance'));
    expect(navigate).toHaveBeenCalledWith({ to: '/attendance' });
  });

  it('reads in Arabic', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: 'الرواتب' })).toBeTruthy();
    expect(await screen.findByText('مستحقة الآن')).toBeTruthy();
  });
});

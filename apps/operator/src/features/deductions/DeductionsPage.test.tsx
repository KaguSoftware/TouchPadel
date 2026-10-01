import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// /deductions (wave5-addendum-2026-09-25 §2.5, §5.2; 0272): the owner alone
// decides what heads and managers propose, and takes an approval back until
// the month's wage is paid; a manager sees what waits for the owner. A
// proposal the viewer sent offers Withdraw, and only that one.

let role: StaffRole = 'manager';
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'm1', displayName: 'Omar', role } }),
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  staff_id: 's-yusuf',
  staff_name: 'Yusuf',
  staff_role: 'barista',
  amount_iqd: 25000,
  deduction_date: '2026-09-20',
  pay_month: null,
  dated_earlier: false,
  reason: 'Late three times this week',
  status: 'waiting',
  proposed_by_name: 'Bareq',
  proposed_by_role: 'head_barista',
  proposed_at: '2026-09-20T09:00:00Z',
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  cancelled_by_name: null,
  cancelled_at: null,
  cancel_reason: null,
  can_decide: true,
  can_withdraw: false,
  can_cancel: false,
  ...over,
});

let waiting: Record<string, unknown>[] = [];
const month = {
  month: '2026-09-01',
  totals: { approved_iqd: 50000, approved_count: 1, waiting_iqd: 25000, waiting_count: 1, people: 1 },
  people: [
    {
      staff_id: 's-hussein',
      display_name: 'Hussein',
      role: 'assistant_barista',
      is_active: true,
      approved_iqd: 50000,
      approved_count: 1,
      waiting_iqd: 25000,
      waiting_count: 1,
      wage_paid: false,
      deductions: [
        { id: 'd9', amount_iqd: 50000, deduction_date: '2026-08-30', dated_earlier: true, reason: 'Broken grinder', status: 'approved', proposed_by_name: 'Bareq', decided_by_name: 'Omar', decided_at: '2026-09-02T10:00:00Z' },
      ],
    },
  ],
};
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'deductions_page':
        return args.p_filter === 'waiting'
          ? { deductions: waiting, waiting_count: waiting.length, total: waiting.length }
          : { deductions: [row({ id: 'd7', status: 'declined', can_decide: false, decided_by_name: 'Majed', decided_at: '2026-09-21T10:00:00Z', decision_note: 'Not on shift that day' })], waiting_count: 1, total: 1 };
      case 'deductions_month':
        return month;
      case 'deduction_targets':
        return { staff: [{ id: 's-yusuf', display_name: 'Yusuf', role: 'barista' }, { id: 's-hasan', display_name: 'Hasan', role: 'waiter' }] };
      case 'decide_deduction':
        return { status: args.p_approve ? 'approved' : 'declined', decided_at: '2026-09-26T10:00:00Z', pay_month: args.p_approve ? '2026-09-01' : null };
      case 'withdraw_deduction':
        return { status: 'withdrawn' };
      case 'cancel_deduction':
        return { status: 'cancelled', cancelled_at: '2026-09-26T10:00:00Z' };
      case 'propose_deduction':
        return role === 'owner' ? { id: 'dnew', status: 'approved', pay_month: '2026-09-01' } : { id: 'dnew', status: 'waiting' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { DeductionsPageScreen } from './DeductionsPage';

function renderPage(as: StaffRole = 'manager', locale: 'en' | 'ar' = 'en') {
  role = as;
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <DeductionsPageScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  waiting = [row()];
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('DeductionsPageScreen', () => {
  it('lists what waits on the owner and approves it with an optional note', async () => {
    const user = userEvent.setup();
    renderPage('owner');
    expect(await screen.findByText('Late three times this week')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waiting (1)' })).toBeTruthy();
    expect(screen.getByText('Head barista')).toBeTruthy();
    await user.click(screen.getByTestId('deductions.approve.d1'));
    const dialog = screen.getByRole('dialog', { name: 'Approve this deduction?' });
    await user.click(within(dialog).getByTestId('deductions.decide.confirm'));
    expect(calls.find((c) => c.fn === 'decide_deduction')?.args).toEqual({ p_id: 'd1', p_approve: true, p_note: null });
  });

  it('asks for a reason before it declines, and sends the reason the proposer reads', async () => {
    const user = userEvent.setup();
    renderPage('owner');
    await user.click(await screen.findByTestId('deductions.decline.d1'));
    const dialog = screen.getByRole('dialog', { name: 'Decline this deduction?' });
    await user.click(within(dialog).getByTestId('deductions.decide.confirm'));
    expect(within(dialog).getByText('A reason is required.')).toBeTruthy();
    expect(calls.some((c) => c.fn === 'decide_deduction')).toBe(false);
    await user.type(within(dialog).getByRole('textbox'), 'Not on shift that day');
    await user.click(within(dialog).getByTestId('deductions.decide.confirm'));
    expect(calls.find((c) => c.fn === 'decide_deduction')?.args).toEqual({ p_id: 'd1', p_approve: false, p_note: 'Not on shift that day' });
  });

  it('shows a manager a head’s proposal as waiting for the owner, with no Approve, Decline or Withdraw', async () => {
    waiting = [row({ can_decide: false })];
    renderPage('manager');
    expect(await screen.findByText('Late three times this week')).toBeTruthy();
    expect(screen.getByTestId('deductions.awaiting.d1').textContent).toBe('Waiting for the owner');
    expect(screen.queryByTestId('deductions.approve.d1')).toBeNull();
    expect(screen.queryByTestId('deductions.decline.d1')).toBeNull();
    expect(screen.queryByTestId('deductions.withdraw.d1')).toBeNull();
    // Nothing is the manager's to decide, so the tab carries no count.
    expect(screen.getByRole('button', { name: 'Waiting' })).toBeTruthy();
  });

  it('offers Withdraw, never Approve, only on a proposal the viewer sent (can_withdraw)', async () => {
    const user = userEvent.setup();
    waiting = [row({ id: 'd2', can_decide: false, can_withdraw: true, proposed_by_name: 'Omar', proposed_by_role: 'manager' }), row({ id: 'd3', can_decide: false })];
    renderPage('manager');
    expect(await screen.findByText('You proposed this. The owner decides it.')).toBeTruthy();
    expect(screen.queryByTestId('deductions.approve.d2')).toBeNull();
    expect(screen.queryByTestId('deductions.withdraw.d3')).toBeNull();
    expect(screen.getByTestId('deductions.awaiting.d3')).toBeTruthy();
    await user.click(screen.getByTestId('deductions.withdraw.d2'));
    await user.click(screen.getByRole('button', { name: 'Withdraw proposal' }));
    expect(calls.find((c) => c.fn === 'withdraw_deduction')?.args).toEqual({ p_id: 'd2' });
  });

  it('says so when nothing waits', async () => {
    waiting = [];
    renderPage('owner');
    expect(await screen.findByText('Nothing waiting')).toBeTruthy();
  });

  it('shows the All tab with each deduction’s status and the decider’s note', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    await user.click(await screen.findByRole('button', { name: 'All' }));
    expect(await screen.findByText('Declined')).toBeTruthy();
    expect(screen.getByText(/Not on shift that day/)).toBeTruthy();
    expect(calls.some((c) => c.fn === 'deductions_page' && c.args.p_filter === 'all')).toBe(true);
  });

  it('shows the month per person, flags a deduction from an earlier month, and lets the owner cancel an approval with a reason', async () => {
    const user = userEvent.setup();
    renderPage('owner');
    await user.click(await screen.findByRole('button', { name: 'Month' }));
    expect(await screen.findByTestId('deductions.month.totals')).toBeTruthy();
    // Nothing is paid in a month that has not started.
    expect((screen.getByTestId('deductions.month.next') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('deductions.person.s-hussein'));
    const item = screen.getByTestId('deductions.item.d9');
    expect(within(item).getByText('Broken grinder')).toBeTruthy();
    expect(within(item).getByText(/Happened in August 2026/)).toBeTruthy();
    await user.click(within(item).getByTestId('deductions.cancel.d9'));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this deduction?' });
    await user.click(within(dialog).getByTestId('deductions.cancel.confirm'));
    expect(calls.some((c) => c.fn === 'cancel_deduction')).toBe(false);
    await user.type(within(dialog).getByRole('textbox'), 'Approved by mistake');
    await user.click(within(dialog).getByTestId('deductions.cancel.confirm'));
    expect(calls.find((c) => c.fn === 'cancel_deduction')?.args).toEqual({ p_id: 'd9', p_reason: 'Approved by mistake' });
  });

  it('marks a paid month’s person “Wage paid” and offers the owner no Cancel there (WAGE_ALREADY_PAID)', async () => {
    const user = userEvent.setup();
    month.people[0]!.wage_paid = true;
    try {
      renderPage('owner');
      await user.click(await screen.findByRole('button', { name: 'Month' }));
      const person = await screen.findByTestId('deductions.person.s-hussein');
      expect(within(person).getByText('Wage paid')).toBeTruthy();
      await user.click(person);
      expect(screen.getByText('This month’s wage is paid, so its deductions can no longer be cancelled.')).toBeTruthy();
      expect(within(screen.getByTestId('deductions.item.d9')).queryByTestId('deductions.cancel.d9')).toBeNull();
    } finally {
      month.people[0]!.wage_paid = false;
    }
  });

  it('gives the manager no Cancel on the month (the owner’s alone)', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    await user.click(await screen.findByRole('button', { name: 'Month' }));
    await user.click(await screen.findByTestId('deductions.person.s-hussein'));
    expect(within(screen.getByTestId('deductions.item.d9')).queryByTestId('deductions.cancel.d9')).toBeNull();
  });

  it('proposes a deduction inline, with a key minted when the form opened', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    await user.click(await screen.findByTestId('deductions.propose'));
    const form = screen.getByTestId('deductions.propose-form');
    // Every rule is stated before the server would refuse it.
    await user.click(within(form).getByTestId('deductions.propose.submit'));
    expect(within(form).getAllByText('Fill this in.').length).toBeGreaterThan(0);
    expect(calls.some((c) => c.fn === 'propose_deduction')).toBe(false);

    await user.click(within(form).getByRole('combobox', { name: /Person/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Hasan/ }));
    await user.type(within(form).getByRole('textbox', { name: /Amount/ }), '15000');
    await user.type(within(form).getByTestId('deductions.propose.reason'), 'Left the floor unattended');
    await user.click(within(form).getByTestId('deductions.propose.submit'));
    const sent = calls.find((c) => c.fn === 'propose_deduction')?.args;
    expect(sent).toMatchObject({ p_staff_id: 's-hasan', p_amount_iqd: 15000, p_reason: 'Left the floor unattended' });
    expect(String(sent?.p_idempotency_key)).toMatch(/^deduction\.propose:/);
    expect(String(sent?.p_date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('records the owner’s own entry at once, and says it comes off the next unpaid wage', async () => {
    const user = userEvent.setup();
    renderPage('owner');
    await user.click(await screen.findByTestId('deductions.propose'));
    const form = screen.getByTestId('deductions.propose-form');
    expect(within(form).getByText(/Recorded at once: it comes off their next unpaid wage/)).toBeTruthy();
    expect(within(form).getByTestId('deductions.propose.submit').textContent).toContain('Deduct from wage');
  });

  it('tells a manager the owner approves the proposal under Wages', async () => {
    const user = userEvent.setup();
    renderPage('manager');
    await user.click(await screen.findByTestId('deductions.propose'));
    const form = screen.getByTestId('deductions.propose-form');
    expect(within(form).getByText(/The owner approves it under Wages/)).toBeTruthy();
    expect(within(form).getByTestId('deductions.propose.submit').textContent).toContain('Send for approval');
  });

  it('reads in Arabic', async () => {
    renderPage('owner', 'ar');
    expect(screen.getByRole('heading', { level: 1, name: 'الخصومات من الراتب' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'موافقة' })).toBeTruthy();
    expect(screen.getByText('رئيس الباريستا')).toBeTruthy();
  });
});

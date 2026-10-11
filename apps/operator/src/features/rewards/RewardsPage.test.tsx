import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';
import { AppRpcError } from '../../lib/appRpc';

// /rewards (0332–0333): the owner sets rewards per person, by name, and
// removes them behind a confirmation. Every count and amount is the server's.

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

const hasan = () => ({
  staff_id: 's-hasan',
  name: 'Hasan',
  role: 'waiter',
  count: 184,
  last_month_count: 120,
  rewards: [
    { id: 'r-200', target: 200, reward_iqd: 50000, prize: null, set_at: '2026-10-01T09:00:00Z' },
    { id: 'r-100', target: 100, reward_iqd: 0, prize: 'Dinner for two', set_at: '2026-10-01T09:00:00Z' },
  ],
});
const rusul = () => ({ staff_id: 's-rusul', name: 'Rusul', role: 'cashier', count: 0, last_month_count: 0, rewards: [] });
const full = () => ({
  staff_id: 's-full',
  name: 'Maha',
  role: 'manager',
  count: 3,
  last_month_count: 9,
  rewards: [1, 2, 3, 4, 5].map((n) => ({ id: `rf-${n}`, target: n * 10, reward_iqd: 1000, prize: null, set_at: null })),
});

let people: () => Record<string, unknown>[] = () => [hasan(), rusul(), full()];
let setReward: (args: Record<string, unknown>) => unknown = () => 'new-id';
let boardFails = false;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'staff_rewards_board':
        if (boardFails) throw new AppRpcError('FORBIDDEN', 'FORBIDDEN');
        return { month: '2026-10-01', month_end: '2026-10-31', days_left: 21, people: people() };
      case 'set_staff_reward':
        return setReward(args);
      case 'end_staff_reward':
        return null;
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { RewardsPageScreen } from './RewardsPage';

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmProvider>
          <RewardsPageScreen />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  people = () => [hasan(), rusul(), full()];
  setReward = () => 'new-id';
  boardFails = false;
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

const count = (fn: string) => calls.filter((c) => c.fn === fn).length;

describe('RewardsPageScreen', () => {
  it('lists each person by name with their orders and rewards, Reached once their own count gets there', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Rewards' })).toBeTruthy();
    expect(screen.getByText(/Each person sees only their own progress on their phone/)).toBeTruthy();
    expect(screen.getByText(/added to their wage the month after/)).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'October 2026' })).toBeTruthy();
    expect(screen.getByTestId('rewards.daysLeft').textContent).toMatch(/21.*days left/);
    expect(screen.getByText('Hasan')).toBeTruthy();
    expect(screen.getAllByText('Waiter').length).toBeGreaterThan(0);
    // Lowest target first: the prize at 100 is reached, the bonus at 200 is 16 away.
    const reached = screen.getByTestId('rewards.reward.r-100');
    expect(reached.textContent).toContain('Dinner for two');
    expect(within(reached).getByText('Reached')).toBeTruthy();
    const open = screen.getByTestId('rewards.reward.r-200');
    expect(open.textContent).toMatch(/50,000/);
    expect(open.textContent).toMatch(/16.*orders to go/);
    expect(within(open).queryByText('Reached')).toBeNull();
    expect(screen.getByText('No rewards set.')).toBeTruthy();
    // Five set: no Add reward, the limit instead.
    expect(screen.queryByTestId('rewards.row.add.s-full')).toBeNull();
    expect(screen.getByText(/rewards each: remove one to add another/)).toBeTruthy();
  });

  it('adds a reward: checks the form first, then sends the branch, the person and the figures', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('rewards.row.add.s-rusul'));
    const form = screen.getByTestId('rewards.add-form');
    expect(within(form).getByText(/Add a reward for .*Rusul/)).toBeTruthy();
    await user.click(within(form).getByTestId('rewards.form.save'));
    expect(count('set_staff_reward')).toBe(0);
    expect(within(form).getByText('Enter a number of orders from 1 to 100,000.')).toBeTruthy();
    expect(within(form).getByText('Enter a bonus, a prize, or both.')).toBeTruthy();
    await user.type(within(form).getByTestId('rewards.form.target'), '150');
    await user.type(within(form).getByRole('textbox', { name: /Bonus/ }), '25000');
    await user.type(within(form).getByTestId('rewards.form.prize'), '  Cinema tickets ');
    await user.click(within(form).getByTestId('rewards.form.save'));
    await waitFor(() => expect(count('set_staff_reward')).toBe(1));
    expect(calls.find((c) => c.fn === 'set_staff_reward')?.args).toEqual({
      p_venue_id: null,
      p_staff_id: 's-rusul',
      p_target: 150,
      p_reward_iqd: 25000,
      p_prize: 'Cinema tickets',
    });
    await waitFor(() => expect(screen.queryByTestId('rewards.add-form')).toBeNull());
  });

  it('sends a prize-only reward with a bonus of 0', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('rewards.row.add.s-rusul'));
    const form = screen.getByTestId('rewards.add-form');
    await user.type(within(form).getByTestId('rewards.form.target'), '300');
    await user.type(within(form).getByTestId('rewards.form.prize'), 'Dinner for two');
    await user.click(within(form).getByTestId('rewards.form.save'));
    await waitFor(() => expect(count('set_staff_reward')).toBe(1));
    expect(calls.find((c) => c.fn === 'set_staff_reward')?.args).toMatchObject({ p_target: 300, p_reward_iqd: 0, p_prize: 'Dinner for two' });
  });

  it('keeps the form open with the server’s reason when a target is taken, and refetches the board', async () => {
    const user = userEvent.setup();
    setReward = () => {
      throw new AppRpcError('REWARD_TARGET_TAKEN', 'REWARD_TARGET_TAKEN');
    };
    renderPage();
    await user.click(await screen.findByTestId('rewards.row.add.s-hasan'));
    const form = screen.getByTestId('rewards.add-form');
    await user.type(within(form).getByTestId('rewards.form.target'), '200');
    await user.type(within(form).getByRole('textbox', { name: /Bonus/ }), '10000');
    const before = count('staff_rewards_board');
    await user.click(within(form).getByTestId('rewards.form.save'));
    expect(await within(form).findByText('This person already has a reward at that target.')).toBeTruthy();
    await waitFor(() => expect(count('staff_rewards_board')).toBeGreaterThan(before));
    expect(screen.getByTestId('rewards.add-form')).toBeTruthy();
  });

  it('removes a reward only after the owner confirms', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('rewards.reward.remove.r-200'));
    let dialog = screen.getByRole('dialog', { name: 'Remove this reward?' });
    expect(dialog.textContent).toMatch(/Hasan.*will no longer see the reward at.*200.*orders/);
    await user.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(count('end_staff_reward')).toBe(0);
    await user.click(screen.getByTestId('rewards.reward.remove.r-200'));
    dialog = screen.getByRole('dialog', { name: 'Remove this reward?' });
    await user.click(within(dialog).getByRole('button', { name: 'Remove reward' }));
    await waitFor(() => expect(count('end_staff_reward')).toBe(1));
    expect(calls.find((c) => c.fn === 'end_staff_reward')?.args).toEqual({ p_id: 'r-200' });
  });

  it('says so when nobody works here, and offers a retry when the board fails', async () => {
    const user = userEvent.setup();
    people = () => [];
    const { unmount } = renderPage();
    expect(await screen.findByText('Nobody to reward at this branch')).toBeTruthy();
    unmount();
    boardFails = true;
    renderPage();
    const retry = await screen.findByRole('button', { name: /retry|try again/i });
    boardFails = false;
    people = () => [rusul()];
    await user.click(retry);
    expect(await screen.findByText('Rusul')).toBeTruthy();
  });

  it('links to Wages', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('rewards.link.wages'));
    expect(navigate).toHaveBeenCalledWith({ to: '/wages' });
  });

  it('reads in Arabic', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: 'المكافآت' })).toBeTruthy();
    expect(await screen.findAllByText('تحققت')).toHaveLength(1);
  });
});

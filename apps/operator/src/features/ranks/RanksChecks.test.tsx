import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// 0444: the two review lists. Level checks say who gave which type, whether the rules applied
// it and where the level went (drift coloured from 0.3); Results to check pair two results the
// same two pairs traded within 7 days, with Void for a manager or the owner.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

let role: 'manager' | 'court_desk' = 'manager';
vi.mock('../../lib/auth', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useAuth: () => ({ staff: { role } }) };
});

import { appRpc } from '../../lib/appRpc';
import { RanksChecks } from './RanksChecks';

const rpc = vi.mocked(appRpc);

const ali = { id: 'p1', name: 'Ali Hassan', username: null, former: false };
const sara = { id: 'p2', name: 'Sara Kareem', username: null, former: false };
const omar = { id: 'p3', name: 'Omar Saleh', username: null, former: false };
const huda = { id: 'p4', name: 'Huda Nasser', username: null, former: false };

const CHECKS = [
  {
    id: 'c1',
    player: ali,
    class: 'A',
    role: 'court_desk',
    checked_by: 'Bareq',
    checked_at: '2026-11-10T10:00:00Z',
    note: null,
    applied: true,
    level_set: 4.5,
    games_after: 6,
    level_after: 4.1,
    drift: -0.4,
  },
  {
    id: 'c2',
    player: sara,
    class: 'new',
    role: 'coach',
    checked_by: 'Yusuf',
    checked_at: '2026-11-09T10:00:00Z',
    note: 'Never played',
    applied: false,
    level_set: null,
    games_after: 0,
    level_after: null,
    drift: null,
  },
];

const result = (id: string, winner: 'a' | 'b', at: string) => ({
  id,
  played_at: at,
  score: winner === 'a' ? '6-4, 6-3' : '3-6, 2-6',
  source: 'player',
  winner,
  a: [ali, sara],
  b: [omar, huda],
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <RanksChecks />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('RanksChecks', () => {
  beforeEach(() => {
    role = 'manager';
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'ranks_level_checks_list') return CHECKS;
      if (fn === 'ranks_results_to_check') {
        return [{ first: result('g1', 'a', '2026-11-08T18:00:00Z'), second: result('g2', 'b', '2026-11-11T18:00:00Z') }];
      }
      if (fn === 'ranks_void') return { id: 'g2', status: 'voided' };
      throw new Error(`unexpected ${fn}`);
    });
  });

  it('shows each Level check: applied with its drift, or skipped by the rules', async () => {
    mount();
    const applied = await screen.findByTestId('ranks-level-check-c1');
    expect(within(applied).getByText('Type A')).toBeTruthy();
    expect(within(applied).getByText('4.1 after 6 games')).toBeTruthy();
    expect(within(applied).getByText('Moved −0.4')).toBeTruthy();
    expect(applied.textContent).toContain('\u2068Bareq\u2069, front desk');
    const skipped = screen.getByTestId('ranks-level-check-c2');
    expect(within(skipped).getByText('New')).toBeTruthy();
    expect(within(skipped).getByText('Skipped by the rules')).toBeTruthy();
    expect(skipped.textContent).toContain('Note: ');
    expect(rpc).toHaveBeenCalledWith('ranks_level_checks_list', { p_limit: 100 });
  });

  it('voids one result of a traded pair with a reason', async () => {
    mount();
    await userEvent.click(await screen.findByTestId('ranks-pair-void-g2'));
    const confirm = screen.getByTestId('ranks-void-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByTestId('ranks-void-reason'), 'Traded wins');
    await userEvent.click(confirm);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ranks_void', { p_result_id: 'g2', p_reason: 'Traded wins' }));
  });

  it('gives the desk the results to check without Void, and no Level checks', async () => {
    role = 'court_desk';
    mount();
    expect(await screen.findByTestId('ranks-pair-g2')).toBeTruthy();
    expect(screen.queryByTestId('ranks-pair-void-g2')).toBeNull();
    expect(screen.queryByTestId('ranks-level-checks')).toBeNull();
    expect(rpc).not.toHaveBeenCalledWith('ranks_level_checks_list', expect.anything());
  });
});

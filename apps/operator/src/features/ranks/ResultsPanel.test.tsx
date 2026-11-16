import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// 0444 (Majed 2026-11-16: "the operator can confirm / edit / set"): the desk confirms a
// player's report waiting on an opponent and corrects a result; only a manager or the owner
// voids; a tournament match is corrected on the tournament, so it offers no Edit.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

let role: 'manager' | 'court_desk' = 'court_desk';
vi.mock('../../lib/auth', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useAuth: () => ({ staff: { role } }) };
});

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { ResultsPanel } from './RanksScreen';

const rpc = vi.mocked(appRpc);
const p = (id: string, name: string) => ({ id, name, username: null, former: false });
const row = (id: string, source: string, status: string) => ({
  id,
  source,
  status,
  winner: 'a',
  score: '6-4',
  played_at: '2026-11-15T18:00:00Z',
  reported_at: '2026-11-15T19:30:00Z',
  reservation_id: null,
  void_reason: null,
  court: null,
  a: [p('p1', 'Ali Hassan'), null],
  b: [p('p3', 'Omar Saleh'), null],
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ResultsPanel />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('ResultsPanel', () => {
  beforeEach(() => {
    role = 'court_desk';
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'ranks_desk_results') {
        return [row('g1', 'player', 'pending'), row('g2', 'tournament', 'confirmed'), row('g3', 'desk', 'confirmed')];
      }
      if (fn === 'ranks_staff_confirm') return { id: 'g1', status: 'confirmed' };
      throw new Error(`unexpected ${fn}`);
    });
  });

  it('lets the desk confirm a waiting player report and edit, but not void', async () => {
    mount();
    await userEvent.click(await screen.findByTestId('ranks-confirm-g1'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('ranks_staff_confirm', { p_result_id: 'g1' }));
    expect(screen.getByTestId('ranks-edit-g1')).toBeTruthy();
    expect(screen.getByTestId('ranks-edit-g3')).toBeTruthy();
    expect(screen.queryByTestId('ranks-edit-g2')).toBeNull();
    expect(screen.queryByTestId('ranks-confirm-g3')).toBeNull();
    expect(screen.queryByTestId('ranks-void-g1')).toBeNull();
  });

  it('opens the correction dialog from Edit, and gives a manager Void too', async () => {
    role = 'manager';
    mount();
    await userEvent.click(await screen.findByTestId('ranks-edit-g3'));
    expect(screen.getByText('Edit this result')).toBeTruthy();
    expect(screen.getByTestId('ranks-void-g3')).toBeTruthy();
  });

  it('shows a refusal beside the row it belongs to', async () => {
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'ranks_desk_results') return [row('g1', 'player', 'expired')];
      if (fn === 'ranks_staff_confirm') {
        throw new AppRpcError('RANKS_RESULT_CLOSED', 'RANKS_RESULT_CLOSED');
      }
      throw new Error(`unexpected ${fn}`);
    });
    mount();
    await userEvent.click(await screen.findByTestId('ranks-confirm-g1'));
    expect(await screen.findByText('This result has already been confirmed, turned down or closed.')).toBeTruthy();
  });
});

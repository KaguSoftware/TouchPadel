import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// The score cell (tournaments build contracts §1.6 score, TD-9; plan §5.1
// "Rounds"): one input, the other side `target − a`, the match's revision as
// p_expected_revision, a correction asks why. Mocked at appRpc.

const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { ScoreCell } from './RoundsBoard';
import type { TourDetailMatch } from './tournamentPayloads';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

const MATCH: TourDetailMatch = {
  match_id: 'm1',
  court_id: 'c1',
  a: ['e1', 'e2'],
  b: ['e3', 'e4'],
  points_a: null,
  points_b: null,
  revision: 0,
  corrections: 0,
};

function mount(match: TourDetailMatch, onDone = vi.fn(), onChanged = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ScoreCell
          match={match}
          target={24}
          teamA="Ali H. & Sara K."
          onDone={onDone}
          onChanged={onChanged}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onDone, onChanged };
}

beforeEach(() => {
  rpc.mockReset();
  toast.ok.mockReset();
  localStorage.clear();
});

describe('ScoreCell', () => {
  it('fills the other side as target − a and sends both with the match revision and no reason', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      match_id: 'm1',
      revision: 1,
      tournament_revision: 4,
      removed_from_round: null,
      status: 'running',
    });
    const { onDone } = mount(MATCH);
    const save = screen.getByRole('button', { name: 'Save score' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Points for Ali H. & Sara K.'), '15');
    expect(plain(screen.getByTestId('score-other').textContent)).toBe('9 to the other side');
    await user.click(save);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    expect(rpc).toHaveBeenCalledWith('tournament_score', {
      p_match_id: 'm1',
      p_points_a: 15,
      p_points_b: 9,
      p_expected_revision: 0,
      p_reason: null,
    });
    expect(toast.ok).toHaveBeenCalledWith('Score saved.');
  });

  it('will not save more than the target', async () => {
    const user = userEvent.setup();
    mount(MATCH);
    await user.type(screen.getByLabelText('Points for Ali H. & Sara K.'), '25');
    expect((screen.getByRole('button', { name: 'Save score' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(plain(screen.getByTestId('score-other').textContent)).toBe(
      'The two sides add up to 24.',
    );
  });

  it('asks why before a correction and sends the reason with the revision it read', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      match_id: 'm1',
      revision: 3,
      tournament_revision: 9,
      removed_from_round: 4,
      status: 'running',
    });
    const { onDone } = mount({ ...MATCH, points_a: 14, points_b: 10, revision: 2 });
    const input = screen.getByLabelText('Points for Ali H. & Sara K.');
    await user.clear(input);
    await user.type(input, '12');
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    expect(rpc).not.toHaveBeenCalled();
    expect(await screen.findByText('Why is this score being corrected?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(4));
    expect(rpc).toHaveBeenCalledWith('tournament_score', {
      p_match_id: 'm1',
      p_points_a: 12,
      p_points_b: 12,
      p_expected_revision: 2,
      p_reason: 'staff_error',
    });
  });

  it('refetches and says so when someone else changed the score', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValue(new AppRpcError('TOURNAMENT_SCORE_REFUSED', 'x', undefined, 'changed'));
    const { onChanged, onDone } = mount(MATCH);
    await user.type(screen.getByLabelText('Points for Ali H. & Sara K.'), '20');
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    expect(plain((await screen.findByRole('alert')).textContent)).toBe(
      'Someone else changed this score. It has been refreshed.',
    );
    expect(onChanged).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

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

function mount(match: TourDetailMatch, onDone = vi.fn(), onChanged = vi.fn(), finished = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ScoreCell
          match={match}
          target={24}
          teamA="Ali H. & Sara K."
          finished={finished}
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
    expect(plain(screen.getByTestId('score-other').textContent)).toBe('9');
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

  it('keeps the box to two digits and never past the target', async () => {
    const user = userEvent.setup();
    mount(MATCH);
    const a = screen.getByLabelText('Points for Ali H. & Sara K.') as HTMLInputElement;
    expect(screen.getByText('The two sides add up to 24.')).toBeTruthy();
    // 2 then 5 would be 25, past 24: the 5 typed last stays.
    await user.type(a, '25');
    expect(a.value).toBe('5');
    expect(plain(screen.getByTestId('score-other').textContent)).toBe('19');
    // 5 then 1 would be 51: the 1 stays. Then 1 then 2 is 12.
    await user.type(a, '1');
    expect(a.value).toBe('1');
    await user.type(a, '2');
    expect(a.value).toBe('12');
    expect((screen.getByRole('button', { name: 'Save score' }) as HTMLButtonElement).disabled).toBe(
      false,
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

  it('asks why before a first score on a finished tournament (0311, c35)', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue({
      match_id: 'm1',
      revision: 1,
      tournament_revision: 12,
      removed_from_round: null,
      status: 'finished',
    });
    const { onDone } = mount(MATCH, vi.fn(), vi.fn(), true);
    await user.type(screen.getByLabelText('Points for Ali H. & Sara K.'), '15');
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    expect(rpc).not.toHaveBeenCalled();
    expect(
      await screen.findByText('The tournament has finished. Why is this score being entered now?'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    expect(rpc).toHaveBeenCalledWith('tournament_score', {
      p_match_id: 'm1',
      p_points_a: 15,
      p_points_b: 9,
      p_expected_revision: 0,
      p_reason: 'staff_error',
    });
  });

  it('says a manager changes the scores of a finished tournament (FORBIDDEN finished)', async () => {
    const user = userEvent.setup();
    rpc.mockRejectedValue(new AppRpcError('FORBIDDEN', 'x', undefined, 'finished'));
    mount({ ...MATCH, points_a: 14, points_b: 10, revision: 2 }, vi.fn(), vi.fn(), true);
    const input = screen.getByLabelText('Points for Ali H. & Sara K.');
    await user.clear(input);
    await user.type(input, '12');
    await user.click(screen.getByRole('button', { name: 'Save score' }));
    await user.click(await screen.findByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByText(
        'The tournament has finished: only a manager can change its scores now.',
      ),
    ).toBeTruthy();
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

  it('steps side A with its buttons, and side B the other way, inside 0 to the target', async () => {
    const user = userEvent.setup();
    mount(MATCH);
    const a = screen.getByLabelText('Points for Ali H. & Sara K.') as HTMLInputElement;
    const other = 'The other side';
    await user.click(screen.getByRole('button', { name: 'Ali H. & Sara K.: one point more' }));
    await user.click(screen.getByRole('button', { name: 'Ali H. & Sara K.: one point more' }));
    expect(a.value).toBe('2');
    expect(plain(screen.getByTestId('score-other').textContent)).toBe('22');
    // Side B one more is side A one less.
    await user.click(screen.getByRole('button', { name: `${other}: one point more` }));
    expect(a.value).toBe('1');
    await user.click(screen.getByRole('button', { name: `${other}: one point more` }));
    await user.click(screen.getByRole('button', { name: `${other}: one point more` }));
    expect(a.value).toBe('0');
    await user.clear(a);
    await user.type(a, '24');
    await user.click(screen.getByRole('button', { name: 'Ali H. & Sara K.: one point more' }));
    expect(a.value).toBe('24');
  });
});

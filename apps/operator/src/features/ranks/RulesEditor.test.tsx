import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// 0444: the owner's ranking rules. A changed rule shows its default and "Back to default"; one
// Save sends every rule that differs from its default to set_ranks_rules; a rule that moves
// levels asks first; a manager reads it all with every control off.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { RulesEditor } from './RulesEditor';
import type { RanksAdmin, RanksRules } from './ranksLogic';

const rpc = vi.mocked(appRpc);

const DEFAULTS: RanksRules = {
  headline: 'race',
  show_level: true,
  class_b_from: 2.5,
  class_a_from: 4.0,
  improved_days: 30,
  improved_min_games: 4,
  start_a: 4.5,
  start_b: 3.2,
  start_c: 2.0,
  start_new: 1.0,
  self_advanced: 4.5,
  self_intermediate: 3.2,
  self_beginner: 2.0,
  self_new: 1.0,
  start_unknown: 2.0,
  scale: 1.0,
  win_weight: 0.7,
  k_provisional: 0.5,
  k_settling: 0.3,
  k_settled: 0.15,
  provisional_games: 5,
  settling_games: 20,
  trust_tournament: 1.0,
  trust_desk: 1.0,
  trust_player: 0.75,
  repeat_days: 30,
  repeat_half_from: 3,
  repeat_zero_from: 5,
  soft_loss_below: 2.5,
  soft_loss_factor: 0.6,
  max_move: 0.25,
  level_min: 1.0,
  level_max: 7.0,
  reliable_games: 6,
  reliable_days: 90,
  reliable_opponents: 4,
  inactive_days: 45,
  return_games: 3,
  check_roles: ['coach', 'court_desk', 'manager', 'owner'],
  check_days: 60,
  check_max_change: 0.5,
  race_win: 10,
  race_strength_max: 2.0,
  race_loss: 2,
  race_draw: 4,
  race_best_matches: 8,
  race_best_tournaments: 2,
  t_first: 100,
  t_second: 60,
  t_semi: 36,
  t_top_half: 18,
  t_played: 8,
  boost_offpeak: 1.5,
  boost_event: 2.0,
  boost_welcome: 1.5,
  boost_max_per_season: 3,
  offpeak: [],
};

function admin(rules: RanksRules): RanksAdmin & { rules: RanksRules; defaults: RanksRules } {
  return {
    settings: {
      enabled: true,
      win_points: 2,
      loss_points: 1,
      draw_points: 1,
      period: 'quarter',
      board_size: 10,
      count_reported: true,
      count_tournaments: true,
      report_hours: 48,
    },
    levels: [{ name_en: 'Rookie', name_ar: 'مبتدئ', min_level: 0 }],
    rules,
    defaults: DEFAULTS,
    overrides: {},
    rebuild: { at: '2026-11-16T09:00:00Z', results: 120, ms: 35 },
  };
}

function mount(rules: RanksRules, canEdit = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RulesEditor data={admin(rules)} canEdit={canEdit} />
          </ConfirmProvider>
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('RulesEditor', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'set_ranks_rules') return admin(DEFAULTS);
      if (fn === 'set_ranks_settings') return admin(DEFAULTS).settings;
      throw new Error(`unexpected ${fn}`);
    });
  });

  it('saves a Race change at once, keeping the overrides already in force', async () => {
    mount({ ...DEFAULTS, race_loss: 3 });
    // The rule already changed shows its default.
    expect(within(screen.getByTestId('ranks-rule-race_loss')).getByText('Default 2')).toBeTruthy();
    const input = screen.getByTestId('ranks-rule-input-race_win');
    await userEvent.clear(input);
    await userEvent.type(input, '12');
    await userEvent.click(screen.getByTestId('ranks-rules-editor-save'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_ranks_rules', { p_rules: { race_win: 12, race_loss: 3 } }, { timeoutMs: 60_000 }),
    );
    expect(screen.queryByText("Re-score every player's level?")).toBeNull();
  });

  it('asks before a rule that re-scores levels, and sends nothing on Cancel', async () => {
    mount(DEFAULTS);
    const input = screen.getByTestId('ranks-rule-input-start_a');
    await userEvent.clear(input);
    await userEvent.type(input, '4.8');
    await userEvent.click(screen.getByTestId('ranks-rules-editor-save'));
    expect(await screen.findByText("Re-score every player's level?")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(rpc).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('ranks-rules-editor-save'));
    await userEvent.click(await screen.findByRole('button', { name: 'Save and re-score' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_ranks_rules', { p_rules: { start_a: 4.8 } }, { timeoutMs: 60_000 }));
  });

  it('puts a rule back to its default, which is saved by leaving it out', async () => {
    mount({ ...DEFAULTS, boost_event: 3 });
    await userEvent.click(screen.getByTestId('ranks-rule-reset-boost_event'));
    expect((screen.getByTestId('ranks-rule-input-boost_event') as HTMLInputElement).value).toBe('2');
    await userEvent.click(screen.getByTestId('ranks-rules-editor-save'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_ranks_rules', { p_rules: {} }, { timeoutMs: 60_000 }));
  });

  it('refuses a value out of range inline and keeps Save off', async () => {
    mount(DEFAULTS);
    const input = screen.getByTestId('ranks-rule-input-provisional_games');
    await userEvent.clear(input);
    await userEvent.type(input, '60');
    expect(within(screen.getByTestId('ranks-rule-provisional_games')).getByRole('alert').textContent).toBe(
      'A whole number between 0 and 50.',
    );
    expect((screen.getByTestId('ranks-rules-editor-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends the season length to set_ranks_settings', async () => {
    mount(DEFAULTS);
    await userEvent.click(screen.getByTestId('ranks-period-month'));
    await userEvent.click(screen.getByTestId('ranks-rules-editor-save'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_ranks_settings', { p_patch: { period: 'month' } }));
    expect(rpc).not.toHaveBeenCalledWith('set_ranks_rules', expect.anything(), expect.anything());
  });

  it('lets a manager read every rule with the controls off and no Save', () => {
    mount({ ...DEFAULTS, race_win: 15 }, false);
    expect((screen.getByTestId('ranks-rule-input-race_win') as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('ranks-rules-editor-save')).toBeNull();
    expect(screen.queryByTestId('ranks-rule-reset-race_win')).toBeNull();
    expect(within(screen.getByTestId('ranks-rule-race_win')).getByText('Default 10')).toBeTruthy();
  });
});

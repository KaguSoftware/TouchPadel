/**
 * 0451: the Player card shows what the games suggest and the interest tags
 * only after the desk asks; until then it offers the button, under the card
 * (the card itself is the button that opens the dialog).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { PlayerCard, type InsightsAsk } from './PlayerCard';
import { parsePlayerFacts, parsePlayerInsights } from './playerLogic';

const facts = parsePlayerFacts({ player: { claimed_level: 'beginner', effective_level: 'beginner' } })!;

function mount(ask: Partial<InsightsAsk>, onOpen = vi.fn()) {
  const full: InsightsAsk = { insights: null, loading: false, failed: false, onLoad: vi.fn(), ...ask };
  render(
    <LocaleProvider>
      <PlayerCard facts={facts} ask={full} tz="Asia/Baghdad" canJudge onOpen={onOpen} />
    </LocaleProvider>,
  );
  return { ask: full, onOpen };
}

describe('PlayerCard: games and interests on demand (0451)', () => {
  it('offers the button, and pressing it asks without opening the dialog', async () => {
    const { ask, onOpen } = mount({});
    const button = screen.getByTestId('player-insights-load');
    expect(button.textContent).toContain('Show games and interests');
    // Not inside the card's own button.
    expect(screen.getByTestId('card-player').contains(button)).toBe(false);
    await userEvent.click(button);
    expect(ask.onLoad).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('says it is working while it asks', () => {
    mount({ loading: true });
    expect(screen.getByTestId('player-insights-load').textContent).toContain('Working it out');
  });

  it('shows the answer in place of the button', () => {
    mount({
      insights: parsePlayerInsights({
        suggested: { level: 'advanced', games: 8, wins: 7, losses: 1, score: 3.1 },
        interests: ['courts', 'cafe'],
      }),
    });
    expect(screen.queryByTestId('player-insights-load')).toBeNull();
    const card = screen.getByTestId('card-player');
    expect(card.textContent).toContain('7 wins of 8');
    expect(card.textContent).toContain('Books courts');
  });

  it('says so when it failed, and the button asks again', async () => {
    const { ask } = mount({ failed: true });
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    await userEvent.click(screen.getByTestId('player-insights-load'));
    expect(ask.onLoad).toHaveBeenCalled();
  });
});

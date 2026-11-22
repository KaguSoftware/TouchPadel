import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ToastProvider } from '../../components/toast';

// Majed 2026-11-16: the player picks their own type and it stands; staff confirm, change or
// set it. The dialog says whether the type was picked by the player or checked by staff, and
// confirms an unchecked pick in one tap with the player's own value.

vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

vi.mock('../../lib/auth', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return { ...real, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});

import { appRpc } from '../../lib/appRpc';
import { PlayerFactsDialog } from './PlayerFactsDialog';
import type { InsightsAsk } from './PlayerCard';
import { parsePlayerFacts } from './playerLogic';

const rpc = vi.mocked(appRpc);

const base = {
  age_band: '25_34',
  claimed_level: 'beginner',
  level_confirmed: null,
  level_confirmed_at: null,
  level_confirmed_role: null,
  level_confirmed_by_name: null,
  level_note: null,
  effective_level: 'beginner',
};

function mount(
  player: Record<string, unknown>,
  onClose = vi.fn(),
  ask: InsightsAsk = { insights: null, loading: false, failed: false, onLoad: vi.fn() },
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <PlayerFactsDialog
            customerId="c1"
            customerName="Ali Hassan"
            facts={parsePlayerFacts({ player })!}
            ask={ask}
            canJudge
            tz="Asia/Baghdad"
            onClose={onClose}
          />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

describe('PlayerFactsDialog', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue(null);
  });

  it("confirms the player's own pick in one tap", async () => {
    const onClose = mount(base);
    expect(screen.getByTestId('player-level-source').textContent).toBe('Picked by the player: Type C. No staff check yet.');
    await userEvent.click(screen.getByTestId('player-confirm-claim'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('staff_set_customer_level', { p_customer_id: 'c1', p_level: 'beginner', p_note: null }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The desk cannot read the ranking rules, so nothing asks for them.
    expect(rpc).not.toHaveBeenCalledWith('ranks_admin', expect.anything());
  });

  it('says who checked a level, and offers no one-tap confirm then', () => {
    mount({
      ...base,
      level_confirmed: 'intermediate',
      level_confirmed_at: '2026-11-10T10:00:00Z',
      level_confirmed_role: 'coach',
      level_confirmed_by_name: 'Yusuf',
      effective_level: 'intermediate',
    });
    expect(screen.getByTestId('player-level-source').textContent).toContain('Checked by');
    expect(screen.getByTestId('player-level-source').textContent).toContain('(coach)');
    expect(screen.queryByTestId('player-confirm-claim')).toBeNull();
  });

  it('hides the one-tap confirm once a different type is being picked', async () => {
    mount(base);
    await userEvent.click(screen.getByTestId('player-level-advanced'));
    expect(screen.queryByTestId('player-confirm-claim')).toBeNull();
  });
});

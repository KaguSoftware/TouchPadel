import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { MatchSettingsPanel } from './MatchSettingsPanel';

// operator.md §5.16: the owner edits (only the changed keys go, for this
// branch), a manager reads, and a server refusal lands on its field. The
// server is appRpc, mocked per RPC name.

const SETTINGS = {
  venue_id: 'v1',
  matches_enabled: false,
  match_fill_deadline_minutes: 120,
  earliest_start_minutes: 180,
  match_ticket_price_iqd: 10000,
  max_filling_matches_per_guest: 3,
};

let settingsRead: () => unknown = () => SETTINGS;
let saveAnswer: (args: Record<string, unknown>) => unknown = (args) => ({ ...SETTINGS, ...(args.p_patch as object) });

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'match_settings') return settingsRead();
      if (fn === 'set_match_settings') return saveAnswer(args);
      return {};
    }),
  };
});
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));

function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

const calls = (fn: string) => vi.mocked(appRpc).mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  settingsRead = () => SETTINGS;
  saveAnswer = (args) => ({ ...SETTINGS, ...(args.p_patch as object) });
  vi.mocked(appRpc).mockClear();
});

describe('MatchSettingsPanel', () => {
  it('the owner changes the deadline and the ticket price: only those keys go, for this branch', async () => {
    const user = userEvent.setup();
    mount(<MatchSettingsPanel canEdit />);
    const deadline = await screen.findByRole('textbox', { name: /^Fill deadline/ });
    // The chain-wide rules say so.
    expect(screen.getByText('Changing these changes them at every branch.')).toBeTruthy();
    await user.clear(deadline);
    await user.type(deadline, '180');
    const price = screen.getByRole('textbox', { name: /^Ticket price/ });
    await user.clear(price);
    await user.type(price, '12500');
    await user.click(screen.getByRole('button', { name: 'Save open-match rules' }));
    await waitFor(() => expect(calls('set_match_settings')).toHaveLength(1));
    expect(calls('set_match_settings')[0]![1]).toEqual({
      p_patch: { match_fill_deadline_minutes: 180, match_ticket_price_iqd: 12500 },
      p_venue_id: null,
    });
  });

  it('turning open matches on sends the switch alone', async () => {
    const user = userEvent.setup();
    mount(<MatchSettingsPanel canEdit />);
    await user.click(await screen.findByRole('switch', { name: /Open matches at this branch/ }));
    await user.click(screen.getByRole('button', { name: 'Save open-match rules' }));
    await waitFor(() => expect(calls('set_match_settings')).toHaveLength(1));
    expect(calls('set_match_settings')[0]![1]).toMatchObject({ p_patch: { matches_enabled: true } });
  });

  it('a price off the 250 step is refused before anything is sent', async () => {
    const user = userEvent.setup();
    mount(<MatchSettingsPanel canEdit />);
    const price = await screen.findByRole('textbox', { name: /^Ticket price/ });
    await user.clear(price);
    await user.type(price, '10100');
    await user.click(screen.getByRole('button', { name: 'Save open-match rules' }));
    expect(await screen.findByText('Use a multiple of 250.')).toBeTruthy();
    expect(calls('set_match_settings')).toHaveLength(0);
  });

  it('INVALID_ARGUMENT naming a settings key lands on that field', async () => {
    const user = userEvent.setup();
    saveAnswer = () => {
      throw new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'max_filling_matches_per_guest');
    };
    mount(<MatchSettingsPanel canEdit />);
    const max = await screen.findByRole('textbox', { name: /^Filling matches per player/ });
    await user.clear(max);
    await user.type(max, '4');
    await user.click(screen.getByRole('button', { name: 'Save open-match rules' }));
    const field = await screen.findByText('The server did not accept this value.');
    // Beside the field it names, not as a line under the form.
    expect(max.closest('div')?.parentElement?.textContent ?? '').toContain('Filling matches per player');
    expect(field).toBeTruthy();
  });

  it('a manager reads the rules and is told who changes them', async () => {
    mount(<MatchSettingsPanel canEdit={false} />);
    expect(await screen.findByText('Only the owner can change these.')).toBeTruthy();
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getByText('10,000 IQD')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a server without open matches (RPC_MISSING) shows nothing', async () => {
    settingsRead = () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    };
    mount(<MatchSettingsPanel canEdit />);
    await waitFor(() => expect(calls('match_settings')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('match-settings')).toBeNull());
  });
});

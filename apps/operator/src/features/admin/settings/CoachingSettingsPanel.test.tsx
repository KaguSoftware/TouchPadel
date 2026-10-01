import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CoachingSettingsPanel } from './CoachingSettingsPanel';

// operator.md §5.12: the owner edits (only the changed keys go, for this
// branch, the share in basis points), a manager reads, the online modes stay
// off until the lessons terms are live (R67), and a refusal lands on its field.

const SETTINGS = {
  venue_id: 'v1',
  coaching_enabled: false,
  lesson_payment_mode: 'desk',
  coach_share_bp: 6000,
  lesson_prices_public: false,
  coach_max_open_private: 10,
  online_payments_available: false,
};

let settingsRead: () => unknown = () => SETTINGS;
let saveAnswer: (args: Record<string, unknown>) => unknown = (args) => ({
  ...SETTINGS,
  ...(args.p_patch as object),
});
let reachable = true;

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      if (fn === 'coaching_settings') return settingsRead();
      if (fn === 'set_coaching_settings') return saveAnswer(args);
      return {};
    }),
  };
});
vi.mock('../../../components/toast', () => ({
  useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }),
}));

function mount(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

const calls = (fn: string) => vi.mocked(appRpc).mock.calls.filter(([name]) => name === fn);
const SAVE = 'Save lesson settings';

beforeEach(() => {
  settingsRead = () => SETTINGS;
  saveAnswer = (args) => ({ ...SETTINGS, ...(args.p_patch as object) });
  reachable = true;
  vi.mocked(appRpc).mockClear();
});

describe('CoachingSettingsPanel', () => {
  it('the owner switches lessons on and changes the share: only those keys go, the share in basis points', async () => {
    const user = userEvent.setup();
    mount(<CoachingSettingsPanel canEdit />);
    await user.click(await screen.findByRole('switch', { name: /Lessons at this branch/ }));
    const share = screen.getByRole('textbox', { name: /^Coach's share/ });
    await user.clear(share);
    await user.type(share, '62.5');
    await user.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(calls('set_coaching_settings')).toHaveLength(1));
    expect(calls('set_coaching_settings')[0]![1]).toEqual({
      p_venue_id: null,
      p_patch: { coaching_enabled: true, coach_share_bp: 6250 },
    });
  });

  it('the online modes are disabled with the terms line until the lessons terms are live', async () => {
    mount(<CoachingSettingsPanel canEdit />);
    const group = await screen.findByRole('group', { name: 'How lessons are paid' });
    expect(
      (within(group).getByRole('button', { name: 'At the desk' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (within(group).getByRole('button', { name: 'At the desk or online' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (within(group).getByRole('button', { name: 'Online only' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      within(screen.getByTestId('online-mode-block')).getByText(
        'Online lesson payment can be switched on once the terms and privacy text with a lessons section are live.',
      ),
    ).toBeTruthy();
  });

  it('terms live: the owner can choose online; a missing provider refusal lands on the payment mode with its line', async () => {
    const user = userEvent.setup();
    settingsRead = () => ({ ...SETTINGS, online_payments_available: true });
    saveAnswer = () => {
      throw new AppRpcError('ONLINE_PAYMENT_OFF', 'ONLINE_PAYMENT_OFF', undefined, 'provider');
    };
    mount(<CoachingSettingsPanel canEdit />);
    const group = await screen.findByRole('group', { name: 'How lessons are paid' });
    expect(screen.queryByTestId('online-mode-block')).toBeNull();
    await user.click(within(group).getByRole('button', { name: 'Online only' }));
    await user.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(calls('set_coaching_settings')).toHaveLength(1));
    expect(calls('set_coaching_settings')[0]![1]).toMatchObject({
      p_patch: { lesson_payment_mode: 'online_required' },
    });
    // The field's error and the block list both carry the provider line.
    expect(
      (await screen.findAllByText("Online payment isn't set up for this branch.")).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('online-mode-block')).getByText(
        "Online payment isn't set up for this branch.",
      ),
    ).toBeTruthy();
  });

  it('coach_max_open_private holds to 1..100 before anything is sent', async () => {
    const user = userEvent.setup();
    mount(<CoachingSettingsPanel canEdit />);
    const max = await screen.findByRole('textbox', { name: /^Private lessons a coach can hold/ });
    await user.clear(max);
    await user.type(max, '101');
    await user.click(screen.getByRole('button', { name: SAVE }));
    expect(await screen.findByText('Between 1 and 100.')).toBeTruthy();
    expect(calls('set_coaching_settings')).toHaveLength(0);
  });

  it('INVALID_ARGUMENT naming a settings key lands on that field', async () => {
    const user = userEvent.setup();
    saveAnswer = () => {
      throw new AppRpcError(
        'INVALID_ARGUMENT',
        'INVALID_ARGUMENT',
        undefined,
        'coach_max_open_private',
      );
    };
    mount(<CoachingSettingsPanel canEdit />);
    const max = await screen.findByRole('textbox', { name: /^Private lessons a coach can hold/ });
    await user.clear(max);
    await user.type(max, '12');
    await user.click(screen.getByRole('button', { name: SAVE }));
    expect(await screen.findByText('The server did not accept this value.')).toBeTruthy();
    expect(max.getAttribute('aria-invalid')).toBe('true');
  });

  it('offline: Save is disabled with the connection reason', async () => {
    const user = userEvent.setup();
    reachable = false;
    mount(<CoachingSettingsPanel canEdit />);
    await user.click(await screen.findByRole('switch', { name: /Prices on the website/ }));
    const save = screen.getByRole('button', { name: SAVE }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe('Needs a connection: lessons work online only');
  });

  it('a manager reads the rules and is told who changes them', async () => {
    settingsRead = () => ({ ...SETTINGS, coach_share_bp: 6255 });
    mount(<CoachingSettingsPanel canEdit={false} />);
    expect(await screen.findByText('Only the owner can change these.')).toBeTruthy();
    expect(screen.getByText('At the desk')).toBeTruthy();
    expect((screen.getByText(/62\.55/).textContent ?? '').replace(/[⁦-⁩]/g, '')).toBe('62.55%');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a server without coaching (RPC_MISSING) shows nothing', async () => {
    settingsRead = () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    };
    mount(<CoachingSettingsPanel canEdit />);
    await waitFor(() => expect(calls('coaching_settings')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('coaching-settings')).toBeNull());
  });
});

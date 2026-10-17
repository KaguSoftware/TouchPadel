import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// Setup's settings pages (management rebuild, 2026-10-17): every panel that
// sat inside "Venue settings" is a page of its own. Each page keeps what the
// panel did: owner edits, manager reads, and online deposits and open
// matches stay closed while online payments are paused.

let live = true;
let role = 'owner';
const rpc = vi.fn(async (_name: string, _args?: unknown): Promise<unknown> => null);

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, appRpc: (name: string, args?: unknown) => rpc(name, args) };
});
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../deposits/useOnlinePaymentsLive', () => ({ useOnlinePaymentsLive: () => live }));
vi.mock('../../deposits/DepositSettingsPanel', () => ({ DepositSettingsPanel: () => <div data-testid="deposit-panel" /> }));
vi.mock('./MatchSettingsPanel', () => ({ MatchSettingsPanel: () => <div data-testid="match-panel" /> }));
vi.mock('./TournamentsSettingsPanel', () => ({ TournamentsSettingsPanel: () => <div data-testid="tournaments-panel" /> }));
vi.mock('./DevicesPanel', () => ({ DevicesPanel: ({ staleSeconds }: { staleSeconds: number }) => <div data-testid="devices-panel">{staleSeconds}</div> }));
vi.mock('./StationsPanel', () => ({ StationsPanel: () => <div data-testid="stations-panel" /> }));
vi.mock('./DayServiceTab', () => ({ DayServiceTab: () => <div data-testid="day-panel" /> }));
vi.mock('./AnalyticsTab', () => ({ AnalyticsTab: () => <div data-testid="analytics-panel" /> }));
vi.mock('../KitchenPairing', () => ({ KitchenPairingPanel: () => <div data-testid="kitchen-panel" /> }));
vi.mock('./venueQueries', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    fetchVenueAdmin: vi.fn(async () => ({
      venue_name: 'Touch',
      phone: null,
      timezone: 'Asia/Baghdad',
      currency: 'IQD',
      tax_inclusive: true,
      cancellation_window_hours: 24,
      hold_ttl_seconds: 600,
      max_booking_horizon_days: 30,
      max_live_holds_per_guest: 3,
      protected_horizon_hours: 12,
      heartbeat_stale_seconds: 60,
      offline_mode_enabled: false,
    })),
    fetchTaxGroups: vi.fn(async () => []),
  };
});

import {
  BookingRulesScreen,
  DevicesScreen,
  OfflineModeScreen,
  OnlineDepositScreen,
  OpenMatchesSettingsScreen,
  VenueDetailsScreen,
} from './SettingsPages';

function mount(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{node}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  live = true;
  role = 'owner';
  rpc.mockReset();
  rpc.mockResolvedValue(null);
});

describe('Courts › Online deposit and Open matches', () => {
  for (const r of ['owner', 'manager']) {
    it(`${r}: the panels show while online payments are live`, async () => {
      role = r;
      mount(
        <>
          <OnlineDepositScreen />
          <OpenMatchesSettingsScreen />
        </>,
      );
      expect(await screen.findByTestId('deposit-panel')).toBeTruthy();
      expect(screen.getByTestId('match-panel')).toBeTruthy();
    });

    it(`${r}: paused, each page says so instead of showing its panel`, async () => {
      role = r;
      live = false;
      mount(
        <>
          <OnlineDepositScreen />
          <OpenMatchesSettingsScreen />
        </>,
      );
      expect(screen.queryByTestId('deposit-panel')).toBeNull();
      expect(screen.queryByTestId('match-panel')).toBeNull();
      expect(screen.getAllByText('Online payments are paused')).toHaveLength(2);
    });
  }
});

describe('Settings › Club details', () => {
  it('owner edits the name; the page title is the tab’s name', async () => {
    mount(<VenueDetailsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Club details' })).toBeTruthy();
    expect(await screen.findByDisplayValue('Touch')).toBeTruthy();
  });

  it('manager reads the name, with who can change it', async () => {
    role = 'manager';
    mount(<VenueDetailsScreen />);
    expect(await screen.findByText('Touch')).toBeTruthy();
    expect(screen.queryByDisplayValue('Touch')).toBeNull();
    expect(screen.getByText('Only the owner can change the venue name, phone and booking rules.')).toBeTruthy();
  });

  it('a name the server refuses gets the name rule, not a number range', async () => {
    const { AppRpcError } = await import('../../../lib/appRpc');
    rpc.mockImplementation(async () => {
      throw new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'venue_name');
    });
    mount(<VenueDetailsScreen />);
    const input = await screen.findByDisplayValue('Touch');
    fireEvent.change(input, { target: { value: 'Touch Padel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByText('Use 2 to 80 characters.')).toBeTruthy());
    expect(screen.queryByText(/Enter a number from/)).toBeNull();
  });
});

describe('Courts › Booking rules', () => {
  it('owner saves only the booking rules it changed', async () => {
    mount(<BookingRulesScreen />);
    const holds = await screen.findByDisplayValue('3');
    fireEvent.change(holds, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_venue_details', { p_patch: { max_live_holds_per_guest: 4 } }));
  });
});

describe('Devices', () => {
  it('Devices reads the silent-after time from the venue', async () => {
    mount(<DevicesScreen />);
    expect((await screen.findByTestId('devices-panel')).textContent).toBe('60');
  });

  it('Offline mode: a manager reads it, no switch', async () => {
    role = 'manager';
    mount(<OfflineModeScreen />);
    expect(await screen.findByText('Off')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

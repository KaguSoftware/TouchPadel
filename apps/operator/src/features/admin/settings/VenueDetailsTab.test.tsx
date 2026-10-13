import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// Online payments are paused until the provider is live: the deposit and
// open-match setting panels are not offered (owner or manager), the rest stays.

let live = true;
let role = 'owner';

vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../deposits/useOnlinePaymentsLive', () => ({ useOnlinePaymentsLive: () => live }));
vi.mock('../../deposits/DepositSettingsPanel', () => ({ DepositSettingsPanel: () => <div data-testid="deposit-panel" /> }));
vi.mock('./MatchSettingsPanel', () => ({ MatchSettingsPanel: () => <div data-testid="match-panel" /> }));
vi.mock('./CoachingSettingsPanel', () => ({ CoachingSettingsPanel: () => <div data-testid="coaching-panel" /> }));
vi.mock('./TournamentsSettingsPanel', () => ({ TournamentsSettingsPanel: () => <div data-testid="tournaments-panel" /> }));
vi.mock('./DevicesPanel', () => ({ DevicesPanel: () => null }));
vi.mock('./StationsPanel', () => ({ StationsPanel: () => null }));
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

import { VenueDetailsTab } from './VenueDetailsTab';

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <VenueDetailsTab />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  live = true;
  role = 'owner';
});

describe('VenueDetailsTab online-payment panels', () => {
  for (const r of ['owner', 'manager']) {
    it(`${r}: deposit and match panels show when online payments are live`, async () => {
      role = r;
      mount();
      expect(await screen.findByTestId('coaching-panel')).toBeTruthy();
      expect(screen.getByTestId('deposit-panel')).toBeTruthy();
      expect(screen.getByTestId('match-panel')).toBeTruthy();
    });

    it(`${r}: deposit and match panels are hidden while paused, coaching stays`, async () => {
      role = r;
      live = false;
      mount();
      expect(await screen.findByTestId('coaching-panel')).toBeTruthy();
      await waitFor(() => expect(screen.getByTestId('tournaments-panel')).toBeTruthy());
      expect(screen.queryByTestId('deposit-panel')).toBeNull();
      expect(screen.queryByTestId('match-panel')).toBeNull();
    });
  }
});

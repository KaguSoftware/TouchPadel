import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// Staff clock-in setup (0442) on Settings › Stations: the club's place (owner) and this desk's key.

vi.mock('../../lib/venue', () => ({ useVenue: () => ({ branchId: 'v1', current: null, venues: [], stationBranchId: 'v1', canSwitch: false, setBranch: () => undefined }) }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

const SECRET = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
const server = vi.hoisted(() => ({
  canEditPlace: true,
  place: null as null | Record<string, unknown>,
  key: null as null | { issued_at: string },
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string) => {
    switch (fn) {
      case 'clock_setup':
        return {
          place: server.place,
          stations: [
            { station_id: 'DEV1', is_till: true, has_key: server.key !== null, issued_at: server.key?.issued_at ?? null, issued_by_name: server.key ? 'Omar' : null },
            { station_id: 'DESK2', is_till: false, has_key: false, issued_at: null, issued_by_name: null },
          ],
          can_edit_place: server.canEditPlace,
        };
      case 'issue_station_clock_key':
        server.key = { issued_at: '2026-11-15T09:00:00.123+00:00' };
        return { station_id: 'DEV1', secret: SECRET, step_seconds: 30, digits: 6, replaced: false };
      case 'set_clock_place':
        return { status: 'saved' };
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { appRpc } from '../../lib/appRpc';
import { ClockSetupPanel } from './ClockSetupPanel';

const rpc = vi.mocked(appRpc);

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmProvider>
          <ClockSetupPanel />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockClear();
  localStorage.clear();
  server.canEditPlace = true;
  server.place = null;
  server.key = null;
});

describe('ClockSetupPanel', () => {
  it("sets up this desk's QR and keeps the secret with the server's stamp", async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText('Not ready yet: set where the club is, then set up a desk QR.')).toBeTruthy();
    await user.click(screen.getByTestId('clock-desk-setup'));
    await waitFor(() => expect(localStorage.getItem('tp.clock-key:DEV1')).not.toBeNull());
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('tp.clock-key:DEV1')!)).toEqual({ secret: SECRET, issued_at: '2026-11-15T09:00:00.123+00:00' }),
    );
    expect(rpc).toHaveBeenCalledWith('issue_station_clock_key', { p_station_id: 'DEV1' });
    expect(await screen.findByText('Working')).toBeTruthy();
    expect(screen.getByTestId('clock-desk-show')).toBeTruthy();
  });

  it('asks before replacing a key, and says when the key here is out of date', async () => {
    const user = userEvent.setup();
    server.key = { issued_at: '2026-11-15T10:00:00+00:00' };
    localStorage.setItem('tp.clock-key:DEV1', JSON.stringify({ secret: SECRET, issued_at: '2026-11-14T10:00:00+00:00' }));
    renderPanel();
    expect(await screen.findByText(/This desk's QR is out of date/)).toBeTruthy();
    await user.click(screen.getByTestId('clock-desk-setup'));
    expect(await screen.findByText("Replace this desk's QR?")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(rpc.mock.calls.some(([fn]) => fn === 'issue_station_clock_key')).toBe(false);
  });

  it('reads a pasted Google Maps link and saves the place with the radius and accuracy', async () => {
    const user = userEvent.setup();
    renderPanel();
    const input = await screen.findByTestId('clock-place-input');
    await user.type(input, 'https://www.google.com/maps/place/x/@33.3,44.3,17z/data=!3d33.312805!4d44.361493');
    expect(screen.getByText(/Reads as .*33\.312805, 44\.361493/)).toBeTruthy();
    await user.click(screen.getByTestId('clock-place-save'));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('set_clock_place', { p_venue_id: null, p_lat: 33.312805, p_lng: 44.361493, p_radius_m: 120, p_max_accuracy_m: 60 }),
    );
  });

  it('explains a short share link', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(await screen.findByTestId('clock-place-input'), 'https://maps.app.goo.gl/abc');
    expect(screen.getByText(/Short share links \(maps\.app\.goo\.gl\) do not hold the location/)).toBeTruthy();
  });

  it('a manager reads the place and cannot change it', async () => {
    server.canEditPlace = false;
    server.place = { lat: 33.3128, lng: 44.3615, radius_m: 150, max_accuracy_m: 50, updated_at: '2026-11-15T08:00:00Z', updated_by_name: 'Majed' };
    renderPanel();
    expect(await screen.findByText('Only the owner changes where the club is.')).toBeTruthy();
    expect(screen.getByText('Phones within 150 m, located to within 50 m.')).toBeTruthy();
    expect(screen.queryByTestId('clock-place-form')).toBeNull();
  });
});

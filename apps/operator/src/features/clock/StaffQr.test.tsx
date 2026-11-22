import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clockCode } from '@touch/core/staff/clock';
import { LocaleProvider } from '../../lib/i18n';
import type * as AppRpcModule from '../../lib/appRpc';

// The desk QR (0442): on the sign-in screen before anyone signs in, and under Staff QR after.

const who = vi.hoisted(() => ({ staff: { id: 'u1', role: 'cashier' as string, extraRoles: [] as string[], blockedAreas: [] as string[] } }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: who.staff }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
}));

vi.mock('../../lib/venue', () => ({ useVenue: () => ({ branchId: 'v1', current: null, venues: [], stationBranchId: 'v1', canSwitch: false, setBranch: () => undefined }) }));

const server = vi.hoisted(() => ({
  registered: true,
  missing: false,
  place: null as null | Record<string, unknown>,
  calls: [] as string[],
}));
vi.mock('../../lib/appRpc', async (importOriginal) => {
  const real = await importOriginal<typeof AppRpcModule>();
  return {
    ...real,
    appRpc: vi.fn(async (fn: string) => {
      server.calls.push(fn);
      if (server.missing) throw new real.AppRpcError('RPC_MISSING', 'missing');
      switch (fn) {
        case 'issue_station_clock_key':
          if (!server.registered) throw new real.AppRpcError('REF_NOT_FOUND', 'REF_NOT_FOUND', 'station_id');
          return { station_id: 'DEV1', secret: '3132333435363738393031323334353637383930', step_seconds: 30, digits: 6, replaced: false };
        case 'register_station':
          server.registered = true;
          return { id: 'DEV1' };
        case 'clock_setup':
          return {
            place: server.place,
            stations: server.registered ? [{ station_id: 'DEV1', is_till: true, has_key: true, issued_at: '2026-11-15T09:00:00+00:00', issued_by_name: 'Omar' }] : [],
            can_edit_place: true,
          };
        default:
          throw new Error(`unexpected ${fn}`);
      }
    }),
  };
});

import { SignInClockPanel, StaffQrView } from './StaffQr';

const SECRET = '3132333435363738393031323334353637383930';
// Ten seconds into a 30-second step, so the code cannot turn over mid-test.
const NOW = Date.UTC(2026, 10, 15, 9, 0, 10);

function withLocale(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <LocaleProvider>{node}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  who.staff.role = 'cashier';
  server.registered = true;
  server.missing = false;
  server.place = null;
  server.calls = [];
});
afterEach(() => vi.useRealTimers());

describe('SignInClockPanel', () => {
  it('shows nothing on a desk with no key', () => {
    withLocale(<SignInClockPanel />);
    expect(screen.queryByTestId('signin-clock')).toBeNull();
  });

  it("draws this desk's QR, the six digits and the seconds left", () => {
    localStorage.setItem('tp.clock-key:DEV1', JSON.stringify({ secret: SECRET, issued_at: null }));
    withLocale(<SignInClockPanel />);
    const { code } = clockCode(SECRET, NOW);
    expect(screen.getByTestId('clock-qr-digits').textContent).toBe(code);
    expect(screen.getByRole('img', { name: 'QR code for staff to start or finish work' })).toBeTruthy();
    expect(screen.getByText('New code in 20 s')).toBeTruthy();
    expect(screen.getByText('Staff: scan this with the Touch Padel app to start or finish work.')).toBeTruthy();
  });

  it('appears as soon as setup stores a key', () => {
    withLocale(<SignInClockPanel />);
    act(() => {
      localStorage.setItem('tp.clock-key:DEV1', JSON.stringify({ secret: SECRET, issued_at: null }));
      window.dispatchEvent(new Event('tp-clock-key'));
    });
    expect(screen.getByTestId('signin-clock')).toBeTruthy();
  });
});

describe('StaffQrView', () => {
  it('shows the QR full screen and closes on Escape', () => {
    localStorage.setItem('tp.clock-key:DEV1', JSON.stringify({ secret: SECRET, issued_at: null }));
    const onClose = vi.fn();
    withLocale(<StaffQrView onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Start or finish work' })).toBeTruthy();
    expect(screen.getByTestId('clock-qr-digits').textContent).toBe(clockCode(SECRET, NOW).code);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('says the desk is not set up, and offers setup only to a manager', () => {
    const { unmount } = withLocale(<StaffQrView onClose={vi.fn()} />);
    expect(screen.getByText('This desk has no staff QR yet')).toBeTruthy();
    expect(screen.getByText('Ask a manager to set it up on this computer.')).toBeTruthy();
    expect(screen.queryByTestId('staff-qr-setup')).toBeNull();
    unmount();
    who.staff.role = 'manager';
    withLocale(<StaffQrView onClose={vi.fn()} />);
    expect(screen.getByTestId('staff-qr-setup')).toBeTruthy();
  });

  it('a manager sets the desk up right here, and the QR replaces the message', async () => {
    vi.useRealTimers();
    who.staff.role = 'manager';
    const user = userEvent.setup();
    withLocale(<StaffQrView onClose={vi.fn()} />);
    await user.click(screen.getByTestId('staff-qr-setup'));
    expect(await screen.findByTestId('clock-qr')).toBeTruthy();
    expect(screen.queryByTestId('staff-qr-missing')).toBeNull();
    expect(localStorage.getItem('tp.clock-key:DEV1')).not.toBeNull();
    expect(server.calls).not.toContain('register_station');
  });

  it('registers a computer that is not a station yet, then sets up its QR', async () => {
    vi.useRealTimers();
    who.staff.role = 'manager';
    server.registered = false;
    const user = userEvent.setup();
    withLocale(<StaffQrView onClose={vi.fn()} />);
    await user.click(screen.getByTestId('staff-qr-setup'));
    expect(await screen.findByTestId('clock-qr')).toBeTruthy();
    expect(server.calls.slice(0, 3)).toEqual(['issue_station_clock_key', 'register_station', 'issue_station_clock_key']);
  });

  it("says the server lacks the feature instead of doing nothing", async () => {
    vi.useRealTimers();
    who.staff.role = 'manager';
    server.missing = true;
    const user = userEvent.setup();
    withLocale(<StaffQrView onClose={vi.fn()} />);
    await user.click(screen.getByTestId('staff-qr-setup'));
    expect(await screen.findByText('This server does not have staff start and finish yet. It needs a server update first.')).toBeTruthy();
    expect(screen.queryByTestId('clock-qr')).toBeNull();
  });

  it("tells a manager under the QR that the club's location is still missing", async () => {
    localStorage.setItem('tp.clock-key:DEV1', JSON.stringify({ secret: SECRET, issued_at: null }));
    who.staff.role = 'manager';
    withLocale(<StaffQrView onClose={vi.fn()} />);
    expect(await screen.findByTestId('staff-qr-place-missing')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('staff-qr-set-place')).toBeTruthy());
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';

// F-49: a retired station kept trading with no word on the machine itself.
// The retired screen is all it shows until a manager or the owner registers
// it again.

let role = 'manager';
const signOut = vi.fn(async () => undefined);
const rpc = vi.fn(async (_name: string, _args?: unknown): Promise<unknown> => ({}));
const quitApp = vi.fn(async () => ({ ok: true }));

vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { id: 's1', role }, signOut }) };
});
vi.mock('../lib/venue', () => ({ useVenue: () => ({ branchId: 'venue-a' }) }));
vi.mock('../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, appRpc: (name: string, args?: unknown) => rpc(name, args) };
});
vi.mock('../lib/updates', () => ({ useUpdateReady: () => null }));
vi.mock('../ipc/bridge', () => ({
  touch: {
    getStation: () => ({ stationId: 'TILL-01', mode: 'till', configured: true, appVersion: 't', locked: false }),
    quitApp: () => quitApp(),
    pinObserved: vi.fn(),
  },
}));

import { StationRetiredScreen } from './StationRetiredScreen';

function mount(onRegistered = vi.fn()) {
  render(
    <LocaleProvider>
      <StationRetiredScreen stationId="TILL-01" onRegistered={onRegistered} />
    </LocaleProvider>,
  );
  return onRegistered;
}

beforeEach(() => {
  role = 'manager';
  rpc.mockClear();
  signOut.mockClear();
  quitApp.mockClear();
  localStorage.clear();
});
afterEach(() => {
  delete (window as { touch?: unknown }).touch;
});

describe('StationRetiredScreen (F-49)', () => {
  it('says the station was retired, names it, and offers nothing to trade with', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'This station was retired' })).toBeTruthy();
    expect(screen.getByText(/TILL-01/)).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('a manager registers it again, as this machine and kind, at the branch in scope', async () => {
    const done = mount();
    await userEvent.click(screen.getByTestId('station-retired.register'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('register_station', { p_id: 'TILL-01', p_venue_id: 'venue-a', p_mode: 'till' }));
    expect(done).toHaveBeenCalled();
  });

  it('a cashier cannot, and is told who can; Sign out is still there', async () => {
    role = 'cashier';
    mount();
    expect(screen.queryByTestId('station-retired.register')).toBeNull();
    expect(screen.getByText(/Ask a manager or the owner/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('inside the shell, Quit is offered in place and runs the quit flow', async () => {
    (window as { touch?: unknown }).touch = {};
    mount();
    await userEvent.click(screen.getByTestId('station-retired.quit'));
    expect(screen.getByTestId('quit.panel')).toBeTruthy();
    await userEvent.click(screen.getByTestId('quit.confirm'));
    await waitFor(() => expect(quitApp).toHaveBeenCalled());
  });
});

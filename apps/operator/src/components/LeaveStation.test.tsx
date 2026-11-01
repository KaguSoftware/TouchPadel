import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../lib/i18n';
import type { AppRpcError } from '../lib/appRpc';

// Quit, shared by the rail, the idle lock (F-48) and the retired screen
// (F-49): one PIN rule, 4 to 12 digits (F-50).

let role = 'cashier';
const rpc = vi.fn(async (_name: string, _args?: unknown): Promise<unknown> => 'mgr-1');
const quitApp = vi.fn(async (_pin: string): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));

vi.mock('../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { id: 's1', role } }) };
});
vi.mock('../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, appRpc: (name: string, args?: unknown) => rpc(name, args) };
});
vi.mock('../lib/updates', () => ({ useUpdateReady: () => null }));
vi.mock('../ipc/bridge', () => ({
  touch: {
    getStation: () => ({ stationId: 'TILL-01', mode: 'till', configured: true, appVersion: 't', locked: true }),
    quitApp: (pin: string) => quitApp(pin),
    pinObserved: vi.fn(),
  },
}));

import { InlineQuitPanel, leaveRefusal } from './LeaveStation';

beforeEach(() => {
  role = 'cashier';
  rpc.mockClear();
  quitApp.mockClear();
  localStorage.clear();
  (window as { touch?: unknown }).touch = {};
});
afterEach(() => {
  delete (window as { touch?: unknown }).touch;
});

function mount(onBack = vi.fn()) {
  render(
    <LocaleProvider>
      <InlineQuitPanel onBack={onBack} />
    </LocaleProvider>,
  );
  return onBack;
}

describe('InlineQuitPanel', () => {
  it('on a locked station takes a manager PIN of 4 to 12 digits (F-50), proved before main quits', async () => {
    mount();
    const field = screen.getByTestId('leave.pin') as HTMLInputElement;
    expect(field.maxLength).toBe(12);
    const quit = screen.getByTestId('quit.confirm') as HTMLButtonElement;
    await userEvent.type(field, '123');
    expect(quit.disabled).toBe(true);
    await userEvent.type(field, '4');
    expect(quit.disabled).toBe(false);
    await userEvent.click(quit);
    await waitFor(() => expect(quitApp).toHaveBeenCalledWith('1234'));
    expect(rpc).toHaveBeenCalledWith('verify_manager_pin', { p_pin: '1234', p_device_id: 'TILL-01' });
  });

  it('the owner quits with the confirmation alone', async () => {
    role = 'owner';
    mount();
    expect(screen.queryByTestId('leave.pin')).toBeNull();
    await userEvent.click(screen.getByTestId('quit.confirm'));
    await waitFor(() => expect(quitApp).toHaveBeenCalledWith(''));
  });

  it('Back leaves the panel', async () => {
    const back = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });
});

describe('leaveRefusal', () => {
  it('reads main’s answers as the server would word them', () => {
    expect(leaveRefusal({ ok: true })).toBeNull();
    expect((leaveRefusal({ ok: false, error: 'pin not recognised' }) as AppRpcError).code).toBe('PIN_INVALID');
    expect((leaveRefusal({ ok: false, error: 'own pin' }) as AppRpcError).code).toBe('PIN_OWN');
  });
});

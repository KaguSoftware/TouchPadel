import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../../lib/i18n';

// F-48: the idle-lock timeout had no screen; it could only be set in the
// database. The owner picks it on Settings › Cashier computers.

let role = 'owner';
let stored = 900;
const mutate = vi.fn();
const toastOk = vi.fn();

vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../../lib/settings', () => ({
  useCafeSettings: () => ({ settings: { till_idle_lock_seconds: stored }, isLoading: false }),
  useSetCafeSetting: () => ({ mutate, isPending: false }),
}));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: toastOk, err: vi.fn(), info: vi.fn() }) }));

import { IdleLockPanel } from './IdleLockPanel';

function mount() {
  return render(
    <LocaleProvider>
      <IdleLockPanel />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  role = 'owner';
  stored = 900;
  mutate.mockReset();
  toastOk.mockReset();
  localStorage.clear();
});

describe('IdleLockPanel (F-48)', () => {
  it('shows the stored timeout and lets the owner change it, saved as seconds', async () => {
    mount();
    const select = screen.getByRole('combobox', { name: 'Lock after' });
    expect(select.textContent).toContain('15 min');
    await userEvent.click(select);
    expect(screen.getByRole('option', { name: 'Never' })).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: '5 min' }));
    expect(mutate).toHaveBeenCalledWith({ key: 'till_idle_lock_seconds', value: 300 }, expect.anything());
    mutate.mock.calls[0]![1].onSuccess();
    expect(toastOk).toHaveBeenCalled();
  });

  it('Never stores 0, the server’s "no idle lock"', async () => {
    mount();
    await userEvent.click(screen.getByRole('combobox', { name: 'Lock after' }));
    await userEvent.click(screen.getByRole('option', { name: 'Never' }));
    expect(mutate).toHaveBeenCalledWith({ key: 'till_idle_lock_seconds', value: 0 }, expect.anything());
  });

  it('a manager sees it but cannot change it, and is told why', () => {
    role = 'manager';
    mount();
    expect((screen.getByRole('combobox', { name: 'Lock after' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only the owner changes/)).toBeTruthy();
  });

  it('keeps an odd stored value selectable rather than showing a wrong one', async () => {
    stored = 90;
    mount();
    const select = screen.getByRole('combobox', { name: 'Lock after' });
    expect(select.textContent).toContain('90 s');
    await userEvent.click(select);
    expect(screen.getByRole('option', { name: '90 s' })).toBeTruthy();
  });
});

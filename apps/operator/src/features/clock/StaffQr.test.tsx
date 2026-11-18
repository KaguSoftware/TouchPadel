import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { clockCode } from '@touch/core/staff/clock';
import { LocaleProvider } from '../../lib/i18n';

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

import { SignInClockPanel, StaffQrView } from './StaffQr';

const SECRET = '3132333435363738393031323334353637383930';
// Ten seconds into a 30-second step, so the code cannot turn over mid-test.
const NOW = Date.UTC(2026, 10, 15, 9, 0, 10);

function withLocale(node: React.ReactNode) {
  return render(<LocaleProvider>{node}</LocaleProvider>);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
  who.staff.role = 'cashier';
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
});

import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// The landing screen of the Setup section: one card per destination, and the
// same role wall as the rail it replaced — a card is a link to a screen, so a
// role that may not open the screen may not be offered the card.

let role: StaffRole = 'owner';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Owner', role } }),
}));

import { SetupHomeScreen } from './SetupHome';

function renderSetup(as: StaffRole) {
  role = as;
  return render(
    <LocaleProvider>
      <SetupHomeScreen />
    </LocaleProvider>,
  );
}

describe('SetupHomeScreen', () => {
  it('offers every setup destination, each with what the screen decides', () => {
    renderSetup('owner');
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeTruthy();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/admin/staff',
      '/admin/courts',
      '/admin/qr',
      '/admin/settings',
      '/admin/hero',
    ]);
    // The card says more than its rail row could: names alone are not answers.
    expect(screen.getByText(/Rotate a code when a card is lost/)).toBeTruthy();
  });

  it('never offers the section overview a card back to itself', () => {
    renderSetup('owner');
    expect(screen.queryByRole('link', { name: /Overview/ })).toBeNull();
  });

  it('drops a destination the role may not open', () => {
    // Staff is owner-only (ROUTE_ROLES); the rest of /admin is manager's too.
    renderSetup('manager');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).not.toContain('/admin/staff');
    expect(links).toContain('/admin/courts');
  });
});

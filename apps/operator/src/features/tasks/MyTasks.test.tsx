import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// Nothing can be assigned yet, so the screen's one job is to say so in a way
// that does not read as a failed load: a heading, the empty sentence, and
// what will appear here once something is — for the role reading it.

let role: StaffRole = 'driver';
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role } }),
}));

import { MyTasksScreen } from './MyTasks';

function renderIn(locale: 'en' | 'ar', as: StaffRole = 'driver') {
  role = as;
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <LocaleProvider>
      <MyTasksScreen />
    </LocaleProvider>,
  );
}

describe('MyTasksScreen', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage */
    }
  });

  it('names the page and says nothing is assigned yet', () => {
    renderIn('en');
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Nothing is assigned to you yet/ })).toBeTruthy();
  });

  it('tells the driver about purchases, not marketing tasks', () => {
    renderIn('en', 'driver');
    expect(screen.getByText(/Purchases and checklists will appear here/)).toBeTruthy();
    expect(screen.queryByText(/marketing/i)).toBeNull();
  });

  it('tells marketing about its own tasks, not purchases', () => {
    renderIn('en', 'marketing');
    expect(screen.getByText(/Marketing tasks and checklists will appear here/)).toBeTruthy();
    expect(screen.queryByText(/purchases/i)).toBeNull();
  });

  it('reads in Arabic from the team lane', () => {
    renderIn('ar', 'driver');
    expect(screen.getByRole('heading', { level: 1, name: 'مهامي' })).toBeTruthy();
    expect(screen.getByText(/ستظهر هنا المشتريات/)).toBeTruthy();
  });

  it('offers no control: there is nothing to act on yet', () => {
    renderIn('en');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

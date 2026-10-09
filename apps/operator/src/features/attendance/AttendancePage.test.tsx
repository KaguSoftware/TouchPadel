import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { businessTodayISO } from '@touch/core';
import { VENUE_TZ } from '@touch/i18n';
import { LocaleProvider } from '../../lib/i18n';
import { ConfirmProvider } from '../../components/ConfirmDialog';

// /attendance (0270–0271): a manager sets the rule (X minutes, Y IQD a day),
// records late and early days, and changes or clears them until the wage is paid.

let settingsRows: { key: string; value: unknown }[] = [];
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: async () => ({ data: settingsRows, error: null }) }) },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));

// The business day the form defaults to, as the page computes it (start hour 4).
const today = businessTodayISO(new Date(), 4, VENUE_TZ);
const month = `${today.slice(0, 7)}-01`;

const day = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  work_date: today,
  late_minutes: 20,
  early_leave_minutes: 0,
  grace_minutes: 15,
  penalty_rule_iqd: 5000,
  penalty_iqd: 5000,
  pay_month: month,
  locked: false,
  note: 'Bus was late',
  recorded_by_name: 'Omar',
  recorded_at: '2026-10-02T12:00:00Z',
  ...over,
});

let days: Record<string, unknown>[] = [];
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    switch (fn) {
      case 'attendance_month':
        return {
          month: (args.p_month as string | undefined) ?? month,
          current_month: month,
          today,
          window_days: 60,
          rule: { grace_minutes: 15, penalty_iqd: 5000 },
          staff: [
            { id: 's-yusuf', display_name: 'Yusuf', role: 'barista' },
            { id: 's-hasan', display_name: 'Hasan', role: 'waiter' },
          ],
          totals: { days: days.length, penalty_days: 1, penalties_iqd: 5000, people: days.length > 0 ? 1 : 0 },
          people:
            days.length > 0
              ? [{ staff_id: 's-yusuf', display_name: 'Yusuf', role: 'barista', is_active: true, day_count: days.length, penalty_days: 1, penalties_iqd: 5000, late_minutes: 20, early_leave_minutes: 0, days }]
              : [],
        };
      case 'record_attendance':
        return { id: 'a9', penalty_iqd: 5000, pay_month: month, replaced: false };
      case 'clear_attendance':
        return { status: 'cleared' };
      case 'set_cafe_settings':
        return [];
      default:
        throw new Error(`unexpected ${fn}`);
    }
  }),
}));

import { AttendancePageScreen } from './AttendancePage';

function renderPage(locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <ConfirmProvider>
          <AttendancePageScreen />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  settingsRows = [
    { key: 'attendance_grace_minutes', value: 15 },
    { key: 'attendance_penalty_iqd', value: 5000 },
  ];
  days = [day()];
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('AttendancePageScreen', () => {
  it('states the rule in a sentence and saves X and Y together', async () => {
    const user = userEvent.setup();
    renderPage();
    const rule = await screen.findByTestId('attendance.rule');
    expect(await within(rule).findByText(/A day costs .*5,000.* when late and early minutes together are more than 15\./)).toBeTruthy();
    expect(within(rule).getByText('Days already recorded keep the rule they were recorded under.')).toBeTruthy();
    expect(within(rule).getByText('The owner sees these on the Wages page.')).toBeTruthy();
    const grace = within(rule).getByRole('textbox', { name: /Minutes allowed/ });
    await user.clear(grace);
    await user.type(grace, '10');
    await user.click(within(rule).getByTestId('attendance.rule.save'));
    expect(calls.find((c) => c.fn === 'set_cafe_settings')?.args).toEqual({ p_settings: { attendance_grace_minutes: 10, attendance_penalty_iqd: 5000 } });
  });

  it('says the rule is off at 0 IQD', async () => {
    settingsRows = [];
    renderPage();
    expect(await screen.findByText('No penalty: the rule is off.')).toBeTruthy();
  });

  it('records a day with a live verdict, and asks for minutes first', async () => {
    const user = userEvent.setup();
    days = [];
    renderPage();
    await user.click(await screen.findByTestId('attendance.record.open'));
    const form = screen.getByTestId('attendance.record-form');
    await user.click(within(form).getByTestId('attendance.record.submit'));
    expect(within(form).getByText('Fill this in.')).toBeTruthy();
    expect(within(form).getByText('Enter minutes late, minutes left early, or both.')).toBeTruthy();
    expect(calls.some((c) => c.fn === 'record_attendance')).toBe(false);

    await user.click(within(form).getByRole('combobox', { name: /Person/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Hasan/ }));
    expect(within(form).getByTestId('attendance.record.verdict').textContent).toBe('Within the limit');
    const late = within(form).getByRole('textbox', { name: /Minutes late/ });
    await user.clear(late);
    await user.type(late, '20');
    expect(within(form).getByTestId('attendance.record.verdict').textContent).toMatch(/Over the limit: costs .*5,000/);
    await user.type(within(form).getByTestId('attendance.record.note'), 'Traffic');
    await user.click(within(form).getByTestId('attendance.record.submit'));
    expect(calls.find((c) => c.fn === 'record_attendance')?.args).toEqual({
      p_staff_id: 's-hasan',
      p_date: today,
      p_late_minutes: 20,
      p_early_leave_minutes: 0,
      p_note: 'Traffic',
    });
  });

  it('says a new entry replaces the day already recorded', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('attendance.record.open'));
    const form = screen.getByTestId('attendance.record-form');
    await user.click(within(form).getByRole('combobox', { name: /Person/ }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Yusuf/ }));
    expect(within(form).getByText(/This replaces the .* already recorded for .*Yusuf/)).toBeTruthy();
  });

  it('lists the month per person, prefills Edit, and clears a day after a confirm', async () => {
    const user = userEvent.setup();
    renderPage();
    const person = await screen.findByTestId('attendance.person.s-yusuf');
    expect(within(person).getByText('Bus was late')).toBeTruthy();
    await user.click(within(person).getByTestId('attendance.edit.a1'));
    const form = screen.getByTestId('attendance.record-form');
    expect(within(form).getByText('Change a recorded day')).toBeTruthy();
    expect((within(form).getByRole('textbox', { name: /Minutes late/ }) as HTMLInputElement).value).toBe('20');

    await user.click(within(person).getByTestId('attendance.clear.a1'));
    await user.click(await screen.findByRole('button', { name: 'Clear day' }));
    expect(calls.find((c) => c.fn === 'clear_attendance')?.args).toEqual({ p_id: 'a1' });
  });

  it('locks a day whose wage is paid, and says which wage a rolled-over day comes off', async () => {
    days = [day({ locked: true }), day({ id: 'a2', work_date: `${today.slice(0, 7)}-01`, pay_month: '2099-01-01' })];
    renderPage();
    const person = await screen.findByTestId('attendance.person.s-yusuf');
    expect(within(person).getByText('Wage paid')).toBeTruthy();
    expect(within(person).queryByTestId('attendance.edit.a1')).toBeNull();
    expect(within(person).queryByTestId('attendance.clear.a1')).toBeNull();
    expect(within(person).getByText(/Comes off January 2099’s wage/)).toBeTruthy();
  });

  it("shows three of a person's days, then View more opens the rest in place", async () => {
    const user = userEvent.setup();
    days = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => day({ id }));
    renderPage();
    const person = await screen.findByTestId('attendance.person.s-yusuf');
    expect(within(person).getAllByRole('row').slice(1)).toHaveLength(3);
    expect(within(person).queryByTestId('attendance.edit.a4')).toBeNull();
    await user.click(within(person).getByRole('button', { name: 'View more (2)' }));
    expect(within(person).getAllByRole('row').slice(1)).toHaveLength(5);
    expect(within(person).getByTestId('attendance.edit.a5')).toBeTruthy();
    await user.click(within(person).getByRole('button', { name: 'Show less' }));
    expect(within(person).getAllByRole('row').slice(1)).toHaveLength(3);
  });

  it('reads in Arabic', async () => {
    renderPage('ar');
    expect(await screen.findByRole('heading', { level: 1, name: 'التأخير والانصراف المبكر' })).toBeTruthy();
  });
});

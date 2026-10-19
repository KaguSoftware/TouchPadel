import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type { StaffRole } from '../../../lib/auth';
import type * as AuthModule from '../../../lib/auth';
import type { GenderRuleRow } from '../../../lib/queries';

// Gender hours (0353): the rate card's sibling. The table names who a rule is
// for and which court ("Every court" is the whole club), marks an overnight
// window, lists women's and men's rules that clash, and Save waits for an
// explicit Women or Men.

let role: StaffRole = 'manager';
let rules: GenderRuleRow[] = [];
const appRpc = vi.hoisted(() => vi.fn(async () => 'new-id'));

vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGenderRules: async () => rules,
  fetchActiveCourts: async () => [
    { id: 'c1', name_en: 'Court 1', name_ar: 'الملعب 1', duration_options: [60], sort_order: 1 },
    { id: 'c2', name_en: 'Court 2', name_ar: 'الملعب 2', duration_options: [60], sort_order: 2 },
  ],
}));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc,
}));
vi.mock('../../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthModule>();
  return { ...actual, usePermissions: () => actual.permissionsFor(role) };
});

import { GenderHoursEditor } from './GenderHoursEditor';

const rule = (over: Partial<GenderRuleRow> & { id: string }): GenderRuleRow => ({
  name: over.id,
  gender: 'female',
  court_id: null,
  days_of_week: [5],
  start_time: '09:00:00',
  end_time: '12:00:00',
  valid_from: null,
  valid_to: null,
  is_active: true,
  ...over,
});

function renderPage(as: StaffRole) {
  role = as;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <GenderHoursEditor />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

describe('GenderHoursEditor', () => {
  beforeEach(() => {
    appRpc.mockClear();
    rules = [];
  });

  it('lists who, which court and an overnight window, and the pairs that clash', async () => {
    rules = [
      rule({ id: 'ladies', name: 'Ladies mornings' }),
      rule({ id: 'league', name: 'Men league', gender: 'male', court_id: 'c2', start_time: '11:00:00', end_time: '13:00:00' }),
      rule({ id: 'late', name: 'Late ladies', court_id: 'c1', days_of_week: [4], start_time: '22:00:00', end_time: '02:00:00' }),
    ];
    renderPage('manager');
    const table = await screen.findByRole('table', { name: 'Gender hours' });
    const ladies = within(table).getByText('Ladies mornings').closest('tr')!;
    expect(within(ladies).getByText('Women only')).toBeTruthy();
    expect(within(ladies).getByText('Every court')).toBeTruthy();
    const league = within(table).getByText('Men league').closest('tr')!;
    expect(within(league).getByText('Men only')).toBeTruthy();
    expect(within(league).getByText('Court 2')).toBeTruthy();
    const late = within(table).getByText('Late ladies').closest('tr')!;
    expect(within(late).getByText('(next day)')).toBeTruthy();
    // Every court for women at 09–12 against Court 2 for men at 11–13 on Friday.
    expect(screen.getByText('Rules that clash')).toBeTruthy();
    expect(within(ladies).getByText('Clashes')).toBeTruthy();
    expect(within(late).queryByText('Clashes')).toBeNull();
  });

  it('teaches the empty page and lets a manager save a rule once Women or Men is chosen', async () => {
    renderPage('manager');
    expect(await screen.findByText('No gender hours yet.')).toBeTruthy();
    await userEvent.click(screen.getAllByTestId('gender-hours-new')[0]!);
    const form = screen.getByTestId('gender-rule-form');
    await userEvent.type(within(form).getByLabelText('Rule name'), 'Ladies mornings');
    const save = within(form).getByTestId('gender-rule-save') as HTMLButtonElement;
    // No default gender.
    expect(save.disabled).toBe(true);
    expect(within(form).getByText('The whole club is kept at these times: every court of this branch.')).toBeTruthy();
    await userEvent.click(within(form).getByTestId('gender-rule-female'));
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(appRpc).toHaveBeenCalledWith(
      'upsert_court_gender_rule',
      expect.objectContaining({ p_id: null, p_name: 'Ladies mornings', p_gender: 'female', p_court_id: null, p_days_of_week: [0, 1, 2, 3, 4, 5, 6], p_is_active: true }),
    );
  });

  it('keeps a desk role out of the editor', async () => {
    renderPage('court_desk');
    expect(await screen.findByText('No gender hours yet.')).toBeTruthy();
    for (const b of screen.getAllByTestId('gender-hours-new')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

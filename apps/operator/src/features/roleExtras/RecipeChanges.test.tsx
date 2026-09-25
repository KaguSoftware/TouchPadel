import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';

// The Recipe changes card on /protocols (#71): management sees the recipe as it
// is and as asked, with quantities; the owner approves or declines with a
// reason, the manager only reads, and a request made stale cannot be approved.

let role: StaffRole = 'owner';
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'o1', displayName: 'Owner', role } }),
}));

const request = (over: Record<string, unknown> = {}) => ({
  id: 'rc1',
  target: 'variant',
  item_name_en: 'Latte',
  item_name_ar: 'لاتيه',
  size_name_en: 'Large',
  size_name_ar: 'كبير',
  requested_by_name: 'Bareq',
  requested_at: '2026-09-25T08:00:00Z',
  note: 'Less sugar, one more shot',
  status: 'waiting',
  decided_by_name: null,
  decided_at: null,
  decline_reason: null,
  stale: false,
  before: [
    { recipe_line_id: 'l1', ingredient_id: 'sugar', name_en: 'Sugar', name_ar: 'سكر', qty: 10, unit: 'g' },
    { recipe_line_id: 'l2', ingredient_id: 'shot', name_en: 'Espresso', name_ar: 'إسبريسو', qty: 2, unit: 'pc' },
  ],
  after: [{ ingredient_id: 'shot', name_en: 'Espresso', name_ar: 'إسبريسو', qty: 3, unit: 'pc' }],
  ...over,
});

let rows = [request()];
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'recipe_changes_page') return { requests: rows, waiting_count: rows.length, total: rows.length };
    if (fn === 'decide_recipe_change') return { status: args.p_approve ? 'approved' : 'declined', lines_written: 1 };
    throw new Error(`unexpected ${fn}`);
  }),
}));

import { RecipeChangesCard } from './RecipeChanges';

function renderCard(as: StaffRole) {
  role = as;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <RecipeChangesCard />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rows = [request()];
  calls.length = 0;
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('RecipeChangesCard', () => {
  it('lists the waiting request and opens it with the recipe now and after, quantities included', async () => {
    renderCard('owner');
    const card = await screen.findByTestId('recipe-changes-card');
    expect(await within(card).findByText('1 waiting')).toBeTruthy();
    await userEvent.click(await within(card).findByTestId('recipe-change-rc1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Less sugar, one more shot')).toBeTruthy();
    const sugar = within(dialog).getByText('Sugar').closest('tr')!;
    expect(sugar.getAttribute('data-change')).toBe('removed');
    expect(within(sugar).getByText('10 g')).toBeTruthy();
    const shot = within(dialog).getByText('Espresso').closest('tr')!;
    expect(shot.getAttribute('data-change')).toBe('changed');
    expect(within(shot).getByText('3 pcs')).toBeTruthy();
  });

  it('asks the owner for a reason before a decline', async () => {
    renderCard('owner');
    await userEvent.click(await screen.findByTestId('recipe-change-rc1'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    const confirm = within(dialog).getByRole('button', { name: 'Decline the request' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(within(dialog).getByRole('textbox'), 'Too sweet already');
    await userEvent.click(confirm);
    expect(calls.find((c) => c.fn === 'decide_recipe_change')?.args).toEqual({ p_id: 'rc1', p_approve: false, p_reason: 'Too sweet already' });
  });

  it('gives the manager the request to read and no decision (decideRecipeChanges)', async () => {
    renderCard('manager');
    await userEvent.click(await screen.findByTestId('recipe-change-rc1'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(dialog).getByText('Only the owner approves or declines a recipe change.')).toBeTruthy();
  });

  it('will not approve a request whose recipe changed since it was sent', async () => {
    rows = [request({ stale: true })];
    renderCard('owner');
    expect(await screen.findByText('Changed since it was sent')).toBeTruthy();
    await userEvent.click(screen.getByTestId('recipe-change-rc1'));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when nothing waits', async () => {
    rows = [];
    renderCard('owner');
    expect(await screen.findByText('No recipe change is waiting.')).toBeTruthy();
  });
});

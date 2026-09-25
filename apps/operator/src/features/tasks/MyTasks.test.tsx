import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';
import type { WorkspaceKey } from '../../lib/workspaces';

// My tasks (build-contracts-2026-09-23 §5.1, §5.4): each role's starts, its
// protocol steps from app.my_protocol_work, a head's team ideas, the way back
// to the kitchen board, and the read-only copy of the phone's pages.

let role: StaffRole = 'driver';
let search: Record<string, unknown> = {};
let workspace: { active: WorkspaceKey; available: readonly WorkspaceKey[]; setActive: () => void } | null = null;
const navigate = vi.fn();

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role } }),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate, useSearch: () => search }));
vi.mock('../../routes/__root', () => ({ useWorkspaceOrNull: () => workspace }));

const work = {
  todo: [
    {
      run_step_id: 'aaaaaaaa-0000-4000-8000-000000000001',
      run_id: 'r1',
      kind: 'price_promo',
      variant: null,
      title_en: 'Summer iced latte',
      title_ar: null,
      step_key: 'announce',
      name_en: 'Announce',
      name_ar: 'الإعلان',
      opened_at: '2026-09-25T08:00:00Z',
      round: 2,
    },
  ],
  waiting: [
    {
      submission_id: 'sub1',
      run_step_id: 'aaaaaaaa-0000-4000-8000-000000000002',
      run_id: 'r2',
      kind: 'product_release',
      title_en: null,
      title_ar: 'كنافة',
      name_en: 'Propose',
      name_ar: 'الاقتراح',
      submitted_at: '2026-09-24T10:00:00Z',
    },
  ],
  decided: [],
  to_decide: [],
  counts: { todo: 1, waiting: 1, to_decide: 0 },
};

let calls: { fn: string; args: unknown }[] = [];
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args?: unknown) => {
    calls.push({ fn, args });
    if (fn === 'my_protocol_work') return work;
    if (fn === 'release_ideas_to_review') {
      return { ideas: [{ id: 'i1', team: 'kitchen', author_name: 'Tiba', submitted_at: '2026-09-25T07:00:00Z', record: { name_en: 'Date cake', item_kind: 'dessert', lines: [], sizes: [{ name_en: 'Slice' }] }, photos: [] }], count: 1 };
    }
    if (fn === 'my_checklists_today') {
      return { business_date: '2026-09-25', lists: [{ run_id: 'c1', role, slot: 'open', name_en: 'Opening', name_ar: 'الافتتاح', done: 1, total: 2, items: [{ id: 'x', text_en: 'Wipe the counter', text_ar: 'امسح', done_at: null, photo_required: true }] }] };
    }
    return {};
  }),
}));

import { MyTasksScreen } from './MyTasks';

function renderIn(as: StaffRole, locale: 'en' | 'ar' = 'en') {
  role = as;
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MyTasksScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  search = {};
  workspace = null;
  calls = [];
  navigate.mockClear();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('MyTasksScreen', () => {
  it('lists the steps to do and the ones waiting, and opens a step by the URL', async () => {
    renderIn('marketing');
    expect(screen.getByRole('heading', { level: 1, name: 'My tasks' })).toBeTruthy();
    const todo = await screen.findByTestId('tasks.todo.aaaaaaaa-0000-4000-8000-000000000001');
    expect(within(todo).getByText('Announce')).toBeTruthy();
    expect(within(todo).getByText('Summer iced latte')).toBeTruthy();
    expect(within(todo).getByText(/Round 2/)).toBeTruthy();
    // A title typed in one language shows in the other too (§4).
    expect(within(screen.getByTestId('tasks.waiting.aaaaaaaa-0000-4000-8000-000000000002')).getByText('كنافة')).toBeTruthy();
    await userEvent.click(within(todo).getByRole('button', { name: /Open/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/tasks', search: { step: 'aaaaaaaa-0000-4000-8000-000000000001' }, replace: true });
  });

  it('offers each role exactly its starts', async () => {
    const starts = (r: StaffRole) => {
      const { unmount } = renderIn(r);
      const found = ['product_release', 'price_promo', 'tournament'].filter((s) => screen.queryByTestId(`tasks.start.${s}`));
      unmount();
      return found;
    };
    expect(starts('marketing')).toEqual(['price_promo']);
    expect(starts('head_barista')).toEqual(['product_release']);
    expect(starts('court_desk')).toEqual(['tournament']);
    expect(starts('driver')).toEqual([]);
    expect(starts('barista')).toEqual([]);
  });

  it('gives a head the ideas their team sent', async () => {
    renderIn('head_chef');
    expect(await screen.findByText('Ideas from your team (1)')).toBeTruthy();
    expect(await screen.findByText('Date cake')).toBeTruthy();
  });

  it('never reads ideas for a role that reviews none', async () => {
    renderIn('barista');
    await screen.findByTestId('tasks.work');
    expect(screen.queryByTestId('tasks.ideas')).toBeNull();
    expect(calls.some((c) => c.fn === 'release_ideas_to_review')).toBe(false);
  });

  it('leads back to the kitchen board from the navless kitchen workspace', async () => {
    workspace = { active: 'prep', available: ['prep'], setActive: () => undefined };
    renderIn('chef');
    await userEvent.click(screen.getByTestId('tasks.back-to-board'));
    expect(navigate).toHaveBeenCalledWith({ to: '/kds' });
  });

  it('shows no way back to the board anywhere else', () => {
    workspace = { active: 'team', available: ['team'], setActive: () => undefined };
    renderIn('driver');
    expect(screen.queryByTestId('tasks.back-to-board')).toBeNull();
  });

  it('copies the phone pages read-only, checklists first', async () => {
    renderIn('cashier');
    const copies = await screen.findByTestId('phone-copies');
    expect(within(copies).getByText('Read-only')).toBeTruthy();
    expect(await within(copies).findByText('1 of 2 done')).toBeTruthy();
    expect(within(copies).getByText(/Wipe the counter · needs a photo/)).toBeTruthy();
    // Nothing on the copy writes: no checkbox, no tick.
    expect(within(copies).queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('reads in Arabic from the team lane', async () => {
    renderIn('marketing', 'ar');
    expect(screen.getByRole('heading', { level: 1, name: 'مهامي' })).toBeTruthy();
    expect(await screen.findByText('الإعلان')).toBeTruthy();
    expect(screen.getByTestId('tasks.start.price_promo').textContent).toContain('تغيير سعر أو عرض');
  });
});

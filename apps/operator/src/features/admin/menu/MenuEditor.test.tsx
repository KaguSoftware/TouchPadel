import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as AuthModule from '../../../lib/auth';
import type * as AdminMenuModule from './useAdminMenu';
import type * as AvailabilityModule from './availability';
import type { AdminMenuData, CategoryRow, ItemRow } from './useAdminMenu';

// The page's add button and list under product release
// (build-contracts-2026-09-23 §5.5): a manager's new café item is a proposal
// (the server refuses it otherwise, ITEM_VIA_RELEASE); a shop product and the
// owner's editor keep "New item"; an item in release says so in the list.

const auth = vi.hoisted(() => ({ role: 'manager' as 'manager' | 'owner' }));
const menu = vi.hoisted(() => ({ data: undefined as AdminMenuData | undefined }));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return {
    ...mod,
    useAuth: () => ({ staff: { role: auth.role } }),
    usePermissions: () => mod.permissionsFor(auth.role),
  };
});
vi.mock('./useAdminMenu', async (importOriginal) => {
  const mod = await importOriginal<typeof AdminMenuModule>();
  return {
    ...mod,
    useAdminMenu: () => ({ data: menu.data, isError: false, error: null, refetch: async () => undefined, refresh: async () => undefined }),
  };
});
vi.mock('./availability', async (importOriginal) => {
  const mod = await importOriginal<typeof AvailabilityModule>();
  return { ...mod, fetchStockBlockData: async () => ({ availability: [], recipeLines: [], onHand: [] }) };
});
vi.mock('../../../lib/settings', () => ({ useBusinessToday: () => '2026-09-25' }));
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useBlocker: () => undefined,
}));

import { MenuEditor } from './MenuEditor';

function category(id: string, kind: 'cafe' | 'shop', sort_order: number): CategoryRow {
  return { id, name_en: kind === 'cafe' ? 'Hot drinks' : 'Rackets', name_ar: kind === 'cafe' ? 'مشروبات ساخنة' : 'مضارب', tax_group_id: 't', sort_order, is_active: true, photo_path: null, kind };
}

function item(id: string, categoryId: string, over: Partial<ItemRow> = {}): ItemRow {
  return {
    id,
    category_id: categoryId,
    name_en: `Item ${id}`,
    name_ar: `صنف ${id}`,
    description_en: null,
    description_ar: null,
    sort_order: 0,
    is_active: true,
    unavailable_on: null,
    photo_path: null,
    photo_blur: null,
    hook_en: '',
    hook_ar: '',
    highlight: 'none',
    sold_out: false,
    launched_at: '2026-09-01T10:00:00Z',
    release_run_id: null,
    release_run: null,
    menu_item_variants: [],
    menu_item_modifier_groups: [],
    ...over,
  };
}

function data(categories: CategoryRow[], items: ItemRow[]): AdminMenuData {
  return { categories, items, groups: [], modifiers: [], taxGroups: [], costs: new Map() };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <MenuEditor />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.role = 'manager';
  router.navigate.mockReset();
  menu.data = data([category('cafe-1', 'cafe', 0), category('shop-1', 'shop', 1)], [item('a', 'cafe-1')]);
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('MenuEditor: adding an item', () => {
  it("turns a manager's New item in a café category into Propose a new item", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull();
    expect(screen.getByText('New café items go through a product release, and the owner launches them.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Propose a new item' }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { start: 'product_release' } });
  });

  it('proposes from an empty café category too, without promising it shows at once', () => {
    menu.data = data([category('cafe-1', 'cafe', 0)], []);
    renderPage();
    const empty = screen.getByRole('heading', { name: 'No items in this category yet.' }).parentElement!;
    expect(within(empty).getByRole('button', { name: 'Propose a new item' })).toBeTruthy();
    expect(within(empty).queryByText(/as soon as it is saved/)).toBeNull();
  });

  it('keeps New item for a shop category, where a manager saves the product hidden', () => {
    menu.data = data([category('shop-1', 'shop', 0), category('cafe-1', 'cafe', 1)], []);
    renderPage();
    expect(screen.getAllByRole('button', { name: 'New item' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Propose a new item' })).toBeNull();
  });

  it("leaves the owner's New item alone", () => {
    auth.role = 'owner';
    renderPage();
    expect(screen.getByRole('button', { name: 'New item' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Propose a new item' })).toBeNull();
    expect(screen.queryByText(/go through a product release/)).toBeNull();
  });

  it('reads in Arabic', () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    renderPage();
    expect(screen.getByRole('button', { name: 'اقترح صنفًا جديدًا' })).toBeTruthy();
  });
});

describe('MenuEditor: the item list', () => {
  it('marks an item still in its release', () => {
    menu.data = data(
      [category('cafe-1', 'cafe', 0)],
      [
        item('a', 'cafe-1'),
        item('b', 'cafe-1', {
          is_active: false,
          launched_at: null,
          release_run_id: 'run-1',
          release_run: { id: 'run-1', status: 'active', title_en: 'New cake', title_ar: null },
        }),
      ],
    );
    renderPage();
    const rows = screen.getAllByRole('row');
    const inRelease = rows.find((r) => within(r).queryByText('Item b'))!;
    expect(within(inRelease).getByText('In release')).toBeTruthy();
    expect(within(inRelease).queryByText('Inactive')).toBeNull();
    const launched = rows.find((r) => within(r).queryByText('Item a'))!;
    expect(within(launched).queryByText('In release')).toBeNull();
  });
});

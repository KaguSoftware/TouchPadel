import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ToastProvider } from '../../../components/toast';
import type * as AuthModule from '../../../lib/auth';
import type * as AppRpcModule from '../../../lib/appRpc';
import type * as AdminMenuModule from './useAdminMenu';
import type { ItemRow } from './useAdminMenu';

// The item form under product release and the manager locks
// (build-contracts-2026-09-23 §5.5). The server refuses the same writes
// (product-release.test.ts, price-promo.test.ts); this pins what each role is
// shown, so a manager is sent to Protocols before typing, not after.

const auth = vi.hoisted(() => ({ role: 'manager' as 'manager' | 'owner' }));
const rpc = vi.hoisted(() => ({ appRpc: vi.fn() }));
const router = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('../../../lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof AuthModule>();
  return {
    ...mod,
    useAuth: () => ({ staff: { role: auth.role } }),
    usePermissions: () => mod.permissionsFor(auth.role),
  };
});
vi.mock('../../../lib/appRpc', async (importOriginal) => {
  const mod = await importOriginal<typeof AppRpcModule>();
  return { ...mod, appRpc: rpc.appRpc };
});
vi.mock('./useAdminMenu', async (importOriginal) => {
  const mod = await importOriginal<typeof AdminMenuModule>();
  return { ...mod, useAdminMenu: () => ({ refresh: async () => undefined }) };
});
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => async () => true }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => router.navigate,
  useBlocker: () => undefined,
}));

import { AppRpcError } from '../../../lib/appRpc';
import { ItemForm } from './ItemForm';

const ITEM_ID = '0b5f0000-0000-4000-8000-0000000000a1';
const RUN_ID = '0b5f0000-0000-4000-8000-0000000000f1';

function itemRow(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: ITEM_ID,
    category_id: 'cat-1',
    name_en: 'Pistachio latte',
    name_ar: 'لاتيه فستق',
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
    menu_item_variants: [
      { id: 'v-1', item_id: ITEM_ID, name_en: 'Regular', name_ar: 'عادي', price_iqd: 5000, is_default: true, sort_order: 0 },
    ],
    menu_item_modifier_groups: [],
    ...over,
  };
}

const DRAFT = { is_active: false, launched_at: null } as const;
const IN_RELEASE = {
  ...DRAFT,
  release_run_id: RUN_ID,
  release_run: { id: RUN_ID, status: 'active', title_en: 'Pistachio latte', title_ar: null },
} as const;

function renderForm(item: ItemRow | null, kind: 'cafe' | 'shop' = 'cafe', locale: 'en' | 'ar' = 'en') {
  try {
    localStorage.setItem('touch-operator-locale', locale);
  } catch {
    /* no storage */
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <ToastProvider>
          <ItemForm item={item} categoryId="cat-1" categoryKind={kind} groups={[]} modifiers={[]} cost={null} today="2026-09-25" onSaved={() => {}} />
        </ToastProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function sizesPanel(): HTMLElement {
  const section = screen.getByRole('heading', { name: 'Sizes and prices' }).closest('section');
  if (!section) throw new Error('no Sizes and prices panel');
  return section;
}

beforeEach(() => {
  auth.role = 'manager';
  rpc.appRpc.mockReset();
  router.navigate.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('ItemForm: prices on sale', () => {
  it("shows a manager a launched item's prices as figures and sends them to a price change", async () => {
    const user = userEvent.setup();
    renderForm(itemRow());
    const panel = within(sizesPanel());
    expect(panel.queryByLabelText('Price (IQD): Regular')).toBeNull();
    expect(panel.queryByRole('button', { name: 'New size' })).toBeNull();
    expect(panel.getByText(/so its prices change through Change the price/)).toBeTruthy();
    await user.click(panel.getByRole('button', { name: 'Change the price' }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'price', item: ITEM_ID } });
  });

  it('locks a launched shop product the same way', () => {
    renderForm(itemRow(), 'shop');
    expect(within(sizesPanel()).getByRole('button', { name: 'Change the price' })).toBeTruthy();
  });

  it("still lets a manager pick the default size, re-sending the stored price", async () => {
    const user = userEvent.setup();
    rpc.appRpc.mockResolvedValue('v-2');
    renderForm(
      itemRow({
        menu_item_variants: [
          { id: 'v-1', item_id: ITEM_ID, name_en: 'Regular', name_ar: 'عادي', price_iqd: 5000, is_default: true, sort_order: 0 },
          { id: 'v-2', item_id: ITEM_ID, name_en: 'Large', name_ar: 'كبير', price_iqd: 6500, is_default: false, sort_order: 1 },
        ],
      }),
    );
    await user.click(screen.getByRole('radio', { name: 'Default: Large' }));
    await user.click(within(sizesPanel()).getByRole('button', { name: 'Save' }));
    expect(rpc.appRpc).toHaveBeenCalledWith('upsert_variant', expect.objectContaining({ p_id: 'v-2', p_price_iqd: 6500, p_is_default: true }));
  });

  it("leaves the owner's editor as it was", () => {
    auth.role = 'owner';
    renderForm(itemRow());
    const panel = within(sizesPanel());
    expect(panel.getByLabelText('Price (IQD): Regular')).toBeTruthy();
    expect(panel.getByRole('button', { name: 'New size' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Change the price' })).toBeNull();
  });

  it('lets a manager switch a launched item that is off back on', () => {
    renderForm(itemRow({ is_active: false }));
    expect((screen.getByRole('switch', { name: 'Active' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ItemForm: an item in release', () => {
  it('names its release and links it, for the owner too', async () => {
    auth.role = 'owner';
    const user = userEvent.setup();
    renderForm(itemRow(IN_RELEASE));
    expect(screen.getByText('In release: ⁨Pistachio latte⁩')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open the release' }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { run: RUN_ID } });
  });

  it('cannot be switched on or repriced by anyone (ITEM_IN_RELEASE)', () => {
    auth.role = 'owner';
    renderForm(itemRow(IN_RELEASE));
    expect((screen.getByRole('switch', { name: 'Active' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Goes on sale when the owner launches its release.')).toBeTruthy();
    const panel = within(sizesPanel());
    expect(panel.queryByLabelText('Price (IQD): Regular')).toBeNull();
    expect(panel.queryByRole('button', { name: 'New size' })).toBeNull();
    expect(panel.getByText('The release’s price step sets these prices.')).toBeTruthy();
  });

  it('is no longer in release once its run is live', () => {
    auth.role = 'owner';
    renderForm(itemRow({ ...IN_RELEASE, is_active: true, launched_at: '2026-09-20T10:00:00Z', release_run: { ...IN_RELEASE.release_run, status: 'live' } }));
    expect(screen.queryByText(/^In release/)).toBeNull();
    expect(within(sizesPanel()).getByLabelText('Price (IQD): Regular')).toBeTruthy();
  });

  it('reads in Arabic', () => {
    renderForm(itemRow(IN_RELEASE), 'cafe', 'ar');
    expect(screen.getByText('قيد الإطلاق: ⁨Pistachio latte⁩')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'افتح الإطلاق' })).toBeTruthy();
  });
});

describe('ItemForm: drafts and new items', () => {
  it("sends a manager's cafe draft to the owner's launch, prices still editable", () => {
    renderForm(itemRow(DRAFT));
    expect((screen.getByRole('switch', { name: 'Active' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Goes on sale when the owner launches it.')).toBeTruthy();
    expect(within(sizesPanel()).getByLabelText('Price (IQD): Regular')).toBeTruthy();
  });

  it("offers Put on sale on a manager's hidden shop product", async () => {
    const user = userEvent.setup();
    renderForm(itemRow(DRAFT), 'shop');
    expect((screen.getByRole('switch', { name: 'Active' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Saved hidden until the owner approves its price.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Put on sale' }));
    expect(router.navigate).toHaveBeenCalledWith({ to: '/protocols', search: { start: 'price_promo', change: 'shop_launch', item: ITEM_ID } });
  });

  it('lets the owner switch a draft on directly', () => {
    auth.role = 'owner';
    renderForm(itemRow(DRAFT));
    expect((screen.getByRole('switch', { name: 'Active' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText('Goes on sale when the owner launches it.')).toBeNull();
  });

  it("saves a manager's new shop product hidden, without calling that a change", async () => {
    const user = userEvent.setup();
    rpc.appRpc.mockResolvedValue(ITEM_ID);
    renderForm(null, 'shop');
    const active = screen.getByRole('switch', { name: 'Active' });
    expect(active.getAttribute('aria-checked')).toBe('false');
    expect((active as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    await user.type(screen.getAllByLabelText('English')[0]!, 'Grip tape');
    await user.type(screen.getAllByLabelText('Arabic')[0]!, 'شريط قبضة');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rpc.appRpc).toHaveBeenCalledWith('upsert_menu_item', expect.objectContaining({ p_id: null, p_is_active: false })));
  });

  it('shows a refusal that still arrives in its own words', async () => {
    const user = userEvent.setup();
    rpc.appRpc.mockRejectedValue(new AppRpcError('ITEM_VIA_RELEASE', 'ITEM_VIA_RELEASE'));
    renderForm(itemRow(DRAFT));
    await user.type(screen.getAllByLabelText('English')[0]!, ' v2');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('New menu items start as “Propose a new item”, and the owner launches them.')).not.toHaveLength(0);
  });
});

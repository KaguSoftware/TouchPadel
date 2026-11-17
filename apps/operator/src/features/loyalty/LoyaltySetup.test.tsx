import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Setup › Loyalty: "Add a tier" and "Add a reward" are the stepped dialog
// (StepWizard); editing one keeps the single form.

const calls: { fn: string; args: Record<string, unknown> }[] = [];
const toasts: string[] = [];
/**
 * 0410: each tier's privileges as loyalty_admin lists them, by tier id. Null is a server
 * without the migration, which sends no `perks` at all.
 */
let perksByTier: Record<string, unknown[]> | null = null;
/** 0445: the drink card as app.stamp_card_settings answers; null is a server without it. */
let stampCard: unknown = null;
let role = 'owner';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: (t: string) => toasts.push(t), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'o1', displayName: 'Majed', role } }),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return { id: 'new' };
  }),
}));
vi.mock('../till/tillData', () => ({
  TILL_MENU_QUERY: {
    queryKey: ['menu'],
    queryFn: async () => ({
      items: [
        {
          id: 'i1',
          name_en: 'Iced latte',
          name_ar: 'آيس لاتيه',
          is_active: true,
          menu_item_variants: [
            { id: 'v-large', name_en: 'Large', name_ar: 'كبير' },
            { id: 'v-regular', name_en: 'Regular', name_ar: 'عادي' },
          ],
        },
      ],
    }),
  },
}));
vi.mock('../admin/addons/useAddons', () => ({
  useAddons: () => ({
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    data: {
      groups: [
        { id: 'g-milk', name_en: 'Milk', name_ar: 'الحليب', min_select: 0, max_select: 1 },
        { id: 'g-syrup', name_en: 'Syrups', name_ar: 'السيروب', min_select: 0, max_select: 3 },
      ],
      modifiers: [],
    },
  }),
}));
// 0445: the café menu the gift, free-with and drink card pickers read.
vi.mock('../admin/menu/useAdminMenu', () => ({
  useAdminMenu: () => ({
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    data: {
      categories: [
        { id: 'c-hot', name_en: 'Hot drinks', name_ar: 'مشروبات ساخنة' },
        { id: 'c-sweet', name_en: 'Desserts', name_ar: 'حلويات' },
      ],
      items: [
        { id: 'i-latte', category_id: 'c-hot', name_en: 'Latte', name_ar: 'لاتيه', is_active: true },
        { id: 'i-tea', category_id: 'c-hot', name_en: 'Tea', name_ar: 'شاي', is_active: true },
        { id: 'i-water', category_id: 'c-hot', name_en: 'Water', name_ar: 'ماء', is_active: true },
        { id: 'i-cake', category_id: 'c-sweet', name_en: 'Cheesecake', name_ar: 'تشيز كيك', is_active: true },
      ],
    },
  }),
}));
vi.mock('./useLoyalty', () => ({
  invalidateLoyaltyAdmin: vi.fn(),
  useStampCard: () => ({ data: stampCard, isError: false, error: null, refetch: vi.fn() }),
  setStampCard: async (card: Record<string, unknown>) => {
    calls.push({ fn: 'set_stamp_card', args: { p_card: card } });
    return card;
  },
  upsertTierPerk: async (perk: Record<string, unknown>) => {
    calls.push({ fn: 'upsert_loyalty_tier_perk', args: { p_perk: perk } });
    return perk;
  },
  deleteTierPerk: async (id: string) => {
    calls.push({ fn: 'delete_loyalty_tier_perk', args: { p_perk_id: id } });
  },
  useLoyaltyAdmin: () => ({
    isError: false,
    error: null,
    refetch: vi.fn(),
    data: {
      settings: {
        enabled: true,
        iqd_per_point: 1000,
        point_value_iqd: 25,
        min_redeem_points: 100,
        earn_cafe: true,
        earn_shop: true,
        earn_court: true,
        earn_lesson: true,
        earn_tournament: true,
        inactivity_expiry_months: null,
        totp_step_seconds: 30,
      },
      tiers: [
        { id: 't0', name_en: 'Member', name_ar: 'عضو', min_points_12m: 0, earn_multiplier: 1, promotion_id: null, sort: 0, color: 'classic' },
        { id: 't1', name_en: 'Silver', name_ar: 'فضي', min_points_12m: 500, earn_multiplier: 1.2, promotion_id: null, sort: 1, color: 'silver' },
      ].map((t) => (perksByTier ? { ...t, perks: perksByTier[t.id] ?? [] } : t)),
      rewards: [],
    },
  }),
}));

import { LoyaltySetupScreen } from './LoyaltySetup';

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <LoyaltySetupScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  perksByTier = null;
  stampCard = null;
  role = 'owner';
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('LoyaltySetupScreen, adding', () => {
  it('adds a tier in three steps, then Review, and saves it after the last tier', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByTestId('loyalty-tiers')).getByRole('button', { name: 'Add a tier' }));
    const wiz = screen.getByTestId('loyalty-tier-wizard');
    expect(within(wiz).getByText('Step 1 of 3')).toBeTruthy();
    const forward = (name: string) => user.click(within(wiz).getAllByRole('button', { name }).at(-1)!);
    await forward('Points & multiplier');
    expect(within(wiz).getByText('Both names are needed.')).toBeTruthy();
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (English)' }), 'Gold');
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (Arabic)' }), 'ذهبي');
    await forward('Points & multiplier');
    await forward('Review');
    expect(within(wiz).getByText('Type a whole number, 0 or more.')).toBeTruthy();
    await user.type(within(wiz).getByRole('textbox', { name: /^From points/ }), '1500');
    await user.clear(within(wiz).getByRole('textbox', { name: /^Earn multiplier/ }));
    await user.type(within(wiz).getByRole('textbox', { name: /^Earn multiplier/ }), '1.5');
    expect(within(wiz).getByText('Gold sits after Silver. A guest moves up once they earn 1,500 points in 12 months.')).toBeTruthy();
    await forward('Card colour');
    // 0416: the club's four cards are offered, the metals are not; no tier holds one of the four
    // yet, so a new tier starts on White; the owner picks Blue.
    expect(within(wiz).getByTestId('loyalty-tier-color-white').getAttribute('aria-pressed')).toBe('true');
    expect(within(wiz).queryByTestId('loyalty-tier-color-gold')).toBeNull();
    await user.click(within(wiz).getByTestId('loyalty-tier-color-blue'));
    expect(within(wiz).getByTestId('loyalty-tier-color-blue').getAttribute('aria-pressed')).toBe('true');
    await forward('Review');
    expect(within(wiz).getByText('All 3 steps done')).toBeTruthy();
    expect(within(wiz).getByText('1,500 points in 12 months')).toBeTruthy();
    expect(within(wiz).getByText('1.5× points')).toBeTruthy();
    await user.click(within(wiz).getByTestId('loyalty-tier-wizard.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'upsert_loyalty_tier')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'upsert_loyalty_tier')?.args).toEqual({
      p_tier: { name_en: 'Gold', name_ar: 'ذهبي', min_points_12m: 1500, earn_multiplier: 1.5, promotion_id: null, sort: 2, color: 'blue' },
    });
    expect(toasts).toEqual(['Saved.']);
  });

  it('adds a reward: a free menu item asks for the item, then the cost and On offer', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByTestId('loyalty-rewards')).getByRole('button', { name: 'Add a reward' }));
    const wiz = screen.getByTestId('loyalty-reward-wizard');
    const forward = (name: string) => user.click(within(wiz).getAllByRole('button', { name }).at(-1)!);
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (English)' }), 'Free iced latte');
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (Arabic)' }), 'آيس لاتيه مجاني');
    await forward('What it gives');
    // An amount off is the default and asks for the amount.
    expect(within(wiz).getByTestId('loyalty-reward-kind-iqd_off').getAttribute('aria-pressed')).toBe('true');
    await forward('Cost');
    expect(within(wiz).getByText('Type an amount above 0.')).toBeTruthy();
    await user.click(within(wiz).getByTestId('loyalty-reward-kind-item'));
    expect(within(wiz).queryByRole('textbox', { name: /^Amount off/ })).toBeNull();
    await forward('Cost');
    expect(within(wiz).getByText('Choose the menu item.')).toBeTruthy();
    await user.click(within(wiz).getByRole('combobox', { name: 'Menu item' }));
    await user.click(await screen.findByRole('option', { name: 'Iced latte · Large' }));
    await forward('Cost');
    await user.type(within(wiz).getByRole('textbox', { name: /^Cost/ }), '400');
    expect(within(wiz).getByText('Guests can redeem it now.')).toBeTruthy();
    await forward('Review');
    // The menu reads the item under its step; the Review row says it again.
    expect(within(wiz).getByText('Gives').closest('div')!.textContent).toContain('Iced latte · Large');
    expect(within(wiz.querySelector('nav')!).getByText('Iced latte · Large')).toBeTruthy();
    expect(within(wiz).getByText('400 points')).toBeTruthy();
    expect(within(wiz).getByText('Yes')).toBeTruthy();
    await user.click(within(wiz).getByTestId('loyalty-reward-wizard.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'upsert_loyalty_reward')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'upsert_loyalty_reward')?.args).toEqual({
      p_reward: {
        name_en: 'Free iced latte',
        name_ar: 'آيس لاتيه مجاني',
        cost_points: 400,
        kind: 'item',
        iqd_off: null,
        menu_variant_id: 'v-large',
        active: true,
        venue_id: null,
      },
    });
  });
});

// 0403 (Majed 2026-11-05: rewards are things you take, not a wallet).
describe('LoyaltySetupScreen, rewards only (0403)', () => {
  it('starts "Use points" off and saves it on with the rest of the settings', async () => {
    const user = userEvent.setup();
    renderPage();
    const settings = within(screen.getByTestId('loyalty-settings'));
    const sw = settings.getByRole('switch', { name: /spend points as money off/ });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await user.click(sw);
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await user.click(settings.getByTestId('loyalty-settings-save'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'set_loyalty_settings')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'set_loyalty_settings')?.args).toMatchObject({
      p_patch: { points_off_enabled: true, enabled: true, point_value_iqd: 25 },
    });
  });

  it('refuses an expiry above 120 months, as the table does', async () => {
    const user = userEvent.setup();
    renderPage();
    const settings = within(screen.getByTestId('loyalty-settings'));
    await user.type(settings.getByRole('textbox', { name: /^Points expire after/ }), '121');
    await user.click(settings.getByTestId('loyalty-settings-save'));
    expect(settings.getByText('Between 1 and 120 months.')).toBeTruthy();
    expect(calls.find((c) => c.fn === 'set_loyalty_settings')).toBeUndefined();
  });

  it('adds a free court hour: no amount, no item, sent with both as null', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(within(screen.getByTestId('loyalty-rewards')).getByRole('button', { name: 'Add a reward' }));
    const wiz = screen.getByTestId('loyalty-reward-wizard');
    const forward = (name: string) => user.click(within(wiz).getAllByRole('button', { name }).at(-1)!);
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (English)' }), 'Free court hour');
    await user.type(within(wiz).getByRole('textbox', { name: 'Name (Arabic)' }), 'ساعة ملعب مجانية');
    await forward('What it gives');
    await user.click(within(wiz).getByTestId('loyalty-reward-kind-court_hour'));
    expect(within(wiz).getByTestId('loyalty-reward-kind-court_hour').getAttribute('aria-pressed')).toBe('true');
    expect(within(wiz).queryByRole('textbox', { name: /^Amount off/ })).toBeNull();
    expect(within(wiz).queryByRole('combobox', { name: 'Menu item' })).toBeNull();
    await forward('Cost');
    await user.type(within(wiz).getByRole('textbox', { name: /^Cost/ }), '800');
    await forward('Review');
    expect(within(wiz).getByText('Gives').closest('div')!.textContent).toContain('One free hour of court');
    await user.click(within(wiz).getByTestId('loyalty-reward-wizard.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'upsert_loyalty_reward')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'upsert_loyalty_reward')?.args).toEqual({
      p_reward: {
        name_en: 'Free court hour',
        name_ar: 'ساعة ملعب مجانية',
        cost_points: 800,
        kind: 'court_hour',
        iqd_off: null,
        menu_variant_id: null,
        active: true,
        venue_id: null,
      },
    });
  });
});

// 0410: what each card gives besides points.
describe('LoyaltySetupScreen, card privileges (0410)', () => {
  const milk = { id: 'k1', tier_id: 't1', kind: 'free_addons', name_en: 'Free milk', name_ar: 'حليب مجاني', modifier_group_ids: ['g-milk'], active: true, sort: 0 };
  const racket = { id: 'k2', tier_id: 't1', kind: 'custom', name_en: 'A racket to borrow', name_ar: 'مضرب للاستعارة', modifier_group_ids: [], active: false, sort: 1 };
  const perkCalls = () => calls.filter((c) => c.fn === 'upsert_loyalty_tier_perk' || c.fn === 'delete_loyalty_tier_perk');

  it('a server that lists no privileges shows no privileges section', () => {
    renderPage();
    expect(screen.getByTestId('loyalty-tiers')).toBeTruthy();
    expect(screen.queryByTestId('loyalty-perks')).toBeNull();
  });

  it('lists each tier’s privileges: both names, what it does, and says once that a card holds the cards below it', () => {
    perksByTier = { t1: [milk, racket] };
    renderPage();
    const panel = within(screen.getByTestId('loyalty-perks'));
    expect(panel.getAllByText(/A card also holds everything the cards below it give/)).toHaveLength(1);
    expect(within(screen.getByTestId('loyalty-perks-tier-t0')).getByText('Nothing yet for this card.')).toBeTruthy();
    const rows = within(screen.getByTestId('loyalty-perks-tier-t1')).getAllByTestId('loyalty-perk');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Free milk')).toBeTruthy();
    expect(within(rows[0]!).getByText('حليب مجاني')).toBeTruthy();
    expect(within(rows[0]!).getByText('Free add-ons: Milk')).toBeTruthy();
    expect(within(rows[0]!).getByRole('switch', { name: 'On' }).getAttribute('aria-checked')).toBe('true');
    expect(within(rows[1]!).getByText('Given by staff, by hand')).toBeTruthy();
    expect(within(rows[1]!).getByRole('switch', { name: 'On' }).getAttribute('aria-checked')).toBe('false');
  });

  it('a group the menu no longer has does not break the row: it says so', () => {
    perksByTier = { t1: [{ ...milk, modifier_group_ids: ['g-milk', 'g-gone'] }, { ...milk, id: 'k3', modifier_group_ids: ['g-gone'] }] };
    renderPage();
    const rows = within(screen.getByTestId('loyalty-perks-tier-t1')).getAllByTestId('loyalty-perk');
    expect(within(rows[0]!).getByText('Free add-ons: Milk')).toBeTruthy();
    expect(within(rows[0]!).getByTestId('loyalty-perk-missing').textContent).toBe('Groups no longer on the menu: 1');
    expect(within(rows[1]!).getByTestId('loyalty-perk-missing').textContent).toMatch(/so it frees nothing/);
  });

  it('adds free add-ons: every add-on by default, with the names filled in both languages', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Silver' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Add a privilege to Silver' }));
    expect(dialog.getByTestId('perk-kind-free_addons').getAttribute('aria-pressed')).toBe('true');
    expect((dialog.getByRole('textbox', { name: 'What guests read (English)' }) as HTMLInputElement).value).toBe('Free add-ons on every drink');
    expect((dialog.getByRole('textbox', { name: 'What guests read (Arabic)' }) as HTMLInputElement).value).toBe('كل إضافات المشروبات مجانًا');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({
      p_perk: {
        tier_id: 't1',
        kind: 'free_addons',
        name_en: 'Free add-ons on every drink',
        name_ar: 'كل إضافات المشروبات مجانًا',
        modifier_group_ids: [],
        active: true,
      },
    });
    expect(toasts).toEqual(['Saved.']);
  });

  it('adds free add-ons for chosen groups: none chosen is refused, and the names follow the groups', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Silver' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('perk-scope-groups'));
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Choose at least one add-on group, or choose every add-on.')).toBeTruthy();
    expect(perkCalls()).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: 'Syrups' }));
    expect(dialog.getByRole('button', { name: 'Syrups' }).getAttribute('aria-pressed')).toBe('true');
    expect((dialog.getByRole('textbox', { name: 'What guests read (English)' }) as HTMLInputElement).value).toBe('Free add-ons: Syrups');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({
      p_perk: { tier_id: 't1', kind: 'free_addons', name_en: 'Free add-ons: Syrups', name_ar: 'إضافات مجانية: السيروب', modifier_group_ids: ['g-syrup'] },
    });
  });

  it('adds "something else": the owner names it, with examples, and it carries no groups', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Member' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('perk-kind-custom'));
    expect(dialog.getByText('For example: priority booking, or a racket to borrow.')).toBeTruthy();
    expect(dialog.queryByTestId('perk-scope-all')).toBeNull();
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Both names are needed, 80 characters at most each.')).toBeTruthy();
    await user.type(dialog.getByRole('textbox', { name: 'What guests read (English)' }), 'Priority booking');
    await user.type(dialog.getByRole('textbox', { name: 'What guests read (Arabic)' }), 'أولوية الحجز');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({
      p_perk: { tier_id: 't0', kind: 'custom', name_en: 'Priority booking', name_ar: 'أولوية الحجز', modifier_group_ids: [], active: true },
    });
  });

  it('the On switch sends the id and the switch alone', async () => {
    const user = userEvent.setup();
    perksByTier = { t1: [milk, racket] };
    renderPage();
    const rows = within(screen.getByTestId('loyalty-perks-tier-t1')).getAllByTestId('loyalty-perk');
    await user.click(within(rows[1]!).getByRole('switch', { name: 'On' }));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({ p_perk: { id: 'k2', active: true } });
  });

  it('edits one in place, keeping its id and order, and drops a group the menu has lost', async () => {
    const user = userEvent.setup();
    perksByTier = { t1: [{ ...milk, modifier_group_ids: ['g-milk', 'g-gone'] }] };
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Edit Free milk' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit privilege' }));
    expect(dialog.getByRole('button', { name: 'Milk' }).getAttribute('aria-pressed')).toBe('true');
    expect(dialog.getByTestId('perk-group-gone')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Syrups' }));
    // A saved name is the owner's: choosing a group does not rewrite it.
    expect((dialog.getByRole('textbox', { name: 'What guests read (English)' }) as HTMLInputElement).value).toBe('Free milk');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({
      p_perk: { id: 'k1', tier_id: 't1', kind: 'free_addons', name_en: 'Free milk', name_ar: 'حليب مجاني', modifier_group_ids: ['g-milk', 'g-syrup'], active: true, sort: 0 },
    });
  });

  it('removes one only after the confirm', async () => {
    const user = userEvent.setup();
    perksByTier = { t1: [milk] };
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove Free milk' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Remove “Free milk”?' }));
    expect(perkCalls()).toHaveLength(0);
    await user.click(dialog.getByTestId('perk-remove-confirm'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]).toEqual({ fn: 'delete_loyalty_tier_perk', args: { p_perk_id: 'k1' } });
  });
});

describe('LoyaltySetupScreen, card gifts and the drink card (0445)', () => {
  const perkCalls = () => calls.filter((c) => c.fn === 'upsert_loyalty_tier_perk');
  const nameEn = (d: ReturnType<typeof within>) => (d.getByRole('textbox', { name: 'What guests read (English)' }) as HTMLInputElement).value;
  const nameAr = (d: ReturnType<typeof within>) => (d.getByRole('textbox', { name: 'What guests read (Arabic)' }) as HTMLInputElement).value;

  async function openAdd(user: ReturnType<typeof userEvent.setup>, tier = 'Silver') {
    await user.click(screen.getByRole('button', { name: `Add a privilege to ${tier}` }));
    return within(await screen.findByRole('dialog', { name: `Add a privilege to ${tier}` }));
  }

  it('offers every kind the till applies, plus something else', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    const dialog = await openAdd(user);
    for (const k of ['free_addons', 'gift', 'free_with', 'stamp_size', 'frame', 'custom']) {
      expect(dialog.getByTestId(`perk-kind-${k}`)).toBeTruthy();
    }
  });

  it('adds a birthday gift: nothing chosen is refused, the names follow the menu, days default to 7', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    const dialog = await openAdd(user);
    await user.click(dialog.getByTestId('perk-kind-gift'));
    expect(nameEn(dialog)).toBe('Birthday gift');
    expect((dialog.getByTestId('perk-gift-days') as HTMLInputElement).value).toBe('7');
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Choose at least one menu section or item.')).toBeTruthy();
    expect(perkCalls()).toHaveLength(0);
    const what = within(dialog.getByTestId('perk-gift-what'));
    await user.click(what.getByRole('button', { name: 'Hot drinks' }));
    await user.click(what.getByRole('button', { name: 'Cheesecake' }));
    expect(nameEn(dialog)).toBe('Birthday gift: Hot drinks, Cheesecake');
    expect(nameAr(dialog)).toBe('هدية عيد الميلاد: مشروبات ساخنة، تشيز كيك');
    await user.clear(dialog.getByTestId('perk-gift-days'));
    await user.type(dialog.getByTestId('perk-gift-days'), '40');
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Between 1 and 31 days.')).toBeTruthy();
    await user.clear(dialog.getByTestId('perk-gift-days'));
    await user.type(dialog.getByTestId('perk-gift-days'), '10');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({
      p_perk: {
        tier_id: 't1',
        kind: 'gift',
        name_en: 'Birthday gift: Hot drinks, Cheesecake',
        name_ar: 'هدية عيد الميلاد: مشروبات ساخنة، تشيز كيك',
        modifier_group_ids: [],
        config: { when: 'birthday', target: 'items', categoryIds: ['c-hot'], itemIds: ['i-cake'], days: 10 },
        active: true,
      },
    });
  });

  it('adds a free-with: both sides are needed, and the config carries each', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    const dialog = await openAdd(user);
    await user.click(dialog.getByTestId('perk-kind-free_with'));
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Choose what must be on the bill.')).toBeTruthy();
    expect(dialog.getByText('Choose what comes free.')).toBeTruthy();
    await user.click(within(dialog.getByTestId('perk-free-with-trigger')).getByRole('button', { name: 'Desserts' }));
    const free = within(dialog.getByTestId('perk-free-with-free'));
    await user.click(free.getByRole('button', { name: 'Tea' }));
    await user.click(free.getByRole('button', { name: 'Water' }));
    expect(nameEn(dialog)).toBe('Free Tea, Water with Desserts');
    expect(nameAr(dialog)).toBe('شاي، ماء مجانًا مع حلويات');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({
      p_perk: {
        kind: 'free_with',
        config: { triggerCategoryIds: ['c-sweet'], triggerItemIds: [], freeCategoryIds: [], freeItemIds: ['i-tea', 'i-water'] },
      },
    });
  });

  it('adds a faster drink card: the size is checked against 2..20 and the club standard is named', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    stampCard = { enabled: true, size: 8, category_ids: ['c-hot'], excluded_item_ids: [] };
    renderPage();
    const dialog = await openAdd(user);
    await user.click(dialog.getByTestId('perk-kind-stamp_size'));
    expect(dialog.getByText('Between 2 and 20 stamps. The club’s standard is 8.')).toBeTruthy();
    await user.type(dialog.getByTestId('perk-stamp-size'), '1');
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Between 2 and 20 stamps.')).toBeTruthy();
    await user.clear(dialog.getByTestId('perk-stamp-size'));
    await user.type(dialog.getByTestId('perk-stamp-size'), '6');
    expect(nameEn(dialog)).toBe('Drink card full at 6 stamps');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({ p_perk: { kind: 'stamp_size', config: { size: 6 } } });
  });

  it('adds a photo frame: each ring is drawn, the pick names it', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    const dialog = await openAdd(user);
    await user.click(dialog.getByTestId('perk-kind-frame'));
    expect(dialog.getByTestId('perk-frame-card-green').getAttribute('aria-pressed')).toBe('true');
    expect(dialog.getByTestId('perk-frame-card-blue').querySelector('[data-frame="card-blue"]')).toBeTruthy();
    await user.click(dialog.getByTestId('perk-frame-card-blue'));
    expect(nameEn(dialog)).toBe('Blue card photo frame');
    expect(nameAr(dialog)).toBe('إطار صورة البطاقة الزرقاء');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({ p_perk: { kind: 'frame', config: { frameId: 'card-blue' } } });
  });

  it('lists each new kind in plain words, and edits a gift keeping its config', async () => {
    const user = userEvent.setup();
    perksByTier = {
      t1: [
        { id: 'g1', tier_id: 't1', kind: 'gift', name_en: 'Birthday drink', name_ar: 'مشروب الميلاد', modifier_group_ids: [], config: { when: 'birthday', categoryIds: ['c-hot'], itemIds: [], days: 7 }, active: true, sort: 0 },
        { id: 'w1', tier_id: 't1', kind: 'free_with', name_en: 'Tea with dessert', name_ar: 'شاي مع الحلوى', modifier_group_ids: [], config: { triggerCategoryIds: ['c-sweet'], triggerItemIds: [], freeCategoryIds: [], freeItemIds: ['i-tea', 'i-gone'] }, active: true, sort: 1 },
        { id: 's1', tier_id: 't1', kind: 'stamp_size', name_en: 'Faster card', name_ar: 'بطاقة أسرع', modifier_group_ids: [], config: { size: 6 }, active: true, sort: 2 },
        { id: 'f1', tier_id: 't1', kind: 'frame', name_en: 'Blue ring', name_ar: 'إطار أزرق', modifier_group_ids: [], config: { frameId: 'card-blue' }, active: true, sort: 3 },
      ],
    };
    renderPage();
    const rows = within(screen.getByTestId('loyalty-perks-tier-t1')).getAllByTestId('loyalty-perk');
    expect(within(rows[0]!).getByText('On their birthday, one free from Hot drinks, for 7 days')).toBeTruthy();
    expect(within(rows[1]!).getByText('With each from Desserts, one free from Tea')).toBeTruthy();
    expect(within(rows[1]!).getByTestId('loyalty-perk-missing').textContent).toBe('No longer on the menu: 1');
    expect(within(rows[2]!).getByText('Drink card fills at 6 stamps')).toBeTruthy();
    expect(within(rows[3]!).getByText('Photo frame in the app: Blue card')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Edit Birthday drink' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit privilege' }));
    expect(dialog.getByTestId('perk-kind-gift').getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog.getByTestId('perk-gift-what')).getByRole('button', { name: 'Hot drinks' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toEqual({
      p_perk: {
        id: 'g1',
        tier_id: 't1',
        kind: 'gift',
        name_en: 'Birthday drink',
        name_ar: 'مشروب الميلاد',
        modifier_group_ids: [],
        config: { when: 'birthday', target: 'items', categoryIds: ['c-hot'], itemIds: [], days: 7 },
        active: true,
        sort: 0,
      },
    });
  });

  it('the manager reads the drink card but cannot change it', () => {
    role = 'manager';
    stampCard = { enabled: true, size: 8, category_ids: ['c-hot'], excluded_item_ids: ['i-water'] };
    renderPage();
    const panel = within(screen.getByTestId('loyalty-stamp-card'));
    expect(panel.getByRole('switch', { name: 'The drink card is on' }).getAttribute('aria-checked')).toBe('true');
    expect((panel.getByRole('switch', { name: 'The drink card is on' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel.getByTestId('stamp-card-categories')).getByRole('button', { name: 'Hot drinks' }).getAttribute('aria-pressed')).toBe('true');
    expect(panel.queryByTestId('stamp-card-save')).toBeNull();
  });

  it('a server without the drink card shows no drink card panel', () => {
    renderPage();
    expect(screen.queryByTestId('loyalty-stamp-card')).toBeNull();
  });

  it('the drink card: the owner turns it on, picks what stamps and what never does, and saves it', async () => {
    const user = userEvent.setup();
    stampCard = { enabled: false, size: 8, category_ids: [], excluded_item_ids: [] };
    perksByTier = { t1: [{ id: 's1', tier_id: 't1', kind: 'stamp_size', name_en: 'Faster card', name_ar: 'بطاقة أسرع', modifier_group_ids: [], config: { size: 6 }, active: true, sort: 0 }] };
    renderPage();
    const panel = within(screen.getByTestId('loyalty-stamp-card'));
    // A card whose privilege fills it sooner is named under the size.
    expect(panel.getByTestId('stamp-card-by-card').textContent).toContain('Silver card: full at 6 stamps');
    expect(panel.getByText('Choose the sections that stamp first.')).toBeTruthy();
    await user.click(panel.getByRole('switch', { name: 'The drink card is on' }));
    await user.click(panel.getByTestId('stamp-card-save'));
    expect(panel.getByText('Choose at least one menu section, or switch the drink card off.')).toBeTruthy();
    expect(calls.filter((c) => c.fn === 'set_stamp_card')).toHaveLength(0);
    await user.click(within(panel.getByTestId('stamp-card-categories')).getByRole('button', { name: 'Hot drinks' }));
    // Only the stamping sections' items can be excluded.
    const excluded = within(panel.getByTestId('stamp-card-excluded'));
    expect(excluded.queryByRole('button', { name: 'Cheesecake' })).toBeNull();
    await user.click(excluded.getByRole('button', { name: 'Water' }));
    await user.clear(panel.getByTestId('stamp-card-size'));
    await user.type(panel.getByTestId('stamp-card-size'), '9');
    await user.click(panel.getByTestId('stamp-card-save'));
    await waitFor(() => expect(calls.filter((c) => c.fn === 'set_stamp_card')).toHaveLength(1));
    expect(calls.find((c) => c.fn === 'set_stamp_card')!.args).toEqual({
      p_card: { enabled: true, size: 9, category_ids: ['c-hot'], excluded_item_ids: ['i-water'] },
    });
    expect(toasts).toContain('Saved.');
  });
});

describe('LoyaltySetupScreen, gifts by when and the free size upgrade (0445, second pass)', () => {
  const perkCalls = () => calls.filter((c) => c.fn === 'upsert_loyalty_tier_perk');
  const nameEn = (d: ReturnType<typeof within>) => (d.getByRole('textbox', { name: 'What guests read (English)' }) as HTMLInputElement).value;

  it('adds a monthly court hour: no menu, no days, named for what it is', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Silver' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('perk-kind-gift'));
    expect(dialog.getByTestId('perk-gift-when-birthday').getAttribute('aria-pressed')).toBe('true');
    await user.click(dialog.getByTestId('perk-gift-when-monthly'));
    expect(dialog.queryByTestId('perk-gift-days')).toBeNull();
    await user.click(dialog.getByTestId('perk-gift-target-court_hour'));
    expect(dialog.queryByTestId('perk-gift-what')).toBeNull();
    expect(nameEn(dialog)).toBe('A free court hour every month');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({
      p_perk: { kind: 'gift', name_en: 'A free court hour every month', config: { when: 'monthly', target: 'court_hour', categoryIds: [], itemIds: [] } },
    });
    expect(perkCalls()[0]!.args.p_perk).not.toHaveProperty('config.days');
  });

  it('a gift on reaching this card starts at 30 days and refuses more than 90', async () => {
    const user = userEvent.setup();
    perksByTier = {};
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Silver' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('perk-kind-gift'));
    await user.click(dialog.getByTestId('perk-gift-when-card_up'));
    expect((dialog.getByTestId('perk-gift-days') as HTMLInputElement).value).toBe('30');
    await user.click(within(dialog.getByTestId('perk-gift-what')).getByRole('button', { name: 'Latte' }));
    expect(nameEn(dialog)).toBe('Welcome gift: Latte');
    await user.clear(dialog.getByTestId('perk-gift-days'));
    await user.type(dialog.getByTestId('perk-gift-days'), '95');
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Between 1 and 90 days.')).toBeTruthy();
    expect(perkCalls()).toHaveLength(0);
  });

  it('adds a free size upgrade, and lists it and the new gifts in plain words', async () => {
    const user = userEvent.setup();
    perksByTier = {
      t1: [
        { id: 'm1', tier_id: 't1', kind: 'gift', name_en: 'Monthly hour', name_ar: 'ساعة الشهر', modifier_group_ids: [], config: { when: 'monthly', target: 'court_hour', categoryIds: [], itemIds: [] }, active: true, sort: 0 },
        { id: 'u1', tier_id: 't1', kind: 'gift', name_en: 'Welcome', name_ar: 'ترحيب', modifier_group_ids: [], config: { when: 'card_up', target: 'items', categoryIds: [], itemIds: ['i-cake'], days: 30 }, active: true, sort: 1 },
        { id: 's1', tier_id: 't1', kind: 'size_upgrade', name_en: 'Upgrade', name_ar: 'ترقية', modifier_group_ids: [], config: { categoryIds: ['c-hot'], itemIds: [] }, active: true, sort: 2 },
      ],
    };
    renderPage();
    const rows = within(screen.getByTestId('loyalty-perks-tier-t1')).getAllByTestId('loyalty-perk');
    expect(within(rows[0]!).getByText('Every month, one free court hour')).toBeTruthy();
    expect(within(rows[1]!).getByText('On reaching this card, one free from Cheesecake, for 30 days')).toBeTruthy();
    expect(within(rows[2]!).getByText('Charged one size down: Hot drinks')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add a privilege to Member' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByTestId('perk-kind-size_upgrade'));
    await user.click(dialog.getByTestId('perk-save'));
    expect(dialog.getByText('Choose at least one menu section or item.')).toBeTruthy();
    await user.click(within(dialog.getByTestId('perk-size-upgrade-what')).getByRole('button', { name: 'Hot drinks' }));
    expect(nameEn(dialog)).toBe('Free size upgrade: Hot drinks');
    await user.click(dialog.getByTestId('perk-save'));
    await waitFor(() => expect(perkCalls()).toHaveLength(1));
    expect(perkCalls()[0]!.args).toMatchObject({ p_perk: { tier_id: 't0', kind: 'size_upgrade', config: { categoryIds: ['c-hot'], itemIds: [] } } });
  });
});

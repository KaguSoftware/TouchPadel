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

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: (t: string) => toasts.push(t), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 'o1', displayName: 'Majed', role: 'owner' } }),
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
vi.mock('./useLoyalty', () => ({
  invalidateLoyaltyAdmin: vi.fn(),
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Setup › Loyalty: "Add a tier" and "Add a reward" are the stepped dialog
// (StepWizard); editing one keeps the single form.

const calls: { fn: string; args: Record<string, unknown> }[] = [];
const toasts: string[] = [];

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
vi.mock('./useLoyalty', () => ({
  invalidateLoyaltyAdmin: vi.fn(),
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
      ],
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
    // 0376: Silver is taken, so a new tier starts on Bronze; the owner picks Gold.
    expect(within(wiz).getByTestId('loyalty-tier-color-bronze').getAttribute('aria-pressed')).toBe('true');
    await user.click(within(wiz).getByTestId('loyalty-tier-color-gold'));
    expect(within(wiz).getByTestId('loyalty-tier-color-gold').getAttribute('aria-pressed')).toBe('true');
    await forward('Review');
    expect(within(wiz).getByText('All 3 steps done')).toBeTruthy();
    expect(within(wiz).getByText('1,500 points in 12 months')).toBeTruthy();
    expect(within(wiz).getByText('1.5× points')).toBeTruthy();
    await user.click(within(wiz).getByTestId('loyalty-tier-wizard.submit'));
    await waitFor(() => expect(calls.find((c) => c.fn === 'upsert_loyalty_tier')).toBeTruthy());
    expect(calls.find((c) => c.fn === 'upsert_loyalty_tier')?.args).toEqual({
      p_tier: { name_en: 'Gold', name_ar: 'ذهبي', min_points_12m: 1500, earn_multiplier: 1.5, promotion_id: null, sort: 2, color: 'gold' },
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Loyalty build contracts §1.3, plan §5.3: one field takes a phone or a member token, then
// loyalty_identify (this branch) and set_tab_customer; the chip's Use points opens on the most
// that fit what is left to pay and sends loyalty_redeem with a per-press key; a loyalty row on
// the tab is undone with loyalty_unredeem; a tab opened offline is off with its hint.

let role = 'cashier';
/** 0308 (c2): the identified member works here; set_tab_customer wants a manager PIN grant. */
let memberIsStaff = false;
/** 0308 (c3): loyalty_redeem answers a spent token as data. */
let tokenSpent = false;
/** 0403: the owner's "Use points" switch (loyalty_till_terms.points_off_enabled). */
let pointsOff = true;
/** 0403: the free court hour already on the tab's booking (loyalty_court_reward.reward). */
let courtReward: Record<string, unknown> | null = null;
const TAB = 't1';
let tabRow: {
  id: string;
  status: string;
  customer_id: string | null;
  reservation_id?: string | null;
  tab_adjustments: unknown[];
};

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === 'tabs'
            ? { data: tabRow, error: null }
            : { data: null, error: { message: 'denied' } },
        maybeSingle: async () => ({ data: null, error: { message: 'denied' } }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: null, error: { message: 'denied' } }),
      };
      return chain;
    },
  },
  supabaseUrl: '',
  supabaseAnonKey: '',
}));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role } }),
}));
vi.mock('../../lib/venueScope', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  currentBranchId: () => 'v1',
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  onlineKey: (rpc: string) => `TILL-1:${rpc}:01JABCDEFGHJKMNPQRSTVWXYZ0`,
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import type { ComponentProps } from 'react';
import type { TabBenefits } from '@touch/core/loyalty';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { MemberAttach } from './MemberAttach';

const rpc = vi.mocked(appRpc);

const MEMBER = {
  customer_id: 'p1',
  display_name: 'Ali H.',
  phone_masked: '0770 *** 4567',
  tier_name_en: 'Member',
  tier_name_ar: 'عضو',
  balance: 400,
  enabled: true,
};

function mount(
  tabId = TAB,
  remainingIqd: number | null = 12_340,
  extra: Partial<ComponentProps<typeof MemberAttach>> = {},
) {
  let grants = 0;
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case 'loyalty_identify':
        return MEMBER;
      case 'set_tab_customer':
        if (memberIsStaff && args?.p_customer_id) {
          if (grants === 0) throw new AppRpcError('PIN_GRANT_REQUIRED', 'PIN_GRANT_REQUIRED');
          grants -= 1;
        }
        tabRow = { ...tabRow, customer_id: (args?.p_customer_id as string | null) ?? null };
        return { tab_id: TAB, customer_id: tabRow.customer_id };
      case 'loyalty_customer':
        return {
          balance: 400,
          lifetime: 900,
          points_12m: 600,
          tier: { id: 't0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 },
          history: [],
        };
      case 'loyalty_till_terms':
        return {
          enabled: true,
          points_off_enabled: pointsOff,
          point_value_iqd: 50,
          min_redeem_points: 100,
          rewards: [
            {
              id: 'r1',
              name_en: 'Free tea',
              name_ar: 'شاي',
              cost_points: 200,
              kind: 'iqd_off',
              iqd_off: 1000,
              menu_variant_id: null,
              active: true,
              venue_id: null,
            },
          ],
        };
      case 'loyalty_redeem':
        if (tokenSpent && args?.p_member_token) {
          return { error: 'MEMBER_CODE_INVALID', detail: 'replayed' };
        }
        return {
          adjustment_id: 'a1',
          points: args?.p_points ?? 20,
          amount_iqd: 1000,
          balance: 200,
        };
      case 'loyalty_unredeem':
        return { balance: 400 };
      case 'loyalty_court_reward':
        return {
          tab_id: TAB,
          reservation_id: 'res1',
          plain_booking: true,
          value_iqd: 40000,
          refused: courtReward ? 'REWARD_ALREADY_ON_BOOKING' : null,
          reward: courtReward,
        };
      case 'verify_manager_pin':
        if (args?.p_pin !== '1234') return null;
        grants += 1;
        return 'mgr1';
      default:
        return {};
    }
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemberAttach tabId={tabId} remainingIqd={remainingIqd} {...extra} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

function calls(fn: string) {
  return rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1]);
}

describe('MemberAttach', () => {
  beforeEach(() => {
    rpc.mockReset();
    role = 'cashier';
    memberIsStaff = false;
    tokenSpent = false;
    pointsOff = true;
    courtReward = null;
    tabRow = { id: TAB, status: 'open', customer_id: null, tab_adjustments: [] };
  });

  it('hides Use points while the owner has it off; Rewards stays (0403)', async () => {
    pointsOff = false;
    tabRow = { ...tabRow, customer_id: 'p1' };
    mount();
    expect(await screen.findByRole('button', { name: 'Rewards' })).toBeTruthy();
    await waitFor(() => expect(calls('loyalty_till_terms')).toHaveLength(1));
    expect(screen.queryByTestId('member-use-points')).toBeNull();
  });

  it('shows the free court hour on a booking’s bill and undoes it by its own id (0403)', async () => {
    courtReward = {
      id: 'crw1',
      reward_id: 'rw1',
      name_en: 'Free court hour',
      name_ar: 'ساعة ملعب مجانية',
      points: 800,
      amount_iqd: 40000,
      created_at: '2026-11-05T20:00:00Z',
      closed: false,
    };
    tabRow = { ...tabRow, customer_id: 'p1', reservation_id: 'res1' };
    const user = userEvent.setup();
    mount();
    expect(await screen.findByTestId('member-court-hour')).toBeTruthy();
    await user.click(screen.getByTestId('member-court-undo'));
    await waitFor(() => expect(calls('loyalty_unredeem')).toEqual([{ p_adjustment_id: 'crw1' }]));
  });

  it('asks another manager’s PIN to add a member who works here, then attaches them (0308, c2)', async () => {
    memberIsStaff = true;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const identify = within(await screen.findByRole('dialog'));
    await user.type(identify.getByTestId('member-code'), '0770 123 4567{Enter}');
    // the refusal turns into the PIN dialog, not an error under the field
    const pinDialog = within(await screen.findByRole('dialog', { name: /staff member/i }));
    const confirm = pinDialog.getByTestId('staff-attach-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(pinDialog.getByTestId('staff-attach-pin'), '1234');
    await user.click(confirm);
    await waitFor(() => expect(calls('set_tab_customer')).toHaveLength(2));
    expect(calls('verify_manager_pin')).toHaveLength(1);
    expect(calls('set_tab_customer')[1]).toEqual({ p_tab_id: TAB, p_customer_id: 'p1' });
    expect(await screen.findByText('Ali H.')).toBeTruthy();
  });

  it('shows a wrong PIN for a staff member and does not attach them', async () => {
    memberIsStaff = true;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const identify = within(await screen.findByRole('dialog'));
    await user.type(identify.getByTestId('member-code'), '0770 123 4567{Enter}');
    const pinDialog = within(await screen.findByRole('dialog', { name: /staff member/i }));
    await user.type(pinDialog.getByTestId('staff-attach-pin'), '9999');
    await user.click(pinDialog.getByTestId('staff-attach-confirm'));
    await waitFor(() => expect(calls('verify_manager_pin')).toHaveLength(1));
    expect(calls('set_tab_customer')).toHaveLength(1);
    expect(tabRow.customer_id).toBeNull();
  });

  it('treats a spent token the server answered as a refusal, and falls back to the PIN', async () => {
    tokenSpent = true;
    const user = userEvent.setup();
    mount(TAB, 12_340);
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const identify = within(await screen.findByRole('dialog'));
    await user.type(identify.getByTestId('member-code'), 'TP-ABCDEFGH-654321{Enter}');
    await waitFor(() => expect(calls('set_tab_customer')).toHaveLength(1));
    await user.click(await screen.findByTestId('member-use-points'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByTestId('redeem-pin')).toBeNull();
    await user.click(dialog.getByTestId('redeem-confirm'));
    await waitFor(() => expect(calls('loyalty_redeem')).toHaveLength(1));
    // the answered miss closes nothing: the dialog now asks for a manager's PIN
    expect(await dialog.findByTestId('redeem-pin')).toBeTruthy();
    expect(screen.queryByText(/took .* off the bill/)).toBeNull();
  });

  it('identifies by the phone the guest says, on this branch, and attaches them to the tab', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('member-code'), '0770 123 4567{Enter}');
    await waitFor(() =>
      expect(calls('set_tab_customer')).toEqual([{ p_tab_id: TAB, p_customer_id: 'p1' }]),
    );
    expect(calls('loyalty_identify')).toEqual([{ p_code: '07701234567', p_venue_id: 'v1' }]);
    expect(await screen.findByText('Ali H.')).toBeTruthy();
    expect(screen.getByTestId('member-balance').textContent).toContain('400');
  });

  it('sends nothing for text that is neither a phone nor a member code', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('member-code'), 'latte{Enter}');
    expect(await dialog.findByText(/isn't a member code or a phone number/)).toBeTruthy();
    expect(calls('loyalty_identify')).toEqual([]);
  });

  it('opens Use points on the most that fits what is left, and redeems with one key behind a manager PIN', async () => {
    role = 'manager';
    tabRow = { ...tabRow, customer_id: 'p1' };
    const user = userEvent.setup();
    mount(TAB, 12_340);
    await user.click(await screen.findByTestId('member-use-points'));
    const dialog = within(await screen.findByRole('dialog'));
    // 400 points at 50 IQD each is 20,000; 12,340 left takes 246 of them.
    await waitFor(() =>
      expect((dialog.getByTestId('redeem-points') as HTMLInputElement).value).toBe('246'),
    );
    // 0308 (c2): no card scanned for this member, so a manager's PIN is the proof
    expect((dialog.getByTestId('redeem-confirm') as HTMLButtonElement).disabled).toBe(true);
    await user.type(dialog.getByTestId('redeem-pin'), '1234');
    await user.click(dialog.getByTestId('redeem-confirm'));
    await waitFor(() =>
      expect(calls('loyalty_redeem')).toEqual([
        {
          p_tab_id: TAB,
          p_points: 246,
          p_reward_id: null,
          p_idempotency_key: 'TILL-1:loyalty_redeem:01JABCDEFGHJKMNPQRSTVWXYZ0',
          p_member_token: null,
        },
      ]),
    );
    expect(calls('verify_manager_pin')).toHaveLength(1);
  });

  it('sends the member token scanned a moment ago as the proof, once, and asks no PIN', async () => {
    const user = userEvent.setup();
    mount(TAB, 12_340);
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const identify = within(await screen.findByRole('dialog'));
    await user.type(identify.getByTestId('member-code'), 'TP-ABCDEFGH-123456{Enter}');
    await waitFor(() => expect(calls('set_tab_customer')).toHaveLength(1));
    await user.click(await screen.findByTestId('member-use-points'));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.queryByTestId('redeem-pin')).toBeNull();
    await user.click(dialog.getByTestId('redeem-confirm'));
    await waitFor(() => expect(calls('loyalty_redeem')).toHaveLength(1));
    expect(calls('loyalty_redeem')[0]).toMatchObject({ p_member_token: 'TP-ABCDEFGH-123456' });
    expect(calls('verify_manager_pin')).toEqual([]);
  });

  it('shows a miss the server answered (0308: counted, not raised) under the field', async () => {
    const user = userEvent.setup();
    mount();
    rpc.mockImplementationOnce(async () => ({ customer_id: null, error: 'MEMBER_NOT_FOUND' }));
    await user.click(await screen.findByRole('button', { name: 'Member' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByTestId('member-code'), '0770 123 4567{Enter}');
    expect(await dialog.findByText(/No account has that member code/)).toBeTruthy();
    expect(calls('set_tab_customer')).toEqual([]);
  });

  it('undoes a redemption on the open tab', async () => {
    tabRow = {
      ...tabRow,
      customer_id: 'p1',
      tab_adjustments: [
        {
          id: 'adj1',
          kind: 'discount_amount',
          amount_iqd: 5000,
          value: 100,
          reason_code: 'loyalty_points',
        },
        { id: 'adj2', kind: 'discount_amount', amount_iqd: 1000, value: 10, reason_code: 'comp' },
      ],
    };
    const user = userEvent.setup();
    mount();
    const undo = await screen.findAllByTestId('member-undo');
    expect(undo).toHaveLength(1);
    await user.click(undo[0]!);
    await waitFor(() => expect(calls('loyalty_unredeem')).toEqual([{ p_adjustment_id: 'adj1' }]));
  });

  it('is off with a hint on a tab opened offline', async () => {
    mount('local:TILL-1:tab.open:01JABCDEFGHJKMNPQRSTVWXYZ0');
    const button = (await screen.findByTestId('member-button')) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/once this tab reaches the server/)).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('shows nothing to a role that cannot attach a member', async () => {
    role = 'waiter';
    mount();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('member-button')).toBeNull();
  });

  // 0410: what the bill customer's card gives, read by the host (app.loyalty_tab_benefits).
  describe('what the card gives (0410)', () => {
    const benefits: TabBenefits = {
      tab_id: TAB,
      customer_id: 'p1',
      enabled: true,
      tier: { id: 't2', name_en: 'Gold', name_ar: 'ذهبي', multiplier: 1.5, color: 'gold' },
      perks: [
        { id: 'k1', kind: 'free_addons', name_en: 'Free add-ons on every drink', name_ar: 'كل إضافات المشروبات مجانًا', tier_id: 't2', tier_name_en: 'Gold', tier_name_ar: 'ذهبي', tier_color: 'gold' },
        { id: 'k2', kind: 'custom', name_en: 'Priority booking', name_ar: 'أولوية الحجز', tier_id: 't1', tier_name_en: 'Silver', tier_name_ar: 'فضي', tier_color: 'silver' },
      ],
      addons: { on_bill_iqd: 1500, due_iqd: 1500, needs_refresh: false },
      deal: null,
    };

    it('names the card in its colour and lists its privileges: free add-ons the till takes off, the rest by hand', async () => {
      tabRow = { ...tabRow, customer_id: 'p1' };
      mount(TAB, 12_340, { benefits });
      const block = within(await screen.findByTestId('member-benefits'));
      expect(block.getByTestId('member-card-name').textContent).toBe('Gold card gives');
      expect(screen.getByTestId('member-benefits').querySelector('[data-tier-color="gold"]')).toBeTruthy();
      const perks = block.getAllByTestId('member-perk');
      expect(perks.map((p) => p.textContent)).toEqual(['Free add-ons on every drinkTaken off by the till', 'Priority bookingGive by hand']);
      expect(block.getByTestId('member-perk-on-bill').textContent).toContain('1,500');
      expect(block.queryByTestId('member-deal')).toBeNull();
    });

    it('never offers Undo for the free add-ons the server put on the bill', async () => {
      tabRow = {
        ...tabRow,
        customer_id: 'p1',
        tab_adjustments: [{ id: 'a9', kind: 'discount_amount', amount_iqd: 1500, value: 1500, reason_code: 'loyalty_tier_perk' }],
      };
      mount(TAB, 12_340, { benefits });
      await screen.findByTestId('member-benefits');
      expect(screen.queryByTestId('member-undo')).toBeNull();
      expect(screen.queryByText('Points used on this bill')).toBeNull();
    });

    it('shows the card of a bill whose customer the server knows without anyone attached (a booking, an app order)', async () => {
      mount(TAB, 12_340, { benefits });
      expect(await screen.findByTestId('member-benefits')).toBeTruthy();
      expect(screen.getByTestId('member-button')).toBeTruthy();
    });

    it('the deal picked in the app runs the host’s promotion apply, and says so once it is on the bill', async () => {
      const user = userEvent.setup();
      const apply = vi.fn();
      tabRow = { ...tabRow, customer_id: 'p1' };
      const deal = { promotion_id: 'pr1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'percent' as const, value: 20, applied: false };
      mount(TAB, 12_340, { benefits: { ...benefits, deal }, deal: { apply } });
      const block = within(await screen.findByTestId('member-deal'));
      expect(block.getByText('Happy hour')).toBeTruthy();
      expect(block.getByText('20% off')).toBeTruthy();
      // Apply waits for the bill to be known open.
      await user.click(await block.findByTestId('member-deal-apply'));
      expect(apply).toHaveBeenCalledTimes(1);
    });

    it('a deal already on the bill has no Apply; a host with no promotion apply only names it', async () => {
      tabRow = { ...tabRow, customer_id: 'p1' };
      const deal = { promotion_id: 'pr1', name_en: 'Happy hour', name_ar: 'ساعة السعادة', type: 'amount' as const, value: 2000, applied: false };
      mount(TAB, 12_340, { benefits: { ...benefits, perks: [], deal } });
      const block = within(await screen.findByTestId('member-deal'));
      expect(block.queryByTestId('member-deal-apply')).toBeNull();
      expect(block.getByText('For your information. Deals are applied at the café cashier.')).toBeTruthy();
      // No privileges: the card heading is left out, the deal stays.
      expect(screen.queryByTestId('member-card-name')).toBeNull();
    });

    it.each([
      ['loyalty is off', { ...benefits, enabled: false }],
      ['the answer is another bill’s', { ...benefits, tab_id: 'other' }],
      ['the card gives nothing and no deal was picked', { ...benefits, perks: [] }],
      ['the server has no such answer', null],
    ])('shows nothing new when %s', async (_why, given) => {
      tabRow = { ...tabRow, customer_id: 'p1' };
      mount(TAB, 12_340, { benefits: given });
      await screen.findByTestId('member-chip');
      expect(screen.queryByTestId('member-benefits')).toBeNull();
    });
  });
});

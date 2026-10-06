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
const TAB = 't1';
let tabRow: { id: string; status: string; customer_id: string | null; tab_adjustments: unknown[] };

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

import { appRpc } from '../../lib/appRpc';
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

function mount(tabId = TAB, remainingIqd: number | null = 12_340) {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    switch (fn) {
      case 'loyalty_identify':
        return MEMBER;
      case 'set_tab_customer':
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
        return {
          adjustment_id: 'a1',
          points: args?.p_points ?? 20,
          amount_iqd: 1000,
          balance: 200,
        };
      case 'loyalty_unredeem':
        return { balance: 400 };
      default:
        return {};
    }
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MemberAttach tabId={tabId} remainingIqd={remainingIqd} />
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
    tabRow = { id: TAB, status: 'open', customer_id: null, tab_adjustments: [] };
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

  it('opens Use points on the most that fits what is left, and redeems with one key', async () => {
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
    await user.click(dialog.getByTestId('redeem-confirm'));
    await waitFor(() =>
      expect(calls('loyalty_redeem')).toEqual([
        {
          p_tab_id: TAB,
          p_points: 246,
          p_reward_id: null,
          p_idempotency_key: 'TILL-1:loyalty_redeem:01JABCDEFGHJKMNPQRSTVWXYZ0',
        },
      ]),
    );
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
});

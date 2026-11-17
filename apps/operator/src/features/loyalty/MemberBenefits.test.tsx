import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeT } from '@touch/i18n';
import type { CardExtras, TabBenefits } from '@touch/core/loyalty';
import { LocaleProvider } from '../../lib/i18n';

// 0445: the member block of a bill says why lines are free (by reason, from
// loyalty_tab_benefits.lines), the member's drink card at a glance, and a birthday gift whose
// days hold today (app.loyalty_card_extras).

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
let extras: CardExtras | null = null;
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async (fn: string) => (fn === 'loyalty_card_extras' ? extras : null)),
}));

import { appRpc } from '../../lib/appRpc';
import { AppRpcError } from '../../lib/appRpc';
import { MemberBenefits, dealValueText, lineReasonLabel } from './MemberBenefits';

const benefits: TabBenefits = {
  tab_id: 't1',
  customer_id: 'p1',
  enabled: true,
  tier: { id: 'b', name_en: 'Blue', name_ar: 'أزرق', multiplier: 1, color: 'blue' },
  perks: [
    { id: 'g1', kind: 'gift', name_en: 'Birthday drink', name_ar: 'مشروب الميلاد', tier_id: 'g', tier_name_en: 'Green', tier_name_ar: 'أخضر', tier_color: 'green' },
    { id: 'w1', kind: 'free_with', name_en: 'Free Tea with Desserts', name_ar: 'شاي مجانًا مع حلويات', tier_id: 'b', tier_name_en: 'Blue', tier_name_ar: 'أزرق', tier_color: 'blue' },
    { id: 'f1', kind: 'frame', name_en: 'Blue card photo frame', name_ar: 'إطار', tier_id: 'b', tier_name_en: 'Blue', tier_name_ar: 'أزرق', tier_color: 'blue' },
    { id: 's1', kind: 'stamp_size', name_en: 'Drink card full at 6 stamps', name_ar: 'بطاقة', tier_id: 'b', tier_name_en: 'Blue', tier_name_ar: 'أزرق', tier_color: 'blue' },
    { id: 'c1', kind: 'custom', name_en: 'Priority booking', name_ar: 'أولوية الحجز', tier_id: 'b', tier_name_en: 'Blue', tier_name_ar: 'أزرق', tier_color: 'blue' },
  ],
  addons: { on_bill_iqd: 9000, due_iqd: 9000, needs_refresh: false },
  lines: [
    { order_item_id: 'oi1', kind: 'gift', perk_id: 'g1', units: 1, amount_iqd: 4000 },
    { order_item_id: 'oi2', kind: 'stamp', perk_id: null, units: 1, amount_iqd: 3000 },
    { order_item_id: 'oi3', kind: 'free_with', perk_id: 'w1', units: 1, amount_iqd: 2000 },
  ],
  deal: null,
};

const card = (over: Partial<CardExtras['stamps']> = {}, gifts: CardExtras['birthday']['gifts'] = []): CardExtras => ({
  stamps: { enabled: true, count: 3, size: 6, ready: false, held: false, ...over },
  birthday: { has_date: true, gifts, counts_from: null, gifts_on_card: [] },
});

function mount(b: TabBenefits = benefits, open = true) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>
        <MemberBenefits benefits={b} open={open} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  extras = null;
  vi.mocked(appRpc).mockClear();
  vi.mocked(appRpc).mockImplementation((async (fn: string) => (fn === 'loyalty_card_extras' ? extras : null)) as never);
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

describe('MemberBenefits (0445)', () => {
  it('lists only what the bill acts on, and sums the free lines by reason', async () => {
    mount();
    const block = within(await screen.findByTestId('member-benefits'));
    const perks = block.getAllByTestId('member-perk');
    // A ring and a drink card size do nothing on a bill.
    expect(perks.map((p) => p.getAttribute('data-kind'))).toEqual(['gift', 'free_with', 'custom']);
    expect(perks[0]!.textContent).toContain('Taken off by the till');
    expect(perks[2]!.textContent).toContain('Give by hand');
    const totals = block.getAllByTestId('member-perk-line-total');
    expect(totals.map((t) => t.textContent)).toEqual([
      'Free drink, card full: 3,000 IQD off',
      'Birthday gift: 4,000 IQD off',
      'Free with the order: 2,000 IQD off',
    ]);
    // With lines, the old one-line sum is not shown as well.
    expect(block.queryByTestId('member-perk-on-bill')).toBeNull();
  });

  it('shows the drink card: x of N, how many to go, and a free drink on this bill', async () => {
    extras = card();
    mount({ ...benefits, lines: [] });
    const stamps = await screen.findByTestId('member-stamps');
    expect(stamps.getAttribute('data-state')).toBe('filling');
    expect(within(stamps).getByTestId('member-stamps-count').textContent).toBe('3 of 6');
    expect(stamps.textContent).toContain('3 more to a free drink');
    expect(vi.mocked(appRpc)).toHaveBeenCalledWith('loyalty_card_extras', { p_profile_id: 'p1' });
  });

  it('a full card says it holds a free drink; one taken on this bill says so', async () => {
    extras = card({ count: 6, ready: true });
    const { unmount } = mount({ ...benefits, lines: [] });
    expect((await screen.findByTestId('member-stamps')).textContent).toContain('Full: one free drink');
    unmount();
    extras = card({ count: 6, ready: true, held: true });
    mount();
    expect((await screen.findByTestId('member-stamps')).textContent).toContain('Free drink on this bill');
  });

  it('shows a birthday gift open today, and why there is none when the date is too new', async () => {
    const g = (perk_id: string, eligible: boolean, used: boolean) => ({ perk_id, name_en: 'Birthday drink', name_ar: 'مشروب الميلاد', target: 'items' as const, window_from: null, window_to: null, eligible, used });
    extras = card({ enabled: false }, [g('g9', true, false), g('g8', false, false)]);
    mount({ ...benefits, lines: [] });
    const rows = await screen.findAllByTestId('member-gift');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['open', 'tooRecent']);
    expect(rows[0]!.textContent).toContain('Birthday gift today: Birthday drink');
    // 0445: not redeemed yet, so it waits for the member, and the till can give it.
    expect(within(rows[0]!).getByTestId('member-gift-claim').textContent).toContain('Waiting for the member to redeem');
    expect(rows[1]!.textContent).toMatch(/less than 30 days/);
    // The drink card is off: no row for it.
    expect(screen.queryByTestId('member-stamps')).toBeNull();
  });

  it('a starter card with nothing but a drink card still shows it; with nothing at all, no block', async () => {
    extras = card();
    const { unmount } = mount({ ...benefits, perks: [], lines: [] });
    expect(await screen.findByTestId('member-stamps')).toBeTruthy();
    expect(screen.queryByTestId('member-card-name')).toBeNull();
    unmount();
    extras = card({ enabled: false });
    mount({ ...benefits, perks: [], lines: [] });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('member-benefits')).toBeNull();
  });

  it('an older server without lines keeps the one-line sum', async () => {
    mount({ ...benefits, lines: undefined, addons: { on_bill_iqd: 1500, due_iqd: 1500, needs_refresh: false } });
    expect((await screen.findByTestId('member-perk-on-bill')).textContent).toContain('1,500');
  });
});

describe('lineReasonLabel (0445)', () => {
  const tr = makeT('en');
  it('names the reason under a bill line, with the units on a line of several and the amount', () => {
    expect(lineReasonLabel({ kind: 'gift', perk: { name_en: 'Birthday drink', name_ar: 'م' }, when: 'birthday', units: 1, amount_iqd: 4000 }, 1, tr, 'en')).toBe('Birthday gift · −4,000 IQD');
    expect(lineReasonLabel({ kind: 'stamp', perk: null, when: null, units: 1, amount_iqd: 3000 }, 2, tr, 'en')).toBe('Free drink, card full ×1 · −3,000 IQD');
    // A free-with reads as the owner named it.
    expect(lineReasonLabel({ kind: 'free_with', perk: { name_en: 'Free Tea with Desserts', name_ar: 'ش' }, when: null, units: 2, amount_iqd: 2000 }, 3, tr, 'en')).toBe('Free Tea with Desserts ×2 · −2,000 IQD');
    expect(lineReasonLabel({ kind: 'free_with', perk: null, when: null, units: 1, amount_iqd: 2000 }, 1, tr, 'en')).toBe('Free with the order · −2,000 IQD');
    // Add-ons carry no units.
    expect(lineReasonLabel({ kind: 'free_addons', perk: null, when: null, units: 0, amount_iqd: 500 }, 2, tr, 'en')).toBe('Free add-ons · −500 IQD');
  });
});

describe('MemberBenefits, gifts by when and the size upgrade (0445, second pass)', () => {
  it('shows the monthly and card-up gifts open now; a court hour one says where it goes, and one on the booking reads as on this bill', async () => {
    extras = {
      ...card({ enabled: false }),
      gifts: [
        { perk_id: 'up1', name_en: 'Welcome cake', name_ar: 'كيك الترحيب', when: 'card_up', target: 'items', window_to: '2026-12-14', used: false },
        { perk_id: 'm1', name_en: 'Monthly hour', name_ar: 'ساعة الشهر', when: 'monthly', target: 'court_hour', window_to: '2026-11-30', used: false },
      ],
    };
    const { unmount } = mount({ ...benefits, lines: [] });
    let rows = await screen.findAllByTestId('member-gift');
    expect(rows.map((r) => [r.getAttribute('data-when'), r.getAttribute('data-state')])).toEqual([
      ['monthly', 'open'],
      ['card_up', 'open'],
    ]);
    expect(rows[0]!.textContent).toContain('Monthly gift open: Monthly hour');
    expect(rows[0]!.textContent).toContain('A court hour goes on the bill of their booking.');
    expect(rows[1]!.textContent).toContain('Welcome gift open: Welcome cake');
    unmount();
    mount({ ...benefits, lines: [], court_gift: { perk_id: 'm1', name_en: 'Monthly hour', name_ar: 'ساعة الشهر', amount_iqd: 20000 } });
    rows = await screen.findAllByTestId('member-gift');
    expect(rows[0]!.getAttribute('data-state')).toBe('onThisBill');
    expect(rows[0]!.textContent).toBe('Gift on this bill: Monthly hour');
  });

  it('sums a size upgrade and tells a monthly gift from a birthday one', async () => {
    mount({
      ...benefits,
      perks: [...benefits.perks, { id: 'gm', kind: 'gift', name_en: 'Monthly coffee', name_ar: 'قهوة الشهر', config: { when: 'monthly', target: 'items', categoryIds: [], itemIds: [] }, tier_id: 'b', tier_name_en: 'Blue', tier_name_ar: 'أزرق', tier_color: 'blue' }],
      lines: [
        { order_item_id: 'oi4', kind: 'gift', perk_id: 'gm', units: 1, amount_iqd: 3500 },
        { order_item_id: 'oi5', kind: 'size_upgrade', perk_id: null, units: 1, amount_iqd: 750 },
      ],
    });
    const totals = await screen.findAllByTestId('member-perk-line-total');
    expect(totals.map((t) => t.textContent)).toEqual(['Monthly gift: 3,500 IQD off', 'Free size upgrade: 750 IQD off']);
  });

  it('labels a size upgrade line and a gift line by its when', () => {
    const tr = makeT('en');
    expect(lineReasonLabel({ kind: 'size_upgrade', perk: null, when: null, units: 1, amount_iqd: 750 }, 1, tr, 'en')).toBe('Free size upgrade · −750 IQD');
    expect(lineReasonLabel({ kind: 'gift', perk: null, when: 'card_up', units: 1, amount_iqd: 3000 }, 1, tr, 'en')).toBe('Welcome gift · −3,000 IQD');
    expect(lineReasonLabel({ kind: 'gift', perk: null, when: null, units: 1, amount_iqd: 3000 }, 1, tr, 'en')).toBe('Card gift · −3,000 IQD');
  });
});

describe('MemberBenefits, Redeem in the app (0445, section 8)', () => {
  const until = '2026-11-22T09:30:00Z';
  const gift = (claimed_until: string | null) => ({ perk_id: 'g9', name_en: 'Birthday drink', name_ar: 'مشروب الميلاد', target: 'items' as const, window_from: null, window_to: null, eligible: true, used: false, claimed_until });

  it('a redeemed free drink and gift say until when, with a date (a claim can be days away)', async () => {
    extras = card({ count: 6, ready: true, claimed_until: until }, [gift(until)]);
    mount({ ...benefits, lines: [] });
    const stamp = await screen.findByTestId('member-stamps-claim');
    expect(stamp.getAttribute('data-claim')).toBe('claimed');
    expect(stamp.textContent).toMatch(/^Redeemed in the app · until Nov 22, 2026.*12:30/);
    const g = await screen.findByTestId('member-gift-claim');
    expect(g.getAttribute('data-claim')).toBe('claimed');
    expect(screen.queryByRole('button', { name: /Give it now/ })).toBeNull();
  });

  it('"Give it now" presses Redeem for the bill, then reads the card again', async () => {
    const user = userEvent.setup();
    extras = card({ count: 6, ready: true }, [gift(null)]);
    mount({ ...benefits, lines: [] });
    await screen.findByTestId('member-stamps-claim');
    vi.mocked(appRpc).mockClear();
    await user.click(screen.getByRole('button', { name: 'Give it now: Birthday drink' }));
    await waitFor(() =>
      expect(vi.mocked(appRpc)).toHaveBeenCalledWith('claim_card_reward_for_tab', expect.objectContaining({ p_tab_id: 't1', p_kind: 'gift', p_perk_id: 'g9' })),
    );
    // The extras are a child of the tab's key: the claim re-reads them.
    await waitFor(() => expect(vi.mocked(appRpc)).toHaveBeenCalledWith('loyalty_card_extras', { p_profile_id: 'p1' }));
    await user.click(screen.getByRole('button', { name: 'Give it now: Drink card' }));
    await waitFor(() =>
      expect(vi.mocked(appRpc)).toHaveBeenCalledWith('claim_card_reward_for_tab', expect.objectContaining({ p_tab_id: 't1', p_kind: 'stamp', p_perk_id: null })),
    );
  });

  it('a reward no longer there says so in the till’s words, beside the reward it was for', async () => {
    const user = userEvent.setup();
    extras = card({ count: 6, ready: true }, [gift(null)]);
    vi.mocked(appRpc).mockImplementation((async (fn: string) => {
      if (fn === 'claim_card_reward_for_tab') throw new AppRpcError('REWARD_NOT_READY', 'REWARD_NOT_READY');
      return fn === 'loyalty_card_extras' ? extras : null;
    }) as never);
    mount({ ...benefits, lines: [] });
    await user.click(await screen.findByRole('button', { name: 'Give it now: Birthday drink' }));
    const g = await screen.findByTestId('member-gift-claim');
    expect(await within(g).findByText('That reward is no longer open for this member. Their card has been read again.')).toBeTruthy();
    expect(within(screen.getByTestId('member-stamps-claim')).queryByRole('alert')).toBeNull();
  });

  it('a settled bill offers no "Give it now"', async () => {
    extras = card({ count: 6, ready: true }, [gift(null)]);
    mount({ ...benefits, lines: [] }, false);
    expect((await screen.findByTestId('member-stamps-claim')).textContent).toBe('Waiting for the member to redeem');
    expect(screen.queryByRole('button', { name: /Give it now/ })).toBeNull();
  });
});

describe('dealValueText (0445)', () => {
  const tr = makeT('en');
  it('words a buy-one-get-one by its percent, never as IQD off', () => {
    expect(dealValueText({ type: 'free_item', value: 100 }, tr, 'en')).toBe('Buy 1, get 1 free');
    expect(dealValueText({ type: 'free_item', value: 50 }, tr, 'en')).toBe('Buy 1, get 1 at 50% off');
    expect(dealValueText({ type: 'percent', value: 10 }, tr, 'en')).toBe('10% off');
    expect(dealValueText({ type: 'amount', value: 5000 }, tr, 'en')).toContain('5,000');
  });
});

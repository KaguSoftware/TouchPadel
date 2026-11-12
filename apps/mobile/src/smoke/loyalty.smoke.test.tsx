/**
 * Loyalty, the guest's side (loyalty plan §5.1). See `src/smoke/auth.smoke.test.tsx` for what a
 * case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the PARSED reads under their `loyaltyKeys`, so the first render draws
 * real content: the member card's QR (computed from the fixture secret, as on a phone), and the
 * loyalty screen with a balance, the way to the next card, deals, rewards, the ladder of cards
 * and history (0410).
 *
 * After the table cases, the states a first render cannot show under the route's one primary:
 * loyalty switched off, the member card's token and phone, a top tier, the deal states and the
 * pick (0410), a server without deals or a ladder, the picked deal on the member card, and
 * Profile's two entries (shown only while loyalty is on, build contracts L-1). None of those
 * names a `route:` (each route is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { MEMBER_TOKEN_RE } from '@touch/core/loyalty';
import { formatIQD, formatNumber, isolate, isolateLtr, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_VENUE_ID,
  branchFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { loyaltyKeys } from '../features/loyalty/keys';
import { parseMemberCard, parseMyLoyalty } from '../features/loyalty/logic';
import { parseMyDeals } from '../features/loyalty/deals';
import { supabase } from '../lib/supabase';
import MemberCardScreen from '../../app/member-card';
import LoyaltyScreen from '../../app/loyalty';
import ProfileScreen from '../../app/profile';

type Seeds = [readonly unknown[], unknown][];

/** RFC 6238's SHA-1 test secret ("12345678901234567890"), as base32. */
const CARD = parseMemberCard({
  member_code: '8F3K2QXM',
  secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  step: 30,
});

/** The ladder (0410): the base card, Silver with a privilege and a deal, Gold above it. */
const TIERS = [
  {
    id: 'tier-0',
    name_en: 'Member',
    name_ar: 'عضو',
    multiplier: 1,
    min_points_12m: 0,
    color: 'classic',
    perks: [],
    deals: [],
  },
  {
    id: 'tier-1',
    name_en: 'Silver',
    name_ar: 'فضي',
    multiplier: 1.25,
    min_points_12m: 1500,
    color: 'silver',
    perks: [{ id: 'perk-syrup', kind: 'free_addons', name_en: 'Free syrup', name_ar: 'نكهة مجانية' }],
    deals: [{ id: 'd-locked', name_en: 'Silver breakfast', name_ar: 'فطور الفضي' }],
  },
  {
    id: 'tier-2',
    name_en: 'Gold',
    name_ar: 'ذهبي',
    multiplier: 1.5,
    min_points_12m: 4000,
    color: 'gold',
    perks: [
      { id: 'perk-addons', kind: 'free_addons', name_en: 'Every add-on free', name_ar: 'كل الإضافات مجانًا' },
      { id: 'perk-racket', kind: 'custom', name_en: 'A racket to borrow', name_ar: 'مضرب للإعارة' },
    ],
    deals: [],
  },
];

const loyaltyFixture = (over: Record<string, unknown> = {}) =>
  parseMyLoyalty({
    enabled: true,
    balance: 1250,
    lifetime: 3400,
    points_12m: 900,
    tier: TIERS[0],
    next_tier: TIERS[1],
    tiers: TIERS,
    point_value_iqd: 50,
    min_redeem_points: 100,
    points_off_enabled: true,
    history: [
      {
        id: 'l-1',
        kind: 'earn',
        delta: 120,
        venue_id: TEST_VENUE_ID,
        created_at: '2026-10-01T10:00:00.000Z',
        note: null,
      },
      {
        id: 'l-2',
        kind: 'redeem',
        delta: -200,
        venue_id: TEST_VENUE_ID,
        created_at: '2026-10-02T10:00:00.000Z',
        note: null,
      },
    ],
    rewards: [
      {
        id: 'r-1',
        name_en: 'Free coffee',
        name_ar: 'قهوة مجانية',
        cost_points: 300,
        kind: 'item',
        iqd_off: null,
      },
    ],
    ...over,
  });

const venue: Seeds = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
];

/** One deal of each kind (0410): open, open but outside its hours, locked to Silver, used. */
const RAW_DEALS = [
  {
    id: 'd-open',
    name_en: 'Happy hour',
    name_ar: 'ساعة السعادة',
    blurb_en: 'Every hot drink.',
    blurb_ar: 'كل المشروبات الساخنة.',
    type: 'percent',
    value: 20,
    ends_at: '2099-01-01T00:00:00.000Z',
    weekdays: [],
    hour_from: null,
    hour_to: null,
    live_now: true,
    min_spend_iqd: 5000,
    per_customer: 3,
    used: 1,
    tier: null,
    state: 'open',
    venue_id: null,
    on: { items: [], categories: [], courts: false },
  },
  {
    id: 'd-wait',
    name_en: 'Late coffee',
    name_ar: 'قهوة المساء',
    blurb_en: null,
    blurb_ar: null,
    type: 'amount',
    value: 2000,
    ends_at: null,
    weekdays: [5, 6],
    hour_from: '22:00',
    hour_to: '02:00',
    live_now: false,
    min_spend_iqd: null,
    per_customer: null,
    used: 0,
    tier: null,
    state: 'open',
    venue_id: null,
    on: { items: [], categories: [{ name_en: 'Coffee', name_ar: 'قهوة' }], courts: false },
  },
  {
    id: 'd-locked',
    name_en: 'Silver breakfast',
    name_ar: 'فطور الفضي',
    blurb_en: null,
    blurb_ar: null,
    type: 'amount',
    value: 5000,
    ends_at: null,
    weekdays: [],
    hour_from: null,
    hour_to: null,
    live_now: true,
    min_spend_iqd: null,
    per_customer: null,
    used: 0,
    tier: { id: 'tier-1', name_en: 'Silver', name_ar: 'فضي', color: 'silver', min_points_12m: 1500 },
    state: 'locked',
    venue_id: null,
    on: { items: [], categories: [], courts: false },
  },
  {
    id: 'd-used',
    name_en: 'Welcome treat',
    name_ar: 'هدية الترحيب',
    blurb_en: null,
    blurb_ar: null,
    type: 'percent',
    value: 50,
    ends_at: null,
    weekdays: [],
    hour_from: null,
    hour_to: null,
    live_now: true,
    min_spend_iqd: null,
    per_customer: 1,
    used: 1,
    tier: null,
    state: 'used',
    venue_id: null,
    on: { items: [], categories: [], courts: false },
  },
];

const rawDeals = (pickedId: string | null = null) => ({
  picked_id: pickedId,
  picked_until: pickedId ? '2099-01-01T00:00:00.000Z' : null,
  deals: RAW_DEALS,
});
const dealsFixture = (pickedId: string | null = null) => parseMyDeals(rawDeals(pickedId));

const cardSeeds: Seeds = [...venue, [profileKeys.own, profileFixture()], [loyaltyKeys.card, CARD]];
const homeSeeds = (
  over: Record<string, unknown> = {},
  deals: ReturnType<typeof parseMyDeals> | null = dealsFixture(),
): Seeds => [
  ...venue,
  [loyaltyKeys.mine, loyaltyFixture(over)],
  // null: the deals were never read (a failed read, or a server before 0410).
  ...(deals ? ([[loyaltyKeys.deals, deals]] as Seeds) : []),
];

/**
 * The app schema's rpc for a case that picks a deal: jest.setup.ts's client has no `schema`, so
 * an unseeded loyalty read simply fails (and reads as "nothing"), which is what every other case
 * here relies on. Undone after each test.
 */
function stubAppRpc(answer: { data: unknown; error: unknown }) {
  const rpc = jest.fn((_name: string, _args?: unknown) => Promise.resolve(answer));
  Object.assign(supabase, { schema: () => ({ rpc }) });
  return rpc;
}
afterEach(() => {
  delete (supabase as unknown as { schema?: unknown }).schema;
});

const CASES: SmokeCase[] = [
  {
    route: 'member-card',
    Component: MemberCardScreen,
    // The QR is a mark with no text of its own: the line over it says what it is for.
    nearbyKey: 'loyalty.guest.card.show',
    options: { session: 'in', queryData: cardSeeds },
  },
  {
    route: 'loyalty',
    Component: LoyaltyScreen,
    labelKey: 'loyalty.guest.home.showCard',
    options: { session: 'in', queryData: homeSeeds() },
  },
];

runSmokeCases('loyalty, the guest side', CASES);

// ── The states a first render cannot show under the primary ─────────────────

const LOCALES: Locale[] = ['en', 'ar'];
const LRI_PDI = /[⁦-⁩]/g;

describe.each(LOCALES)('loyalty states in %s', (locale) => {
  const t = makeT(locale);

  it('the member card draws a live TP- token and "Get a new code", and no phone number', () => {
    const screen = renderRoute(MemberCardScreen, { locale, session: 'in', queryData: cardSeeds });
    try {
      const token = String(screen.getByTestId('member-card.code').props.children).replace(
        LRI_PDI,
        '',
      );
      expect(token).toMatch(MEMBER_TOKEN_RE);
      expect(token.startsWith('TP-8F3K2QXM-')).toBe(true);
      expect(screen.queryByTestId('member-card.phone')).toBeNull();
      expect(screen.getByTestId('member-card.progress')).toBeTruthy();
      const again = screen.getByTestId('member-card.new-code');
      expect(within(again).getByText(t('loyalty.guest.card.newCode'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('with rewards only (0403, the default) the card shows no "smallest use" bar', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ points_off_enabled: false }),
    });
    try {
      expect(screen.queryByTestId('loyalty.use-progress')).toBeNull();
      expect(screen.getByTestId('loyalty.reward.r-1')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the loyalty screen shows the tier on its way, rewards and history', () => {
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      expect(screen.getByTestId('loyalty.use-progress')).toBeTruthy();
      expect(screen.getByTestId('loyalty.tier')).toBeTruthy();
      // The way to the next card (0410): its name, the points to go, the bar, what it adds.
      const silver = locale === 'ar' ? 'فضي' : 'Silver';
      const next = screen.getByTestId('loyalty.next-card');
      expect(within(next).getByText(t('loyalty.guest.next.label'))).toBeTruthy();
      expect(within(screen.getByTestId('loyalty.next-card.name')).getByText(silver)).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.next-card.remaining')).getByText(isolateLtr('600')),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.next-card.progress')).toBeTruthy();
      const adds = screen.getByTestId('loyalty.next-card.gives');
      expect(
        within(adds).getByText(t('loyalty.guest.next.gives', { tier: isolate(silver) })),
      ).toBeTruthy();
      expect(
        within(adds).getByText(
          t('loyalty.guest.gives.multiplier', { times: isolateLtr(`${formatNumber(1.25, locale)}×`) }),
        ),
      ).toBeTruthy();
      expect(within(adds).getByText(locale === 'ar' ? 'نكهة مجانية' : 'Free syrup')).toBeTruthy();
      expect(
        within(adds).getByText(
          t('loyalty.guest.gives.deal', {
            name: isolate(locale === 'ar' ? 'فطور الفضي' : 'Silver breakfast'),
          }),
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId('loyalty.top-card')).toBeNull();
      // The cards (0410): the base one is theirs, the two above say what they still need.
      expect(screen.getByTestId('loyalty.tiers')).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-0')).getByText(t('loyalty.guest.ladder.yours')),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-0')).getByText(t('loyalty.guest.ladder.base')),
      ).toBeTruthy();
      const gold = screen.getByTestId('loyalty.tier.tier-2');
      expect(within(gold).getByText(t('loyalty.guest.next.toGo'))).toBeTruthy();
      expect(within(gold).getByText(isolateLtr('3,100'))).toBeTruthy();
      expect(
        within(gold).getByText(t('loyalty.guest.ladder.from', { points: isolateLtr('4,000') })),
      ).toBeTruthy();
      expect(within(gold).getByText(locale === 'ar' ? 'مضرب للإعارة' : 'A racket to borrow')).toBeTruthy();
      expect(screen.getByTestId('loyalty.reward.r-1')).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.history.l-1')).getByText(
          t('loyalty.guest.history.kind.earn'),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.history.l-2')).getByText(
          t('loyalty.guest.history.kind.redeem'),
        ),
      ).toBeTruthy();
      // Not opened from the Club tab: the card is that tab's, so it switches there on the card.
      fireEvent.press(screen.getByTestId('loyalty.show-card'));
      expect(routerState.calls).toContainEqual({
        method: 'replace',
        arg: { pathname: '/club', params: { show: 'card' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('opened from the Club tab, "show my card" goes back to the card underneath', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds(),
      params: { from: 'club' },
    });
    try {
      fireEvent.press(screen.getByTestId('loyalty.show-card'));
      // useBack pops to the card when there is history; a test has none, so it lands on the card.
      expect(routerState.calls).toEqual([{ method: 'replace', arg: { pathname: '/club', params: { show: 'card' } } }]);
    } finally {
      screen.unmount();
    }
  });

  it('a top tier says so instead of a next one', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ tier: TIERS[2], next_tier: null, history: [], rewards: [] }),
    });
    try {
      // The top card (0410) says so, has no bar, and lists everything the card holds.
      const top = screen.getByTestId('loyalty.top-card');
      expect(within(top).getByText(t('loyalty.guest.next.topLabel'))).toBeTruthy();
      expect(within(top).getByText(t('loyalty.guest.next.top'))).toBeTruthy();
      expect(within(top).getByText(t('loyalty.guest.next.holds'))).toBeTruthy();
      expect(within(top).getByText(locale === 'ar' ? 'كل الإضافات مجانًا' : 'Every add-on free')).toBeTruthy();
      // A card holds what the tiers under it give too.
      expect(within(top).getByText(locale === 'ar' ? 'نكهة مجانية' : 'Free syrup')).toBeTruthy();
      expect(screen.queryByTestId('loyalty.next-card')).toBeNull();
      expect(screen.queryByTestId('loyalty.top-card.progress')).toBeNull();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-1')).getByText(t('loyalty.guest.ladder.included')),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.history-empty')).toBeTruthy();
      expect(screen.getByTestId('loyalty.reward-soon.0')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a deal of each kind reads its state: open, not right now, locked, used (0410)', () => {
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      expect(within(screen.getByTestId('loyalty.deals')).getByText(t('loyalty.guest.deals.title'))).toBeTruthy();

      const open = screen.getByTestId('loyalty.deal.d-open');
      expect(
        within(screen.getByTestId('loyalty.deal-value.d-open')).getByText(
          t('loyalty.guest.deals.percentOff', { percent: isolateLtr('20%') }),
        ),
      ).toBeTruthy();
      expect(within(open).getByText(locale === 'ar' ? 'ساعة السعادة' : 'Happy hour')).toBeTruthy();
      // The owner's line, not what the deal covers.
      expect(within(open).getByText(locale === 'ar' ? 'كل المشروبات الساخنة.' : 'Every hot drink.')).toBeTruthy();
      expect(within(open).queryByText(t('loyalty.guest.deals.wholeBill'))).toBeNull();
      expect(within(open).getByText(t('loyalty.guest.deals.minSpend'))).toBeTruthy();
      expect(within(open).getByText(isolate(formatIQD(5000, locale)))).toBeTruthy();
      expect(within(open).getByText(t('loyalty.guest.deals.usesLeft'))).toBeTruthy();
      expect(within(open).getByText(isolateLtr('2'))).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.deal-use.d-open')).getByText(t('loyalty.guest.deals.use')),
      ).toBeTruthy();

      // Outside its hours: still theirs to pick for later, and it says so with its days and hours.
      const wait = screen.getByTestId('loyalty.deal.d-wait');
      expect(within(wait).getByText(t('loyalty.guest.deals.notNow'))).toBeTruthy();
      expect(within(wait).getByText(t('loyalty.guest.deals.days'))).toBeTruthy();
      expect(within(wait).getByText(t('loyalty.guest.deals.hours'))).toBeTruthy();
      // No line from the owner: what it covers.
      expect(
        within(wait).getByText(
          t('loyalty.guest.deals.covers', { names: isolate(locale === 'ar' ? 'قهوة' : 'Coffee') }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.deal-use.d-wait')).toBeTruthy();

      // Locked: the card it needs and the points to go; nothing to press.
      const locked = screen.getByTestId('loyalty.deal.d-locked');
      expect(
        within(locked).getByText(
          t('loyalty.guest.deals.needs', { tier: isolate(locale === 'ar' ? 'فضي' : 'Silver') }),
        ),
      ).toBeTruthy();
      expect(within(locked).getByText(isolateLtr('600'))).toBeTruthy();
      expect(within(locked).getByText(t('loyalty.guest.deals.wholeBill'))).toBeTruthy();
      expect(screen.queryByTestId('loyalty.deal-use.d-locked')).toBeNull();

      // Used: marked, nothing to press.
      const used = screen.getByTestId('loyalty.deal.d-used');
      expect(within(used).getByText(t('loyalty.guest.deals.used'))).toBeTruthy();
      expect(screen.queryByTestId('loyalty.deal-use.d-used')).toBeNull();

      // Nothing is picked yet.
      expect(screen.queryByTestId('loyalty.deal-show.d-open')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('"Use at the cashier" picks the deal, keeps the answer and goes to the member card', async () => {
    const rpc = stubAppRpc({ data: rawDeals('d-open'), error: null });
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('loyalty.deal-use.d-open'));
      });
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'replace',
          arg: { pathname: '/club', params: { show: 'card' } },
        }),
      );
      expect(rpc).toHaveBeenCalledWith('pick_deal', { p_promotion_id: 'd-open' });
      expect(rpc).toHaveBeenCalledTimes(1);
      // The cache took pick_deal's own answer: the card is the one in use, without a second read.
      expect(screen.client.getQueryData(loyaltyKeys.deals)).toMatchObject({ picked_id: 'd-open' });
      await waitFor(() => expect(screen.getByTestId('loyalty.deal-show.d-open')).toBeTruthy());
      expect(
        within(screen.getByTestId('loyalty.deal.d-open')).getByText(t('loyalty.guest.deals.picked')),
      ).toBeTruthy();
      expect(screen.queryByTestId('loyalty.deal-use.d-open')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('the picked deal is marked, shows the card, and can be taken off it', async () => {
    const rpc = stubAppRpc({ data: rawDeals(null), error: null });
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({}, dealsFixture('d-open')),
    });
    try {
      const picked = screen.getByTestId('loyalty.deal.d-open');
      expect(within(picked).getByText(t('loyalty.guest.deals.picked'))).toBeTruthy();
      expect(within(picked).getByText(t('loyalty.guest.deals.heldUntil'))).toBeTruthy();
      const show = screen.getByTestId('loyalty.deal-show.d-open');
      expect(within(show).getByText(t('loyalty.guest.deals.showCard'))).toBeTruthy();
      fireEvent.press(show);
      expect(routerState.calls).toContainEqual({
        method: 'replace',
        arg: { pathname: '/club', params: { show: 'card' } },
      });
      // Another open deal can still be picked in its place.
      expect(screen.getByTestId('loyalty.deal-use.d-wait')).toBeTruthy();

      const clear = screen.getByTestId('loyalty.deal-clear.d-open');
      expect(within(clear).getByText(t('loyalty.guest.deals.clear'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(clear);
      });
      await waitFor(() => expect(screen.getByTestId('loyalty.deal-use.d-open')).toBeTruthy());
      // null clears the pick, and the argument is still sent.
      expect(rpc).toHaveBeenCalledWith('pick_deal', { p_promotion_id: null });
      expect(screen.queryByTestId('loyalty.deal-show.d-open')).toBeNull();
      expect(screen.getByText(t('loyalty.guest.deals.cleared'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a refused pick says why, in the shared catalogue\'s words, and stays on the screen', async () => {
    stubAppRpc({ data: null, error: { message: 'DEAL_USED', code: 'P0001' } });
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('loyalty.deal-use.d-open'));
      });
      await waitFor(() => expect(screen.getByText(t('op.errors.DEAL_USED'))).toBeTruthy());
      expect(routerState.calls).toEqual([]);
    } finally {
      screen.unmount();
    }
  });

  it('a server before 0410 (no deals, no ladder) shows neither, and never an empty box', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ tiers: undefined }, null),
    });
    try {
      expect(screen.queryByTestId('loyalty.deals')).toBeNull();
      expect(screen.queryByText(t('loyalty.guest.deals.title'))).toBeNull();
      expect(screen.queryByTestId('loyalty.tiers')).toBeNull();
      // The way to the next card still draws from `next_tier`, with its points rate.
      expect(screen.getByTestId('loyalty.next-card.progress')).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.next-card.gives')).getByText(
          t('loyalty.guest.gives.multiplier', { times: isolateLtr(`${formatNumber(1.25, locale)}×`) }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.show-card')).toBeTruthy();
      expect(screen.getByTestId('loyalty.reward.r-1')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('with deals read but none listed, the section is not drawn', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({}, parseMyDeals({ picked_id: null, deals: [] })),
    });
    try {
      expect(screen.queryByTestId('loyalty.deals')).toBeNull();
      expect(screen.getByTestId('loyalty.tiers')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the member card names the picked deal by the code, and nothing when none is picked or read', () => {
    const picked = renderRoute(MemberCardScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, [loyaltyKeys.deals, dealsFixture('d-open')]],
    });
    try {
      const note = picked.getByTestId('member-card.deal');
      expect(within(note).getByText(t('loyalty.guest.deals.cardLabel'))).toBeTruthy();
      expect(within(note).getByText(locale === 'ar' ? 'ساعة السعادة' : 'Happy hour')).toBeTruthy();
      expect(
        within(note).getByText(t('loyalty.guest.deals.percentOff', { percent: isolateLtr('20%') })),
      ).toBeTruthy();
      expect(within(note).getByText(t('loyalty.guest.deals.cardLine'))).toBeTruthy();
      // The code is untouched beside it.
      expect(picked.getByTestId('member-card.qr')).toBeTruthy();
      expect(picked.getByTestId('member-card.code')).toBeTruthy();
    } finally {
      picked.unmount();
    }
    for (const seeds of [
      [...cardSeeds, [loyaltyKeys.deals, dealsFixture()]] as Seeds,
      // Deals never read (no signal on a cold start): the card is the code alone.
      cardSeeds,
      // A pick whose 24 hours are up.
      [
        ...cardSeeds,
        [
          loyaltyKeys.deals,
          parseMyDeals({ ...rawDeals('d-open'), picked_until: '2020-01-01T00:00:00.000Z' }),
        ],
      ] as Seeds,
    ]) {
      const screen = renderRoute(MemberCardScreen, { locale, session: 'in', queryData: seeds });
      try {
        expect(screen.queryByTestId('member-card.deal')).toBeNull();
        expect(screen.getByTestId('member-card.qr')).toBeTruthy();
      } finally {
        screen.unmount();
      }
    }
  });

  it('loyalty switched off says so and offers nothing', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ enabled: false }),
    });
    try {
      expect(screen.getByTestId('loyalty.off')).toBeTruthy();
      expect(screen.getByText(t('loyalty.guest.off'))).toBeTruthy();
      expect(screen.queryByTestId('loyalty.show-card')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('Profile offers the member card and Points & rewards only while loyalty is on', () => {
    const seeds = (enabled: boolean): Seeds => [
      [profileKeys.own, profileFixture()],
      [availabilityKeys.branches, [branchFixture()]],
      [availabilityKeys.settings(TEST_VENUE_ID), null],
      [loyaltyKeys.mine, loyaltyFixture({ enabled })],
    ];
    const off = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(false) });
    try {
      expect(off.queryByTestId('profile.member-card')).toBeNull();
      expect(off.queryByTestId('profile.loyalty')).toBeNull();
    } finally {
      off.unmount();
    }
    const on = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(true) });
    try {
      const card = on.getByTestId('profile.member-card');
      expect(within(card).getByText(t('loyalty.guest.card.profileTitle'))).toBeTruthy();
      fireEvent.press(card);
      expect(routerState.calls).toContainEqual({
        method: 'replace',
        arg: { pathname: '/club', params: { show: 'card' } },
      });
      const row = on.getByTestId('profile.loyalty');
      expect(within(row).getByText(t('loyalty.guest.home.title'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/loyalty' });
    } finally {
      on.unmount();
    }
  });
});

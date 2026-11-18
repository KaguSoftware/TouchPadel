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
import { formatNumber, isolate, isolateLtr, makeT, type Locale } from '@touch/i18n';
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
import { parseMyRewardVouchers } from '../features/loyalty/vouchers';
import { NO_EXTRAS, parseCardExtras } from '../features/loyalty/extras';
import { BIRTH_TZ, birthDateToDate } from '../features/profile/birthDate';
import { countPhrase, formatDate } from '@touch/i18n';
import { supabase } from '../lib/supabase';
import MemberCardScreen from '../../app/member-card';
import LoyaltyScreen from '../../app/loyalty';
import RewardVoucherScreen from '../../app/reward-voucher';
import ProfileScreen from '../../app/profile';
import ClubScreen from '../../app/(tabs)/club';

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
    perks: [
      { id: 'perk-syrup', kind: 'free_addons', name_en: 'Free syrup', name_ar: 'نكهة مجانية' },
    ],
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
      {
        id: 'perk-addons',
        kind: 'free_addons',
        name_en: 'Every add-on free',
        name_ar: 'كل الإضافات مجانًا',
      },
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
    tier: {
      id: 'tier-1',
      name_en: 'Silver',
      name_ar: 'فضي',
      color: 'silver',
      min_points_12m: 1500,
    },
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
/** 0415: a reward redeemed in the app, ten minutes left on the server's clock unless told. */
const vouchersFixture = (status = 'active', minutesLeft = 10) =>
  parseMyRewardVouchers({
    now: new Date().toISOString(),
    vouchers: [
      {
        id: 'v-1',
        code: 'TPV-8F3K2QXM9ABC',
        reward_id: 'r-1',
        name_en: 'Free coffee',
        name_ar: 'قهوة مجانية',
        kind: 'item',
        points: 300,
        status,
        created_at: new Date(Date.now() - (15 - minutesLeft) * 60_000).toISOString(),
        expires_at: new Date(Date.now() + minutesLeft * 60_000).toISOString(),
        ended_at: status === 'active' ? null : new Date().toISOString(),
      },
    ],
  });
const homeSeeds = (
  over: Record<string, unknown> = {},
  deals: ReturnType<typeof parseMyDeals> | null = dealsFixture(),
  vouchers: ReturnType<typeof parseMyRewardVouchers> = parseMyRewardVouchers({ now: new Date().toISOString(), vouchers: [] }),
  extras: ReturnType<typeof parseCardExtras> = NO_EXTRAS,
): Seeds => [
  ...venue,
  [loyaltyKeys.mine, loyaltyFixture(over)],
  // null: the deals were never read (a failed read, or a server before 0410).
  ...(deals ? ([[loyaltyKeys.deals, deals]] as Seeds) : []),
  // 0415: seeded, so the first render asks the server for nothing more.
  [loyaltyKeys.vouchers, vouchers],
  // 0445: the drink card and birthday gifts, off unless a case says otherwise.
  [loyaltyKeys.extras, extras],
];

/** 0445: a drink card of `size` with `count` stamps, and the birthday as given. */
const extrasFixture = (
  stamps: Record<string, unknown> = {},
  birthday: Record<string, unknown> = {},
  gifts: unknown[] = [],
) =>
  parseCardExtras({
    gifts,
    stamps: { enabled: true, count: 5, size: 8, ready: false, held: false, ...stamps },
    birthday: {
      has_date: true,
      gifts: [],
      counts_from: '2025-01-01',
      gifts_on_card: [{ perk_id: 'g-drink', name_en: 'A drink on your birthday', name_ar: 'مشروب في عيد ميلادك', target: 'items', days: 7 }],
      ...birthday,
    },
  });
const OPEN_GIFT = {
  perk_id: 'g-drink',
  name_en: 'A drink on your birthday',
  name_ar: 'مشروب في عيد ميلادك',
  target: 'items',
  window_from: '2026-11-12',
  window_to: '2026-11-18',
  eligible: true,
  used: false,
};

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
    // The primary is the points themselves (2026-11-13): the screen has no card button now.
    labelKey: 'loyalty.guest.home.balance',
    options: { session: 'in', queryData: homeSeeds() },
  },
  {
    route: 'reward-voucher',
    Component: RewardVoucherScreen,
    // The QR is a mark with no text of its own: the line under it says what it is for.
    nearbyKey: 'loyalty.guest.voucher.show',
    options: {
      session: 'in',
      params: { id: 'v-1' },
      queryData: homeSeeds({}, dealsFixture(), vouchersFixture()),
    },
  },
];

runSmokeCases('loyalty, the guest side', CASES);

// ── The states a first render cannot show under the primary ─────────────────

const LOCALES: Locale[] = ['en', 'ar'];
const LRI_PDI = /[⁦-⁩]/g;

describe.each(LOCALES)('loyalty states in %s', (locale) => {
  const t = makeT(locale);

  it('a ready reward has Redeem, and a code not yet collected heads the screen (0415)', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({}, dealsFixture(), vouchersFixture()),
    });
    try {
      const redeem = screen.getByTestId('loyalty.reward.r-1.redeem');
      expect(within(redeem).getByText(t('loyalty.guest.rewards.redeem'))).toBeTruthy();
      const row = screen.getByTestId('loyalty.voucher.v-1');
      expect(within(row).getByText(locale === 'ar' ? 'قهوة مجانية' : 'Free coffee')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('rewards run cheapest first: the ready ones, the "You" line naming the next, then the rest with points to go (2026-11-16)', () => {
    const rewards = [
      { id: 'r-court', name_en: 'Free court hour', name_ar: 'ساعة ملعب مجانية', cost_points: 2000, kind: 'court_hour', iqd_off: null },
      { id: 'r-1', name_en: 'Free coffee', name_ar: 'قهوة مجانية', cost_points: 300, kind: 'item', iqd_off: null },
      { id: 'r-off', name_en: '5,000 off', name_ar: 'خصم 5,000', cost_points: 1500, kind: 'iqd_off', iqd_off: 5000 },
    ];
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds({ rewards }) });
    try {
      expect(screen.getByTestId('loyalty.reward.r-1.redeem')).toBeTruthy();
      expect(screen.queryByTestId('loyalty.reward.r-off.redeem')).toBeNull();
      const you = screen.getByTestId('loyalty.rewards.you');
      const points = (n: number) => isolateLtr(formatNumber(n, locale));
      expect(within(you).getByText(t('loyalty.guest.rewards.you', { points: points(1250) }))).toBeTruthy();
      expect(
        within(you).getByText(
          t('loyalty.guest.rewards.next', { reward: locale === 'ar' ? 'خصم 5,000' : '5,000 off', points: points(250) }),
        ),
      ).toBeTruthy();
      const off = screen.getByTestId('loyalty.reward.r-off');
      expect(within(off).getByText(t('loyalty.guest.rewards.toGo', { points: points(250) }))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the reward code shows its QR, the grouped code and the time; collected and expired say so', () => {
    const live = renderRoute(RewardVoucherScreen, {
      locale,
      session: 'in',
      params: { id: 'v-1' },
      queryData: homeSeeds({}, dealsFixture(), vouchersFixture()),
    });
    try {
      expect(live.getByTestId('reward-voucher.qr')).toBeTruthy();
      expect(
        within(live.getByTestId('reward-voucher.code')).getByText('TPV-8F3K-2QXM-9ABC'),
      ).toBeTruthy();
      expect(String(live.getByTestId('reward-voucher.time').props.children)).toMatch(
        /^(9:5\d|10:00)$/,
      );
      expect(live.getByTestId('reward-voucher.cancel')).toBeTruthy();
    } finally {
      live.unmount();
    }
    const done = renderRoute(RewardVoucherScreen, {
      locale,
      session: 'in',
      params: { id: 'v-1' },
      queryData: homeSeeds({}, dealsFixture(), vouchersFixture('used')),
    });
    try {
      expect(
        within(done.getByTestId('reward-voucher.collected')).getByText(
          t('loyalty.guest.voucher.collectedTitle'),
        ),
      ).toBeTruthy();
      expect(done.queryByTestId('reward-voucher.qr')).toBeNull();
    } finally {
      done.unmount();
    }
    const late = renderRoute(RewardVoucherScreen, {
      locale,
      session: 'in',
      params: { id: 'v-1' },
      queryData: homeSeeds({}, dealsFixture(), vouchersFixture('expired', 0)),
    });
    try {
      expect(late.getByTestId('reward-voucher.expired')).toBeTruthy();
      // 1,250 points reach the 300-point reward again
      expect(late.getByTestId('reward-voucher.again')).toBeTruthy();
    } finally {
      late.unmount();
    }
  });

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
      // The points as a number with the tier beside it (2026-11-13): no card, no card button.
      expect(
        within(screen.getByTestId('loyalty.balance')).getByText(isolateLtr('1,250')),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.tier')).getByText(locale === 'ar' ? 'عضو' : 'Member'),
      ).toBeTruthy();
      expect(screen.queryByTestId('loyalty.show-card')).toBeNull();
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
          t('loyalty.guest.gives.multiplier', {
            times: isolateLtr(`${formatNumber(1.25, locale)}×`),
          }),
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
      // The cards (0410) sit in the same block, the next card's list in its own row: the base one
      // is theirs, the one past the next says what it still needs (the next one's is the head's).
      const tiers = within(next).getByTestId('loyalty.tiers');
      expect(
        within(within(tiers).getByTestId('loyalty.tier.tier-1')).getByTestId(
          'loyalty.next-card.gives',
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-1')).queryByText(t('loyalty.guest.next.toGo')),
      ).toBeNull();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-0')).getByText(
          t('loyalty.guest.ladder.yours'),
        ),
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
      expect(
        within(gold).getByText(locale === 'ar' ? 'مضرب للإعارة' : 'A racket to borrow'),
      ).toBeTruthy();
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
      // "Your card" twice: the head's label and the mark on its own row in the cards under it.
      expect(within(top).getAllByText(t('loyalty.guest.next.topLabel'))).toHaveLength(2);
      expect(within(top).getByText(t('loyalty.guest.next.top'))).toBeTruthy();
      // Its cards are in the same block: its own row marked, the ones under it included.
      expect(
        within(within(top).getByTestId('loyalty.tier.tier-2')).getByTestId('loyalty.tier-yours'),
      ).toBeTruthy();
      expect(within(top).getByText(locale === 'ar' ? 'كل الإضافات مجانًا' : 'Every add-on free')).toBeTruthy();
      expect(within(top).getByText(locale === 'ar' ? 'نكهة مجانية' : 'Free syrup')).toBeTruthy();
      expect(screen.queryByTestId('loyalty.next-card')).toBeNull();
      expect(screen.queryByTestId('loyalty.top-card.progress')).toBeNull();
      expect(
        within(screen.getByTestId('loyalty.tier.tier-1')).getByText(
          t('loyalty.guest.ladder.included'),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.history-empty')).toBeTruthy();
      expect(screen.getByTestId('loyalty.rewards-empty')).toBeTruthy();
      expect(screen.queryByText(t('loyalty.guest.rewards.soon'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('Points & rewards shows no deals: rewards and the cards only (Majed, 2026-11-15)', () => {
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      expect(screen.queryByTestId('loyalty.deals')).toBeNull();
      expect(screen.queryByText(t('loyalty.guest.deals.title'))).toBeNull();
      expect(screen.getByTestId('loyalty.reward.r-1')).toBeTruthy();
      expect(screen.getByTestId('loyalty.tiers')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the Club tab lists the usable deals under the code, picked first; locked and used stay off', () => {
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds({}, dealsFixture('d-wait'))],
    });
    try {
      expect(screen.getByTestId('club.card.qr')).toBeTruthy();
      const section = screen.getByTestId('club.deals');
      expect(within(section).getByText(t('loyalty.guest.deals.title'))).toBeTruthy();
      expect(screen.getByTestId('club.deal.d-open')).toBeTruthy();
      // A tile is the picture alone: no line, no button (2026-11-15); they are in the sheet.
      expect(screen.queryByTestId('club.deal-use.d-open')).toBeNull();
      expect(within(screen.getByTestId('club.deal.d-open')).queryByText(locale === 'ar' ? 'كل المشروبات الساخنة.' : 'Every hot drink.')).toBeNull();
      expect(screen.queryByTestId('club.deal.d-locked')).toBeNull();
      expect(screen.queryByTestId('club.deal.d-used')).toBeNull();
      // The picked one first, as Points & rewards orders it.
      const ids = within(section)
        .getAllByTestId(/^club\.deal\.d-/)
        .map((n) => String(n.props.testID));
      expect(ids).toEqual(['club.deal.d-wait', 'club.deal.d-open']);
      // Its name is on the paper the cashier scans.
      expect(screen.getByTestId('club.card.deal')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('on the Club tab a tap opens the deal; Redeem there gives its own 15-minute QR', async () => {
    const voucher = {
      id: 'v-1',
      code: 'TPD-ABCDEFGHJKMN',
      promotion_id: 'd-open',
      name_en: 'Happy hour',
      name_ar: 'ساعة السعادة',
      type: 'percent',
      value: 20,
      status: 'active',
      created_at: '2026-11-15T10:00:00.000Z',
      expires_at: '2026-11-15T10:15:00.000Z',
      ended_at: null,
    };
    const rpc = stubAppRpc({ data: { now: '2026-11-15T10:00:00.000Z', voucher }, error: null });
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds()],
    });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('club.deal.d-open'));
      });
      // The sheet: the owner's line, the facts, and Redeem.
      expect(screen.getByTestId('club.deal-sheet.fact.min')).toBeTruthy();
      const redeem = screen.getByTestId('club.deal-sheet.redeem');
      expect(within(redeem).getByText(t('loyalty.guest.deals.redeem'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(redeem);
      });
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'push',
          arg: { pathname: '/deal-voucher', params: { id: 'v-1' } },
        }),
      );
      expect(rpc).toHaveBeenCalledWith('redeem_deal', { p_promotion_id: 'd-open' });
    } finally {
      screen.unmount();
    }
  });

  it('a refused Redeem says why, in the shared catalogue\'s words, and stays on the Club tab', async () => {
    stubAppRpc({ data: null, error: { message: 'DEAL_USED', code: 'P0001' } });
    const screen = renderRoute(ClubScreen, { locale, session: 'in', queryData: [...cardSeeds, ...homeSeeds()] });
    try {
      await act(async () => {
        fireEvent.press(screen.getByTestId('club.deal.d-open'));
      });
      await act(async () => {
        fireEvent.press(screen.getByTestId('club.deal-sheet.redeem'));
      });
      await waitFor(() => expect(screen.getByText(t('op.errors.DEAL_USED'))).toBeTruthy());
      expect(routerState.calls.filter((c) => c.method === 'push')).toEqual([]);
    } finally {
      screen.unmount();
    }
  });

  it('the Club tab draws no deals section when none can be used', () => {
    const onlyLocked = parseMyDeals({ picked_id: null, deals: [RAW_DEALS[2], RAW_DEALS[3]] });
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds({}, onlyLocked)],
    });
    try {
      expect(screen.getByTestId('club.card.qr')).toBeTruthy();
      expect(screen.queryByTestId('club.deals')).toBeNull();
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
          t('loyalty.guest.gives.multiplier', {
            times: isolateLtr(`${formatNumber(1.25, locale)}×`),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('loyalty.balance')).toBeTruthy();
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
      expect(screen.queryByTestId('loyalty.points')).toBeNull();
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

  // ── the drink card and the birthday (0445) ─────────────────────────────────

  it('the Club tab shows the drink card under the code, and the stamps to a free drink', () => {
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds({}, dealsFixture(), undefined, extrasFixture())],
    });
    try {
      const card = screen.getByTestId('club.drink-card');
      expect(within(card).getByText(t('loyalty.guest.drinkCard.title'))).toBeTruthy();
      expect(screen.getByTestId('club.drink-card.slot.7')).toBeTruthy();
      expect(screen.queryByTestId('club.drink-card.slot.8')).toBeNull();
      expect(
        within(card).getByText(
          t('loyalty.guest.drinkCard.toGo', { stamps: countPhrase('loyalty.guest.drinkCard.stamps', 3, locale) }),
        ),
      ).toBeTruthy();
      // No birthday line: the gift is on the card, the date counts, and no window is open.
      expect(screen.queryByTestId('club.birthday')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('a full drink card says the next drink is on us; once on a bill, that it is on the open bill', () => {
    const ready = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({}, dealsFixture(), undefined, extrasFixture({ count: 6, size: 6, ready: true })),
    });
    try {
      const state = ready.getByTestId('loyalty.drink-card.state');
      expect(within(state).getByText(t('loyalty.guest.drinkCard.readyTitle'))).toBeTruthy();
      expect(ready.queryByTestId('loyalty.drink-card.slot.6')).toBeNull();
    } finally {
      ready.unmount();
    }
    const held = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({}, dealsFixture(), undefined, extrasFixture({ count: 8, ready: true, held: true })),
    });
    try {
      expect(held.getByText(t('loyalty.guest.drinkCard.heldTitle'))).toBeTruthy();
    } finally {
      held.unmount();
    }
    // Switched off by the owner: no drink card at all.
    const off = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      expect(off.queryByTestId('loyalty.drink-card')).toBeNull();
    } finally {
      off.unmount();
    }
  });

  it('a birthday gift open today heads the Club tab, with the gift and the day it ends', () => {
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [
        ...cardSeeds,
        ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({ enabled: false }, { gifts: [OPEN_GIFT] })),
      ],
    });
    try {
      const banner = screen.getByTestId('club.birthday');
      expect(within(banner).getByText(t('loyalty.guest.birthday.title'))).toBeTruthy();
      expect(
        within(screen.getByTestId('club.birthday.gift.g-drink')).getByText(
          locale === 'ar' ? OPEN_GIFT.name_ar : OPEN_GIFT.name_en,
        ),
      ).toBeTruthy();
      const until = isolate(formatDate(birthDateToDate('2026-11-18') as Date, locale, BIRTH_TZ));
      expect(within(banner).getByText(t('loyalty.guest.birthday.until', { date: until }))).toBeTruthy();
      expect(screen.queryByTestId('club.drink-card')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('no birth date asks for one in Edit profile; a new date says when it counts', () => {
    const noDate = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [
        ...cardSeeds,
        ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({}, { has_date: false, counts_from: null })),
      ],
    });
    try {
      const prompt = noDate.getByTestId('club.birthday.add-date');
      expect(within(prompt).getByText(t('loyalty.guest.birthday.addDate'))).toBeTruthy();
      fireEvent.press(prompt);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/profile-edit' });
    } finally {
      noDate.unmount();
    }
    const waiting = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [
        ...cardSeeds,
        ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({}, { counts_from: '2099-01-01' })),
      ],
    });
    try {
      const date = isolate(formatDate(birthDateToDate('2099-01-01') as Date, locale, BIRTH_TZ));
      expect(waiting.getByText(t('loyalty.guest.birthday.waiting', { date }))).toBeTruthy();
    } finally {
      waiting.unmount();
    }
  });

  it('the next card lists its birthday gift, drink card size and ring in plain words (0445)', () => {
    const blue = {
      ...TIERS[1],
      perks: [
        { id: 'p-cake', kind: 'gift', name_en: 'A dessert on your birthday', name_ar: 'حلى في عيد ميلادك', config: { when: 'birthday', categoryIds: ['c'], itemIds: [], days: 7 } },
        { id: 'p-six', kind: 'stamp_size', name_en: 'Drink card full at 6', name_ar: 'بطاقة المشروبات تمتلئ عند 6', config: { size: 6 } },
        { id: 'p-ring', kind: 'frame', name_en: 'The blue ring', name_ar: 'الإطار الأزرق', config: { frameId: 'card-blue' } },
        { id: 'p-tea', kind: 'free_with', name_en: 'Tea with any dessert', name_ar: 'شاي مع أي حلى', config: { triggerCategoryIds: ['d'], triggerItemIds: [], freeCategoryIds: [], freeItemIds: ['t'] } },
      ],
    };
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ next_tier: blue, tiers: [TIERS[0], blue, TIERS[2]] }),
    });
    try {
      const gives = screen.getByTestId('loyalty.next-card.gives');
      expect(within(gives).getByText(locale === 'ar' ? 'حلى في عيد ميلادك' : 'A dessert on your birthday')).toBeTruthy();
      expect(
        within(gives).getByText(
          t('loyalty.guest.gives.giftBirthday', { days: countPhrase('loyalty.guest.gives.days', 7, locale) }),
        ),
      ).toBeTruthy();
      expect(
        within(gives).getByText(
          t('loyalty.guest.gives.stampSizeDetail', { stamps: countPhrase('loyalty.guest.gives.stamps', 6, locale) }),
        ),
      ).toBeTruthy();
      expect(within(gives).getByText(t('loyalty.guest.gives.frameDetail'))).toBeTruthy();
      expect(within(gives).getByText(t('loyalty.guest.gives.freeWithDetail'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a birthday court hour says it comes off a booking at the desk (0445)', () => {
    const court = { ...OPEN_GIFT, perk_id: 'g-court', name_en: 'A free court hour', name_ar: 'ساعة ملعب مجانية', target: 'court_hour' };
    const only = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({ enabled: false }, { gifts: [court] }))],
    });
    try {
      expect(within(only.getByTestId('club.birthday')).getByText(t('loyalty.guest.birthday.bodyCourt'))).toBeTruthy();
    } finally {
      only.unmount();
    }
    const mixed = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [
        ...cardSeeds,
        ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({ enabled: false }, { gifts: [OPEN_GIFT, court] })),
      ],
    });
    try {
      expect(within(mixed.getByTestId('club.birthday')).getByText(t('loyalty.guest.birthday.body'))).toBeTruthy();
      expect(within(mixed.getByTestId('club.birthday.gift.g-court')).getByText(t('loyalty.guest.birthday.courtNote'))).toBeTruthy();
    } finally {
      mixed.unmount();
    }
  });

  it('the Club tab notes the card-up welcome and the month\'s gift until they end; a used one is hidden (0445)', () => {
    const gifts = [
      { perk_id: 'm-1', name_en: 'Drink of the month', name_ar: 'مشروب الشهر', when: 'monthly', target: 'items', window_to: '2026-11-30', used: false },
      { perk_id: 'u-1', name_en: 'A welcome court hour', name_ar: 'ساعة ملعب ترحيبية', when: 'card_up', target: 'court_hour', window_to: '2026-12-10', used: false },
      { perk_id: 'm-used', name_en: 'Used one', name_ar: 'مستخدمة', when: 'monthly', target: 'items', window_to: '2026-11-30', used: true },
    ];
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: [...cardSeeds, ...homeSeeds({}, dealsFixture(), undefined, extrasFixture({ enabled: false }, {}, gifts))],
    });
    try {
      const welcome = screen.getByTestId('club.card-gifts.u-1');
      const card = isolate(locale === 'ar' ? TIERS[0]!.name_ar : TIERS[0]!.name_en);
      expect(within(welcome).getByText(t('loyalty.guest.cardGifts.cardUpTitle', { card }))).toBeTruthy();
      const dec10 = isolate(formatDate(birthDateToDate('2026-12-10') as Date, locale, BIRTH_TZ));
      expect(within(welcome).getByText(t('loyalty.guest.cardGifts.court', { date: dec10 }))).toBeTruthy();
      const month = screen.getByTestId('club.card-gifts.m-1');
      expect(within(month).getByText(t('loyalty.guest.cardGifts.monthlyTitle'))).toBeTruthy();
      const nov30 = isolate(formatDate(birthDateToDate('2026-11-30') as Date, locale, BIRTH_TZ));
      expect(within(month).getByText(t('loyalty.guest.cardGifts.items', { date: nov30 }))).toBeTruthy();
      expect(screen.queryByTestId('club.card-gifts.m-used')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('the cards list monthly, card-up and court-hour gifts and the free size up in plain words (0445)', () => {
    const gift = (id: string, config: Record<string, unknown>) => ({ id, kind: 'gift', name_en: id, name_ar: id, config });
    const blue = {
      ...TIERS[1],
      perks: [
        gift('p-month', { when: 'monthly', target: 'items', categoryIds: ['c'], itemIds: [] }),
        gift('p-welcome', { when: 'card_up', target: 'items', categoryIds: ['c'], itemIds: [], days: 30 }),
        gift('p-court', { when: 'birthday', target: 'court_hour', categoryIds: [], itemIds: [], days: 7 }),
        { id: 'p-size', kind: 'size_upgrade', name_en: 'Size up', name_ar: 'حجم أكبر', config: { categoryIds: ['coffee'], itemIds: [] } },
      ],
    };
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ next_tier: blue, tiers: [TIERS[0], blue, TIERS[2]] }),
    });
    try {
      const gives = screen.getByTestId('loyalty.next-card.gives');
      const days = (n: number) => countPhrase('loyalty.guest.gives.days', n, locale);
      expect(within(gives).getByText(t('loyalty.guest.gives.giftMonthly'))).toBeTruthy();
      expect(within(gives).getByText(t('loyalty.guest.gives.giftCardUp', { days: days(30) }))).toBeTruthy();
      expect(within(gives).getByText(t('loyalty.guest.gives.giftBirthdayCourt', { days: days(7) }))).toBeTruthy();
      expect(within(gives).getByText(t('loyalty.guest.gives.sizeUpgradeDetail'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

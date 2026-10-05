/**
 * Loyalty, the guest's side (loyalty plan §5.1). See `src/smoke/auth.smoke.test.tsx` for what a
 * case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the PARSED reads under their `loyaltyKeys`, so the first render draws
 * real content: the member card's QR (computed from the fixture secret, as on a phone), and the
 * loyalty screen with a balance, a tier on its way to the next, rewards and history.
 *
 * After the table cases, the states a first render cannot show under the route's one primary:
 * loyalty switched off, the member card's token and phone, a top tier, and Profile's two entries
 * (shown only while loyalty is on, build contracts L-1). None of those names a `route:` (each
 * route is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { MEMBER_TOKEN_RE } from '@touch/core/loyalty';
import { makeT, type Locale } from '@touch/i18n';
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
import MemberCardScreen from '../../app/member-card';
import LoyaltyScreen from '../../app/loyalty';
import ProfileScreen from '../../app/(tabs)/profile';

type Seeds = [readonly unknown[], unknown][];

/** RFC 6238's SHA-1 test secret ("12345678901234567890"), as base32. */
const CARD = parseMemberCard({
  member_code: '8F3K2QXM',
  secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  step: 30,
});

const loyaltyFixture = (over: Record<string, unknown> = {}) =>
  parseMyLoyalty({
    enabled: true,
    balance: 1250,
    lifetime: 3400,
    points_12m: 900,
    tier: { id: 'tier-0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 },
    next_tier: {
      id: 'tier-1',
      name_en: 'Silver',
      name_ar: 'فضي',
      multiplier: 1.25,
      min_points_12m: 1500,
    },
    point_value_iqd: 50,
    min_redeem_points: 100,
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

const cardSeeds: Seeds = [...venue, [profileKeys.own, profileFixture()], [loyaltyKeys.card, CARD]];
const homeSeeds = (over: Record<string, unknown> = {}): Seeds => [
  ...venue,
  [loyaltyKeys.mine, loyaltyFixture(over)],
];

const CASES: SmokeCase[] = [
  {
    route: 'member-card',
    Component: MemberCardScreen,
    // The QR is a mark with no text of its own: the till's other way in is beside it.
    nearbyKey: 'loyalty.guest.card.sayNumber',
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

  it('the member card draws a live TP- token, the phone and "Get a new code"', () => {
    const screen = renderRoute(MemberCardScreen, { locale, session: 'in', queryData: cardSeeds });
    try {
      const token = String(screen.getByTestId('member-card.code').props.children).replace(
        LRI_PDI,
        '',
      );
      expect(token).toMatch(MEMBER_TOKEN_RE);
      expect(token.startsWith('TP-8F3K2QXM-')).toBe(true);
      expect(screen.getByTestId('member-card.phone')).toBeTruthy();
      expect(screen.getByTestId('member-card.progress')).toBeTruthy();
      const again = screen.getByTestId('member-card.new-code');
      expect(within(again).getByText(t('loyalty.guest.card.newCode'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the loyalty screen shows the tier on its way, rewards and history', () => {
    const screen = renderRoute(LoyaltyScreen, { locale, session: 'in', queryData: homeSeeds() });
    try {
      expect(screen.getByTestId('loyalty.tier-progress')).toBeTruthy();
      expect(
        screen.getByText(
          t('loyalty.guest.tier.next', { tier: locale === 'ar' ? 'فضي' : 'Silver' }),
        ),
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
      fireEvent.press(screen.getByTestId('loyalty.show-card'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/member-card' });
    } finally {
      screen.unmount();
    }
  });

  it('a top tier says so instead of a next one', () => {
    const screen = renderRoute(LoyaltyScreen, {
      locale,
      session: 'in',
      queryData: homeSeeds({ next_tier: null, history: [], rewards: [] }),
    });
    try {
      expect(screen.getByText(t('loyalty.guest.tier.top'))).toBeTruthy();
      expect(screen.queryByTestId('loyalty.tier-progress')).toBeNull();
      expect(screen.getByTestId('loyalty.history-empty')).toBeTruthy();
      expect(screen.getByText(t('loyalty.guest.rewards.empty'))).toBeTruthy();
    } finally {
      screen.unmount();
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
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/member-card' });
      const row = on.getByTestId('profile.loyalty');
      expect(within(row).getByText(t('loyalty.guest.home.title'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/loyalty' });
    } finally {
      on.unmount();
    }
  });
});

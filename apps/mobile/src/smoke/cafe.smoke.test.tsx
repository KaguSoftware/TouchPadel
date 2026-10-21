/**
 * The café menu, to look at (Majed, 2026-10-17): `app/cafe-menu.tsx`, opened from the account
 * page. See `src/smoke/auth.smoke.test.tsx` for what a case asserts and `src/test/smokeCase.tsx`
 * for how.
 *
 * The route case seeds the ASSEMBLED menu under `cafeKeys.menu`, so the first render draws real
 * rows. After it, the states one render cannot show: an item with several sizes and one sold out,
 * the empty menu, and the account page's two ways in (signed in and signed out).
 *
 * The Club tab (the bar's centre since 2026-10-19: the member card and the same menu) is cased
 * here too: it opens on the card for a member, on the menu for a guest who has not signed in,
 * and drops the switch when the owner has loyalty off.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { formatIQD, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import { TEST_VENUE_ID, branchFixture, profileFixture } from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { cafeKeys } from '../features/cafe/keys';
import { assembleMenu, type MenuViewSection } from '../features/cafe/logic';
import { loyaltyKeys } from '../features/loyalty/keys';
import { parseMemberCard, parseMyLoyalty } from '../features/loyalty/logic';
import CafeMenuScreen from '../../app/cafe-menu';
import ClubScreen from '../../app/(tabs)/club';
import ProfileScreen from '../../app/profile';

type Seeds = [readonly unknown[], unknown][];

const MENU: MenuViewSection[] = assembleMenu(
  [
    { id: 'coffee', name_en: 'Coffee', name_ar: 'قهوة', sort_order: 1 },
    { id: 'sweets', name_en: 'Sweets', name_ar: 'حلويات', sort_order: 2 },
  ],
  [
    {
      id: 'latte',
      category_id: 'coffee',
      name_en: 'Latte',
      name_ar: 'لاتيه',
      hook_en: 'Double shot, steamed milk',
      hook_ar: 'شوت مزدوج مع حليب مبخّر',
      sold_out: false,
      serve_temp: 'both',
      photo_path: null,
      sort_order: 1,
      menu_item_variants: [
        {
          id: 'latte-s',
          name_en: 'Small',
          name_ar: 'صغير',
          price_iqd: 4000,
          is_default: true,
          sort_order: 1,
        },
        {
          id: 'latte-l',
          name_en: 'Large',
          name_ar: 'كبير',
          price_iqd: 5000,
          is_default: false,
          sort_order: 2,
        },
      ],
    },
    {
      id: 'cookie',
      category_id: 'sweets',
      name_en: 'Cookie',
      name_ar: 'كوكيز',
      hook_en: null,
      hook_ar: null,
      sold_out: true,
      serve_temp: null,
      photo_path: null,
      sort_order: 1,
      menu_item_variants: [
        {
          id: 'cookie-1',
          name_en: 'Regular',
          name_ar: 'عادي',
          price_iqd: 2500,
          is_default: true,
          sort_order: 1,
        },
      ],
    },
  ],
);

const menuSeeds = (menu: MenuViewSection[] = MENU): Seeds => [
  [availabilityKeys.branches, [branchFixture()]],
  [cafeKeys.menu(TEST_VENUE_ID), menu],
];

/** RFC 6238's SHA-1 test secret, as base32 (the same card loyalty.smoke.test.tsx draws). */
const CARD = parseMemberCard({
  member_code: '8F3K2QXM',
  secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  step: 30,
});

const loyalty = (enabled: boolean) =>
  parseMyLoyalty({
    enabled,
    balance: 1250,
    lifetime: 3400,
    points_12m: 900,
    tier: { id: 'tier-0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 },
    next_tier: null,
    point_value_iqd: 50,
    min_redeem_points: 100,
    history: [],
    rewards: [],
  });

const clubSeeds = (enabled = true): Seeds => [
  ...menuSeeds(),
  [profileKeys.own, profileFixture()],
  [loyaltyKeys.mine, loyalty(enabled)],
  [loyaltyKeys.card, CARD],
];

const CASES: SmokeCase[] = [
  {
    route: 'club',
    Component: ClubScreen,
    // The switch's track has no words of its own: the tab's title is beside it.
    nearbyKey: 'tabs.club',
    options: { session: 'in', queryData: clubSeeds() },
  },
  {
    route: 'cafe-menu',
    Component: CafeMenuScreen,
    // The list has no words of its own: the line that says where ordering happens is beside it.
    nearbyKey: 'cafe.viewOnlyNote',
    options: { queryData: menuSeeds() },
  },
];

runSmokeCases('café menu', CASES);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('café menu states in %s', (locale) => {
  const t = makeT(locale);

  it('shows each size with its price, a sold-out item as sold out, and a chip per category', () => {
    const screen = renderRoute(CafeMenuScreen, { locale, queryData: menuSeeds() });
    try {
      const latte = screen.getByTestId('cafe-menu.item.latte');
      expect(within(latte).getByText(locale === 'ar' ? 'لاتيه' : 'Latte')).toBeTruthy();
      expect(within(latte).getByText(formatIQD(4000, locale))).toBeTruthy();
      expect(within(latte).getByText(formatIQD(5000, locale))).toBeTruthy();
      expect(within(latte).queryByText(t('cafe.soldOutCta'))).toBeNull();
      const cookie = screen.getByTestId('cafe-menu.item.cookie');
      expect(within(cookie).getByText(t('cafe.soldOutCta'))).toBeTruthy();
      expect(within(cookie).getByText(formatIQD(2500, locale))).toBeTruthy();
      expect(screen.getByTestId('cafe-menu.category.coffee')).toBeTruthy();
      expect(screen.getByTestId('cafe-menu.category.sweets')).toBeTruthy();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('says so when the branch has no menu up', () => {
    const screen = renderRoute(CafeMenuScreen, { locale, queryData: menuSeeds([]) });
    try {
      expect(screen.getByTestId('cafe-menu.empty')).toBeTruthy();
      expect(screen.getByText(t('cafe.menuEmpty.title'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the account page opens it, signed in and signed out', () => {
    const signedIn = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), null],
      ],
    });
    try {
      const row = signedIn.getByTestId('profile.cafe-menu');
      expect(within(row).getByText(t('profile.cafeMenu'))).toBeTruthy();
      expect(signedIn.getByText(t('profile.groupCafe'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/cafe-menu' });
    } finally {
      signedIn.unmount();
    }
    const signedOut = renderRoute(ProfileScreen, { locale, session: 'out' });
    try {
      fireEvent.press(signedOut.getByTestId('profile.cafe-menu'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/cafe-menu' });
    } finally {
      signedOut.unmount();
    }
  });
});

describe.each(LOCALES)('the Club tab in %s', (locale) => {
  const t = makeT(locale);

  it('opens on the member card for a member, with the points leading to Points & rewards', () => {
    const screen = renderRoute(ClubScreen, { locale, session: 'in', queryData: clubSeeds() });
    try {
      expect(screen.getByTestId('club.card.qr')).toBeTruthy();
      expect(screen.getByTestId('club.loyalty.balance')).toBeTruthy();
      expect(screen.queryByTestId('club.menu.list')).toBeNull();
      fireEvent.press(screen.getByTestId('club.loyalty'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/loyalty', params: { from: 'club' } },
      });
      fireEvent.press(screen.getByTestId('club.view.menu'));
      expect(screen.getByTestId('club.menu.list')).toBeTruthy();
      expect(screen.getByTestId('club.menu.item.latte')).toBeTruthy();
      expect(screen.queryByTestId('club.card.qr')).toBeNull();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('sent with show=card (Profile, Points & rewards) opens on the card; the switch clears it', () => {
    const screen = renderRoute(ClubScreen, {
      locale,
      session: 'in',
      queryData: clubSeeds(),
      params: { show: 'card' },
    });
    try {
      expect(screen.getByTestId('club.card.qr')).toBeTruthy();
      fireEvent.press(screen.getByTestId('club.view.menu'));
      expect(screen.getByTestId('club.menu.list')).toBeTruthy();
      expect(routerState.calls).toContainEqual({
        method: 'setParams',
        arg: { show: undefined },
      });
    } finally {
      screen.unmount();
    }
  });

  it('opens on the menu signed out, and the card view asks to sign in', () => {
    const screen = renderRoute(ClubScreen, { locale, session: 'out', queryData: menuSeeds() });
    try {
      expect(screen.getByTestId('club.menu.list')).toBeTruthy();
      fireEvent.press(screen.getByTestId('club.view.card'));
      expect(screen.getByText(t('loyalty.guest.card.signInPitch'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('club.sign-in'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/sign-in' });
    } finally {
      screen.unmount();
    }
  });

  it('is the menu alone while the owner has loyalty off', () => {
    const screen = renderRoute(ClubScreen, { locale, session: 'in', queryData: clubSeeds(false) });
    try {
      expect(screen.queryByTestId('club.view')).toBeNull();
      expect(screen.getByTestId('club.menu.list')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

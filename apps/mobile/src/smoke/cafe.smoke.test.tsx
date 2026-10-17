/**
 * The café menu, to look at (Majed, 2026-10-17): `app/cafe-menu.tsx`, opened from the account
 * page. See `src/smoke/auth.smoke.test.tsx` for what a case asserts and `src/test/smokeCase.tsx`
 * for how.
 *
 * The route case seeds the ASSEMBLED menu under `cafeKeys.menu`, so the first render draws real
 * rows. After it, the states one render cannot show: an item with several sizes and one sold out,
 * the empty menu, and the account page's two ways in (signed in and signed out).
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
import CafeMenuScreen from '../../app/cafe-menu';
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
        { id: 'latte-s', name_en: 'Small', name_ar: 'صغير', price_iqd: 4000, is_default: true, sort_order: 1 },
        { id: 'latte-l', name_en: 'Large', name_ar: 'كبير', price_iqd: 5000, is_default: false, sort_order: 2 },
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
        { id: 'cookie-1', name_en: 'Regular', name_ar: 'عادي', price_iqd: 2500, is_default: true, sort_order: 1 },
      ],
    },
  ],
);

const menuSeeds = (menu: MenuViewSection[] = MENU): Seeds => [
  [availabilityKeys.branches, [branchFixture()]],
  [cafeKeys.menu(TEST_VENUE_ID), menu],
];

const CASES: SmokeCase[] = [
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

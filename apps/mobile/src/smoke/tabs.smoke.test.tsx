/**
 * The tab navigator and its three screens.
 *
 * The hardest three renders in the app live here: `(tabs)/index` builds the
 * court's GL stage and a glass sheet, `(tabs)/_layout` is UIKit's own tab bar,
 * and `(tabs)/bookings` has four states (signed out, empty, error, populated)
 * that used to share one branch. See `src/smoke/auth.smoke.test.tsx` for what
 * a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * TWO OF THESE CASES ASSERT ON IDS A MOCK MINTED. Read them for what they are:
 *
 *  • `tabs` (the iOS layout, which the `jest-expo/ios` preset resolves
 *    `(tabs)/_layout` to). `TabsLayout.ios.tsx` carries NO testID — UIKit
 *    draws the bar — and `tabs.book` exists only because jest.setup.ts's
 *    `expo-router/unstable-native-tabs` mock names each Trigger's View after
 *    its route. The case proves the layout declares three triggers with the
 *    locale's labels; it does not prove a `tabs.book` node exists on a device.
 *    The Android case below is where that id is asserted on the app's own
 *    Pressable.
 *  • `book`. jest.setup.ts's `Court3D` mock reports itself unavailable on
 *    mount, so the Book tab always takes its GL-less branch here (the flat
 *    `CourtIllustration` with the CTA under it). That branch ships, but the
 *    GL branch — where the CTA is anchored to the measured net — is never
 *    rendered by this suite.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import {
  TEST_VENUE_ID,
  TEST_VENUE_2_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  profileFixture,
} from '../test/fixtures';
import { bookingKeys } from '../features/booking/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import TabsLayout from '../../app/(tabs)/_layout';
// The `.android` file BY NAME, past the preset's platform resolution: this is
// the navigator whose tab buttons are the app's own Pressables, and the only
// place `tabs.book` / `tabs.bookings` / `tabs.profile` are minted by app code.
import TabsLayoutAndroid from '../navigation/TabsLayout.android';
import BookScreen from '../../app/(tabs)/index';
import BookingsScreen from '../../app/(tabs)/bookings';
import ProfileScreen from '../../app/(tabs)/profile';

const CASES: SmokeCase[] = [
  {
    route: 'tabs',
    Component: TabsLayout,
    // The trigger renders its Label's text, so the label IS the assertion —
    // and it is the only evidence in a Node render that the iOS bar was
    // declared at all (jest.setup.ts's NativeTabs mock says what that proves).
    labelKey: 'tabs.book',
  },
  {
    route: 'book',
    Component: BookScreen,
    labelKey: 'courts.viewAvailability',
    // The Book tab reads the venue's hours for its open-now pill and the court
    // list for the stage. Seeded so the screen renders its content rather than
    // a skeleton — the CTA is mounted either way, but the AR label assertion
    // needs the real surface.
    options: {
      queryData: [
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), null],
      ],
    },
  },
  {
    route: 'bookings',
    Component: BookingsScreen,
    // The chip's label carries its own count, so the key interpolates. One
    // upcoming booking is seeded, which is what makes the count 1 — an empty
    // list renders the empty state and no chips at all.
    labelKey: 'booking.upcomingCount',
    labelParams: { count: 1 },
    options: {
      session: 'in',
      queryData: [
        [bookingKeys.mine, [bookingFixture()]],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.allCourts, [courtFixture()]],
      ],
    },
  },
  {
    route: 'profile',
    Component: ProfileScreen,
    labelKey: 'settings.title',
    options: {
      session: 'in',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), null],
      ],
    },
  },
];

runSmokeCases('tab screens', CASES);

/**
 * The Android bar, rendered directly. expo-router's `Tabs` is a stand-in in
 * jest.setup.ts (there is no navigator to drive), but the stand-in renders
 * each screen's OWN `tabBarButton` — so the Pressable under `tabs.book` here,
 * its testID and the `TabLabel` inside it are `TabsLayout.android.tsx`'s real
 * code, and the id is asserted on app code at least once. Same table row as
 * the iOS case: the primary is `tabs.book` on both platforms by design.
 */
runSmokeCases('android tab bar', [
  { route: 'tabs', Component: TabsLayoutAndroid, labelKey: 'tabs.book' },
]);

/**
 * The branch picker on the Book tab (multi-venue slice 4). Not a route of its
 * own, so not a table case: with TWO open branches the picker is mounted, its
 * label and the second branch's name are in the locale's words; with ONE it is
 * not there at all, which is today's install.
 */
const LOCALES: Locale[] = ['en', 'ar'];
const second = branchFixture({
  venue_id: TEST_VENUE_2_ID,
  venue_slug: 'touch-mansour',
  venue_name_en: 'Touch Mansour',
  venue_name_ar: 'تاتش المنصور',
});
const bookSeeds = (branches: unknown[]): [readonly unknown[], unknown][] => [
  [availabilityKeys.branches, branches],
  [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), null],
];

describe.each(LOCALES)('book branch picker in %s', (locale) => {
  const t = makeT(locale);

  it('shows the picker with two open branches', () => {
    const screen = renderRoute(BookScreen, {
      locale,
      queryData: bookSeeds([branchFixture(), second]),
    });
    try {
      expect(screen.getByTestId('book.branch')).toBeTruthy();
      expect(screen.getByText(t('branches.common.branch'))).toBeTruthy();
      const segment = screen.getByTestId(`book.branch.${TEST_VENUE_2_ID}`);
      expect(
        within(segment).getByText(locale === 'ar' ? 'تاتش المنصور' : 'Touch Mansour'),
      ).toBeTruthy();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('shows no picker with one open branch', () => {
    const screen = renderRoute(BookScreen, { locale, queryData: bookSeeds([branchFixture()]) });
    try {
      expect(screen.queryByTestId('book.branch')).toBeNull();
      expect(screen.getByTestId('book.view-availability')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

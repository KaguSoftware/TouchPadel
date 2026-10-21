/**
 * The tab navigator, two of its five screens, and the account page the tabs'
 * avatar opens (app/profile.tsx, a tab until 2026-10-17): Play is cased in
 * play.smoke.test.tsx, Club in cafe.smoke.test.tsx and Coaches in
 * coaching.smoke.test.tsx (each route is named by exactly one suite); both
 * bars are checked here for all five ids.
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
 *    its route. The case proves the layout declares five triggers with the
 *    locale's labels; it does not prove a `tabs.book` node exists on a device.
 *    The Android case below is where that id is asserted on the app's own
 *    Pressable.
 *  • `book`. jest.setup.ts's `Court3D` mock reports itself unavailable on
 *    mount, so the Book tab always takes its GL-less branch here (the CTA on
 *    the brand pattern, no court). That branch ships, but the
 *    GL branch — where the CTA is anchored to the measured net — is never
 *    rendered by this suite.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_VENUE_ID,
  TEST_VENUE_2_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  myMatchesFixture,
  myTicketsFixture,
  profileFixture,
} from '../test/fixtures';
import { bookingKeys } from '../features/booking/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { matchKeys } from '../features/matches/keys';
import TabsLayout from '../../app/(tabs)/_layout';
import { isGuestPreview, setGuestPreview } from '../features/staff/guestPreview';
// The `.android` file BY NAME, past the preset's platform resolution: this is
// the navigator whose tab buttons are the app's own Pressables, and the only
// place `tabs.book` / `tabs.bookings` / `tabs.coaches` are minted by app code.
import TabsLayoutAndroid from '../navigation/TabsLayout.android';
import BookScreen from '../../app/(tabs)/index';
import BookingsScreen from '../../app/(tabs)/bookings';
import ProfileScreen from '../../app/profile';

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
      // No open matches and an empty wallet (guest.md §4.27): the tab is
      // today's list; reservations.smoke.test.tsx draws it with match rows.
      queryData: [
        [bookingKeys.mine, [bookingFixture()]],
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.tickets, myTicketsFixture()],
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

/**
 * Five tabs on both bars, in this order, each with its own id and the locale's
 * label. Profile left the bar on 2026-10-17 for the avatar on each title row;
 * Club (the member card and the café menu) took the centre on 2026-10-19.
 */
const TAB_ORDER = [
  ['tabs.bookings', 'tabs.bookings'],
  ['tabs.play', 'tabs.play'],
  ['tabs.club', 'tabs.club'],
  ['tabs.book', 'tabs.book'],
  ['tabs.coaches', 'tabs.coaches'],
] as const;

describe.each(LOCALES)('the five tabs in %s', (locale) => {
  const t = makeT(locale);

  it.each<[string, typeof TabsLayout]>([
    ['iOS', TabsLayout],
    ['Android', TabsLayoutAndroid],
  ])('the %s bar declares all five, Club in the middle, and no Profile tab', (_name, Layout) => {
    const screen = renderRoute(Layout, { locale });
    try {
      const ids = TAB_ORDER.map(([id, key]) => {
        const tab = screen.getByTestId(id);
        expect(within(tab).getByText(t(key))).toBeTruthy();
        return id;
      });
      const all = screen.UNSAFE_root.findAll(
        (n) => typeof n.props.testID === 'string' && n.props.testID.startsWith('tabs.') && n.props.testID !== 'tabs.back-to-staff',
      );
      const seen = [...new Set(all.map((n) => n.props.testID as string))];
      expect(seen).toEqual(ids);
    } finally {
      screen.unmount();
    }
  });
});

// "Show guest view" (owner, 2026-09-28): a staff session that asked for it
// gets the guest tabs with a way back; without asking, it never does. The way
// back lives on the account page since Profile left the bar (2026-10-17).
describe.each<Locale>(['en', 'ar'])('the guest view for staff in %s', (locale) => {
  const t = makeT(locale);

  it('shows the tabs, and the account page carries a Back to staff view pill that ends the preview', () => {
    setGuestPreview(true);
    const tabs = renderRoute(TabsLayout, { locale, staff: { role: 'manager' } });
    try {
      expect(tabs.getByText(t('tabs.book'))).toBeTruthy();
      expect(tabs.queryByTestId('tabs.back-to-staff')).toBeNull();
    } finally {
      tabs.unmount();
    }
    const account = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      staff: { role: 'manager' },
      pathname: '/profile',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), null],
      ],
    });
    try {
      const back = account.getByTestId('tabs.back-to-staff');
      expect(within(back).getByText(t('staff.shell.guestView.back'))).toBeTruthy();
      fireEvent.press(back);
      expect(isGuestPreview()).toBe(false);
    } finally {
      account.unmount();
      setGuestPreview(false);
    }
  });

  it('shows no pill on the account page of a guest', () => {
    const screen = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), null],
      ],
    });
    try {
      expect(screen.queryByTestId('tabs.back-to-staff')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('keeps a staff session out of the tabs when it did not ask', () => {
    const screen = renderRoute(TabsLayout, { locale, staff: { role: 'manager' } });
    try {
      expect(screen.queryByTestId('tabs.back-to-staff')).toBeNull();
      expect(screen.queryByText(t('tabs.book'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});

/**
 * The account button (Majed, 2026-10-17): the guest's picture on the trailing
 * edge of each tab's title row, in place of the Profile tab. It opens the
 * account page, signed in or out, and the screen reader hears "Your account".
 */
describe.each(LOCALES)('the account button in %s', (locale) => {
  const t = makeT(locale);

  it.each<[string, typeof BookScreen, 'in' | 'out', [readonly unknown[], unknown][]]>([
    ['book', BookScreen, 'out', bookSeeds([branchFixture()])],
    [
      'bookings',
      BookingsScreen,
      'in',
      [
        [bookingKeys.mine, [bookingFixture()]],
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.tickets, myTicketsFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.allCourts, [courtFixture()]],
        [profileKeys.own, profileFixture()],
      ],
    ],
  ])('the %s tab opens the account page', (route, Screen, session, queryData) => {
    const screen = renderRoute(Screen, { locale, session, queryData });
    try {
      const button = screen.getByTestId(`${route}.account`);
      expect(button.props.accessibilityLabel).toBe(t('profile.openAccount'));
      fireEvent.press(button);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/profile' });
    } finally {
      screen.unmount();
    }
  });
});

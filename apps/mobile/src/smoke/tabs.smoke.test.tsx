/**
 * The tab navigator and its three screens.
 *
 * The hardest three renders in the app live here: `(tabs)/index` builds the
 * court's GL stage and a glass sheet, `(tabs)/_layout` is UIKit's own tab bar,
 * and `(tabs)/bookings` has four states (signed out, empty, error, populated)
 * that used to share one branch. See `src/smoke/auth.smoke.test.tsx` for what
 * a case asserts and `src/test/smokeCase.tsx` for how.
 */
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { bookingFixture, courtFixture, profileFixture } from '../test/fixtures';
import { bookingKeys } from '../features/booking/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import TabsLayout from '../../app/(tabs)/_layout';
import BookScreen from '../../app/(tabs)/index';
import BookingsScreen from '../../app/(tabs)/bookings';
import ProfileScreen from '../../app/(tabs)/profile';

const CASES: SmokeCase[] = [
  {
    route: 'tabs',
    Component: TabsLayout,
    primary: 'tabs.book',
    // The trigger renders its Label's text, so the label IS the assertion —
    // and it is the only evidence in a Node render that the iOS bar was
    // declared at all (jest.setup.ts's NativeTabs mock says what that proves).
    labelKey: 'tabs.book',
  },
  {
    route: 'book',
    Component: BookScreen,
    primary: 'book.view-availability',
    labelKey: 'courts.viewAvailability',
    // The Book tab reads the venue's hours for its open-now pill and the court
    // list for the stage. Seeded so the screen renders its content rather than
    // a skeleton — the CTA is mounted either way, but the AR label assertion
    // needs the real surface.
    options: {
      queryData: [
        [availabilityKeys.courts, [courtFixture()]],
        [availabilityKeys.settings, null],
      ],
    },
  },
  {
    route: 'bookings',
    Component: BookingsScreen,
    primary: 'bookings.filter.upcoming',
    // The chip's label carries its own count, so the key interpolates. One
    // upcoming booking is seeded, which is what makes the count 1 — an empty
    // list renders the empty state and no chips at all.
    labelKey: 'booking.upcomingCount',
    labelParams: { count: 1 },
    options: {
      session: 'in',
      queryData: [
        [bookingKeys.mine, [bookingFixture()]],
        [availabilityKeys.courts, [courtFixture()]],
      ],
    },
  },
  {
    route: 'profile',
    Component: ProfileScreen,
    primary: 'profile.settings',
    labelKey: 'settings.title',
    options: {
      session: 'in',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.settings, null],
      ],
    },
  },
];

runSmokeCases('tab screens', CASES);

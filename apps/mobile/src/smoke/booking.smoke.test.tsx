/**
 * The booking flow after the slot is picked (the pick itself is the Book tab's
 * sheet, covered by the tabs suite): review it, confirm it, look at it later.
 *
 * These are the screens with the most STATE behind a first render — an
 * availability grid, a reservation fetched by id, a hold with a deadline — so
 * each case seeds exactly what its screen needs to get past loading and draw
 * its real content. See `src/smoke/auth.smoke.test.tsx` for what a case
 * asserts and `src/test/smokeCase.tsx` for how.
 */
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import {
  TEST_RESERVATION_ID,
  TEST_VENUE_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  depositQuoteFixture,
  myMatchesFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { bookingKeys } from '../features/booking/hooks';
import { depositKeys } from '../features/deposit/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import { matchKeys } from '../features/matches/keys';
import BookingDetailScreen from '../../app/booking/[id]';
import BookingHistoryScreen from '../../app/booking-history';
import ReviewScreen from '../../app/review';
import SuccessScreen from '../../app/success';

/**
 * Everything the availability grid and the venue-aware screens read: ONE open
 * branch (so no picker, as on today's install) and that branch's rows.
 */
const VENUE: [readonly unknown[], unknown][] = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
  [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.rates(TEST_VENUE_ID), []],
  [availabilityKeys.ratePrices, []],
];

const HOLD_ID = '33333333-3333-4333-8333-333333333333';

/** A hold that has not expired, as the booking sheet hands it to Review. */
const holdParams = () => ({
  holdId: HOLD_ID,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  priceIqd: '30000',
  courtNameEn: 'Court One',
  courtNameAr: 'الملعب الأول',
  startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  durationMin: '90',
});

const CASES: SmokeCase[] = [
  {
    route: 'booking-detail',
    Component: BookingDetailScreen,
    labelKey: 'booking.cancelBooking',
    // The cancel action appears only for an UPCOMING, still-active booking
    // whose cancellation policy has loaded — `upcomingActive && policyKnown &&
    // eligible`. The fixture is three days out and the window is two hours, so
    // all three hold without the test knowing the rule.
    options: {
      session: 'in',
      params: { id: TEST_RESERVATION_ID },
      queryData: [...VENUE, [bookingKeys.one(TEST_RESERVATION_ID), bookingFixture()]],
    },
  },
  {
    route: 'booking-history',
    Component: BookingHistoryScreen,
    labelKey: 'booking.clearHistory',
    // The Clear button is the list's FOOTER: it renders only when there is
    // history to clear, so the fixture is a booking that has already happened.
    // No open matches (guest.md §4.27): both match scopes answer empty.
    options: {
      session: 'in',
      queryData: [
        ...VENUE,
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.mine('past'), myMatchesFixture()],
        [
          bookingKeys.mine,
          [
            bookingFixture({
              status: 'completed',
              start_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
              end_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 5_400_000).toISOString(),
            }),
          ],
        ],
      ],
    },
  },
  {
    route: 'review',
    Component: ReviewScreen,
    labelKey: 'booking.reserveCta',
    // Without a live `holdId` the screen renders its "hold expired" branch and
    // a way back to availability instead of the CTA. Deposits off: today's
    // Confirm, unchanged (build-contracts-2026-09-27 §4).
    options: {
      session: 'in',
      params: holdParams(),
      queryData: [...VENUE, [depositKeys.quote(HOLD_ID), depositQuoteFixture({ mode: 'off' })]],
    },
  },
  {
    route: 'review',
    Component: ReviewScreen,
    // Deposits optional: "Pay X now" leads, and the same Confirm becomes the
    // second choice, "Confirm, pay at the desk", under the same id.
    labelKey: 'deposit.confirmPayAtDeskCta',
    options: {
      session: 'in',
      params: holdParams(),
      queryData: [...VENUE, [depositKeys.quote(HOLD_ID), depositQuoteFixture({ mode: 'optional' })]],
    },
  },
  {
    route: 'success',
    Component: SuccessScreen,
    labelKey: 'common.done',
    options: {
      session: 'in',
      params: {
        reservationId: TEST_RESERVATION_ID,
        courtNameEn: 'Court One',
        courtNameAr: 'الملعب الأول',
        startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        durationMin: '90',
        priceIqd: '30000',
      },
      queryData: VENUE,
    },
  },
];

runSmokeCases('booking screens', CASES);

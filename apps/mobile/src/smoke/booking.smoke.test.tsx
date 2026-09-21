/**
 * The booking flow: pick a slot, review it, confirm it, look at it later.
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
  bookingFixture,
  courtFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { bookingKeys } from '../features/booking/hooks';
import { availabilityKeys } from '../features/availability/hooks';
import AvailabilityScreen from '../../app/availability';
import BookingDetailScreen from '../../app/booking/[id]';
import BookingHistoryScreen from '../../app/booking-history';
import ReviewScreen from '../../app/review';
import SuccessScreen from '../../app/success';

/** Everything the availability grid and the venue-aware screens read. */
const VENUE: [readonly unknown[], unknown][] = [
  [availabilityKeys.settings, venueSettingsFixture()],
  [availabilityKeys.courts, [courtFixture()]],
  [availabilityKeys.rates, []],
  [availabilityKeys.ratePrices, []],
];

/** A hold that has not expired, as the availability screen hands it to Review. */
const holdParams = () => ({
  holdId: '33333333-3333-4333-8333-333333333333',
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  priceIqd: '30000',
  courtNameEn: 'Court One',
  courtNameAr: 'الملعب الأول',
  startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  durationMin: '90',
});

const CASES: SmokeCase[] = [
  {
    route: 'availability',
    Component: AvailabilityScreen,
    // The duration picker is a SegmentedControl: the track carries the id and
    // holds no text of its own, so the label assertion moves to a segment's.
    // It is mounted above the grid's own branches, which is why it is the
    // primary — an empty or failed day still has a duration to pick.
    primary: 'availability.duration',
    nearbyKey: 'booking.durationMinutes',
    labelParams: { minutes: 60 },
    options: { session: 'in', queryData: VENUE },
  },
  {
    route: 'booking-detail',
    Component: BookingDetailScreen,
    primary: 'booking-detail.cancel',
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
    primary: 'booking-history.clear',
    labelKey: 'booking.clearHistory',
    // The Clear button is the list's FOOTER: it renders only when there is
    // history to clear, so the fixture is a booking that has already happened.
    options: {
      session: 'in',
      queryData: [
        ...VENUE,
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
    primary: 'review.reserve',
    labelKey: 'booking.reserveCta',
    // Without a live `holdId` the screen renders its "hold expired" branch and
    // a way back to availability instead of the CTA.
    options: { session: 'in', params: holdParams(), queryData: VENUE },
  },
  {
    route: 'success',
    Component: SuccessScreen,
    primary: 'success.done',
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

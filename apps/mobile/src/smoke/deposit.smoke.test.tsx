/**
 * The online deposit's screens (build-contracts-2026-09-27 §4): the return
 * link's landing, the payment screen, and the designed "not here" screen any
 * unknown link reaches. See `src/smoke/auth.smoke.test.tsx` for what a case
 * asserts and `src/test/smokeCase.tsx` for how.
 *
 * The payment screen is seeded with a PARSED status (the shape the query holds
 * after `parseDepositStatus`), in the one state a guest meets first: the bank's
 * page is open and the window is still running.
 */
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import {
  TEST_RESERVATION_ID,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  depositStatusFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { depositKeys } from '../features/deposit/hooks';
import PayReturnScreen from '../../app/pay/return';
import PayStatusScreen from '../../app/pay/status';
import NotFoundScreen from '../../app/+not-found';

const REF = '55555555-5555-4555-8555-555555555555';

const VENUE: [readonly unknown[], unknown][] = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
  [availabilityKeys.allCourts, [courtFixture()]],
];

const CASES: SmokeCase[] = [
  {
    route: 'pay-return',
    Component: PayReturnScreen,
    // A spinner and one line: the screen lives for the frame it takes to hand
    // the ref to the payment screen.
    nearbyKey: 'deposit.checkingTitle',
    options: { session: 'in', params: { ref: REF } },
  },
  {
    route: 'pay-status',
    Component: PayStatusScreen,
    labelKey: 'deposit.openAgain',
    options: {
      session: 'in',
      params: { ref: REF },
      queryData: [
        ...VENUE,
        [depositKeys.status(REF), depositStatusFixture({ ref: REF, reservationId: TEST_RESERVATION_ID })],
      ],
    },
  },
  {
    route: 'not-found',
    Component: NotFoundScreen,
    labelKey: 'booking.myBookings',
  },
];

runSmokeCases('online deposit screens', CASES);

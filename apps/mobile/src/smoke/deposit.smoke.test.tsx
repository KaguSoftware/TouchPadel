/**
 * The online payment's screens (build-contracts-2026-09-27 §4): the return
 * link's landing, the payment screen, the designed "not here" screen any
 * unknown link reaches, and the open-match ticket wallet that starts a ticket
 * purchase (docs/design/open-matches/guest.md §4.10). See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * The payment screen is seeded with a PARSED status (the shape the query holds
 * after `parseDepositStatus`), in the one state a guest meets first: the bank's
 * page is open and the window is still running. After the table cases, the
 * states a ticket purchase adds (§4.10.4): its summary while paying, and
 * `ticketsBought`.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { countPhrase, isolateLtr, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import {
  TEST_RESERVATION_ID,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  depositStatusFixture,
  myTicketsFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { depositKeys } from '../features/deposit/hooks';
import type { DepositStatus } from '../features/deposit/logic';
import { matchKeys } from '../features/matches/keys';
import PayReturnScreen from '../../app/pay/return';
import PayStatusScreen from '../../app/pay/status';
import NotFoundScreen from '../../app/+not-found';
import TicketsScreen from '../../app/tickets';

const REF = '55555555-5555-4555-8555-555555555555';

const VENUE: [readonly unknown[], unknown][] = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture()],
  [availabilityKeys.allCourts, [courtFixture()]],
];

/** A purchase of two tickets as deposit-status sends it (money.md §5.5): no hold, no reservation. */
const ticketStatus = (over: Partial<DepositStatus> = {}): DepositStatus =>
  depositStatusFixture({
    ref: REF,
    purpose: 'ticket',
    ticketCount: 2,
    unitPriceIqd: 10000,
    amountIqd: 20000,
    priceIqd: 20000,
    restIqd: 0,
    depositMode: 'off',
    holdLive: false,
    reservation: null,
    ...over,
  });

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
  {
    route: 'tickets',
    Component: TicketsScreen,
    // An empty wallet with room for three: the buy card, "Pay with Qi Card".
    labelKey: 'matches.tickets.buy',
    options: {
      session: 'in',
      params: { buy: '2', for: 'join' },
      queryData: [...VENUE, [matchKeys.tickets, myTicketsFixture()]],
    },
  },
];

runSmokeCases('online payment screens', CASES);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('a ticket purchase in %s', (locale) => {
  const t = makeT(locale);

  it('pays for "Open-match tickets × 2", not a court', () => {
    const screen = renderRoute(PayStatusScreen, {
      locale,
      session: 'in',
      params: { ref: REF },
      queryData: [...VENUE, [depositKeys.status(REF), ticketStatus()]],
    });
    try {
      expect(screen.getByTestId('pay-status.open-again')).toBeTruthy();
      expect(
        screen.getByText(
          `${t('matches.pay.summaryTitle')} ${t('matches.pay.summaryCount', { count: isolateLtr('2') })}`,
        ),
      ).toBeTruthy();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('says the tickets are in, and opens the wallet', () => {
    const screen = renderRoute(PayStatusScreen, {
      locale,
      session: 'in',
      params: { ref: REF },
      queryData: [...VENUE, [depositKeys.status(REF), ticketStatus({ status: 'succeeded' })]],
    });
    try {
      expect(screen.getByTestId('pay-status.state.ticketsBought')).toBeTruthy();
      expect(
        within(screen.getByTestId('pay-status.view-tickets')).getByText(t('matches.pay.viewTickets')),
      ).toBeTruthy();
      expect(
        screen.getByText(
          t('matches.pay.ticketsBoughtBody', { tickets: countPhrase('matches.count.tickets', 2, locale) }),
        ),
      ).toBeTruthy();
      // No booking to confirm, no desk to pay at.
      expect(screen.queryByTestId('pay-status.pay-at-desk')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('offers a failed purchase a new attempt and a way back, never the desk', () => {
    const screen = renderRoute(PayStatusScreen, {
      locale,
      session: 'in',
      params: { ref: REF },
      queryData: [
        ...VENUE,
        [depositKeys.status(REF), ticketStatus({ status: 'failed', failureCode: 'declined' })],
      ],
    });
    try {
      expect(within(screen.getByTestId('pay-status.try-again')).getByText(t('deposit.tryAgain'))).toBeTruthy();
      expect(within(screen.getByTestId('pay-status.back')).getByText(t('common.back'))).toBeTruthy();
      expect(screen.queryByTestId('pay-status.pay-at-desk')).toBeNull();
      expect(screen.queryByTestId('pay-status.choose-another-time')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows the wallet: the count ready, what is held, a purchase in progress', () => {
    const screen = renderRoute(TicketsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...VENUE,
        [
          matchKeys.tickets,
          myTicketsFixture({
            available: 2,
            reserved: 1,
            pending: {
              requestId: REF,
              status: 'pending',
              ticketCount: 1,
              amountIqd: 10000,
              formUrl: null,
              deadlineAt: null,
            },
          }),
        ],
      ],
    });
    try {
      expect(screen.getByText(countPhrase('matches.count.ticketsReady', 2, locale))).toBeTruthy();
      expect(screen.getByText(countPhrase('matches.count.ticketsHeld', 1, locale))).toBeTruthy();
      expect(screen.getByTestId('tickets.pending')).toBeTruthy();
      expect(screen.getByTestId('tickets.buy')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('puts the wallet limit in place of the buy card when the wallet is full', () => {
    const screen = renderRoute(TicketsScreen, {
      locale,
      session: 'in',
      queryData: [...VENUE, [matchKeys.tickets, myTicketsFixture({ available: 9, maxAvailable: 9 })]],
    });
    try {
      expect(screen.queryByTestId('tickets.buy')).toBeNull();
      expect(screen.getByText(t('matches.errors.walletLimit'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

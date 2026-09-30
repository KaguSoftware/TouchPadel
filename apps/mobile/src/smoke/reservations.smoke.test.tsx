/**
 * Open matches in My Reservations, the booking history and Profile
 * (docs/design/open-matches/guest.md §4.16), in EN and AR. The screens' own
 * table cases live in tabs.smoke.test.tsx and booking.smoke.test.tsx, seeded
 * with no matches; these renders seed `my_matches` rows and a wallet, so the
 * match rows, the wallet line and the Profile entries are drawn for real.
 *
 * No table case here: every route below is cased by its own suite, and
 * `src/navigation/__tests__/smokeCoverage.test.ts` wants each named by exactly
 * one.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { renderRoute } from '../test/smoke';
import {
  TEST_MATCH_ID,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  myMatchRowFixture,
  myMatchesFixture,
  myTicketsFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { bookingKeys } from '../features/booking/hooks';
import { matchKeys } from '../features/matches/keys';
import { profileKeys } from '../features/profile/hooks';
import BookingsScreen from '../../app/(tabs)/bookings';
import ProfileScreen from '../../app/(tabs)/profile';
import BookingHistoryScreen from '../../app/booking-history';

const VENUE: [readonly unknown[], unknown][] = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: true })],
  [availabilityKeys.allCourts, [courtFixture()]],
];

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('open matches in My Reservations in %s', (locale) => {
  const t = makeT(locale);

  it('lists a filling match under OPEN MATCHES, with the wallet line', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...VENUE,
        [bookingKeys.mine, []],
        [matchKeys.mine('upcoming'), myMatchesFixture([myMatchRowFixture()])],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      expect(screen.getByText(t('matches.reservations.openMatches'))).toBeTruthy();
      expect(screen.getByTestId(`bookings.match.${TEST_MATCH_ID}`)).toBeTruthy();
      expect(
        within(screen.getByTestId('bookings.tickets')).getByText(
          t('matches.tickets.walletLine', { ready: countPhrase('matches.count.ticketsReady', 2, locale) }),
        ),
      ).toBeTruthy();
      // A match still filling is something to show: not the empty state.
      expect(screen.queryByTestId('bookings.empty')).toBeNull();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('makes a booked match the next game, opening the match', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...VENUE,
        [bookingKeys.mine, []],
        [
          matchKeys.mine('upcoming'),
          myMatchesFixture([myMatchRowFixture({ status: 'booked', seatsTaken: 4, courtId: courtFixture().id })]),
        ],
      ],
    });
    try {
      expect(
        within(screen.getByTestId('bookings.next-up')).getByText(t('matches.reservations.viewMatch')),
      ).toBeTruthy();
      expect(screen.queryByText(t('matches.reservations.openMatches'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('keeps a played match in the history', () => {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const played = myMatchRowFixture({
      status: 'played',
      seatsTaken: 4,
      startAt: start.toISOString(),
      endAt: new Date(start.getTime() + 90 * 60 * 1000).toISOString(),
      mySeats: [{ ...myMatchRowFixture().mySeats[0]!, status: 'attended', ticketStatus: 'available' }],
    });
    const screen = renderRoute(BookingHistoryScreen, {
      locale,
      session: 'in',
      queryData: [
        ...VENUE,
        [bookingKeys.mine, []],
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.mine('past'), myMatchesFixture([played])],
      ],
    });
    try {
      expect(screen.getByTestId(`booking-history.match.${TEST_MATCH_ID}`)).toBeTruthy();
      expect(screen.getByTestId('booking-history.clear')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('offers the ticket wallet and the blocked players from Profile', () => {
    const screen = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      queryData: [...VENUE, [profileKeys.own, profileFixture()]],
    });
    try {
      expect(within(screen.getByTestId('profile.tickets')).getByText(t('profile.tickets'))).toBeTruthy();
      expect(
        within(screen.getByTestId('profile.blocked-players')).getByText(t('profile.blockedPlayers')),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

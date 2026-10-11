/**
 * The tournament seating board and the tournament rows in My reservations (play-coaches contracts
 * §1, §5), in EN and AR. See `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * No table case here: `tournament/[id]` is cased by tournaments.smoke.test.tsx and
 * `(tabs)/bookings` by tabs.smoke.test.tsx, and `src/navigation/__tests__/smokeCoverage.test.ts`
 * wants each route named by exactly one suite. These renders seed the PARSED reads of
 * `src/test/tournamentsFixtures.ts`, so the board and the rows are drawn from real shapes.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { isolateLtr, makeT, type Locale } from '@touch/i18n';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_VENUE_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  myMatchesFixture,
  myTicketsFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import {
  TOUR_ID,
  TOUR_ID_2,
  entriesFixture,
  openTournamentFixture,
  tournamentListItemFixture,
  tournamentPublicFixture,
  tournamentsPublicFixture,
} from '../test/tournamentsFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { bookingKeys } from '../features/booking/hooks';
import { matchKeys } from '../features/matches/keys';
import { profileKeys } from '../features/profile/hooks';
import { tournamentKeys } from '../features/tournaments/keys';
import { parseTournamentPublic, parseTournamentsPublic } from '../features/tournaments/logic';
import TournamentDetailScreen from '../../app/(tournaments)/tournament/[id]';
import BookingsScreen from '../../app/(tabs)/bookings';

type Seeds = [readonly unknown[], unknown][];

const venue = (on = true): Seeds => [
  [availabilityKeys.branches, [branchFixture({ tournaments_enabled: on })]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ tournaments_enabled: on })],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.degraded(TEST_VENUE_ID), false],
];

const detailSeeds = (raw: Record<string, unknown>): Seeds => [
  ...venue(),
  [profileKeys.own, profileFixture()],
  [tournamentKeys.one(TOUR_ID), parseTournamentPublic(raw, TOUR_ID)],
];

const BOARD = 'tournament-detail.seating';
const chair = (court: number, n: number) => `${BOARD}.court.${court}.chair.${n}`;

const HOUR = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const mine = (status: string) => ({ entry_id: `e-${status}`, status, waitlist_position: null });

const bookingsSeeds = (tournaments: unknown[], bookings: unknown[] = []): Seeds => [
  ...venue(),
  [bookingKeys.mine, bookings],
  [matchKeys.mine('upcoming'), myMatchesFixture()],
  [matchKeys.tickets, myTicketsFixture()],
  [tournamentKeys.list, parseTournamentsPublic(tournamentsPublicFixture({ tournaments }))],
];

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('the seating board in %s', (locale) => {
  const t = makeT(locale);
  const court = (no: number) => t('tournaments.guest.detail.court', { no: isolateLtr(String(no)) });

  it('seats the entries in order on ceil(max / 4) courts, with the format’s caption', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture()),
    });
    try {
      const board = screen.getByTestId(BOARD);
      expect(within(board).getByText(t('seating.title'))).toBeTruthy();
      expect(within(board).getByText(t('seating.caption.americano'))).toBeTruthy();
      expect(within(board).getByText(t('seating.tapHint'))).toBeTruthy();
      // 16 places: four courts, the fifth never drawn.
      expect(screen.getByTestId(chair(4, 4))).toBeTruthy();
      expect(screen.queryByTestId(chair(5, 1))).toBeNull();
      // Entry 1 on court 1 side A, entry 10 on court 3 chair 2, the rest open.
      expect(within(screen.getByTestId(chair(1, 1))).getByText('Ali K.')).toBeTruthy();
      expect(
        within(screen.getByTestId(chair(2, 1))).getByText(
          t('tournaments.common.player', { no: isolateLtr('5') }),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(chair(3, 3))).getByText(t('seating.chair.open')),
      ).toBeTruthy();
      // Never colour alone: the reader hears the court, the chair and who sits there.
      expect(screen.getByTestId(chair(1, 1)).props.accessibilityLabel).toBe(
        t('seating.chairA11y', { court: court(1), chair: isolateLtr('1'), who: 'Ali K.' }),
      );
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('a tap on an open chair runs Register: signed out, it goes to the welcome', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'out',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture()),
    });
    try {
      const open = screen.getByTestId(chair(3, 3));
      expect(open.props.accessibilityLabel).toContain(t('seating.registerHint'));
      fireEvent.press(open);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
    } finally {
      screen.unmount();
    }
  });

  it('shows the guest’s own chair as "You", and open chairs only read once entered', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(
        openTournamentFixture({
          entries: entriesFixture(10, 5),
          me: { entry_id: 'e', status: 'registered', waitlist_position: null, owed_iqd: 0 },
        }),
      ),
    });
    try {
      expect(
        within(screen.getByTestId(chair(2, 2))).getByText(t('seating.chair.mine')),
      ).toBeTruthy();
      expect(screen.getByText(t('seating.ownCourt', { court: court(2) }))).toBeTruthy();
      expect(screen.getByText(t('seating.order'))).toBeTruthy();
      // Entered already: an open chair is a label, not a button.
      expect(screen.getByTestId(chair(3, 3)).props.accessibilityRole).toBeUndefined();
      expect(screen.getByTestId('tournament-detail.withdraw')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a full board offers the waitlist on the footer, as before', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(
        openTournamentFixture({
          max_entries: 8,
          entries_count: 8,
          places_left: 0,
          entries: entriesFixture(8),
          format: 'mexicano',
        }),
      ),
    });
    try {
      expect(screen.getByText(t('seating.fullHint'))).toBeTruthy();
      expect(screen.getByText(t('seating.caption.mexicano'))).toBeTruthy();
      expect(
        within(screen.getByTestId('tournament-detail.register')).getByText(
          t('tournaments.guest.waitlist'),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('after the draw shows round 1’s real courts and who sits out', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(tournamentPublicFixture()),
    });
    try {
      const board = screen.getByTestId(BOARD);
      expect(within(board).getByText(t('seating.drawTitle'))).toBeTruthy();
      expect(within(board).getByText(t('seating.sitOut'))).toBeTruthy();
      // Omar H. (seed 3, the guest's entry) plays on side B of court 1.
      expect(
        within(screen.getByTestId(chair(1, 3))).getByText(t('seating.chair.mine')),
      ).toBeTruthy();
      expect(within(screen.getByTestId(chair(1, 1))).getByText('Ali K.')).toBeTruthy();
      expect(screen.queryByTestId(chair(2, 1))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('folds a big board to four courts, with a way to show them all', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture({ max_entries: 64, places_left: 54 })),
    });
    try {
      expect(screen.queryByTestId(chair(5, 1))).toBeNull();
      const more = screen.getByTestId(`${BOARD}.more`);
      expect(
        within(more).getByText(t('seating.showAll', { count: isolateLtr('16') })),
      ).toBeTruthy();
      fireEvent.press(more);
      expect(screen.getByTestId(chair(16, 4))).toBeTruthy();
      expect(
        within(screen.getByTestId(`${BOARD}.more`)).getByText(t('seating.showFewer')),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

describe.each(LOCALES)('tournaments in My reservations in %s', (locale) => {
  const t = makeT(locale);

  it('makes the next tournament the hero, opening it', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: bookingsSeeds([tournamentListItemFixture()]),
    });
    try {
      const hero = screen.getByTestId('bookings.next-up');
      expect(within(hero).getByText(t('seating.viewTournament'))).toBeTruthy();
      expect(
        within(hero).getByText(locale === 'ar' ? 'أمريكانو الجمعة' : 'Friday Americano'),
      ).toBeTruthy();
      // An entry is something to show: the chips, not the empty state.
      expect(screen.queryByTestId('bookings.empty')).toBeNull();
      expect(
        within(screen.getByTestId('bookings.filter.upcoming')).getByText(
          t('booking.upcomingCount', { count: 1 }),
        ),
      ).toBeTruthy();
      fireEvent.press(hero);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/tournament/[id]', params: { id: TOUR_ID } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('lists a later tournament among the upcoming bookings, waitlist and all', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: bookingsSeeds(
        [
          tournamentListItemFixture({
            starts_at: at(120),
            ends_at: at(123),
            mine: { entry_id: 'e', status: 'waitlisted', waitlist_position: 2 },
          }),
        ],
        [bookingFixture()],
      ),
    });
    try {
      const row = screen.getByTestId(`bookings.tournament.${TOUR_ID}`);
      expect(within(row).getByText(t('booking.statusPending'))).toBeTruthy();
      expect(
        within(screen.getByTestId('bookings.filter.upcoming')).getByText(
          t('booking.upcomingCount', { count: 2 }),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('files a played tournament under Played and a withdrawal under Cancelled', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: bookingsSeeds([
        tournamentListItemFixture({
          status: 'finished',
          starts_at: at(-30),
          ends_at: at(-27),
          mine: mine('registered'),
        }),
        tournamentListItemFixture({ id: TOUR_ID_2, mine: mine('withdrawn') }),
      ]),
    });
    try {
      expect(screen.queryByTestId(`bookings.tournament.${TOUR_ID}`)).toBeNull();
      fireEvent.press(screen.getByTestId('bookings.filter.played'));
      expect(screen.getByTestId(`bookings.tournament.${TOUR_ID}`)).toBeTruthy();
      fireEvent.press(screen.getByTestId('bookings.filter.cancelled'));
      const left = screen.getByTestId(`bookings.tournament.${TOUR_ID_2}`);
      expect(
        within(left).getByText(t('tournaments.common.entryStatus.withdrawn'), { exact: false }),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('reads nothing while no branch has tournaments on', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...venue(false),
        [bookingKeys.mine, [bookingFixture()]],
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.tickets, myTicketsFixture()],
        [tournamentKeys.list, parseTournamentsPublic(tournamentsPublicFixture())],
      ],
    });
    try {
      expect(screen.queryByTestId(`bookings.tournament.${TOUR_ID}`)).toBeNull();
      expect(
        within(screen.getByTestId('bookings.next-up')).getByText(t('booking.viewBooking')),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

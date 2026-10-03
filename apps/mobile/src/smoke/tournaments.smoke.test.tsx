/**
 * Tournaments, the guest's side (tournaments plan §5.2). See `src/smoke/auth.smoke.test.tsx` for
 * what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the PARSED reads of `src/test/tournamentsFixtures.ts` (built from the
 * `TOURNAMENT_SHAPES` key lists) under their `tournamentKeys`, so the first render draws real
 * content: the list on Upcoming, and an open tournament the guest has not entered (Register).
 *
 * After the table cases, the states a first render cannot show under the route's one primary:
 * the list opened on Mine, every branch switched off, a full tournament's waitlist, a registered
 * guest's Withdraw and money owed, play under way (the standings and the schedule), a missing
 * tournament, a signed-out Register, the Book tab's entry row and Profile's "My tournaments".
 * None of those names a `route:` (each route is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { useState } from 'react';
import { Animated } from 'react-native';
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { formatIQD, isolate, isolateLtr, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import {
  TOUR_ID,
  TOUR_ID_2,
  openTournamentFixture,
  tournamentPublicFixture,
  tournamentsPublicFixture,
} from '../test/tournamentsFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { listBookableDates } from '../features/availability/assemble';
import { profileKeys } from '../features/profile/hooks';
import { tournamentKeys } from '../features/tournaments/keys';
import { parseTournamentPublic, parseTournamentsPublic } from '../features/tournaments/logic';
import { BookingSheet } from '../components/BookingSheet';
import TournamentsScreen from '../../app/tournaments';
import TournamentDetailScreen from '../../app/tournament/[id]';
import ProfileScreen from '../../app/(tabs)/profile';

type Seeds = [readonly unknown[], unknown][];

/** One open branch with tournaments on (or off). */
const venue = (on = true): Seeds => [
  [availabilityKeys.branches, [branchFixture({ tournaments_enabled: on })]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ tournaments_enabled: on })],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.degraded(TEST_VENUE_ID), false],
];

const listSeeds = (over: Record<string, unknown> = {}): Seeds => [
  ...venue(),
  [tournamentKeys.list, parseTournamentsPublic(tournamentsPublicFixture(over))],
];

const detailSeeds = (raw: Record<string, unknown>, id = TOUR_ID): Seeds => [
  ...venue(),
  [profileKeys.own, profileFixture()],
  [tournamentKeys.one(id), parseTournamentPublic(raw, id)],
];

const CASES: SmokeCase[] = [
  {
    route: 'tournaments',
    Component: TournamentsScreen,
    // A list primary carries no text of its own: the filter is beside it.
    nearbyKey: 'tournaments.guest.list.upcoming',
    options: { session: 'out', queryData: listSeeds() },
  },
  {
    route: 'tournament-detail',
    Component: TournamentDetailScreen,
    labelKey: 'tournaments.guest.register',
    options: {
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture()),
    },
  },
];

runSmokeCases('tournaments, the guest side', CASES);

// ── The states a first render cannot show under the primary ─────────────────

const LOCALES: Locale[] = ['en', 'ar'];

/** The booking sheet, open and at rest, as the Book tab mounts it. */
function Sheet() {
  const [progress] = useState(() => new Animated.Value(1));
  return (
    <BookingSheet testID="book.sheet" progress={progress} direction={1} bottomInset={0} isOpen />
  );
}

function sheetSeeds(on: boolean): Seeds {
  const settings = venueSettingsFixture({ tournaments_enabled: on });
  const strip = listBookableDates(new Date(), 'Asia/Baghdad', 6, settings);
  return [
    [availabilityKeys.branches, [branchFixture({ tournaments_enabled: on })]],
    [availabilityKeys.settings(TEST_VENUE_ID), settings],
    [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
    [availabilityKeys.rates(TEST_VENUE_ID), []],
    [availabilityKeys.ratePrices, []],
    [availabilityKeys.window(TEST_VENUE_ID, strip[0]!, strip[strip.length - 1]!), []],
  ];
}

describe.each(LOCALES)('tournament states in %s', (locale) => {
  const t = makeT(locale);
  const money = (n: number) => isolate(formatIQD(n, locale));

  it('lists the guest’s own entries on Mine, opened from Profile’s `?filter=mine`', () => {
    const screen = renderRoute(TournamentsScreen, {
      locale,
      session: 'in',
      params: { filter: 'mine' },
      queryData: listSeeds(),
    });
    try {
      expect(screen.getByTestId(`tournaments.row.${TOUR_ID}`)).toBeTruthy();
      expect(screen.queryByTestId(`tournaments.row.${TOUR_ID_2}`)).toBeNull();
      expect(
        within(screen.getByTestId(`tournaments.row.${TOUR_ID}`)).getByText(
          t('tournaments.common.entryStatus.registered'),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows the notice and no list while every branch has tournaments off', () => {
    const screen = renderRoute(TournamentsScreen, {
      locale,
      session: 'out',
      queryData: [...venue(false), [tournamentKeys.list, parseTournamentsPublic({ off: true })]],
    });
    try {
      expect(screen.getByTestId('tournaments.off')).toBeTruthy();
      expect(screen.getByText(t('tournaments.guest.list.off'))).toBeTruthy();
      expect(screen.queryByTestId('tournaments.list')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('offers the waitlist on Register’s id when no place is left', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture({ places_left: 0 })),
    });
    try {
      expect(
        within(screen.getByTestId('tournament-detail.register')).getByText(
          t('tournaments.guest.waitlist'),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('offers a registered guest Withdraw and says what the desk takes on the day', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(
        openTournamentFixture({
          me: { entry_id: 'e', status: 'registered', waitlist_position: null, owed_iqd: 15000 },
        }),
      ),
    });
    try {
      expect(screen.queryByTestId('tournament-detail.register')).toBeNull();
      expect(
        within(screen.getByTestId('tournament-detail.withdraw')).getByText(
          t('tournaments.guest.withdraw'),
        ),
      ).toBeTruthy();
      expect(
        screen.getByText(t('tournaments.guest.owedAtDesk', { amount: money(15000) })),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows the standings and the schedule once play is under way, with no action', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(tournamentPublicFixture()),
    });
    try {
      expect(screen.getByText(t('tournaments.guest.detail.standings'))).toBeTruthy();
      expect(screen.getByText(t('tournaments.guest.detail.schedule'))).toBeTruthy();
      expect(
        screen.getByText(t('tournaments.common.round', { round: isolateLtr('1') })),
      ).toBeTruthy();
      expect(
        screen.getAllByText(t('tournaments.common.formerPlayer'), { exact: false }).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByTestId('tournament-detail.register')).toBeNull();
      expect(screen.queryByTestId('tournament-detail.withdraw')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('reads one "not available" state for a missing tournament', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'out',
      params: { id: TOUR_ID },
      queryData: detailSeeds({ missing: true }),
    });
    try {
      expect(screen.getByTestId('tournament-detail.not-found')).toBeTruthy();
      expect(screen.getByText(t('tournaments.guest.detail.notFound'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('sends a signed-out Register to the welcome', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'out',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture()),
    });
    try {
      fireEvent.press(screen.getByTestId('tournament-detail.register'));
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
    } finally {
      screen.unmount();
    }
  });

  it('the Book tab’s sheet has "Tournaments" only while the branch has tournaments on', () => {
    // Tomorrow, which has times whatever the hour the suite runs at: the rows sit under the lanes.
    const tomorrow = listBookableDates(new Date(), 'Asia/Baghdad', 6, venueSettingsFixture())[1]!;
    const off = renderRoute(Sheet, { locale, queryData: sheetSeeds(false) });
    fireEvent.press(off.getByTestId(`book.sheet.day.${tomorrow}`));
    try {
      expect(off.queryByTestId('book.sheet.tournaments')).toBeNull();
    } finally {
      off.unmount();
    }
    const on = renderRoute(Sheet, { locale, queryData: sheetSeeds(true) });
    fireEvent.press(on.getByTestId(`book.sheet.day.${tomorrow}`));
    try {
      const row = on.getByTestId('book.sheet.tournaments');
      expect(within(row).getByText(t('tournaments.guest.entry.book'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/tournaments' });
    } finally {
      on.unmount();
    }
  });

  it('Profile shows "My tournaments" while a branch has tournaments on, and opens Mine', () => {
    const seeds = (on: boolean): Seeds => [
      [profileKeys.own, profileFixture()],
      [availabilityKeys.branches, [branchFixture({ tournaments_enabled: on })]],
      [availabilityKeys.settings(TEST_VENUE_ID), null],
    ];
    const off = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(false) });
    try {
      expect(off.queryByTestId('profile.my-tournaments')).toBeNull();
    } finally {
      off.unmount();
    }
    const on = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(true) });
    try {
      const row = on.getByTestId('profile.my-tournaments');
      expect(within(row).getByText(t('tournaments.guest.entry.mine'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/tournaments', params: { filter: 'mine' } },
      });
    } finally {
      on.unmount();
    }
  });
});

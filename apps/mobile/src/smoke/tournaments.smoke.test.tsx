/**
 * Tournaments, the guest's side (tournaments plan §5.2). See `src/smoke/auth.smoke.test.tsx` for
 * what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the PARSED reads of `src/test/tournamentsFixtures.ts` (built from the
 * `TOURNAMENT_SHAPES` key lists) under their `tournamentKeys`, so the first render draws real
 * content: an open tournament the guest has not entered (Register). The list is the Play tab's
 * (play.smoke.test.tsx).
 *
 * After the table cases, the states a first render cannot show under the route's one primary:
 * a full tournament's waitlist, a registered guest's Withdraw and money owed, play under way (the
 * standings and the schedule), a missing tournament, a signed-out Register and Profile's "My
 * tournaments".
 * None of those names a `route:` (each route is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { formatIQD, isolate, isolateLtr, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { tournamentsOnForFile } from '../test/tournamentsEnv';
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
  openTournamentFixture,
  tournamentPublicFixture,
} from '../test/tournamentsFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { tournamentKeys } from '../features/tournaments/keys';
import { parseTournamentPublic } from '../features/tournaments/logic';
import TournamentsLayout from '../../app/(tournaments)/_layout';
import TournamentDetailScreen from '../../app/(tournaments)/tournament/[id]';
import ProfileScreen from '../../app/profile';

// Tournaments ship in this file's build (features/tournaments/shipped.ts); the store build leaves them out.
tournamentsOnForFile();

type Seeds = [readonly unknown[], unknown][];

/** One open branch with tournaments on (or off). */
const venue = (on = true): Seeds => [
  [availabilityKeys.branches, [branchFixture({ tournaments_enabled: on })]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ tournaments_enabled: on })],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.degraded(TEST_VENUE_ID), false],
];

const detailSeeds = (
  raw: Record<string, unknown>,
  id = TOUR_ID,
  play: Record<string, unknown> = {},
): Seeds => [
  ...venue(),
  [profileKeys.own, { ...profileFixture(), ...play }],
  [tournamentKeys.one(id), parseTournamentPublic(raw, id)],
];

/** A guest's play survey answers on the own-profile row (0334), for 0339's fit. */
const answered = (level: string | null, years: string | null) => ({
  play_level: level,
  play_years: years,
  play_wants: null,
  play_survey_at: '2026-10-12T18:00:00.000Z',
});

const CASES: SmokeCase[] = [
  // The group's own stack: a todo in the table (it needs a live router).
  {
    route: 'tournaments-stack',
    Component: TournamentsLayout,
    labelKey: 'tournaments.guest.list.title',
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

describe.each(LOCALES)('tournament states in %s', (locale) => {
  const t = makeT(locale);
  const money = (n: number) => isolate(formatIQD(n, locale));

  // 0339: the fixture is class B (intermediate), and here 1 to 3 years.
  const forB = { class: 'B', play_years: 'one_to_three' };

  it('registers a guest the tournament is for', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture(forB), TOUR_ID, answered('intermediate', 'one_to_three')),
    });
    try {
      expect(screen.getByTestId('tournament-detail.register')).toBeTruthy();
      expect(screen.queryByTestId('tournament-detail.not-for-you')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('says why in place of Register for a guest of another level or years', () => {
    for (const [level, years, key] of [
      ['advanced', 'one_to_three', 'tournaments.guest.errors.levelMismatch'],
      ['intermediate', 'three_plus', 'tournaments.guest.errors.yearsMismatch'],
    ] as const) {
      const screen = renderRoute(TournamentDetailScreen, {
        locale,
        session: 'in',
        params: { id: TOUR_ID },
        queryData: detailSeeds(openTournamentFixture(forB), TOUR_ID, answered(level, years)),
      });
      try {
        expect(screen.queryByTestId('tournament-detail.register')).toBeNull();
        expect(within(screen.getByTestId('tournament-detail.not-for-you')).getByText(t(key))).toBeTruthy();
      } finally {
        screen.unmount();
      }
    }
  });

  it('asks a guest who skipped the years question to answer it first', () => {
    const screen = renderRoute(TournamentDetailScreen, {
      locale,
      session: 'in',
      params: { id: TOUR_ID },
      queryData: detailSeeds(openTournamentFixture(forB), TOUR_ID, answered('intermediate', null)),
    });
    try {
      expect(screen.queryByTestId('tournament-detail.register')).toBeNull();
      expect(screen.getByText(t('tournaments.guest.errors.profileRequired'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('tournament-detail.answer'));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/play-survey', params: { mode: 'edit' } },
      });
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

  it('Profile shows "My tournaments" while a branch has tournaments on, and opens My reservations', () => {
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
      // My reservations lists the tournaments now (play-coaches contracts §1).
      expect(routerState.calls).toContainEqual({ method: 'navigate', arg: '/bookings' });
    } finally {
      on.unmount();
    }
  });
});

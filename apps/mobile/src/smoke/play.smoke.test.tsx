/**
 * The Play tab (docs/design/play-coaches/contracts-2026-10-11.md §7): open
 * matches and tournaments on one timeline. See `src/smoke/auth.smoke.test.tsx`
 * for what a case asserts and `src/test/smokeCase.tsx` for how.
 *
 * The route case seeds one branch with open matches on, its one listed match
 * (`openMatchesFixture`, two days out) and the two tournaments of
 * `tournamentsPublicFixture`, so the first render draws the mixed timeline and
 * its "Start a match".
 *
 * After it, what one render cannot show under that primary: both kinds on the
 * page with their own ids and the night's line, the list's banned and
 * switched-off notices (moved here from matches.smoke.test.tsx with the list),
 * a branch with only tournaments, `show=tournaments`, a signed-out guest
 * browsing (a match card keeps the time for after sign-in), a tournament tap,
 * the empty page and "Start a match" opening the Book sheet.
 */
import { describe, expect, it } from '@jest/globals';
import { fireEvent, within } from '@testing-library/react-native';
import { countPhrase, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_MATCH_ID,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  matchSlotsFixture,
  openMatchesFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { TOUR_ID, TOUR_ID_2, tournamentsPublicFixture } from '../test/tournamentsFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { matchKeys } from '../features/matches/keys';
import { guestWindow } from '../features/matches/logic';
import { clearPendingJoin, getPendingJoin } from '../features/matches/pendingJoin';
import { takeBookingSheetRequest } from '../features/courtTransition/openIntent';
import { tournamentKeys } from '../features/tournaments/keys';
import { parseTournamentsPublic } from '../features/tournaments/logic';
import PlayScreen from '../../app/(tabs)/play';

type Seeds = [readonly unknown[], unknown][];
const TZ = 'Asia/Baghdad';

const guestRange = () => guestWindow(new Date(), TZ);

/** One open branch, open matches on or off, and its courts. */
const venue = (matchesOn = true): Seeds => [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: matchesOn })],
  [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
];

const tours = (over: Record<string, unknown> = {}): Seeds => [
  [tournamentKeys.list, parseTournamentsPublic(tournamentsPublicFixture(over))],
];

const openSeeds = (open: unknown = openMatchesFixture()): Seeds => {
  const { from, to } = guestRange();
  return [[matchKeys.open(TEST_VENUE_ID, from, to), open]];
};

const slotSeeds = (): Seeds => {
  const { from, to } = guestRange();
  return [[matchKeys.slots(TEST_VENUE_ID, from, to), matchSlotsFixture()]];
};

const CASES: SmokeCase[] = [
  {
    route: 'play',
    Component: PlayScreen,
    labelKey: 'play.start',
    options: { session: 'in', queryData: [...venue(), ...openSeeds(), ...tours()] },
  },
];

runSmokeCases('the Play tab', CASES);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('Play states in %s', (locale) => {
  const t = makeT(locale);

  it('mixes the match and the tournaments on one timeline, each kind with its own card', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(), ...openSeeds(), ...tours()],
    });
    try {
      const match = within(screen.getByTestId(`play.match.${TEST_MATCH_ID}`));
      expect(match.getByText(countPhrase('matches.count.seatsLeft', 1, locale))).toBeTruthy();
      expect(match.getByText(t('matches.detail.join'))).toBeTruthy();
      // No names on a match card (GD-5).
      expect(match.queryByText(/Ahmed|Sara/)).toBeNull();
      const entered = within(screen.getByTestId(`play.tournament.${TOUR_ID}`));
      expect(entered.getByText(t('tournaments.common.entryStatus.registered'))).toBeTruthy();
      expect(screen.getByTestId(`play.tournament.${TOUR_ID_2}`)).toBeTruthy();
      // The match and the first tournament share a night (two days out).
      expect(
        screen.getByText(
          `${countPhrase('matches.count.openMatches', 1, locale)} · ${countPhrase('play.count.tournaments', 1, locale)}`,
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('play.kind')).toBeTruthy();
      expect(within(screen.getByTestId('play.filter.all')).getByText(t('matches.list.filterAll'))).toBeTruthy();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('tells a banned guest why there are no matches, with no way to start one', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(), ...openSeeds({ banned: true, matches: [] }), ...tours()],
    });
    try {
      expect(screen.getByText(t('matches.errors.banned'))).toBeTruthy();
      expect(screen.queryByTestId('play.start')).toBeNull();
      // Tournaments are not open matches: they stay.
      expect(screen.getByTestId(`play.tournament.${TOUR_ID}`)).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('says both are off when the branch has matches off and no branch runs tournaments', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(false), [tournamentKeys.list, parseTournamentsPublic({ off: true })]],
    });
    try {
      expect(screen.getByTestId('play.off')).toBeTruthy();
      expect(screen.getByText(t('play.off'))).toBeTruthy();
      expect(screen.queryByTestId('play.start')).toBeNull();
      expect(screen.queryByTestId('play.kind')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows only the tournaments, with no switch, while open matches are off', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(false), ...tours()],
    });
    try {
      expect(screen.getByTestId(`play.tournament.${TOUR_ID}`)).toBeTruthy();
      expect(screen.queryByTestId('play.kind')).toBeNull();
      expect(screen.queryByTestId('play.start')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('opens on the tournaments for `show=tournaments`', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      params: { show: 'tournaments' },
      queryData: [...venue(), ...openSeeds(), ...tours()],
    });
    try {
      expect(screen.queryByTestId(`play.match.${TEST_MATCH_ID}`)).toBeNull();
      expect(screen.getByTestId(`play.tournament.${TOUR_ID}`)).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('lets a signed-out guest browse, and keeps the time a match card was tapped for', () => {
    const slot = matchSlotsFixture()[0]!;
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'out',
      queryData: [...venue(), ...slotSeeds(), ...tours()],
    });
    try {
      const card = screen.getByTestId(`play.slot.${Date.parse(slot.startAt)}-0`);
      expect(within(card).getByText(t('matches.link.signIn'))).toBeTruthy();
      fireEvent.press(card);
      expect(getPendingJoin()).toEqual({ kind: 'slot', venueId: TEST_VENUE_ID, startAt: slot.startAt });
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
      expect(screen.getByTestId(`play.tournament.${TOUR_ID}`)).toBeTruthy();
    } finally {
      screen.unmount();
      clearPendingJoin();
    }
  });

  // 0339: both fixture tournaments are class B (intermediate); TOUR_ID is entered.
  const withPlay = (level: string | null, years: string | null) =>
    [
      profileKeys.own,
      {
        ...profileFixture(),
        play_level: level,
        play_years: years,
        play_wants: null,
        play_survey_at: '2026-10-12T18:00:00.000Z',
      },
    ] as [readonly unknown[], unknown];

  it('lists only the tournaments a guest is for, and always the one they entered', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(false), ...tours(), withPlay('advanced', 'three_plus')],
    });
    try {
      expect(screen.getByTestId(`play.tournament.${TOUR_ID}`)).toBeTruthy();
      expect(screen.queryByTestId(`play.tournament.${TOUR_ID_2}`)).toBeNull();
      expect(screen.queryByTestId('play.fit-ask')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows a guest who skipped their level every tournament, and asks for it', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...venue(false), ...tours(), withPlay(null, null)],
    });
    try {
      expect(screen.getByTestId(`play.tournament.${TOUR_ID_2}`)).toBeTruthy();
      const ask = screen.getByTestId('play.fit-ask');
      expect(within(ask).getByText(t('play.fitAsk'))).toBeTruthy();
      fireEvent.press(ask);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/play-survey', params: { mode: 'edit' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('opens a tournament from its card', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'out',
      queryData: [...venue(false), ...tours()],
    });
    try {
      fireEvent.press(screen.getByTestId(`play.tournament.${TOUR_ID_2}`));
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/tournament/[id]', params: { id: TOUR_ID_2 } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('teaches the next step on an empty page, and Start opens the Book sheet', () => {
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [
        ...venue(),
        ...openSeeds({ banned: false, matches: [] }),
        ...tours({ tournaments: [] }),
      ],
    });
    try {
      expect(screen.getByTestId('play.empty')).toBeTruthy();
      expect(screen.getByText(t('play.emptyBody'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('play.empty.start'));
      expect(takeBookingSheetRequest()).toBe(true);
      expect(routerState.calls).toContainEqual({ method: 'navigate', arg: '/(tabs)' });
    } finally {
      screen.unmount();
    }
  });
});

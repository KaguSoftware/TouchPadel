/**
 * The open-match screens (docs/design/open-matches/guest.md §4.27). See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the parsed fixtures of `src/test/fixtures.ts` under
 * their `matchKeys`, so the first render draws real content: a viewer's
 * instant match at 3/4 with two tickets (Join), a start the quote allows with a wallet that covers it, a signed-out invite
 * (`open`), a report and an empty block list. `tickets` is cased with the
 * payment screens, in deposit.smoke.test.tsx.
 *
 * After the table cases, the states a first render cannot show under the
 * route's one primary: the restricted card (R32), the organiser's requests,
 * the buy and gender cards, a member's booked match with its money and
 * quick messages, an ended match's §4.15 line, the link's closed and
 * restricted layouts, the gender ask and the short wallet on the new-match
 * form, and a blocked player. The list is the Play tab's (play.smoke.test.tsx).
 * Last, the booking gate on Start and Join (owner, 2026-09-29): a phone nobody
 * has verified goes to the code first, before any purchase too. Then the seat
 * count a poll lowers under the picked one (the join sends what the card
 * shows), the friends alert and the total, the chat and rules sheets, and
 * who may see Messages.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { countPhrase, formatIQD, isolate, isolateLtr, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { alertState, expectAlerted } from '../test/alertState';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_MATCH_ID,
  TEST_MATCH_TOKEN,
  TEST_VENUE_ID,
  branchFixture,
  courtFixture,
  matchDetailFixture,
  matchInviteFixture,
  matchQuoteFixture,
  matchRestrictedFixture,
  myBlocksFixture,
  myTicketsFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { supabase } from '../lib/supabase';
import { availabilityKeys } from '../features/availability/hooks';
import { profileKeys } from '../features/profile/hooks';
import { matchKeys } from '../features/matches/keys';
import type { MatchDetail } from '../features/matches/logic';
import MatchesLayout from '../../app/(matches)/_layout';
import MatchDetailScreen from '../../app/(matches)/match/[id]';
import MatchNewScreen from '../../app/(matches)/match-new';
import MatchLinkScreen from '../../app/m/[token]';
import MatchReportScreen from '../../app/(matches)/match-report';
import BlockedPlayersScreen from '../../app/blocked-players';
import { onlinePaymentsOnForFile } from '../test/onlinePaymentsEnv';

onlinePaymentsOnForFile();

const COURT_ID = courtFixture().id;

/** One open branch with open matches switched on, and its courts. */
const venue = (settings: Record<string, unknown> = {}): [readonly unknown[], unknown][] => [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: true, ...settings })],
  [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
  [availabilityKeys.allCourts, [courtFixture()]],
];

/** The new-match form's params, and its quote's key. */
const START_AT = matchDetailFixture().startAt;
const newParams = {
  venueId: TEST_VENUE_ID,
  courtId: COURT_ID,
  startAt: START_AT,
  durationMin: '90',
  priceIqd: '40000',
};
const quoteKey = matchKeys.quote(TEST_VENUE_ID, COURT_ID, START_AT, 90);

const detail = (over: Partial<MatchDetail> = {}) => ({
  session: 'in' as const,
  params: { id: TEST_MATCH_ID },
  queryData: [...venue(), [matchKeys.one(TEST_MATCH_ID, ''), matchDetailFixture(over)]] as [
    readonly unknown[],
    unknown,
  ][],
});

const CASES: SmokeCase[] = [
  // The group's own stack: a todo in the table (it needs a live router).
  {
    route: 'matches-stack',
    Component: MatchesLayout,
    labelKey: 'matches.list.title',
  },
  {
    route: 'match-detail',
    Component: MatchDetailScreen,
    labelKey: 'matches.detail.join',
    options: detail(),
  },
  {
    route: 'match-new',
    Component: MatchNewScreen,
    labelKey: 'matches.create.start',
    options: {
      session: 'in',
      params: newParams,
      queryData: [
        ...venue(),
        [quoteKey, matchQuoteFixture()],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    },
  },
  {
    route: 'match-link',
    Component: MatchLinkScreen,
    labelKey: 'matches.link.signIn',
    options: {
      session: 'out',
      params: { token: TEST_MATCH_TOKEN },
      queryData: [[matchKeys.invite(TEST_MATCH_TOKEN), matchInviteFixture()]],
    },
  },
  {
    route: 'match-report',
    Component: MatchReportScreen,
    labelKey: 'matches.report.submit',
    options: {
      session: 'in',
      params: { matchId: TEST_MATCH_ID, seatId: '77777777-7777-4777-8777-000000000003', name: 'Sara M.' },
    },
  },
  {
    route: 'blocked-players',
    Component: BlockedPlayersScreen,
    nearbyKey: 'matches.blocks.empty',
    options: { session: 'in', queryData: [[matchKeys.blocks, myBlocksFixture()]] },
  },
];

runSmokeCases('open matches', CASES);

const LOCALES: Locale[] = ['en', 'ar'];
/** Nothing granted: each case turns on what its viewer may do. */
const NO_CAN: MatchDetail['me']['can'] = {
  join: false,
  request: false,
  withdraw: false,
  leave: false,
  cancel: false,
  remove: false,
  decide: false,
  message: false,
  report: false,
  block: false,
  share: false,
};
const REQUEST_ID = '88888888-8888-4888-8888-000000000001';
const MY_SEAT = '77777777-7777-4777-8777-000000000004';

describe.each(LOCALES)('open-match states in %s', (locale) => {
  const t = makeT(locale);

  it('prints the seats as names, a friend as "+1", and the empty seat', () => {
    const screen = renderRoute(MatchDetailScreen, { locale, ...detail() });
    try {
      expect(within(screen.getByTestId('match-detail.seats.1')).getByText(isolate('Ahmed K.'))).toBeTruthy();
      expect(
        within(screen.getByTestId('match-detail.seats.2')).getByText(
          t('matches.common.friendSeat', { name: isolate('Ahmed K.'), extra: isolateLtr('+1') }),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('match-detail.seats.4')).getByText(t('matches.common.openSeat')),
      ).toBeTruthy();
      // A viewer has no seat menu: the server granted nothing on any seat.
      expect(screen.queryByTestId('match-detail.seats.1.menu')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows a restricted viewer the refusal and a way on, never the seats (R32)', () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      session: 'in',
      params: { id: TEST_MATCH_ID },
      queryData: [...venue(), [matchKeys.one(TEST_MATCH_ID, ''), matchRestrictedFixture()]],
    });
    try {
      expect(screen.getByTestId('match-detail.restricted')).toBeTruthy();
      expect(screen.getByText(t('matches.errors.genderMismatch'))).toBeTruthy();
      expect(within(screen.getByTestId('match-detail.find')).getByText(t('matches.link.findAnother'))).toBeTruthy();
      expect(screen.queryByTestId('match-detail.seats')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('offers the purchase when the wallet cannot cover a seat', () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...detail({ me: { ...matchDetailFixture().me, ticketsAvailable: 0, ticketsNeeded: 1 } }),
    });
    try {
      expect(screen.queryByTestId('match-detail.join')).toBeNull();
      expect(
        within(screen.getByTestId('match-detail.buy')).getByText(
          t('matches.detail.buyAndJoin', { tickets: countPhrase('matches.count.ticketsGen', 1, locale) }),
        ),
      ).toBeTruthy();
      // An empty wallet has its own sentence: the zero form never goes into
      // "You have {ready}." ("You have No tickets yet.").
      expect(screen.getByText(t('matches.detail.youHaveNone'))).toBeTruthy();
      expect(
        screen.queryByText(
          t('matches.detail.youHave', { ready: countPhrase('matches.count.ticketsReady', 0, locale) }),
        ),
      ).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('sends the guest to the questionnaire for the gender, in place of Join, when the server needs it', () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...detail({
        me: { ...matchDetailFixture().me, refusal: 'GENDER_REQUIRED', can: { ...NO_CAN, join: false } },
      }),
    });
    try {
      expect(screen.getByTestId('match-detail.gender')).toBeTruthy();
      // The question itself is the player questionnaire's (2026-10-12).
      expect(screen.queryByTestId('match-detail.gender.female')).toBeNull();
      const answer = screen.getByTestId('match-detail.gender.answer');
      expect(within(answer).getByText(t('matches.gender.answer'))).toBeTruthy();
      expect(screen.queryByTestId('match-detail.join')).toBeNull();
      fireEvent.press(answer);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/play-survey', params: { step: 'gender' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it("gives the organiser the requests, with games and no-shows, plus cancel", () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...detail({
        joinPolicy: 'approve',
        shareToken: TEST_MATCH_TOKEN,
        me: {
          ...matchDetailFixture().me,
          role: 'organiser',
          can: { ...NO_CAN, decide: true, share: true, cancel: true, leave: true },
        },
        requests: [
          {
            requestId: REQUEST_ID,
            name: 'Omar H.',
            former: false,
            seatsRequested: 1,
            friendGenders: [],
            gamesPlayed: 12,
            noShows: 1,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    try {
      const row = within(screen.getByTestId(`match-detail.request.${REQUEST_ID}`));
      expect(row.getByText(isolate('Omar H.'))).toBeTruthy();
      expect(
        row.getByText(
          t('matches.detail.requestLine', {
            games: countPhrase('matches.count.games', 12, locale),
            noShows: countPhrase('matches.count.noShows', 1, locale),
            seats: countPhrase('matches.count.seats', 1, locale),
          }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId(`match-detail.request.${REQUEST_ID}.approve`)).toBeTruthy();
      expect(screen.getByTestId(`match-detail.request.${REQUEST_ID}.decline`)).toBeTruthy();
      // Share lives in the header alone: no second button down the page.
      expect(screen.queryByTestId('match-detail.share')).toBeNull();
      expect(within(screen.getByTestId('match-detail.cancel')).getByText(t('matches.detail.cancel'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('tells a booked member what they pay at the desk, and opens the chat with three presets', () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...detail({
        status: 'booked',
        seatsTaken: 4,
        seatsLeft: 0,
        courtId: COURT_ID,
        me: {
          ...matchDetailFixture().me,
          role: 'player',
          seats: [
            {
              seatId: MY_SEAT,
              seatNo: 4,
              kind: 'account',
              status: 'in',
              endReason: null,
              shareIqd: 10000,
              requestId: null,
              ticketStatus: 'in_use',
            },
          ],
          leaveOutcome: 'locked_until_refill',
          can: { ...NO_CAN, leave: true, message: true },
        },
      }),
    });
    try {
      expect(screen.getByTestId('match-detail.leave')).toBeTruthy();
      expect(screen.getByText(t('matches.detail.moneyNote'))).toBeTruthy();
      // Messages is a row; the presets are in the sheet it opens.
      expect(screen.queryByTestId('match-detail.chat.send.on_my_way')).toBeNull();
      fireEvent.press(screen.getByTestId('match-detail.messages'));
      expect(screen.getByTestId('match-detail.chat.send.on_my_way')).toBeTruthy();
      expect(screen.getByTestId('match-detail.chat.send.running_late')).toBeTruthy();
      expect(screen.getByTestId('match-detail.chat.send.cant_make_it')).toBeTruthy();
      // "Who's bringing balls?" is held back: nothing in the set can answer it.
      expect(screen.queryByTestId('match-detail.chat.send.bring_balls')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it("reads an ended match's own line, with the ticket back (§4.15 row 22)", () => {
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...detail({
        status: 'bumped',
        endedReason: 'bumped',
        me: {
          ...matchDetailFixture().me,
          role: 'player',
          seats: [
            {
              seatId: MY_SEAT,
              seatNo: 4,
              kind: 'account',
              status: 'cancelled',
              endReason: 'match_ended',
              shareIqd: 10000,
              requestId: null,
              ticketStatus: 'available',
            },
          ],
          can: NO_CAN,
        },
      }),
    });
    try {
      const line = `${t('matches.states.bumped')} · ${countPhrase('matches.count.ticketsBack', 1, locale)}`;
      expect(within(screen.getByTestId('match-detail.action')).getByText(line)).toBeTruthy();
      expect(screen.queryByTestId('match-detail.join')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows a closed invite as closed, with a way to find another match', () => {
    const screen = renderRoute(MatchLinkScreen, {
      locale,
      session: 'out',
      params: { token: TEST_MATCH_TOKEN },
      queryData: [[matchKeys.invite(TEST_MATCH_TOKEN), { status: 'closed' }]],
    });
    try {
      expect(screen.getByText(t('matches.link.closed'))).toBeTruthy();
      expect(within(screen.getByTestId('match-link.find')).getByText(t('matches.link.find'))).toBeTruthy();
      expect(screen.queryByTestId('match-link.sign-in')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('treats a malformed token as closed without reading anything', () => {
    const screen = renderRoute(MatchLinkScreen, { locale, session: 'out', params: { token: 'short' } });
    try {
      expect(screen.getByTestId('match-link.find')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives a signed-in restricted link viewer the restricted card (R32)', () => {
    const screen = renderRoute(MatchLinkScreen, {
      locale,
      session: 'in',
      params: { token: TEST_MATCH_TOKEN },
      queryData: [
        [matchKeys.byToken(TEST_MATCH_TOKEN), matchRestrictedFixture({ refusal: 'MATCH_BANNED' })],
        [matchKeys.invite(TEST_MATCH_TOKEN), matchInviteFixture()],
      ],
    });
    try {
      expect(screen.getByTestId('match-link.restricted')).toBeTruthy();
      expect(screen.getByText(t('matches.errors.banned'))).toBeTruthy();
      expect(screen.getByTestId('match-link.find')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('asks the gender on the new-match form before anything else can be picked', () => {
    const screen = renderRoute(MatchNewScreen, {
      locale,
      session: 'in',
      params: newParams,
      queryData: [
        ...venue(),
        [quoteKey, matchQuoteFixture({ myGender: null, categories: ['open', 'women', 'men'] })],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      expect(screen.getByTestId('match-new.gender')).toBeTruthy();
      expect(screen.getByTestId('match-new.start').props.accessibilityState).toMatchObject({ disabled: true });
    } finally {
      screen.unmount();
    }
  });

  it('turns Start into a purchase when the wallet is short', () => {
    const screen = renderRoute(MatchNewScreen, {
      locale,
      session: 'in',
      params: newParams,
      queryData: [
        ...venue(),
        [quoteKey, matchQuoteFixture({ ticketsAvailable: 0 })],
        [matchKeys.tickets, myTicketsFixture({ available: 0 })],
      ],
    });
    try {
      expect(
        within(screen.getByTestId('match-new.start')).getByText(
          t('matches.create.buyAndStart', { tickets: countPhrase('matches.count.ticketsGen', 1, locale) }),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows a refused start as the refusal, with no Start', () => {
    const screen = renderRoute(MatchNewScreen, {
      locale,
      session: 'in',
      params: newParams,
      queryData: [
        ...venue(),
        [quoteKey, matchQuoteFixture({ refusal: 'MATCH_LIMIT_REACHED' })],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      expect(within(screen.getByTestId('match-new.refusal')).getByText(t('matches.errors.limitReached'))).toBeTruthy();
      expect(screen.queryByTestId('match-new.start')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  /** The new-match form with the guest's profile read, on a wallet of `available`. */
  const startForm = (session: 'in' | 'verified', available: number) =>
    renderRoute(MatchNewScreen, {
      locale,
      session,
      params: newParams,
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [quoteKey, matchQuoteFixture({ ticketsAvailable: available })],
        [matchKeys.tickets, myTicketsFixture({ available })],
      ],
    });
  const verifyBack = {
    method: 'push',
    arg: { pathname: '/phone-sign-in', params: { returnTo: 'back', phone: profileFixture().phone } },
  };
  const pushes = () => routerState.calls.filter((c) => c.method === 'push');

  it('sends an unverified Start to the phone step, even one that buys first', () => {
    for (const available of [2, 0]) {
      const screen = startForm('in', available);
      try {
        fireEvent.press(screen.getByTestId('match-new.start'));
        expect(pushes()).toEqual([verifyBack]);
      } finally {
        screen.unmount();
      }
    }
  });

  it('lets a verified Start go on, to the purchase when the wallet is short', () => {
    const screen = startForm('verified', 0);
    try {
      fireEvent.press(screen.getByTestId('match-new.start'));
      expect(pushes()).toEqual([
        { method: 'push', arg: { pathname: '/tickets', params: { buy: '1', for: 'start' } } },
      ]);
    } finally {
      screen.unmount();
    }
  });

  it('sends an unverified Join, and Buy and join, to the phone step', () => {
    const profile: [readonly unknown[], unknown] = [profileKeys.own, profileFixture()];
    const join = detail();
    const joinScreen = renderRoute(MatchDetailScreen, {
      locale,
      ...join,
      queryData: [...join.queryData, profile],
    });
    try {
      fireEvent.press(joinScreen.getByTestId('match-detail.join'));
      expect(pushes()).toEqual([verifyBack]);
    } finally {
      joinScreen.unmount();
    }
    const buy = detail({ me: { ...matchDetailFixture().me, ticketsAvailable: 0, ticketsNeeded: 1 } });
    const buyScreen = renderRoute(MatchDetailScreen, {
      locale,
      ...buy,
      queryData: [...buy.queryData, profile],
    });
    try {
      fireEvent.press(buyScreen.getByTestId('match-detail.buy'));
      expect(pushes()).toEqual([verifyBack]);
    } finally {
      buyScreen.unmount();
    }
  });

  it('lets a verified Buy and join go on to the purchase', () => {
    const buy = detail({ me: { ...matchDetailFixture().me, ticketsAvailable: 0, ticketsNeeded: 1 } });
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...buy,
      session: 'verified',
      queryData: [...buy.queryData, [profileKeys.own, profileFixture()]],
    });
    try {
      fireEvent.press(screen.getByTestId('match-detail.buy'));
      expect(pushes()).toEqual([
        { method: 'push', arg: { pathname: '/tickets', params: { buy: '1', for: 'join' } } },
      ]);
    } finally {
      screen.unmount();
    }
  });

  it('sends the seats the card shows when a poll lowers the seats left (OM-39)', async () => {
    // The case is about what was sent: `app.match_join` answers MATCH_FULL (a
    // pending mutation would hold a GC timer past the suite), every read waits.
    const rpc = jest.fn((fn: string, _args: Record<string, unknown>) =>
      fn === 'match_join'
        ? Promise.resolve({ data: null, error: { message: 'MATCH_FULL', details: null, hint: null, code: 'P0001' } })
        : new Promise<never>(() => {}),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const first = matchDetailFixture();
    const threeLeft = detail({ seatsTaken: 1, seatsLeft: 3, seats: first.seats.slice(0, 1) });
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...threeLeft,
      session: 'verified',
      queryData: [
        ...threeLeft.queryData,
        [profileKeys.own, profileFixture()],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      // Me + 2 on a wallet of two: one ticket short.
      fireEvent.press(screen.getByTestId('match-detail.seats-wanted.3'));
      expect(screen.getByTestId('match-detail.buy')).toBeTruthy();
      // The 20 s poll: two seats went, one is left, and the stepper with them.
      await act(async () => {
        screen.client.setQueryData(matchKeys.one(TEST_MATCH_ID, ''), first);
        // The query client tells the screen on a timer: let it fire inside act.
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(screen.queryByTestId('match-detail.seats-wanted')).toBeNull();
      fireEvent.press(screen.getByTestId('match-detail.join'));
      // One seat, no friends, and no purchase the screen never showed.
      expect(pushes()).toEqual([]);
      await waitFor(() =>
        expect(rpc).toHaveBeenCalledWith('match_join', { p_match_id: TEST_MATCH_ID, p_friends: [] }),
      );
      await expectAlerted(t('matches.errors.full'));
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('opens the rules in a sheet, with the explanations the screen no longer prints', () => {
    const screen = renderRoute(MatchDetailScreen, { locale, ...detail({ joinPolicy: 'approve' }) });
    try {
      // No hint lines on the screen itself.
      expect(screen.queryByText(t('matches.detail.infoShareBody'))).toBeNull();
      expect(screen.queryByText(t('matches.detail.infoCourtTitle'))).toBeNull();
      expect(screen.queryByTestId('match-detail.rules-sheet')).toBeNull();
      fireEvent.press(screen.getByTestId('match-detail.rules'));
      expect(screen.getByTestId('match-detail.rules-sheet')).toBeTruthy();
      expect(screen.getByText(t('matches.detail.infoShareBody'))).toBeTruthy();
      expect(screen.getByText(t('matches.detail.rulesCalledOff'))).toBeTruthy();
      expect(screen.getByText(t('matches.detail.askPayAtDesk'))).toBeTruthy();
      expect(screen.getByText(t('matches.detail.courtRule'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('match-detail.rules-sheet.done'));
      expect(screen.queryByTestId('match-detail.rules-sheet')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('keeps Messages from a guest who is not in the match', () => {
    const screen = renderRoute(MatchDetailScreen, { locale, ...detail() });
    try {
      expect(screen.queryByTestId('match-detail.messages')).toBeNull();
      expect(screen.queryByTestId('match-detail.chat')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('shows the total for the seats picked, over a full-width action', () => {
    const first = matchDetailFixture();
    const threeLeft = detail({ seatsTaken: 1, seatsLeft: 3, seats: first.seats.slice(0, 1) });
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...threeLeft,
      session: 'verified',
      queryData: [
        ...threeLeft.queryData,
        [profileKeys.own, profileFixture()],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      const bar = within(screen.getByTestId('match-detail.action'));
      expect(bar.getByText(t('matches.detail.total', { seats: countPhrase('matches.count.seats', 1, locale) }))).toBeTruthy();
      expect(bar.getByText(isolate(formatIQD(10000, locale)))).toBeTruthy();
      fireEvent.press(screen.getByTestId('match-detail.seats-wanted.2'));
      expect(bar.getByText(t('matches.detail.total', { seats: countPhrase('matches.count.seats', 2, locale) }))).toBeTruthy();
      expect(bar.getByText(isolate(formatIQD(20000, locale)))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it("asks once, naming the seats and the match's gender, before a +1 join", async () => {
    const rpc = jest.fn((fn: string, _args: Record<string, unknown>) =>
      fn === 'match_join'
        ? Promise.resolve({ data: null, error: { message: 'MATCH_FULL', details: null, hint: null, code: 'P0001' } })
        : new Promise<never>(() => {}),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const first = matchDetailFixture();
    const threeLeft = detail({ seatsTaken: 1, seatsLeft: 3, seats: first.seats.slice(0, 1), category: 'men' });
    const screen = renderRoute(MatchDetailScreen, {
      locale,
      ...threeLeft,
      session: 'verified',
      queryData: [
        ...threeLeft.queryData,
        [profileKeys.own, profileFixture()],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      // Alone: no question, the join goes straight out.
      fireEvent.press(screen.getByTestId('match-detail.join'));
      await waitFor(() => expect(rpc).toHaveBeenCalledWith('match_join', { p_match_id: TEST_MATCH_ID, p_friends: [] }), {
        timeout: 5000,
      });
      rpc.mockClear();
      alertState.log.length = 0;
      // Hold the next alert open: the suite's own mock would press Cancel at once.
      let shown: { text: string; onPress?: () => void }[] = [];
      jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => {
        alertState.log.push({ title: title ?? '', body: body ?? '' });
        shown = (buttons ?? []) as typeof shown;
      });
      // With a friend: nothing is sent until the guest says they are all men.
      fireEvent.press(screen.getByTestId('match-detail.seats-wanted.2'));
      fireEvent.press(screen.getByTestId('match-detail.join'));
      await waitFor(
        () => expect(alertState.log.some((a) => a.body.includes(t('matches.detail.takeBodyMen')))).toBe(true),
        { timeout: 5000 },
      );
      const asked = alertState.log.find((a) => a.body.includes(t('matches.detail.takeBodyMen')));
      expect(asked?.title).toBe(
        t('matches.detail.takeTitle', { taking: countPhrase('matches.count.seats', 2, locale) }),
      );
      expect(rpc).not.toHaveBeenCalledWith('match_join', expect.anything());
      // The alert's second button is the guest's yes.
      expect(shown[1]?.text).toBe(t('matches.detail.takeConfirmMen'));
      await act(async () => {
        shown[1]?.onPress?.();
      });
      await waitFor(
        () =>
          expect(rpc).toHaveBeenCalledWith('match_join', {
            p_match_id: TEST_MATCH_ID,
            p_friends: [{ gender: 'male' }],
          }),
        { timeout: 5000 },
      );
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('lists a blocked player with an Unblock', () => {
    const blockId = '99999999-9999-4999-8999-000000000001';
    const screen = renderRoute(BlockedPlayersScreen, {
      locale,
      session: 'in',
      queryData: [
        [
          matchKeys.blocks,
          myBlocksFixture([{ blockId, name: 'Omar H.', former: false, createdAt: new Date().toISOString() }]),
        ],
      ],
    });
    try {
      expect(within(screen.getByTestId(`blocked-players.row.${blockId}`)).getByText(isolate('Omar H.'))).toBeTruthy();
      expect(
        within(screen.getByTestId(`blocked-players.row.${blockId}.unblock`)).getByText(t('matches.blocks.unblock')),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });
});

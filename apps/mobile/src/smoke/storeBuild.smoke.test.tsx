/**
 * The STORE BUILD: EXPO_PUBLIC_ONLINE_PAYMENTS unset or "off", as every eas.json
 * profile ships it (features/deposit/enabled.ts). Online payment and open
 * matches are hidden whatever the server's settings say; the code stays for a
 * later reviewed release. Every case seeds the server's answer that would
 * SHOW the feature (an optional deposit, matches_enabled true, an
 * online_optional lesson branch) and asserts the screen ignores it.
 *
 * The suites that test those features set the flag ON per file
 * (src/test/onlinePaymentsEnv.ts). This one never does, except for the single
 * control case that proves a seed really does show the feature when it is on.
 *
 * No table case here: each route is cased by its own suite
 * (src/navigation/__tests__/smokeCoverage.test.ts wants exactly one).
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { ComponentType } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { renderRoute } from '../test/smoke';
import { SMOKE_ROUTES } from './routes';
import {
  TEST_MATCH_ID,
  TEST_VENUE_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  depositQuoteFixture,
  depositStatusFixture,
  myMatchRowFixture,
  myMatchesFixture,
  myTicketsFixture,
  openMatchesFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import {
  COACH_ID,
  COACH_TZ,
  TYPE_PRIVATE_ID,
  coachProfileFixture,
  coachSlotsFixture,
  venueAt,
} from '../test/coachingFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { bookingKeys } from '../features/booking/hooks';
import { coachingKeys } from '../features/coaching/keys';
import { lessonWindow, parseCoachProfile, parseCoachSlots } from '../features/coaching/logic';
import { depositKeys } from '../features/deposit/keys';
import { matchKeys } from '../features/matches/keys';
import { profileKeys } from '../features/profile/hooks';
import { guestWindow } from '../features/matches/logic';
import ReviewScreen from '../../app/review';
import LessonReviewScreen from '../../app/(coaching)/lesson-review';
import PlayScreen from '../../app/(tabs)/play';
import ProfileScreen from '../../app/(tabs)/profile';
import BookingsScreen from '../../app/(tabs)/bookings';
import TicketsScreen from '../../app/tickets';
import PayStatusScreen from '../../app/pay/status';
import PayReturnScreen from '../../app/pay/return';
import MatchLinkScreen from '../../app/m/[token]';
import MatchDetailScreen from '../../app/(matches)/match/[id]';
import MatchNewScreen from '../../app/(matches)/match-new';
import MatchReportScreen from '../../app/(matches)/match-report';
import BlockedPlayersScreen from '../../app/blocked-players';

type Seeds = [readonly unknown[], unknown][];

let before: string | undefined;
beforeEach(() => {
  before = process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
  delete process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
});
afterEach(() => {
  if (before === undefined) delete process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
  else process.env.EXPO_PUBLIC_ONLINE_PAYMENTS = before;
});

const primaryOf = (route: string): string => {
  const row = SMOKE_ROUTES.find((r) => r.route === route);
  if (!row) throw new Error(`no route ${route}`);
  return row.primary;
};

const TZ = 'Asia/Baghdad';
const HOLD_ID = '33333333-3333-4333-8333-333333333333';
const REF = '55555555-5555-4555-8555-555555555555';

/** One open branch with matches switched ON by the server. */
const VENUE: Seeds = [
  [availabilityKeys.branches, [branchFixture()]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: true })],
  [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.rates(TEST_VENUE_ID), []],
  [availabilityKeys.ratePrices, []],
];

const holdParams = () => ({
  holdId: HOLD_ID,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  priceIqd: '30000',
  courtNameEn: 'Court One',
  courtNameAr: 'Court One',
  startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  durationMin: '90',
});

const START_AT = venueAt(1, 18 * 60).toISOString();
const lessonSeeds = (): Seeds => {
  const { from, to } = lessonWindow(new Date(), COACH_TZ);
  return [
    ...VENUE,
    [
      coachingKeys.profile(COACH_ID, TEST_VENUE_ID),
      parseCoachProfile(
        coachProfileFixture({
          venue: { ...coachProfileFixture().venue, payment_mode: 'online_optional' },
        }),
      ),
    ],
    [coachingKeys.slots(COACH_ID, TYPE_PRIVATE_ID, from, to), parseCoachSlots(coachSlotsFixture())],
    [profileKeys.own, profileFixture()],
  ];
};
const lessonParams = {
  coachId: COACH_ID,
  lessonTypeId: TYPE_PRIVATE_ID,
  venueId: TEST_VENUE_ID,
  startAt: START_AT,
};

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('the store build in %s', (locale) => {
  const t = makeT(locale);

  it('Review shows the plain reserve button with an optional deposit quote', () => {
    const screen = renderRoute(ReviewScreen, {
      locale,
      session: 'in',
      params: holdParams(),
      queryData: [
        ...VENUE,
        [depositKeys.quote(HOLD_ID), depositQuoteFixture({ mode: 'optional' })],
      ],
    });
    try {
      expect(screen.getByTestId(primaryOf('review'))).toBeTruthy();
      expect(screen.queryByText(t('deposit.confirmPayAtDeskCta'))).toBeNull();
      expect(screen.getByText(t('booking.reserveCta'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('a lesson offers the desk only with an online_optional branch (control: on offers Qi)', () => {
    const options = {
      locale,
      session: 'verified' as const,
      params: lessonParams,
      queryData: lessonSeeds(),
    };
    process.env.EXPO_PUBLIC_ONLINE_PAYMENTS = 'on';
    const control = renderRoute(LessonReviewScreen, options);
    try {
      expect(control.getByText(t('coaching.guest.review.payOnline'))).toBeTruthy();
    } finally {
      control.unmount();
    }
    delete process.env.EXPO_PUBLIC_ONLINE_PAYMENTS;
    const screen = renderRoute(LessonReviewScreen, options);
    try {
      expect(screen.getByTestId('lesson-review.book')).toBeTruthy();
      expect(screen.queryByText(t('coaching.guest.review.payOnline'))).toBeNull();
      expect(screen.queryByText(t('coaching.guest.review.bookAndPay'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('Play hides open matches although the branch has them on', () => {
    const { from, to } = guestWindow(new Date(), TZ);
    const screen = renderRoute(PlayScreen, {
      locale,
      session: 'in',
      queryData: [...VENUE, [matchKeys.open(TEST_VENUE_ID, from, to), openMatchesFixture()]],
    });
    try {
      expect(screen.queryByTestId(`play.match.${TEST_MATCH_ID}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('Profile has no tickets and no blocked-players row', () => {
    const screen = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      queryData: [
        [profileKeys.own, profileFixture()],
        [availabilityKeys.branches, [branchFixture()]],
        [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ matches_enabled: true })],
      ],
    });
    try {
      expect(screen.getByTestId('profile.settings')).toBeTruthy();
      expect(screen.queryByTestId('profile.tickets')).toBeNull();
      expect(screen.queryByTestId('profile.blocked-players')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('My Reservations has no tickets pill and no match row', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...VENUE,
        [bookingKeys.mine, [bookingFixture()]],
        [matchKeys.mine('upcoming'), myMatchesFixture([myMatchRowFixture()])],
        [matchKeys.tickets, myTicketsFixture({ available: 2 })],
      ],
    });
    try {
      expect(screen.queryByTestId('bookings.tickets')).toBeNull();
      expect(screen.queryByTestId(`bookings.match.${TEST_MATCH_ID}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  const GATED: {
    name: string;
    Component: ComponentType<Record<string, never>>;
    params: Record<string, string>;
    screenId: string;
  }[] = [
    {
      name: 'tickets',
      Component: TicketsScreen,
      params: { buy: '2', for: 'join' },
      screenId: 'tickets',
    },
    {
      name: '/pay/status',
      Component: PayStatusScreen,
      params: { ref: REF },
      screenId: 'pay-status',
    },
    {
      name: '/pay/return',
      Component: PayReturnScreen,
      params: { ref: REF },
      screenId: 'pay-return',
    },
    {
      name: '/m/x',
      Component: MatchLinkScreen,
      params: { token: 'x'.repeat(22) },
      screenId: 'match-link',
    },
    {
      name: 'match detail',
      Component: MatchDetailScreen,
      params: { id: TEST_MATCH_ID },
      screenId: 'match-detail',
    },
    { name: 'match-new', Component: MatchNewScreen, params: {}, screenId: 'match-new' },
    {
      name: 'match-report',
      Component: MatchReportScreen,
      params: { id: TEST_MATCH_ID },
      screenId: 'match-report',
    },
    {
      name: 'blocked players',
      Component: BlockedPlayersScreen,
      params: {},
      screenId: 'blocked-players',
    },
  ];

  it.each(GATED)(
    '$name redirects to Home instead of rendering',
    ({ Component, params, screenId }) => {
      const screen = renderRoute(Component, {
        locale,
        session: 'in',
        params,
        queryData: [
          ...VENUE,
          [matchKeys.tickets, myTicketsFixture()],
          [depositKeys.status(REF), depositStatusFixture({ ref: REF })],
        ],
      });
      try {
        expect(screen.queryByTestId(primaryOf(screenId))).toBeNull();
      } finally {
        screen.unmount();
      }
    },
  );
});

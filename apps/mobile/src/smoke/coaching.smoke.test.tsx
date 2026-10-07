/**
 * Coaching, the guest's side (docs/design/coaching/guest.md §4.17). See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * Each route case seeds the PARSED reads of `src/test/coachingFixtures.ts`
 * (built from the `COACHING_SHAPES` key lists) under their `coachingKeys`, at
 * one branch with coaching switched on, so the first render draws real
 * content: the coaches with the classes row, a coach's offers and grid, the
 * classes with their filter, an open group session in desk mode (Join), the
 * private review (Book the lesson), a booked lesson with a free cancel, and My
 * lessons.
 *
 * After the table cases, the states a first render cannot show under the
 * route's one primary: the "Is this you?" card on the lesson and on My lessons
 * (C-21), the cancel dialog's words for a moved lesson (R8) and a course left
 * late (R62), a time on a coach's grid (signed out: the intent and the
 * welcome; signed in: the review), the switch off, a bad coach id, the Book
 * tab's entry row, Profile's "My lessons", the Bookings section, and the
 * payment screen's `lessonBooked`. None of those names a `route:` (each route
 * is cased by exactly one suite; smokeCoverage.test.ts).
 */
import { useState } from 'react';
import { Alert, Animated, RefreshControl } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { formatIQD, isolate, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases, type SmokeCase } from '../test/smokeCase';
import { supabase } from '../lib/supabase';
import { renderRoute } from '../test/smoke';
import { routerState } from '../test/routerState';
import {
  TEST_VENUE_ID,
  bookingFixture,
  branchFixture,
  courtFixture,
  depositStatusFixture,
  myMatchesFixture,
  myTicketsFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import {
  COACH_ID,
  COACH_TZ,
  COURSE_ID,
  ENROLMENT_ID,
  LESSON_ID,
  TYPE_PRIVATE_ID,
  coachProfileFixture,
  coachSlotsFixture,
  coachingPublicFixture,
  courseOfferFixture,
  lessonOfferFixture,
  myLessonFixture,
  myLessonRowFixture,
  sessionListingsFixture,
  venueAt,
} from '../test/coachingFixtures';
import { availabilityKeys } from '../features/availability/hooks';
import { listBookableDates } from '../features/availability/assemble';
import { profileKeys } from '../features/profile/hooks';
import { bookingKeys } from '../features/booking/hooks';
import { matchKeys } from '../features/matches/keys';
import { depositKeys } from '../features/deposit/keys';
import { coachingKeys } from '../features/coaching/keys';
import {
  lessonWindow,
  parseCoachProfile,
  parseCoachSlots,
  parseCoachingPublic,
  parseLessonOffer,
  parseMyLesson,
  parseMyLessons,
} from '../features/coaching/logic';
import { cancelCopy } from '../features/coaching/cancel';
import { clearPendingLesson, getPendingLesson } from '../features/coaching/pendingLesson';
import { BookingSheet } from '../components/BookingSheet';
import { CoachStatusProvider } from '../features/coach/CoachStatusProvider';
import CoachesScreen from '../../app/coaches';
import CoachDetailScreen from '../../app/coach/[id]';
import ClassesScreen from '../../app/classes';
import ClassDetailScreen from '../../app/class/[id]';
import LessonReviewScreen from '../../app/lesson-review';
import LessonDetailScreen from '../../app/lesson/[id]';
import MyLessonsScreen from '../../app/my-lessons';
import ProfileScreen from '../../app/(tabs)/profile';
import BookingsScreen from '../../app/(tabs)/bookings';
import PayStatusScreen from '../../app/pay/status';

type Seeds = [readonly unknown[], unknown][];

/** One open branch with coaching on (or off), its settings and courts, and no degraded flag. */
const venue = (on = true): Seeds => [
  [availabilityKeys.branches, [branchFixture({ coaching_enabled: on })]],
  [availabilityKeys.settings(TEST_VENUE_ID), venueSettingsFixture({ coaching_enabled: on })],
  [availabilityKeys.allCourts, [courtFixture()]],
  [availabilityKeys.degraded(TEST_VENUE_ID), false],
];

/** The coach's grid window, as `useLessonBooking` keys it (today's strip, no overnight tail in the fixture). */
const slotsKey = () => {
  const { from, to } = lessonWindow(new Date(), COACH_TZ);
  return coachingKeys.slots(COACH_ID, TYPE_PRIVATE_ID, from, to);
};

const coachSeeds = (profileOver: Record<string, unknown> = {}): Seeds => [
  ...venue(),
  [
    coachingKeys.profile(COACH_ID, TEST_VENUE_ID),
    parseCoachProfile(coachProfileFixture(profileOver)),
  ],
  [slotsKey(), parseCoachSlots(coachSlotsFixture())],
];

const publicSeeds = (): Seeds => [
  ...venue(),
  [coachingKeys.public(TEST_VENUE_ID), parseCoachingPublic(coachingPublicFixture())],
];

const lessonSeeds = (over: Record<string, unknown> = {}): Seeds => [
  ...venue(),
  [coachingKeys.one(ENROLMENT_ID), parseMyLesson(myLessonFixture(over))],
];

const START_AT = venueAt(1, 18 * 60).toISOString();

const CASES: SmokeCase[] = [
  {
    route: 'coaches',
    Component: CoachesScreen,
    // A list primary carries no text of its own (U5): the classes row is beside it.
    nearbyKey: 'coaching.guest.coaches.classes',
    options: { session: 'out', queryData: publicSeeds() },
  },
  {
    route: 'coach-detail',
    Component: CoachDetailScreen,
    nearbyKey: 'coaching.guest.coach.offers',
    options: {
      session: 'out',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds(),
    },
  },
  {
    route: 'classes',
    Component: ClassesScreen,
    nearbyKey: 'coaching.guest.classes.filterAll',
    options: { session: 'out', queryData: publicSeeds() },
  },
  {
    route: 'class-detail',
    Component: ClassDetailScreen,
    labelKey: 'coaching.guest.class.join',
    options: {
      session: 'verified',
      params: { id: LESSON_ID, kind: 'session' },
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [coachingKeys.offer('session', LESSON_ID), parseLessonOffer(lessonOfferFixture())],
      ],
    },
  },
  {
    route: 'lesson-review',
    Component: LessonReviewScreen,
    labelKey: 'coaching.guest.review.book',
    options: {
      session: 'verified',
      params: {
        coachId: COACH_ID,
        lessonTypeId: TYPE_PRIVATE_ID,
        venueId: TEST_VENUE_ID,
        startAt: START_AT,
      },
      queryData: [...coachSeeds(), [profileKeys.own, profileFixture()]],
    },
  },
  {
    route: 'lesson-detail',
    Component: LessonDetailScreen,
    labelKey: 'coaching.guest.lesson.cancel',
    options: { session: 'in', params: { id: ENROLMENT_ID }, queryData: lessonSeeds() },
  },
  {
    route: 'my-lessons',
    Component: MyLessonsScreen,
    labelKey: 'coaching.guest.mine.upcoming',
    options: {
      session: 'in',
      queryData: [
        ...venue(),
        [coachingKeys.mine('upcoming'), parseMyLessons([myLessonRowFixture()])],
      ],
    },
  },
];

runSmokeCases('coaching, the guest side', CASES);

// ── The states a first render cannot show under the primary ─────────────────

const LOCALES: Locale[] = ['en', 'ar'];

let alerts: { title?: string; body?: string }[] = [];

beforeEach(() => {
  alerts = [];
  jest.spyOn(Alert, 'alert').mockImplementation((title, body) => {
    alerts.push({ title, body });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  clearPendingLesson();
});

/** The booking sheet, open and at rest, as the Book tab mounts it. */
function Sheet() {
  const [progress] = useState(() => new Animated.Value(1));
  return (
    <BookingSheet testID="book.sheet" progress={progress} direction={1} bottomInset={0} isOpen />
  );
}

function sheetSeeds(on: boolean): Seeds {
  const settings = venueSettingsFixture({ coaching_enabled: on });
  const strip = listBookableDates(new Date(), 'Asia/Baghdad', 6, settings);
  return [
    [availabilityKeys.branches, [branchFixture({ coaching_enabled: on })]],
    [availabilityKeys.settings(TEST_VENUE_ID), settings],
    [availabilityKeys.courts(TEST_VENUE_ID), [courtFixture()]],
    [availabilityKeys.rates(TEST_VENUE_ID), []],
    [availabilityKeys.ratePrices, []],
    [availabilityKeys.window(TEST_VENUE_ID, strip[0]!, strip[strip.length - 1]!), []],
  ];
}

describe.each(LOCALES)('coaching states in %s', (locale) => {
  const t = makeT(locale);

  it('holds a signed-in viewer’s grid behind a skeleton until coach_me says whose page it is (MB-18)', () => {
    // The provider mounted with nothing seeded: coach_me is in flight on the first render.
    const WithStatus = () => (
      <CoachStatusProvider>
        <CoachDetailScreen />
      </CoachStatusProvider>
    );
    const screen = renderRoute(WithStatus, {
      locale,
      session: 'in',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds(),
    });
    try {
      expect(screen.getByTestId('coach-detail.offers')).toBeTruthy();
      expect(screen.queryByText(t('coaching.guest.coach.grid'))).toBeNull();
    } finally {
      screen.unmount();
    }
    // Signed out, nothing to wait for: the grid shows at once.
    const out = renderRoute(CoachDetailScreen, {
      locale,
      session: 'out',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds(),
    });
    try {
      expect(out.getByText(t('coaching.guest.coach.grid'))).toBeTruthy();
    } finally {
      out.unmount();
    }
  });

  it('joins the friends’ names with the reader’s own list separator (MB-17)', () => {
    const screen = renderRoute(LessonDetailScreen, {
      locale,
      session: 'in',
      params: { id: ENROLMENT_ID },
      queryData: lessonSeeds({ friend_names: ['Ali', 'Omar'], party_size: 3 }),
    });
    try {
      const sep = locale === 'ar' ? '، ' : ', ';
      expect(
        screen.getByText(
          t('coaching.guest.lesson.friends', {
            names: [isolate('Ali'), isolate('Omar')].join(sep),
          }),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('sends an unconfirmed coach-added place to "Confirm it’s you", never a second Join (MB-14)', () => {
    const screen = renderRoute(ClassDetailScreen, {
      locale,
      session: 'verified',
      params: { id: LESSON_ID, kind: 'session' },
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [
          coachingKeys.offer('session', LESSON_ID),
          parseLessonOffer(
            lessonOfferFixture({
              mine: { enrolment_id: ENROLMENT_ID, status: 'booked', confirm_needed: true },
            }),
          ),
        ],
      ],
    });
    try {
      expect(screen.getByText(t('coaching.guest.class.mineConfirm'))).toBeTruthy();
      const mine = screen.getByTestId('class-detail.mine');
      expect(within(mine).getByText(t('coaching.guest.bookings.confirm'))).toBeTruthy();
      expect(screen.queryByTestId('class-detail.join')).toBeNull();
      fireEvent.press(mine);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/lesson/[id]', params: { id: ENROLMENT_ID } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('shows the not-found layout when a join is refused LESSON_NOT_FOUND over a cached offer (MB-13)', async () => {
    // The join is refused; the offer re-read still answers the old offer, so
    // only the refusal can end the screen.
    const rpc = jest.fn((name: string) =>
      Promise.resolve(
        name === 'lesson_offer'
          ? { data: lessonOfferFixture(), error: null }
          : { data: null, error: { message: 'LESSON_NOT_FOUND', code: 'P0001', details: null } },
      ),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(ClassDetailScreen, {
      locale,
      session: 'verified',
      params: { id: LESSON_ID, kind: 'session' },
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [coachingKeys.offer('session', LESSON_ID), parseLessonOffer(lessonOfferFixture())],
      ],
    });
    try {
      fireEvent.press(screen.getByTestId('class-detail.join'));
      await waitFor(() => expect(screen.getByTestId('class-detail.not-found')).toBeTruthy());
      expect(rpc).toHaveBeenCalledWith('lesson_join', expect.anything());
      expect(screen.queryByTestId('class-detail.join')).toBeNull();
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  it('shows the off notice on a class whose branch switched coaching off, and no Join (MB-12)', () => {
    const screen = renderRoute(ClassDetailScreen, {
      locale,
      session: 'verified',
      params: { id: LESSON_ID, kind: 'session' },
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [coachingKeys.offer('session', LESSON_ID), parseLessonOffer({ off: true })],
      ],
    });
    try {
      expect(
        within(screen.getByTestId('class-detail.off')).getByText(t('coaching.common.errors.off')),
      ).toBeTruthy();
      expect(screen.queryByTestId('class-detail.join')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('reads coach_slots {off: true} as off on a coach page, not as a pause, and hides the grid (MB-12)', () => {
    const screen = renderRoute(CoachDetailScreen, {
      locale,
      session: 'out',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: [
        ...venue(),
        [coachingKeys.profile(COACH_ID, TEST_VENUE_ID), parseCoachProfile(coachProfileFixture())],
        [slotsKey(), parseCoachSlots({ off: true })],
      ],
    });
    try {
      expect(screen.getByText(t('coaching.common.errors.off'))).toBeTruthy();
      expect(screen.queryByText(t('coaching.guest.coach.paused'))).toBeNull();
      expect(screen.queryByText(t('coaching.guest.coach.grid'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  /** The group session at a coach price (12,000, its type 15,000) and a course with no price sent. */
  const pricedSessions = () => {
    const [group, course] = sessionListingsFixture();
    return [
      { ...group!, price_iqd: 12000, full_price_iqd: 12000 },
      { ...course!, price_iqd: null, full_price_iqd: null },
    ];
  };

  it.each([
    [
      'classes',
      () =>
        renderRoute(ClassesScreen, {
          locale,
          session: 'out',
          queryData: [
            ...venue(),
            [
              coachingKeys.public(TEST_VENUE_ID),
              parseCoachingPublic({ ...coachingPublicFixture(), sessions: pricedSessions() }),
            ],
          ],
        }),
      'classes.row',
    ],
    [
      'coach-detail',
      () =>
        renderRoute(CoachDetailScreen, {
          locale,
          session: 'out',
          params: { id: COACH_ID, venueId: TEST_VENUE_ID },
          queryData: [
            ...venue(),
            [
              coachingKeys.profile(COACH_ID, TEST_VENUE_ID),
              parseCoachProfile(coachProfileFixture({ sessions: pricedSessions() })),
            ],
            [slotsKey(), parseCoachSlots(coachSlotsFixture())],
          ],
        }),
      'coach-detail.session',
    ],
  ])(
    'shows a session row’s own price on %s, never its type’s, and none when none is sent (MB-05)',
    (_route, render, rowId) => {
      const screen = render();
      try {
        const group = within(screen.getByTestId(`${rowId}.${LESSON_ID}`));
        expect(group.getByText(isolate(formatIQD(12000, locale)))).toBeTruthy();
        expect(group.queryByText(isolate(formatIQD(15000, locale)))).toBeNull();
        const course = within(screen.getByTestId(`${rowId}.${COURSE_ID}`));
        expect(course.queryByText(isolate(formatIQD(60000, locale)))).toBeNull();
      } finally {
        screen.unmount();
      }
    },
  );

  it('asks "Is this you?" on the lesson, and offers nothing else until "Yes" (C-21)', () => {
    const screen = renderRoute(LessonDetailScreen, {
      locale,
      session: 'in',
      params: { id: ENROLMENT_ID },
      queryData: lessonSeeds({
        confirm_needed: true,
        booked_by: 'coach',
        can: { cancel: true, pay: false, confirm: true },
      }),
    });
    try {
      expect(
        within(screen.getByTestId('lesson-detail.confirm.yes')).getByText(
          t('coaching.guest.confirm.yes'),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId('lesson-detail.confirm.no')).getByText(
          t('coaching.guest.confirm.no'),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('coaching.guest.confirm.byCoach'))).toBeTruthy();
      expect(screen.queryByTestId('lesson-detail.cancel')).toBeNull();
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
    }
  });

  it('puts the confirm card above My lessons, never a plain row', () => {
    const screen = renderRoute(MyLessonsScreen, {
      locale,
      session: 'in',
      queryData: [
        ...venue(),
        [
          coachingKeys.mine('upcoming'),
          parseMyLessons([myLessonRowFixture({ confirm_needed: true, booked_by: 'staff' })]),
        ],
      ],
    });
    try {
      expect(
        within(screen.getByTestId(`my-lessons.confirm.${ENROLMENT_ID}.yes`)).getByText(
          t('coaching.guest.confirm.yes'),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('coaching.guest.confirm.byStaff'))).toBeTruthy();
      expect(screen.queryByTestId(`my-lessons.row.${ENROLMENT_ID}`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('words the cancel of a lesson moved after booking as free until it starts (R8)', () => {
    const over = {
      rescheduled: true,
      cancel: { ...myLessonFixture().cancel, policy: 'free', free_because: 'rescheduled' },
    };
    const screen = renderRoute(LessonDetailScreen, {
      locale,
      session: 'in',
      params: { id: ENROLMENT_ID },
      queryData: lessonSeeds(over),
    });
    try {
      expect(screen.getByText(t('coaching.guest.lesson.moved'))).toBeTruthy();
      fireEvent.press(screen.getByTestId('lesson-detail.cancel'));
      const lesson = parseMyLesson(myLessonFixture(over));
      const copy = cancelCopy(lesson.cancel, lesson.kind, {
        t,
        locale,
        tz: COACH_TZ,
        windowHours: 2,
      });
      expect(alerts.at(-1)).toEqual({ title: copy.title, body: copy.body });
      expect(copy.body).toContain(t('coaching.guest.cancel.freeMoved', { refund: '' }).trim());
    } finally {
      screen.unmount();
    }
  });

  it('words leaving a running course late from the server’s preview (C-23, R62)', () => {
    const over = {
      kind: 'course',
      course_id: 'k',
      session_no: 2,
      sessions_count: 3,
      cancel: {
        policy: 'late',
        free_until: null,
        free_because: null,
        refund_iqd: 20000,
        kept_iqd: 20000,
        counts_late: true,
        refund_sessions: 1,
        kept_sessions: 1,
        next_start_at: venueAt(1, 17 * 60).toISOString(),
      },
    };
    const screen = renderRoute(LessonDetailScreen, {
      locale,
      session: 'in',
      params: { id: ENROLMENT_ID },
      queryData: lessonSeeds(over),
    });
    try {
      const leave = screen.getByTestId('lesson-detail.cancel');
      expect(within(leave).getByText(t('coaching.guest.lesson.leave'))).toBeTruthy();
      fireEvent.press(leave);
      const lesson = parseMyLesson(myLessonFixture(over));
      const copy = cancelCopy(lesson.cancel, lesson.kind, {
        t,
        locale,
        tz: COACH_TZ,
        windowHours: 2,
      });
      expect(alerts.at(-1)?.body).toBe(copy.body);
      expect(copy.body).not.toMatch(/\{\w+\}/);
    } finally {
      screen.unmount();
    }
  });

  it('a time on a coach’s grid, then Book: signed out keeps the intent and opens the welcome', async () => {
    const screen = renderRoute(CoachDetailScreen, {
      locale,
      session: 'out',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds(),
    });
    try {
      const startMin = Math.floor(Date.parse(START_AT) / 60_000);
      await act(async () => {
        fireEvent.press(screen.getByTestId(`coach-detail.slot.none-${startMin}`));
      });
      // Picking a time opens the book bar; Book books it.
      const book = screen.getByTestId('coach-detail.book');
      expect(within(book).getByText(t('coaching.guest.coach.bookLesson'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(book);
      });
      expect(getPendingLesson()).toMatchObject({
        kind: 'private',
        coachId: COACH_ID,
        startAt: START_AT,
      });
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/welcome' });
    } finally {
      screen.unmount();
    }
  });

  it('a time on a coach’s grid, then Book: signed in opens the review with the offer’s price', async () => {
    const screen = renderRoute(CoachDetailScreen, {
      locale,
      session: 'in',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds(),
    });
    try {
      const startMin = Math.floor(Date.parse(START_AT) / 60_000);
      await act(async () => {
        fireEvent.press(screen.getByTestId(`coach-detail.slot.none-${startMin}`));
      });
      // Picking a time opens the book bar; Book books it.
      const book = screen.getByTestId('coach-detail.book');
      expect(within(book).getByText(t('coaching.guest.coach.bookLesson'))).toBeTruthy();
      await act(async () => {
        fireEvent.press(book);
      });
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: {
          pathname: '/lesson-review',
          params: {
            coachId: COACH_ID,
            lessonTypeId: TYPE_PRIVATE_ID,
            venueId: TEST_VENUE_ID,
            startAt: START_AT,
            priceIqd: '30000',
          },
        },
      });
    } finally {
      screen.unmount();
    }
  });

  it('a paused coach reads "not taking bookings" and has no grid (R16, R76)', () => {
    const screen = renderRoute(CoachDetailScreen, {
      locale,
      session: 'out',
      params: { id: COACH_ID, venueId: TEST_VENUE_ID },
      queryData: coachSeeds({ coach: { ...coachProfileFixture().coach, status: 'paused' } }),
    });
    try {
      expect(screen.getByText(t('coaching.guest.coach.paused'))).toBeTruthy();
      expect(screen.queryByText(t('coaching.guest.coach.grid'))).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('a coach id that is not one shows the not-found layout', () => {
    const screen = renderRoute(CoachDetailScreen, {
      locale,
      session: 'out',
      params: { id: 'nope' },
    });
    try {
      expect(
        within(screen.getByTestId('coach-detail.see-all')).getByText(
          t('coaching.guest.coach.seeAll'),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('switched off at the branch: the notice, no list (rule 7)', () => {
    const screen = renderRoute(CoachesScreen, { locale, session: 'out', queryData: venue(false) });
    try {
      expect(screen.getByTestId('coaches.off')).toBeTruthy();
      expect(screen.getByText(t('coaching.common.errors.off'))).toBeTruthy();
      expect(screen.queryByTestId('coaches.list')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('a late course join shows the server’s share and Join and pay', () => {
    const screen = renderRoute(ClassDetailScreen, {
      locale,
      session: 'verified',
      params: { id: 'k', kind: 'course' },
      queryData: [
        ...venue(),
        [profileKeys.own, profileFixture()],
        [coachingKeys.offer('course', 'k'), parseLessonOffer(courseOfferFixture({ mine: null }))],
      ],
    });
    try {
      expect(screen.getByTestId('class-detail.mode')).toBeTruthy();
      expect(
        within(screen.getByTestId('class-detail.join')).getByText(t('coaching.guest.class.join')),
      ).toBeTruthy();
      expect(screen.getByTestId('class-detail.session.1')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('the Book tab’s sheet has "Lessons with a coach" only while the branch has coaching on', () => {
    // Tomorrow, which has times whatever the hour the suite runs at: the rows sit under the lanes.
    const tomorrow = listBookableDates(new Date(), 'Asia/Baghdad', 6, venueSettingsFixture())[1]!;
    const off = renderRoute(Sheet, { locale, queryData: sheetSeeds(false) });
    fireEvent.press(off.getByTestId(`book.sheet.day.${tomorrow}`));
    try {
      expect(off.queryByTestId('book.sheet.lessons')).toBeNull();
    } finally {
      off.unmount();
    }
    const on = renderRoute(Sheet, { locale, queryData: sheetSeeds(true) });
    fireEvent.press(on.getByTestId(`book.sheet.day.${tomorrow}`));
    try {
      const row = on.getByTestId('book.sheet.lessons');
      expect(within(row).getByText(t('coaching.guest.entry.book'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({ method: 'push', arg: '/coaches' });
    } finally {
      on.unmount();
    }
  });

  it('Profile shows "My lessons" while a branch has coaching on', () => {
    const seeds = (on: boolean): Seeds => [
      [profileKeys.own, profileFixture()],
      [availabilityKeys.branches, [branchFixture({ coaching_enabled: on })]],
      [availabilityKeys.settings(TEST_VENUE_ID), null],
    ];
    const off = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(false) });
    try {
      expect(off.queryByTestId('profile.my-lessons')).toBeNull();
    } finally {
      off.unmount();
    }
    const on = renderRoute(ProfileScreen, { locale, session: 'in', queryData: seeds(true) });
    try {
      expect(
        within(on.getByTestId('profile.my-lessons')).getByText(t('profile.myLessons')),
      ).toBeTruthy();
    } finally {
      on.unmount();
    }
  });

  it('Bookings lists the upcoming lessons in their own section', () => {
    const screen = renderRoute(BookingsScreen, {
      locale,
      session: 'in',
      queryData: [
        [bookingKeys.mine, [bookingFixture()]],
        [matchKeys.mine('upcoming'), myMatchesFixture()],
        [matchKeys.tickets, myTicketsFixture()],
        [availabilityKeys.branches, [branchFixture({ coaching_enabled: true })]],
        [availabilityKeys.allCourts, [courtFixture()]],
        [coachingKeys.mine('upcoming'), parseMyLessons([myLessonRowFixture()])],
      ],
    });
    try {
      expect(screen.getByTestId(`bookings.lesson.${ENROLMENT_ID}`)).toBeTruthy();
      expect(
        within(screen.getByTestId('bookings.lessons.all')).getByText(
          t('coaching.guest.bookings.all'),
        ),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it.each([true, false])(
    'Bookings’ pull-to-refresh re-reads the lessons only while coaching is on (%s) (MB-19)',
    async (on) => {
      const rpc = jest.fn((_name: string) => Promise.resolve({ data: [], error: null }));
      Object.assign(supabase, { schema: () => ({ rpc }) });
      const screen = renderRoute(BookingsScreen, {
        locale,
        session: 'in',
        queryData: [
          [bookingKeys.mine, [bookingFixture()]],
          [matchKeys.mine('upcoming'), myMatchesFixture()],
          [matchKeys.tickets, myTicketsFixture()],
          [availabilityKeys.branches, [branchFixture({ coaching_enabled: on })]],
          [availabilityKeys.allCourts, [courtFixture()]],
          [coachingKeys.mine('upcoming'), parseMyLessons([myLessonRowFixture()])],
        ],
      });
      try {
        rpc.mockClear();
        await act(async () => {
          screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
        });
        const lessonReads = () => rpc.mock.calls.filter(([name]) => name === 'my_lessons');
        if (on) await waitFor(() => expect(lessonReads().length).toBeGreaterThan(0));
        else expect(lessonReads()).toHaveLength(0);
      } finally {
        screen.unmount();
        delete (supabase as { schema?: unknown }).schema;
      }
    },
  );

  it('the payment screen books the lesson and opens it (§4.9.3)', () => {
    const REF = '55555555-5555-4555-8555-5555555555aa';
    const screen = renderRoute(PayStatusScreen, {
      locale,
      session: 'in',
      params: { ref: REF },
      queryData: [
        ...venue(),
        [
          depositKeys.status(REF),
          depositStatusFixture({
            ref: REF,
            status: 'succeeded',
            purpose: 'lesson',
            depositMode: 'off',
            holdLive: false,
            reservation: null,
            amountIqd: 30000,
            lesson: {
              enrolmentId: ENROLMENT_ID,
              enrolmentStatus: 'booked',
              kind: 'private',
              lessonId: LESSON_ID,
              courseId: null,
              startAt: venueAt(1, 18 * 60).toISOString(),
              endAt: venueAt(1, 19 * 60).toISOString(),
              venueId: TEST_VENUE_ID,
              coachId: COACH_ID,
              coachNameEn: 'Sara Coach',
              coachNameAr: 'سارة المدرّبة',
              typeNameEn: 'Private lesson',
              typeNameAr: 'حصة خاصة',
            },
          }),
        ],
      ],
    });
    try {
      expect(screen.getByTestId('pay-status.state.lessonBooked')).toBeTruthy();
      expect(
        within(screen.getByTestId('pay-status.view-lesson')).getByText(
          t('coaching.guest.pay.viewLesson'),
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId('pay-status.pay-at-desk')).toBeNull();
    } finally {
      screen.unmount();
    }
  });
});

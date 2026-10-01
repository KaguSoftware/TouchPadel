/**
 * Coach mode (docs/design/coaching/guest.md §4.13, §4.17): every coach-mode
 * screen in EN and AR, rendered for a signed-in account that coaches. See
 * `src/smoke/auth.smoke.test.tsx` for what a case asserts and
 * `src/test/smokeCase.tsx` for how.
 *
 * A coach case passes `coach: <coach_me>`: renderRoute signs the test session
 * in, mounts CoachStatusProvider and seeds `coach_me`, so RequireCoach lets the
 * screen through on the first render. The reads each screen makes are seeded
 * from `src/test/coachFixtures.ts` under the exact keys the screen uses.
 *
 * Then the states the cases cannot show: the accept sheet (R61), paused (R16),
 * a branch switched off (R45), a retired coach (C-25), and a staff member who
 * coaches (C-27), on coach mode and on the staff hub's row.
 */
import { describe, expect, it } from '@jest/globals';
import { within } from '@testing-library/react-native';
import { isolate, makeT, type Locale } from '@touch/i18n';
import { runSmokeCases } from '../test/smokeCase';
import { renderRoute } from '../test/smoke';
import { coachKeys } from '../features/coach/keys';
import {
  COACH_VENUE_ID,
  LESSON_ID,
  STATEMENT_ID,
  STATEMENT_MONTH,
  coachHoursFixture,
  coachLessonFixture,
  coachMeFixture,
  coachMeRetiredFixture,
  coachScheduleFixture,
  coachScheduleKey,
  coachSlotsFixture,
  coachSlotsKey,
  coachStatementsFixture,
  ENROLMENT_ID,
  ENROLMENT_2_ID,
} from '../test/coachFixtures';
import CoachMode from '../../app/coach-mode';
import CoachModeHours from '../../app/coach-mode-hours';
import CoachModeLesson from '../../app/coach-mode-lesson';
import CoachModeNew from '../../app/coach-mode-new';
import CoachModeBook from '../../app/coach-mode-book';
import CoachModeStatements from '../../app/coach-mode-statements';
import StaffToday from '../../app/staff';

const scheduleSeed = (): [readonly unknown[], unknown] => [
  coachScheduleKey(),
  coachScheduleFixture(),
];
const statementSeeds = (): [readonly unknown[], unknown][] => [
  [coachKeys.statements('summary'), coachStatementsFixture(false)],
  [coachKeys.statements(STATEMENT_MONTH), coachStatementsFixture(true)],
];

runSmokeCases('coach mode', [
  {
    route: 'coach-mode',
    Component: CoachMode,
    // The schedule is a list: its heading is the text on screen.
    nearbyKey: 'coaching.coach.home.schedule',
    options: { coach: coachMeFixture(), queryData: [scheduleSeed()] },
  },
  {
    route: 'coach-mode-hours',
    Component: CoachModeHours,
    labelKey: 'coaching.coach.hours.save',
    options: { coach: coachMeFixture(), queryData: [[coachKeys.hours, coachHoursFixture()]] },
  },
  {
    route: 'coach-mode-lesson',
    Component: CoachModeLesson,
    nearbyKey: 'coaching.coach.roster.title',
    options: {
      coach: coachMeFixture(),
      params: { id: LESSON_ID },
      queryData: [[coachKeys.lesson(LESSON_ID), coachLessonFixture()]],
    },
  },
  {
    route: 'coach-mode-new',
    Component: CoachModeNew,
    labelKey: 'coaching.coach.new.create',
    options: { coach: coachMeFixture() },
  },
  {
    route: 'coach-mode-book',
    Component: CoachModeBook,
    labelKey: 'coaching.coach.book.book',
    options: { coach: coachMeFixture(), queryData: [[coachSlotsKey(), coachSlotsFixture()]] },
  },
  {
    route: 'coach-mode-statements',
    Component: CoachModeStatements,
    nearbyKey: 'coaching.coach.statements.title',
    options: { coach: coachMeFixture(), queryData: statementSeeds() },
  },
]);

const LOCALES: Locale[] = ['en', 'ar'];

describe.each(LOCALES)('coach mode’s states in %s', (locale) => {
  const t = makeT(locale);

  it('opens on the accept sheet while the profile is not public (R61, C-22)', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      coach: coachMeFixture({ public_accepted: false }),
      queryData: [scheduleSeed()],
    });
    try {
      expect(screen.getByTestId('coach-mode.accept-sheet')).toBeTruthy();
      expect(
        within(screen.getByTestId('coach-mode.accept')).getByText(
          t('coaching.coach.accept.accept'),
        ),
      ).toBeTruthy();
      expect(screen.getByText(t('coaching.coach.accept.body'))).toBeTruthy();
      expect(screen.getByTestId('coach-mode.banner.not-public')).toBeTruthy();
      expect(screen.getByTestId('coach-mode.accept-later')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows no sheet and no banner once the profile is public', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      coach: coachMeFixture(),
      queryData: [scheduleSeed()],
    });
    try {
      expect(screen.queryByTestId('coach-mode.accept-sheet')).toBeNull();
      expect(screen.queryByTestId('coach-mode.banner.not-public')).toBeNull();
      expect(screen.getByTestId('coach-mode.book')).toBeTruthy();
      expect(screen.getByTestId('coach-mode.new')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('tells a paused coach, and hides booking and new sessions (R16)', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      coach: coachMeFixture({ status: 'paused' }),
      queryData: [scheduleSeed()],
    });
    try {
      expect(
        within(screen.getByTestId('coach-mode.banner.paused')).getByText(
          t('coaching.coach.banner.paused'),
        ),
      ).toBeTruthy();
      expect(screen.queryByTestId('coach-mode.book')).toBeNull();
      expect(screen.queryByTestId('coach-mode.new')).toBeNull();
      expect(screen.getByTestId('coach-mode.hours')).toBeTruthy();
      expect(screen.getByTestId('coach-mode.statements')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('says lessons are switched off at a branch rather than hiding coach mode (R45)', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      coach: coachMeFixture({}, { coaching_enabled: false }),
      queryData: [scheduleSeed()],
    });
    try {
      const branch = locale === 'ar' ? 'تتش بادل' : 'Touch Padel';
      expect(
        within(screen.getByTestId(`coach-mode.banner.off.${COACH_VENUE_ID}`)).getByText(
          t('coaching.coach.banner.off', { branch: isolate(branch) }),
        ),
      ).toBeTruthy();
      expect(screen.getByTestId('coach-mode.schedule')).toBeTruthy();
      expect(screen.queryByTestId('coach-mode.book')).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lists the schedule by night with each lesson as a row', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      coach: coachMeFixture(),
      queryData: [scheduleSeed()],
    });
    try {
      expect(screen.getByTestId(`coach-mode.lesson.${LESSON_ID}`)).toBeTruthy();
      expect(screen.getByText(t('coaching.coach.home.tomorrow'))).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('keeps a retired coach out of coach mode and on the statements (C-25)', () => {
    const home = renderRoute(CoachMode, {
      locale,
      coach: coachMeRetiredFixture(),
      queryData: [scheduleSeed()],
    });
    try {
      expect(home.queryByTestId('coach-mode.schedule')).toBeNull();
    } finally {
      home.unmount();
    }
    const statements = renderRoute(CoachModeStatements, {
      locale,
      coach: coachMeRetiredFixture(),
      queryData: statementSeeds(),
    });
    try {
      expect(statements.getByTestId('coach-mode-statements.month')).toBeTruthy();
      expect(
        statements.getByTestId(`coach-mode-statements.statement.${STATEMENT_ID}`),
      ).toBeTruthy();
      // No estimate for a retired coach.
      expect(statements.queryByText(t('coaching.coach.statements.thisMonth'))).toBeNull();
    } finally {
      statements.unmount();
    }
  });

  it('shows an active coach this month’s estimate beside the statements', () => {
    const screen = renderRoute(CoachModeStatements, {
      locale,
      coach: coachMeFixture(),
      queryData: statementSeeds(),
    });
    try {
      expect(screen.getByText(t('coaching.coach.statements.thisMonth'))).toBeTruthy();
      expect(
        screen.getByTestId(`coach-mode-statements.month.${STATEMENT_MONTH.slice(0, 7)}`),
      ).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('shows the roster with phones, a call button and the attendance marks (C-16, CD-11)', () => {
    const screen = renderRoute(CoachModeLesson, {
      locale,
      coach: coachMeFixture(),
      params: { id: LESSON_ID },
      queryData: [[coachKeys.lesson(LESSON_ID), coachLessonFixture()]],
    });
    try {
      expect(screen.getByTestId(`coach-mode-lesson.student.${ENROLMENT_ID}`)).toBeTruthy();
      expect(screen.getByTestId(`coach-mode-lesson.student.${ENROLMENT_ID}.call`)).toBeTruthy();
      expect(screen.getByTestId(`coach-mode-lesson.student.${ENROLMENT_ID}.mark`)).toBeTruthy();
      expect(screen.getByTestId(`coach-mode-lesson.student.${ENROLMENT_2_ID}.mark`)).toBeTruthy();
      expect(screen.getByText(t('coaching.coach.roster.phoneNote'))).toBeTruthy();
      expect(screen.getByTestId('coach-mode-lesson.add')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('opens coach mode for a staff member who coaches (C-27)', () => {
    const screen = renderRoute(CoachMode, {
      locale,
      staff: { role: 'barista' },
      coach: coachMeFixture(),
      queryData: [scheduleSeed()],
    });
    try {
      expect(screen.getByTestId('coach-mode.schedule')).toBeTruthy();
    } finally {
      screen.unmount();
    }
  });

  it('gives the staff hub a Coach mode row for staff who coach, and none for staff who do not', () => {
    const coaching = renderRoute(StaffToday, {
      locale,
      staff: { role: 'head_chef' },
      coach: coachMeFixture(),
    });
    try {
      expect(
        within(coaching.getByTestId('staff.coach-mode')).getByText(t('staff.shell.coachMode')),
      ).toBeTruthy();
    } finally {
      coaching.unmount();
    }
    const retired = renderRoute(StaffToday, {
      locale,
      staff: { role: 'head_chef' },
      coach: coachMeRetiredFixture(),
    });
    try {
      expect(
        within(retired.getByTestId('staff.coach-mode')).getByText(t('staff.shell.coachStatements')),
      ).toBeTruthy();
    } finally {
      retired.unmount();
    }
    const plain = renderRoute(StaffToday, { locale, staff: { role: 'head_chef' } });
    try {
      expect(plain.queryByTestId('staff.coach-mode')).toBeNull();
    } finally {
      plain.unmount();
    }
  });
});

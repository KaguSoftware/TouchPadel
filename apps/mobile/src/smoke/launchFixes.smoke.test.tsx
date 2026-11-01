/**
 * The 2026-11-01 launch fixes on the phone, in EN and AR (qa/final-checklist
 * findings; Majed's answers):
 *
 *  - F-16 blocked pages are always blocked: Today leaves them out, and a page
 *    opened any other way (a push, a deep link) goes back to Today.
 *  - F-59 the deduction form is for the roles that propose; coach mode opened
 *    by a staff member who does not coach goes back to Today.
 *  - F-39 a checklist the server sends a person shows on their phone, a
 *    second job's included (the phone never filters lists by role).
 *  - F-21 Review warns before Reserve when the price moved, and a confirm
 *    refused PRICE_CHANGED shows the new price instead of booking.
 *  - F-70 a coach sees and sets the level of a student whose account link is
 *    confirmed, and only that student (0401).
 *  - F-46 phone OTP on: Profile offers "Verify phone number", and a changed
 *    number in Edit profile needs its code before it is saved.
 *
 * No table case here: each route is cased by its own suite
 * (src/navigation/__tests__/smokeCoverage.test.ts wants exactly one).
 */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { act, fireEvent, waitFor, within } from '@testing-library/react-native';
import { formatIQD, isolate, makeT, type Locale } from '@touch/i18n';
import { renderRoute, TEST_VENUE_ID } from '../test/smoke';
import { routerState } from '../test/routerState';
import { TEST_SESSION } from '../test/authState';
import { SMOKE_ROUTES } from './routes';
import {
  branchFixture,
  courtFixture,
  depositQuoteFixture,
  profileFixture,
  venueSettingsFixture,
} from '../test/fixtures';
import { supabase } from '../lib/supabase';
import { staffKeys } from '../features/staff/keys';
import { availabilityKeys } from '../features/availability/hooks';
import { depositKeys } from '../features/deposit/hooks';
import { profileKeys } from '../features/profile/hooks';
import type { ChecklistsToday } from '../features/staff/checklists/logic';
import StaffToday from '../../app/staff';
import StaffWork from '../../app/(staff)/staff-work';
import StaffIncidentReport from '../../app/(staff)/staff-incident-report';
import StaffDeductionPropose from '../../app/(staff)/staff-deduction-propose';
import StaffOrder from '../../app/(staff)/staff-order';
import CoachMode from '../../app/(coach-mode)/coach-mode';
import CoachModeLesson from '../../app/(coach-mode)/coach-mode-lesson';
import { coachKeys } from '../features/coach/keys';
import { parseCoachLesson } from '../features/coach/logic';
import { ENROLMENT_2_ID, ENROLMENT_ID, LESSON_ID, coachLessonRaw, coachMeFixture } from '../test/coachFixtures';
import ReviewScreen from '../../app/review';
import ProfileScreen from '../../app/profile';
import ProfileEditScreen from '../../app/profile-edit';

const V = TEST_VENUE_ID;
const LOCALES: Locale[] = ['en', 'ar'];

const primaryOf = (name: string): string => {
  const row = SMOKE_ROUTES.find((r) => r.route === name);
  if (!row) throw new Error(`no route ${name}`);
  return row.primary;
};

/** A gate's Redirect (null-rendered by jest.setup.ts), with the href it was given. */
function redirectHref(screen: ReturnType<typeof renderRoute>): unknown {
  const found = screen.UNSAFE_root.findAll(
    (n) => typeof n.type === 'function' && (n.type as { displayName?: string }).displayName === 'Redirect',
  );
  return found[0]?.props.href;
}

const PHONE_OTP = process.env.EXPO_PUBLIC_PHONE_OTP;
beforeAll(() => {
  process.env.EXPO_PUBLIC_PHONE_OTP = 'on';
});
afterAll(() => {
  if (PHONE_OTP === undefined) delete process.env.EXPO_PUBLIC_PHONE_OTP;
  else process.env.EXPO_PUBLIC_PHONE_OTP = PHONE_OTP;
});

describe.each(LOCALES)('launch fixes in %s', (locale) => {
  const t = makeT(locale);

  // ── F-16 ──────────────────────────────────────────────────────────────────

  it('leaves a blocked page off Today (F-16)', () => {
    const open = renderRoute(StaffToday, { locale, staff: { role: 'manager' } });
    try {
      expect(open.getByTestId('staff.group.floor')).toBeTruthy();
    } finally {
      open.unmount();
    }
    // Café cashier unticked: Place an order (the manager's whole floor group) goes.
    const blocked = renderRoute(StaffToday, {
      locale,
      staff: { role: 'manager', blockedAreas: ['till'] },
    });
    try {
      expect(blocked.queryByTestId('staff.group.floor')).toBeNull();
      expect(blocked.getByTestId(primaryOf('staff'))).toBeTruthy();
    } finally {
      blocked.unmount();
    }
  });

  it('sends a blocked page opened by a push or a link back to Today (F-16)', () => {
    const open = renderRoute(StaffIncidentReport, { locale, staff: { role: 'court_desk' } });
    try {
      expect(open.getByTestId(primaryOf('staff-incident-report'))).toBeTruthy();
    } finally {
      open.unmount();
    }
    const blocked = renderRoute(StaffIncidentReport, {
      locale,
      staff: { role: 'court_desk', blockedAreas: ['incidents'] },
    });
    try {
      expect(blocked.queryByTestId(primaryOf('staff-incident-report'))).toBeNull();
      expect(redirectHref(blocked)).toBe('/staff');
    } finally {
      blocked.unmount();
    }
  });

  it('applies a block to a second job\'s page too (F-16)', () => {
    const screen = renderRoute(StaffOrder, {
      locale,
      staff: { role: 'waiter', extraRoles: ['cashier'], blockedAreas: ['till'] },
    });
    try {
      expect(screen.queryByTestId(primaryOf('staff-order'))).toBeNull();
      expect(redirectHref(screen)).toBe('/staff');
    } finally {
      screen.unmount();
    }
  });

  // ── F-59 ──────────────────────────────────────────────────────────────────

  it('keeps the deduction form for the roles that propose (F-59)', () => {
    const barista = renderRoute(StaffDeductionPropose, {
      locale,
      staff: { role: 'barista' },
      queryData: [[staffKeys.deductionTargets(V), { staff: [] }]],
    });
    try {
      expect(barista.queryByTestId(primaryOf('staff-deduction-propose'))).toBeNull();
      expect(redirectHref(barista)).toBe('/staff');
    } finally {
      barista.unmount();
    }
    const head = renderRoute(StaffDeductionPropose, {
      locale,
      staff: { role: 'head_barista' },
      queryData: [[staffKeys.deductionTargets(V), { staff: [] }]],
    });
    try {
      expect(head.getByTestId(primaryOf('staff-deduction-propose'))).toBeTruthy();
    } finally {
      head.unmount();
    }
  });

  it('sends a staff member who does not coach from coach mode back to Today (F-59)', () => {
    const staff = renderRoute(CoachMode, {
      locale,
      staff: { role: 'cashier' },
      coach: { coach: null, serverNow: null },
    });
    try {
      expect(staff.queryByTestId(primaryOf('coach-mode'))).toBeNull();
      expect(redirectHref(staff)).toBe('/staff');
    } finally {
      staff.unmount();
    }
    const guest = renderRoute(CoachMode, {
      locale,
      session: 'in',
      coach: { coach: null, serverNow: null },
    });
    try {
      expect(redirectHref(guest)).toBe('/profile');
    } finally {
      guest.unmount();
    }
  });

  // ── F-39 ──────────────────────────────────────────────────────────────────

  it('shows a checklist sent for a second job on the person\'s phone (F-39)', () => {
    const lists: ChecklistsToday = {
      business_date: '2026-10-31',
      lists: [
        {
          run_id: 'run-desk',
          // The second job's list: a cashier who also works the court desk.
          role: 'court_desk',
          slot: 'open',
          name_en: 'Opening the desk',
          name_ar: 'افتتاح الاستقبال',
          done: 0,
          total: 1,
          items: [
            {
              id: 'line-d1',
              position: 1,
              text_en: 'Count the float',
              text_ar: 'عُدّ الصندوق',
              done_by_name: null,
              done_at: null,
              note: null,
              photo_required: false,
              photo_path: null,
            },
          ],
        },
      ],
    } as ChecklistsToday;
    const screen = renderRoute(StaffWork, {
      locale,
      staff: { role: 'cashier', extraRoles: ['court_desk'] },
      queryData: [
        [staffKeys.checklists(V), lists],
        [staffKeys.work(V), { todo: [], waiting: [], decided: [], to_decide: [], counts: { todo: 0, waiting: 0, to_decide: 0 } }],
      ],
    });
    try {
      const row = screen.getByTestId('staff.checklist.run-desk');
      expect(within(row).getByText(locale === 'ar' ? 'افتتاح الاستقبال' : 'Opening the desk')).toBeTruthy();
    } finally {
      screen.unmount();
    }
    // My tasks unticked (F-16): the work alerts page leaves the checklists out.
    const blocked = renderRoute(StaffWork, {
      locale,
      staff: { role: 'cashier', extraRoles: ['court_desk'], blockedAreas: ['tasks'] },
      queryData: [[staffKeys.checklists(V), lists]],
    });
    try {
      expect(blocked.queryByTestId('staff.checklist.run-desk')).toBeNull();
    } finally {
      blocked.unmount();
    }
  });

  // ── F-21 ──────────────────────────────────────────────────────────────────

  const VENUE: [readonly unknown[], unknown][] = [
    [availabilityKeys.branches, [branchFixture()]],
    [availabilityKeys.settings(V), venueSettingsFixture()],
    [availabilityKeys.courts(V), [courtFixture()]],
    [availabilityKeys.allCourts, [courtFixture()]],
    [availabilityKeys.rates(V), []],
    [availabilityKeys.ratePrices, []],
  ];
  const HOLD_ID = '33333333-3333-4333-8333-333333333333';
  const hold = (over: Record<string, string> = {}) => ({
    holdId: HOLD_ID,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    priceIqd: '36000',
    courtNameEn: 'Court One',
    courtNameAr: 'الملعب الأول',
    startAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    durationMin: '90',
    ...over,
  });
  const reviewOptions = (params: Record<string, string>) => ({
    locale,
    session: 'verified' as const,
    params,
    queryData: [
      ...VENUE,
      [depositKeys.quote(HOLD_ID), depositQuoteFixture({ mode: 'off' })] as [readonly unknown[], unknown],
      [profileKeys.own, profileFixture()] as [readonly unknown[], unknown],
      // Terms already accepted (null: no consent row to ask about).
      [profileKeys.consent(TEST_SESSION.user.id), null] as [readonly unknown[], unknown],
    ],
  });

  it('warns on Review, before Reserve, when the hold\'s price is not the one the grid showed (F-21)', () => {
    const moved = renderRoute(ReviewScreen, reviewOptions(hold({ shownPriceIqd: '30000' })));
    try {
      const notice = moved.getByTestId('review.price-changed');
      expect(
        within(notice).getByText(
          t('booking.priceMovedNotice', {
            from: isolate(formatIQD(30000, locale)),
            to: isolate(formatIQD(36000, locale)),
          }),
        ),
      ).toBeTruthy();
      expect(moved.getByTestId('review.reserve')).toBeTruthy();
    } finally {
      moved.unmount();
    }
    const same = renderRoute(ReviewScreen, reviewOptions(hold({ shownPriceIqd: '36000' })));
    try {
      expect(same.queryByTestId('review.price-changed')).toBeNull();
    } finally {
      same.unmount();
    }
  });

  it('shows the new price instead of booking when the confirm is refused PRICE_CHANGED (F-21)', async () => {
    const refusal = Object.assign(new Error('PRICE_CHANGED'), {
      code: 'P0001',
      details: JSON.stringify({ quoted_iqd: 36000, current_iqd: 40000, rate_rule_id: 'r' }),
    });
    const rpc = jest.fn((name: string, _args?: unknown) =>
      Promise.resolve(name === 'confirm_booking' ? { data: null, error: refusal } : { data: null, error: null }),
    );
    type AlertButton = { text?: string; style?: string; onPress?: () => void };
    let buttons: AlertButton[] = [];
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, list) => {
      buttons = (list ?? []) as AlertButton[];
    });
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(ReviewScreen, reviewOptions(hold()));
    try {
      fireEvent.press(screen.getByTestId('review.reserve'));
      await waitFor(() => expect(buttons.length).toBeGreaterThan(0));
      // The system alert's confirm button runs the write.
      const confirm = buttons.find((b) => b.style !== 'cancel');
      act(() => confirm!.onPress!());
      await waitFor(() => expect(screen.getByTestId('review.price-moved')).toBeTruthy());
      expect(rpc).toHaveBeenCalledWith('confirm_booking', { p_hold_id: HOLD_ID });
      expect(
        screen.getByText(t('booking.priceMovedBody', { price: isolate(formatIQD(40000, locale)) })),
      ).toBeTruthy();
      // Nothing was booked: no Success screen.
      expect(routerState.calls.find((c) => c.method === 'replace')).toBeUndefined();
      expect(screen.getByTestId('review.back-to-availability')).toBeTruthy();
    } finally {
      screen.unmount();
      alert.mockRestore();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  // ── F-70 ──────────────────────────────────────────────────────────────────

  const linkedLesson = () => {
    const raw = coachLessonRaw();
    raw.roster[0] = { ...raw.roster[0]!, level: null } as never;
    raw.roster[1] = {
      ...raw.roster[1]!,
      level: { claimed: 'beginner', confirmed: 'intermediate', confirmed_role: 'court_desk', confirmed_at: '2026-10-31T10:00:00Z', note: null },
    } as never;
    return parseCoachLesson(raw);
  };

  it('shows a linked student\'s claimed and confirmed level, and nothing for an unlinked place (F-70)', () => {
    const screen = renderRoute(CoachModeLesson, {
      locale,
      coach: coachMeFixture(),
      params: { id: LESSON_ID },
      queryData: [[coachKeys.lesson(LESSON_ID), linkedLesson()]],
    });
    try {
      const row = `coach-mode-lesson.student.${ENROLMENT_2_ID}.level`;
      expect(
        within(screen.getByTestId(`${row}.confirmed`)).getByText(
          t('coaching.coach.level.confirmedBy', {
            level: t('playProfile.survey.level.intermediate.title'),
            by: t('coaching.coach.level.by.court_desk'),
          }),
        ),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId(`${row}.claimed`)).getByText(
          t('coaching.coach.level.claimed', { level: t('playProfile.survey.level.beginner.title') }),
        ),
      ).toBeTruthy();
      expect(within(screen.getByTestId(`${row}.set`)).getByText(t('coaching.coach.level.set'))).toBeTruthy();
      expect(screen.queryByTestId(`coach-mode-lesson.student.${ENROLMENT_ID}.level`)).toBeNull();
    } finally {
      screen.unmount();
    }
  });

  it('lets the coach change the level with a note, on the place, never a profile (F-70)', async () => {
    const rpc = jest.fn((name: string, _args?: unknown) =>
      Promise.resolve(
        name === 'coach_set_student_level'
          ? { data: { enrolment_id: ENROLMENT_2_ID, level_confirmed: 'advanced', level_confirmed_role: 'coach', level_note: 'Strong at the net', duplicate: false }, error: null }
          : { data: null, error: null },
      ),
    );
    Object.assign(supabase, { schema: () => ({ rpc }) });
    const screen = renderRoute(CoachModeLesson, {
      locale,
      coach: coachMeFixture(),
      params: { id: LESSON_ID },
      queryData: [[coachKeys.lesson(LESSON_ID), linkedLesson()]],
    });
    try {
      fireEvent.press(screen.getByTestId(`coach-mode-lesson.student.${ENROLMENT_2_ID}.level.set`));
      const sheet = 'coach-mode-lesson.level-sheet';
      expect(screen.getByTestId(sheet)).toBeTruthy();
      expect(screen.getByTestId(`${sheet}.option.intermediate`).props.accessibilityState.checked).toBe(true);
      expect(within(screen.getByTestId(`${sheet}.save`)).getByText(t('coaching.coach.level.save'))).toBeTruthy();
      expect(screen.getByTestId(`${sheet}.clear`)).toBeTruthy();
      fireEvent.press(screen.getByTestId(`${sheet}.option.advanced`));
      fireEvent.changeText(screen.getByTestId(`${sheet}.note`), ' Strong at the net ');
      fireEvent.press(screen.getByTestId(`${sheet}.save`));
      await waitFor(() =>
        expect(rpc).toHaveBeenCalledWith('coach_set_student_level', {
          p_enrolment_id: ENROLMENT_2_ID,
          p_level: 'advanced',
          p_note: 'Strong at the net',
        }),
      );
      expect(screen.direction()).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    } finally {
      screen.unmount();
      delete (supabase as { schema?: unknown }).schema;
    }
  });

  // ── F-46 ──────────────────────────────────────────────────────────────────

  it('offers "Verify phone number" on Profile with phone OTP on (F-46)', () => {
    const screen = renderRoute(ProfileScreen, {
      locale,
      session: 'in',
      queryData: [[profileKeys.own, profileFixture()], [availabilityKeys.branches, [branchFixture()]]],
    });
    try {
      const row = screen.getByTestId('profile.verify-phone');
      expect(within(row).getByText(t('auth.verifyPhoneRow'))).toBeTruthy();
      fireEvent.press(row);
      expect(routerState.calls).toContainEqual({
        method: 'push',
        arg: { pathname: '/phone-sign-in', params: { mode: 'link' } },
      });
    } finally {
      screen.unmount();
    }
  });

  it('sends a code before an edited phone number is saved (F-46)', async () => {
    const updateUser = jest.fn((_attrs: unknown) => Promise.resolve({ data: {}, error: null }));
    Object.assign(supabase.auth, { updateUser });
    const screen = renderRoute(ProfileEditScreen, {
      locale,
      session: 'in',
      params: { section: 'phone' },
      queryData: [[profileKeys.own, profileFixture()]],
    });
    try {
      fireEvent.changeText(screen.getByTestId('profile-edit.phone'), '7712345678');
      fireEvent.press(screen.getByTestId('profile-edit.save-phone'));
      await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ phone: '+9647712345678' }));
      await waitFor(() =>
        expect(routerState.calls).toContainEqual({
          method: 'push',
          arg: { pathname: '/verify-otp', params: { phone: '+9647712345678', mode: 'link', from: 'edit' } },
        }),
      );
    } finally {
      screen.unmount();
      delete (supabase.auth as { updateUser?: unknown }).updateUser;
    }
  });
});

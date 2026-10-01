/**
 * Coach-mode fixtures (docs/design/coaching/guest.md §4.17): the RAW answers
 * of every coach read, built to carry every key of `@touch/core`'s
 * COACHING_SHAPES (the logic tests assert `missingKeys(...)` is empty, so a
 * fixture missing a binding key fails its own test), plus the parsed values
 * and query keys the smoke cases seed.
 *
 * PURE: no react-native import, so vitest (plain node) reads it as well as
 * jest-expo. Times are relative to now, so a fixture never ages into another
 * state.
 */
import { localParts, wallTimeToUtc } from '@touch/core';
import { coachKeys } from '../features/coach/keys';
import {
  parseCoachHours,
  parseCoachLesson,
  parseCoachMe,
  parseCoachSchedule,
  parseCoachSlots,
  parseCoachStatements,
  scheduleWindow,
  slotsWindow,
  type CoachMeRead,
} from '../features/coach/logic';

export const COACH_TZ = 'Asia/Baghdad';
/** The branch every coach case teaches at (the smoke suite's TEST_VENUE_ID). */
export const COACH_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';
export const COACH_VENUE_2_ID = '44444444-4444-4444-8444-444444444444';
export const COACH_ID = 'c0ac0000-0000-4000-8000-0000000000c1';
export const PRIVATE_TYPE_ID = '7e000000-0000-4000-8000-000000000001';
export const GROUP_TYPE_ID = '7e000000-0000-4000-8000-000000000002';
export const COURSE_TYPE_ID = '7e000000-0000-4000-8000-000000000003';
export const LESSON_ID = '1e550000-0000-4000-8000-000000000001';
export const PRIVATE_LESSON_ID = '1e550000-0000-4000-8000-000000000002';
export const ENROLMENT_ID = 'e0000000-0000-4000-8000-000000000001';
export const ENROLMENT_2_ID = 'e0000000-0000-4000-8000-000000000002';
export const TIME_OFF_ID = '70ff0000-0000-4000-8000-000000000001';
export const STATEMENT_ID = '57a70000-0000-4000-8000-000000000001';
export const STATEMENT_MONTH = '2026-09-01';

const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** The next whole hour from now, local, plus `days` days: a start the grid accepts. */
function startIn(days: number, hour = 18): string {
  const today = localParts(new Date(), COACH_TZ).date;
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
  return wallTimeToUtc(date, hour * 60, COACH_TZ).toISOString();
}

// ── coach_me ────────────────────────────────────────────────────────────────

export function coachMeRaw(
  over: Record<string, unknown> = {},
  branchOver: Record<string, unknown> = {},
) {
  return {
    coach: {
      id: COACH_ID,
      status: 'active',
      display_name_en: 'Sara Coach',
      display_name_ar: 'سارة المدرّبة',
      bio_en: 'Ten years on court.',
      bio_ar: 'عشر سنوات في الملعب.',
      photo_path: null,
      public_accepted: true,
      branches: [
        {
          venue_id: COACH_VENUE_ID,
          name_en: 'Touch Padel',
          name_ar: 'تتش بادل',
          timezone: COACH_TZ,
          coaching_enabled: true,
          ...branchOver,
        },
      ],
      lesson_types: [
        {
          id: PRIVATE_TYPE_ID,
          venue_id: COACH_VENUE_ID,
          kind: 'private',
          name_en: 'Private lesson',
          name_ar: 'حصة خاصة',
          duration_min: 60,
          max_places: 4,
          min_places: 1,
          sessions_count: null,
          cutoff_hours: 0,
          price_iqd: 30000,
          is_active: true,
        },
        {
          id: GROUP_TYPE_ID,
          venue_id: COACH_VENUE_ID,
          kind: 'group',
          name_en: 'Group clinic',
          name_ar: 'حصة جماعية',
          duration_min: 90,
          max_places: 8,
          min_places: 4,
          sessions_count: null,
          cutoff_hours: 2,
          price_iqd: 15000,
          is_active: true,
        },
        {
          id: COURSE_TYPE_ID,
          venue_id: COACH_VENUE_ID,
          kind: 'course',
          name_en: 'Beginners course',
          name_ar: 'دورة المبتدئين',
          duration_min: 60,
          max_places: 6,
          min_places: 3,
          sessions_count: 4,
          cutoff_hours: 24,
          price_iqd: 80000,
          is_active: true,
        },
      ],
      adds_today: 3,
      add_cap: 30,
      private_open: 4,
      private_cap: 10,
      ...over,
    },
    server_now: new Date().toISOString(),
  };
}

export function coachMeRetiredRaw() {
  return {
    coach: {
      id: COACH_ID,
      status: 'retired',
      display_name_en: 'Sara Coach',
      display_name_ar: 'سارة المدرّبة',
    },
    server_now: new Date().toISOString(),
  };
}

/** The parsed coach_me a smoke case seeds through `RenderRouteOptions.coach`. */
export function coachMeFixture(
  over: Record<string, unknown> = {},
  branchOver: Record<string, unknown> = {},
): CoachMeRead {
  return parseCoachMe(coachMeRaw(over, branchOver));
}

export function coachMeRetiredFixture(): CoachMeRead {
  return parseCoachMe(coachMeRetiredRaw());
}

// ── coach_schedule ──────────────────────────────────────────────────────────

export function coachScheduleRaw() {
  const start = Date.parse(startIn(1));
  return {
    lessons: [
      {
        lesson_id: LESSON_ID,
        venue_id: COACH_VENUE_ID,
        kind: 'group',
        course_id: null,
        session_no: null,
        sessions_count: null,
        type_name_en: 'Group clinic',
        type_name_ar: 'حصة جماعية',
        title_en: '',
        title_ar: '',
        start_at: iso(start),
        end_at: iso(start + 1.5 * HOUR),
        status: 'scheduled',
        places_taken: 2,
        max_places: 8,
        min_places: 4,
        cutoff_at: iso(start - 2 * HOUR),
        court_name_en: 'Court 1',
        court_name_ar: 'الملعب 1',
        unmarked: 0,
      },
      {
        lesson_id: PRIVATE_LESSON_ID,
        venue_id: COACH_VENUE_ID,
        kind: 'private',
        course_id: null,
        session_no: null,
        sessions_count: null,
        type_name_en: 'Private lesson',
        type_name_ar: 'حصة خاصة',
        title_en: '',
        title_ar: '',
        start_at: startIn(2, 10),
        end_at: iso(Date.parse(startIn(2, 10)) + HOUR),
        status: 'scheduled',
        places_taken: 2,
        max_places: 4,
        min_places: 1,
        cutoff_at: null,
        court_name_en: 'Court 2',
        court_name_ar: 'الملعب 2',
        unmarked: 0,
      },
    ],
    time_off: [{ id: TIME_OFF_ID, starts_at: startIn(4, 9), ends_at: startIn(4, 21) }],
    server_now: new Date().toISOString(),
  };
}

/** The key coach-mode.tsx reads its schedule under today (whole local days). */
export function coachScheduleKey(): readonly unknown[] {
  const today = localParts(new Date(), COACH_TZ).date;
  const w = scheduleWindow(wallTimeToUtc(today, 12 * 60, COACH_TZ), COACH_TZ);
  return coachKeys.schedule(w.from, w.to);
}

export function coachScheduleFixture() {
  return parseCoachSchedule(coachScheduleRaw());
}

// ── coach_hours_mine ────────────────────────────────────────────────────────

export function coachHoursRaw() {
  return {
    branches: [
      {
        venue_id: COACH_VENUE_ID,
        name_en: 'Touch Padel',
        name_ar: 'تتش بادل',
        timezone: COACH_TZ,
        windows: [
          {
            id: 'w0000000-0000-4000-8000-000000000001',
            weekday: 0,
            start_time: '09:00',
            end_time: '12:00',
            set_by: 'coach',
            updated_at: new Date().toISOString(),
          },
          {
            id: 'w0000000-0000-4000-8000-000000000002',
            weekday: 2,
            start_time: '17:00',
            end_time: '24:00',
            set_by: 'staff',
            updated_at: new Date().toISOString(),
          },
        ],
      },
    ],
    time_off: [
      {
        id: TIME_OFF_ID,
        starts_at: startIn(4, 9),
        ends_at: startIn(4, 21),
        reason: 'Tournament',
        set_by: 'coach',
      },
    ],
    server_now: new Date().toISOString(),
  };
}

export function coachHoursFixture() {
  return parseCoachHours(coachHoursRaw());
}

// ── coach_lesson ────────────────────────────────────────────────────────────

/** A group session that started an hour ago: marks are open (CD-11), phones show (R54). */
export function coachLessonRaw(over: Record<string, unknown> = {}) {
  const start = Date.now() - HOUR;
  return {
    lesson: {
      id: LESSON_ID,
      venue_id: COACH_VENUE_ID,
      kind: 'group',
      course_id: null,
      session_no: null,
      sessions_count: null,
      type_name_en: 'Group clinic',
      type_name_ar: 'حصة جماعية',
      title_en: '',
      title_ar: '',
      start_at: iso(start),
      end_at: iso(start + 1.5 * HOUR),
      status: 'scheduled',
      cancel_reason: null,
      court_name_en: 'Court 1',
      court_name_ar: 'الملعب 1',
      max_places: 8,
      min_places: 4,
      places_taken: 2,
      cutoff_at: iso(start - 2 * HOUR),
      ...over,
    },
    course: null,
    roster: [
      {
        enrolment_id: ENROLMENT_ID,
        name: 'Ali Student',
        phone: '+9647700000011',
        party_size: 1,
        friend_names: [],
        booked_by: 'coach',
        payment_mode: 'desk',
        status: 'booked',
        attendance: null,
      },
      {
        enrolment_id: ENROLMENT_2_ID,
        name: 'Huda Guest',
        phone: '+9647700000012',
        party_size: 1,
        friend_names: [],
        booked_by: 'guest',
        payment_mode: 'online',
        status: 'booked',
        attendance: 'attended',
      },
    ],
    can: {
      add: true,
      remove: true,
      cancel: false,
      cancel_course: false,
      reschedule: false,
      mark: true,
    },
    mark_until: iso(start + 24 * HOUR),
    server_now: new Date().toISOString(),
  };
}

export function coachLessonFixture(over: Record<string, unknown> = {}) {
  return parseCoachLesson(coachLessonRaw(over));
}

// ── coach_slots ─────────────────────────────────────────────────────────────

export function coachSlotsRaw() {
  const first = Date.parse(startIn(1, 10));
  return {
    off: false,
    venue_id: COACH_VENUE_ID,
    lesson_type_id: PRIVATE_TYPE_ID,
    duration_min: 60,
    bookable: true,
    starts: [0, 1, 2].map((k) => ({
      start_at: iso(first + k * HOUR),
      end_at: iso(first + (k + 1) * HOUR),
    })),
  };
}

export function coachSlotsFixture() {
  return parseCoachSlots(coachSlotsRaw());
}

/** The key coach-mode-book.tsx reads the private type's free times under today. */
export function coachSlotsKey(): readonly unknown[] {
  const w = slotsWindow(new Date(), COACH_TZ);
  return coachKeys.slots(COACH_ID, PRIVATE_TYPE_ID, w.from, w.to);
}

// ── my_coach_statements ─────────────────────────────────────────────────────

export function coachStatementsRaw(withLines: boolean) {
  return {
    months: [STATEMENT_MONTH],
    statements: [
      {
        id: STATEMENT_ID,
        venue_id: COACH_VENUE_ID,
        venue_name_en: 'Touch Padel',
        venue_name_ar: 'تتش بادل',
        month: STATEMENT_MONTH,
        status: 'paid',
        lessons_count: 12,
        collected_iqd: 360000,
        court_share_iqd: 60000,
        coach_iqd: 180000,
        adjustments_iqd: 0,
        total_iqd: 180000,
        share_bp: 6000,
        approved_at: '2026-10-01T08:00:00.000Z',
        paid_at: '2026-10-02T08:00:00.000Z',
        paid_reference: 'CASH-0912',
        ...(withLines
          ? {
              lines: [
                {
                  lesson_id: LESSON_ID,
                  start_at: '2026-09-14T15:00:00.000Z',
                  kind: 'group',
                  type_name_en: 'Group clinic',
                  type_name_ar: 'حصة جماعية',
                  collected_iqd: 30000,
                  court_share_iqd: 5000,
                  share_bp: 6000,
                  coach_iqd: 15000,
                  is_adjustment: false,
                },
              ],
            }
          : {}),
      },
    ],
    current_month: [
      {
        venue_id: COACH_VENUE_ID,
        estimate: true,
        lessons: 3,
        collected_iqd: 90000,
        coach_iqd: 45000,
      },
    ],
  };
}

export function coachStatementsFixture(withLines: boolean) {
  return parseCoachStatements(coachStatementsRaw(withLines));
}

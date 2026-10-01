/**
 * The coaching reads as the SERVER answers them (snake_case, every key of
 * `COACHING_SHAPES`, packages/core/src/coaching/shapes.ts), for the parser
 * tests (vitest) and the smoke renders (jest, which seed the PARSED shapes:
 * `parseX(xFixture())`). Each fixture carries every key its shape lists, every
 * nullable object filled in, so `missingKeys(fixture, shape)` is empty and a
 * parser that read a key the shape does not list would be caught
 * (features/coaching/__tests__/logic.test.ts).
 *
 * PURE: no react-native, no expo. Times are relative to now, on the lesson
 * grid of Asia/Baghdad, so a fixture never goes stale.
 */
import { localParts, wallTimeToUtc } from '@touch/core';

export const COACH_TZ = 'Asia/Baghdad';
export const COACH_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';
export const COACH_ID = '5c0ac000-0000-4000-8000-000000000001';
export const TYPE_PRIVATE_ID = '5c0ac000-0000-4000-8000-0000000000a1';
export const TYPE_GROUP_ID = '5c0ac000-0000-4000-8000-0000000000a2';
export const TYPE_COURSE_ID = '5c0ac000-0000-4000-8000-0000000000a3';
export const LESSON_ID = '5c0ac000-0000-4000-8000-0000000000b1';
export const COURSE_ID = '5c0ac000-0000-4000-8000-0000000000c1';
export const COURSE_LESSON_IDS = [
  '5c0ac000-0000-4000-8000-0000000000d1',
  '5c0ac000-0000-4000-8000-0000000000d2',
  '5c0ac000-0000-4000-8000-0000000000d3',
];
export const ENROLMENT_ID = '5c0ac000-0000-4000-8000-0000000000e1';
export const PHOTO_PATH = 'coaches/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f/sara.jpg';

const DAY = 86_400_000;

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y!, m! - 1, d!) + n * DAY);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${out.getUTCFullYear()}-${pad(out.getUTCMonth() + 1)}-${pad(out.getUTCDate())}`;
}

/** `days` from today, venue-local, at `hh:mm` (on the 30-minute grid). */
export function venueAt(days: number, minutes: number, now: Date = new Date()): Date {
  return wallTimeToUtc(addDays(localParts(now, COACH_TZ).date, days), minutes, COACH_TZ);
}

const iso = (d: Date) => d.toISOString();

const coachCard = () => ({
  id: COACH_ID,
  display_name_en: 'Sara Coach',
  display_name_ar: 'سارة المدرّبة',
  photo_path: PHOTO_PATH,
});

/** One group session and one course, as `coaching_public.sessions[]` / `coach_profile.sessions[]` list them. */
export function sessionListingsFixture(now: Date = new Date()) {
  return [
    {
      kind: 'group',
      lesson_id: LESSON_ID,
      course_id: null,
      venue_id: COACH_VENUE_ID,
      coach_id: COACH_ID,
      lesson_type_id: TYPE_GROUP_ID,
      title_en: '',
      title_ar: '',
      start_at: iso(venueAt(2, 18 * 60, now)),
      end_at: iso(venueAt(2, 19 * 60, now)),
      sessions_count: null,
      sessions_left: null,
      places_left: 3,
      max_places: 8,
      signup_closes_at: iso(venueAt(2, 18 * 60, now)),
      cutoff_at: iso(venueAt(2, 16 * 60, now)),
    },
    {
      kind: 'course',
      lesson_id: null,
      course_id: COURSE_ID,
      venue_id: COACH_VENUE_ID,
      coach_id: COACH_ID,
      lesson_type_id: TYPE_COURSE_ID,
      title_en: 'Beginners course',
      title_ar: 'دورة المبتدئين',
      start_at: iso(venueAt(3, 17 * 60, now)),
      end_at: iso(venueAt(3, 18 * 60, now)),
      sessions_count: 3,
      sessions_left: 3,
      places_left: 4,
      max_places: 6,
      signup_closes_at: iso(venueAt(17, 17 * 60, now)),
      cutoff_at: iso(venueAt(3, 15 * 60, now)),
    },
  ];
}

export function coachingPublicFixture(now: Date = new Date()) {
  return {
    off: false,
    branches: [
      {
        venue_id: COACH_VENUE_ID,
        name_en: 'Touch Padel',
        name_ar: 'تاتش بادل',
        timezone: COACH_TZ,
        payment_mode: 'desk',
        prices_public: false,
        cancellation_window_hours: 24,
      },
    ],
    coaches: [
      {
        ...coachCard(),
        bio_en: 'Ten years on court.',
        bio_ar: 'عشر سنوات في الملعب.',
        sort_order: 1,
        venue_ids: [COACH_VENUE_ID],
        offers: [
          { lesson_type_id: TYPE_PRIVATE_ID, venue_id: COACH_VENUE_ID, price_iqd: 30000 },
          { lesson_type_id: TYPE_GROUP_ID, venue_id: COACH_VENUE_ID, price_iqd: 15000 },
        ],
      },
    ],
    lesson_types: [
      {
        id: TYPE_PRIVATE_ID,
        venue_id: COACH_VENUE_ID,
        kind: 'private',
        name_en: 'Private lesson',
        name_ar: 'حصة خاصة',
        description_en: '',
        description_ar: '',
        duration_min: 60,
        max_places: 4,
        min_places: 1,
        sessions_count: null,
        price_iqd: 30000,
        sort_order: 1,
      },
      {
        id: TYPE_GROUP_ID,
        venue_id: COACH_VENUE_ID,
        kind: 'group',
        name_en: 'Group clinic',
        name_ar: 'حصة جماعية',
        description_en: '',
        description_ar: '',
        duration_min: 60,
        max_places: 8,
        min_places: 4,
        sessions_count: null,
        price_iqd: 15000,
        sort_order: 2,
      },
    ],
    sessions: sessionListingsFixture(now),
    server_now: iso(now),
  };
}

const profileOffers = () => [
  {
    lesson_type_id: TYPE_PRIVATE_ID,
    kind: 'private',
    name_en: 'Private lesson',
    name_ar: 'حصة خاصة',
    description_en: '',
    description_ar: '',
    duration_min: 60,
    max_places: 4,
    min_places: 1,
    sessions_count: null,
    cutoff_hours: 0,
    price_iqd: 30000,
  },
  {
    lesson_type_id: TYPE_GROUP_ID,
    kind: 'group',
    name_en: 'Group clinic',
    name_ar: 'حصة جماعية',
    description_en: '',
    description_ar: '',
    duration_min: 60,
    max_places: 8,
    min_places: 4,
    sessions_count: null,
    cutoff_hours: 2,
    price_iqd: 15000,
  },
];

export function coachProfileFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  return {
    off: false,
    coach: {
      ...coachCard(),
      bio_en: 'Ten years on court.',
      bio_ar: 'عشر سنوات في الملعب.',
      status: 'active',
      venue_ids: [COACH_VENUE_ID],
    },
    venue: {
      venue_id: COACH_VENUE_ID,
      name_en: 'Touch Padel',
      name_ar: 'تاتش بادل',
      timezone: COACH_TZ,
      phone: '+9647700000000',
      payment_mode: 'desk',
      prices_public: false,
      cancellation_window_hours: 24,
    },
    offers: profileOffers(),
    sessions: sessionListingsFixture(now),
    server_now: iso(now),
    ...over,
  };
}

/** Two private starts tomorrow evening, venue-local. */
export function coachSlotsFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  return {
    off: false,
    venue_id: COACH_VENUE_ID,
    lesson_type_id: TYPE_PRIVATE_ID,
    duration_min: 60,
    bookable: true,
    starts: [
      { start_at: iso(venueAt(1, 18 * 60, now)), end_at: iso(venueAt(1, 19 * 60, now)) },
      { start_at: iso(venueAt(1, 18 * 60 + 30, now)), end_at: iso(venueAt(1, 19 * 60 + 30, now)) },
    ],
    ...over,
  };
}

/** A group session's offer (open, desk mode), with `mine` and `late_join` filled when `full`. */
export function lessonOfferFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  return {
    kind: 'group',
    lesson_id: LESSON_ID,
    venue_id: COACH_VENUE_ID,
    timezone: COACH_TZ,
    phone: '+9647700000000',
    coach: coachCard(),
    type: {
      id: TYPE_GROUP_ID,
      name_en: 'Group clinic',
      name_ar: 'حصة جماعية',
      description_en: '',
      description_ar: '',
      duration_min: 60,
    },
    title_en: '',
    title_ar: '',
    start_at: iso(venueAt(2, 18 * 60, now)),
    end_at: iso(venueAt(2, 19 * 60, now)),
    status: 'open',
    places_left: 3,
    max_places: 8,
    min_places: 4,
    places_taken: 5,
    cutoff_at: iso(venueAt(2, 16 * 60, now)),
    signup_closes_at: iso(venueAt(2, 18 * 60, now)),
    price_iqd: 15000,
    full_price_iqd: 15000,
    late_join: null,
    payment_mode: 'desk',
    cancellation_window_hours: 24,
    mine: null,
    server_now: iso(now),
    ...over,
  };
}

/** A course's offer, every nullable object filled (a late join, the caller's own place). */
export function courseOfferFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  return {
    kind: 'course',
    course_id: COURSE_ID,
    venue_id: COACH_VENUE_ID,
    timezone: COACH_TZ,
    phone: '+9647700000000',
    coach: coachCard(),
    type: {
      id: TYPE_COURSE_ID,
      name_en: 'Beginners course',
      name_ar: 'دورة المبتدئين',
      description_en: '',
      description_ar: '',
      duration_min: 60,
    },
    title_en: 'Beginners course',
    title_ar: 'دورة المبتدئين',
    start_at: iso(venueAt(3, 17 * 60, now)),
    end_at: iso(venueAt(3, 18 * 60, now)),
    sessions: COURSE_LESSON_IDS.map((lessonId, i) => ({
      lesson_id: lessonId,
      session_no: i + 1,
      start_at: iso(venueAt(3 + 7 * i - 7, 17 * 60, now)),
      end_at: iso(venueAt(3 + 7 * i - 7, 18 * 60, now)),
      status: i === 0 ? 'completed' : 'scheduled',
      started: i === 0,
    })),
    status: 'open',
    places_left: 2,
    max_places: 6,
    min_places: 3,
    places_taken: 4,
    cutoff_at: iso(venueAt(-5, 15 * 60, now)),
    signup_closes_at: iso(venueAt(10, 17 * 60, now)),
    price_iqd: 40000,
    full_price_iqd: 60000,
    late_join: { sessions_left: 2, sessions_count: 3 },
    payment_mode: 'online_optional',
    cancellation_window_hours: 24,
    mine: { enrolment_id: ENROLMENT_ID, status: 'booked' },
    server_now: iso(now),
    ...over,
  };
}

/** One `my_lessons` row: a booked private lesson in two days, paid at the desk. Every nullable object filled. */
export function myLessonRowFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  return {
    enrolment_id: ENROLMENT_ID,
    kind: 'private',
    lesson_id: LESSON_ID,
    course_id: null,
    venue_id: COACH_VENUE_ID,
    coach: coachCard(),
    type_name_en: 'Private lesson',
    type_name_ar: 'حصة خاصة',
    title_en: '',
    title_ar: '',
    start_at: iso(venueAt(2, 18 * 60, now)),
    end_at: iso(venueAt(2, 19 * 60, now)),
    session_no: null,
    sessions_count: null,
    first_session_no: null,
    sessions_covered: null,
    status: 'booked',
    cancel_kind: null,
    lesson_status: 'scheduled',
    attendance: null,
    booked_by: 'guest',
    confirm_needed: false,
    rescheduled: false,
    party_size: 2,
    payment_mode: 'desk',
    price_iqd: 30000,
    paid_online_iqd: 0,
    owed_iqd: 30000,
    refund: { status: 'pending', amount_iqd: 0 },
    places_taken: 1,
    min_places: 1,
    cutoff_at: null,
    pending_payment: {
      request_id: 'req-1',
      deadline_at: iso(new Date(now.getTime() + 10 * 60_000)),
    },
    hold_expires_at: null,
    ...over,
  };
}

/** `my_lesson` for that row: a free cancel, the court, the sessions list filled. */
export function myLessonFixture(over: Record<string, unknown> = {}, now: Date = new Date()) {
  const start = venueAt(2, 18 * 60, now);
  return {
    ...myLessonRowFixture({}, now),
    friend_names: ['Ali'],
    court_name_en: 'Court One',
    court_name_ar: 'الملعب الأول',
    sessions: [
      {
        lesson_id: LESSON_ID,
        session_no: 1,
        start_at: iso(start),
        end_at: iso(venueAt(2, 19 * 60, now)),
        status: 'scheduled',
        rescheduled: false,
        attendance: null,
      },
    ],
    cancel: {
      policy: 'free',
      free_until: iso(new Date(start.getTime() - 24 * 3_600_000)),
      free_because: null,
      refund_iqd: 0,
      kept_iqd: 0,
      counts_late: true,
      refund_sessions: null,
      kept_sessions: null,
      next_start_at: null,
    },
    can: { cancel: true, pay: false, confirm: false },
    branch_phone: '+9647700000000',
    timezone: COACH_TZ,
    server_now: iso(now),
    ...over,
  };
}

export function lessonBeginFixture(over: Record<string, unknown> = {}) {
  return {
    request_id: 'req-lesson-1',
    form_url: 'https://pay.example/qi/1',
    amount_iqd: 30000,
    deadline_at: '2026-10-01T10:15:00.000Z',
    status: 'pending',
    reused: false,
    enrolment_id: ENROLMENT_ID,
    ...over,
  };
}

import { coachingStatus, parseCoachingPublic, type CoachingRead } from '@/lib/coaching';

/**
 * `app.coaching_public` answers for the coaching tests (docs/design/coaching/guest.md §4.3):
 * raw jsonb as the server sends it, built on the read contract's key lists
 * (`COACHING_SHAPES.coaching_public`; coaching.test.ts holds the fixture to them, so a fixture
 * missing a key fails its own test).
 *
 * Every answer also carries what a page must NEVER print, should a server ever send it: a
 * profile id, a phone, a student's name (R43, C-11). The page tests scan the rendered HTML for
 * these values. Prices are always in the answer (C-11: presentation, not secrecy); the branch's
 * `prices_public` decides whether the page shows them.
 *
 * Invented names, like src/test/fixtures.ts. Ids are uuids: a coach's builds its `/c/` link.
 */
export const BRANCH_A = 'c0000000-0000-4000-8000-000000000001';
export const BRANCH_B = 'c0000000-0000-4000-8000-000000000002';

export const COACH_ALI = 'a1b2c3d4-0000-4000-8000-0000000000c1';
export const COACH_SARA = 'a1b2c3d4-0000-4000-8000-0000000000c2';
export const COACH_OMAR = 'a1b2c3d4-0000-4000-8000-0000000000c3';
/** A coach the server never sends (not accepted, paused or retired): sessions of theirs are dropped. */
export const COACH_HIDDEN = 'a1b2c3d4-0000-4000-8000-0000000000c9';

export const TYPE_PRIVATE = 'b0000000-0000-4000-8000-0000000000a1';
export const TYPE_GROUP = 'b0000000-0000-4000-8000-0000000000a2';
export const TYPE_COURSE = 'b0000000-0000-4000-8000-0000000000a3';
export const TYPE_B_PRIVATE = 'b0000000-0000-4000-8000-0000000000b1';

export const GROUP_LESSON = 'd0000000-0000-4000-8000-0000000000e1';
export const COURSE_ID = 'd0000000-0000-4000-8000-0000000000f1';

export const ALI_PHOTO =
  'coaches/0f0e0d0c-0b0a-4908-8706-050403020100/1a2b3c4d-1111-4222-8333-444455556666.jpg';

/** Values that must never reach a rendered page (R43): a profile id, phones, a student. */
export const NEVER_SHOWN = [
  'f9f9f9f9-1111-4222-8333-999999999999', // a profile id
  '7701234567', // a guest phone
  'Zainab', // a student
  'Kareem', // a profile surname
];

/**
 * The prices in the answer (IQD), for the price-hidden and price-shown cases. The session rows
 * carry their own (0294, DB-28): Ali's group session was made at his price and the course at its
 * own, neither the type's, so a page that showed a type's base price on a session fails.
 */
export const PRICES = {
  private: 30000,
  aliPrivate: 35000,
  group: 15000,
  course: 120000,
  groupSession: 18000,
  courseOwn: 110000,
} as const;

const branch = (venueId: string, nameEn: string, nameAr: string, pricesPublic: boolean) => ({
  venue_id: venueId,
  name_en: nameEn,
  name_ar: nameAr,
  timezone: 'Asia/Baghdad',
  payment_mode: 'desk',
  prices_public: pricesPublic,
  cancellation_window_hours: 24,
});

/** The fixture answer: one branch, two coaches, three lesson types, a group session and a course. */
export function coachingAnswer({
  pricesPublic = false,
  secondBranch = false,
}: { pricesPublic?: boolean; secondBranch?: boolean } = {}): Record<string, unknown> {
  return {
    off: false,
    branches: [
      branch(BRANCH_A, 'Fixture Padel', 'بادل التجربة', pricesPublic),
      ...(secondBranch ? [branch(BRANCH_B, 'Fixture Padel Two', 'بادل التجربة الثاني', true)] : []),
    ],
    coaches: [
      {
        id: COACH_ALI,
        display_name_en: 'Ali Fixture',
        display_name_ar: 'علي التجربة',
        bio_en: 'Ten years on court. Patient with beginners, sharp with the bandeja.',
        bio_ar: 'عشر سنوات في الملعب، صبور مع المبتدئين.',
        photo_path: ALI_PHOTO,
        sort_order: 1,
        venue_ids: [BRANCH_A],
        offers: [
          { lesson_type_id: TYPE_PRIVATE, venue_id: BRANCH_A, price_iqd: PRICES.aliPrivate },
          { lesson_type_id: TYPE_GROUP, venue_id: BRANCH_A, price_iqd: PRICES.group },
        ],
        // Never public (R43): a server must not send these, and the page must not print them.
        profile_id: NEVER_SHOWN[0],
        phone: '+964 770 123 4567',
        full_name: 'Ali Kareem',
      },
      {
        id: COACH_SARA,
        display_name_en: 'Sara Fixture',
        display_name_ar: 'سارة التجربة',
        bio_en: '',
        bio_ar: '',
        photo_path: null,
        sort_order: 2,
        venue_ids: [BRANCH_A],
        offers: [{ lesson_type_id: TYPE_COURSE, venue_id: BRANCH_A, price_iqd: PRICES.course }],
      },
      ...(secondBranch
        ? [
            {
              id: COACH_OMAR,
              display_name_en: 'Omar Fixture',
              display_name_ar: 'عمر التجربة',
              bio_en: 'Second branch.',
              bio_ar: 'الفرع الثاني.',
              photo_path: null,
              sort_order: 3,
              venue_ids: [BRANCH_B],
              offers: [{ lesson_type_id: TYPE_B_PRIVATE, venue_id: BRANCH_B, price_iqd: 40000 }],
            },
          ]
        : []),
    ],
    lesson_types: [
      {
        id: TYPE_PRIVATE,
        venue_id: BRANCH_A,
        kind: 'private',
        name_en: 'Private lesson',
        name_ar: 'حصة خاصة',
        description_en: 'One coach, you and up to three friends.',
        description_ar: 'مدرّب واحد وحتى ثلاثة أصدقاء.',
        duration_min: 60,
        max_places: 4,
        min_places: 1,
        sessions_count: null,
        price_iqd: PRICES.private,
        sort_order: 1,
      },
      {
        id: TYPE_GROUP,
        venue_id: BRANCH_A,
        kind: 'group',
        name_en: 'Group clinic',
        name_ar: 'حصة جماعية',
        description_en: '',
        description_ar: '',
        duration_min: 90,
        max_places: 8,
        min_places: 4,
        sessions_count: null,
        price_iqd: PRICES.group,
        sort_order: 2,
      },
      {
        id: TYPE_COURSE,
        venue_id: BRANCH_A,
        kind: 'course',
        name_en: 'Beginner course',
        name_ar: 'دورة المبتدئين',
        description_en: 'Eight weeks from the first touch.',
        description_ar: 'ثمانية أسابيع من اللمسة الأولى.',
        duration_min: 60,
        max_places: 6,
        min_places: 3,
        sessions_count: 8,
        price_iqd: PRICES.course,
        sort_order: 3,
      },
      ...(secondBranch
        ? [
            {
              id: TYPE_B_PRIVATE,
              venue_id: BRANCH_B,
              kind: 'private',
              name_en: 'Private lesson (Two)',
              name_ar: 'حصة خاصة (الثاني)',
              description_en: '',
              description_ar: '',
              duration_min: 60,
              max_places: 2,
              min_places: 1,
              sessions_count: null,
              price_iqd: 40000,
              sort_order: 1,
            },
          ]
        : []),
    ],
    sessions: [
      {
        kind: 'group',
        lesson_id: GROUP_LESSON,
        course_id: null,
        venue_id: BRANCH_A,
        coach_id: COACH_ALI,
        lesson_type_id: TYPE_GROUP,
        title_en: '',
        title_ar: '',
        start_at: '2026-10-02T16:30:00+00:00',
        end_at: '2026-10-02T18:00:00+00:00',
        sessions_count: null,
        sessions_left: null,
        places_left: 3,
        max_places: 8,
        signup_closes_at: '2026-10-02T16:30:00+00:00',
        cutoff_at: '2026-10-02T14:30:00+00:00',
        price_iqd: PRICES.groupSession,
        full_price_iqd: PRICES.groupSession,
        // Never public (C-11): a count of places is all the page may say.
        students: [{ name: 'Zainab H.', phone: '+9647701234567' }],
      },
      {
        kind: 'course',
        lesson_id: null,
        course_id: COURSE_ID,
        venue_id: BRANCH_A,
        coach_id: COACH_SARA,
        lesson_type_id: TYPE_COURSE,
        title_en: 'October beginners',
        title_ar: 'مبتدئو أكتوبر',
        start_at: '2026-10-04T15:00:00+00:00',
        end_at: '2026-10-04T16:00:00+00:00',
        sessions_count: 8,
        sessions_left: 8,
        places_left: 2,
        max_places: 6,
        signup_closes_at: '2026-11-22T15:00:00+00:00',
        cutoff_at: '2026-10-03T15:00:00+00:00',
        price_iqd: PRICES.courseOwn,
        full_price_iqd: PRICES.courseOwn,
      },
      {
        // A coach the server should not have sent: the parser drops their session.
        kind: 'group',
        lesson_id: 'd0000000-0000-4000-8000-0000000000e9',
        course_id: null,
        venue_id: BRANCH_A,
        coach_id: COACH_HIDDEN,
        lesson_type_id: TYPE_GROUP,
        title_en: 'Hidden coach session',
        title_ar: 'حصة مدرّب مخفي',
        start_at: '2026-10-03T16:30:00+00:00',
        end_at: '2026-10-03T18:00:00+00:00',
        sessions_count: null,
        sessions_left: null,
        places_left: 5,
        max_places: 8,
        signup_closes_at: '2026-10-03T16:30:00+00:00',
        cutoff_at: '2026-10-03T14:30:00+00:00',
        price_iqd: PRICES.group,
        full_price_iqd: PRICES.group,
      },
    ],
    server_now: '2026-10-01T09:00:00+00:00',
  };
}

/** What `getCachedCoaching` answers for a raw `coaching_public` answer (no network). */
export function coachingRead(raw: unknown): CoachingRead {
  const coaching = parseCoachingPublic(raw);
  if (!coaching) return { status: 'error', coaching: null };
  const status = coachingStatus(coaching);
  return { status, coaching: status === 'off' ? null : coaching };
}

export const COACHING_OFF: CoachingRead = { status: 'off', coaching: null };
export const COACHING_ERROR: CoachingRead = { status: 'error', coaching: null };

/**
 * The mocked read, as mutable state (a module mock factory runs once, and `restoreMocks: true`
 * would wipe a `vi.fn()` implementation between cases). A page test mocks the module with:
 *
 *   vi.mock('@/lib/coaching.server', async () => {
 *     const { coachingServer } = await import('@/test/coachingFixtures');
 *     return { getCachedCoaching: () => Promise.resolve(coachingServer.read) };
 *   });
 */
export const coachingServer: { read: CoachingRead; calls: number } = {
  read: COACHING_OFF,
  calls: 0,
};

export function resetCoachingServer(read: CoachingRead = COACHING_OFF): void {
  coachingServer.read = read;
  coachingServer.calls = 0;
}

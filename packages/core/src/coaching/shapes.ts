/**
 * The coaching read and write contracts (R41, R72; build contracts §1.13–§1.14).
 *
 * One entry per RPC answer the clients parse: the keys each answer always carries, picked by the
 * privacy review's binding table (`drafts/review-rules-privacy-2026-10-01.md` §5, X1–X29: the
 * client lane's name wins where a client renders a field) and written out in `guest.md` §4.3,
 * `operator.md` §5.6–§5.7 and `money.md` §5.3, §5.11, §6.6, §7.5, §8.
 *
 * - The database's `coaching-shapes.test.ts` asserts every RPC result's keys ⊇ its list here.
 * - The phone, web and operator parsers read the same lists (a missing key falls back, never
 *   throws).
 * - A server may ADD keys; it never renames or drops one listed here.
 *
 * Conventions:
 * - A list describes the full answer: coaching on, the row found. The short answers (`{off:
 *   true}`, `{coach: null}`, `{duplicate: true}` on an un-keyed repeat) are not described.
 * - A key whose value is null still counts as carried.
 * - `nested` maps a path to the keys of the object(s) found there. Path segments are joined with
 *   `.`; a segment ending in `[]` is an array whose every element is checked. A path whose value
 *   is absent or null is skipped (nullable objects such as `venue`, `course`, `mine`): the parent's
 *   list decides whether the key itself must be there.
 * - `optional` names keys an answer carries only for some rows (a course's `sessions`), as paths
 *   in the `nested` form without the trailing `[]` (`'statements[].lines'`).
 * - `oneOf` groups keys of which the answer carries at least one (`lesson_offer`: `lesson_id` for a
 *   group session, `course_id` for a course).
 * - `array: true`: the answer is a bare array of rows; `keys`, `nested`, `oneOf` describe each row.
 */

export interface CoachingShape {
  /** The callable whose answer this is: a public RPC, the `lesson-begin` edge, or an internal. */
  readonly rpc: string;
  /** The binding row of the privacy review §5 (R41), or null for a shape outside that table. */
  readonly x: string | null;
  /** True when the answer is a bare array of rows. */
  readonly array?: boolean;
  /** Keys the answer always carries. */
  readonly keys: readonly string[];
  /** Keys carried only by some answers (paths, see the file comment). */
  readonly optional?: readonly string[];
  /** Groups of keys of which at least one is carried. */
  readonly oneOf?: readonly (readonly string[])[];
  /** Nested objects and arrays: path → keys. */
  readonly nested?: Readonly<Record<string, readonly string[]>>;
}

// ---------------------------------------------------------------------------------------------
// Fragments used by more than one answer.

/** A coach as a guest surface shows them (public display names only; `id` is `coaches.id`, R43). */
const COACH_CARD = ['id', 'display_name_en', 'display_name_ar', 'photo_path'] as const;

/** `coaching_public.sessions[]` and `coach_profile.sessions[]` (X1, X2). */
const SESSION_LISTING = [
  'kind',
  'lesson_id',
  'course_id',
  'venue_id',
  'coach_id',
  'lesson_type_id',
  'title_en',
  'title_ar',
  'start_at',
  'end_at',
  'sessions_count',
  'sessions_left',
  'places_left',
  'max_places',
  'signup_closes_at',
  'cutoff_at',
] as const;

/** One `my_lessons` row; `my_lesson` adds its detail (X7, X8). */
const MY_LESSON_ROW = [
  'enrolment_id',
  'kind',
  'lesson_id',
  'course_id',
  'venue_id',
  'coach',
  'type_name_en',
  'type_name_ar',
  'title_en',
  'title_ar',
  'start_at',
  'end_at',
  'session_no',
  'sessions_count',
  'first_session_no',
  'sessions_covered',
  'status',
  'cancel_kind',
  'lesson_status',
  'attendance',
  'booked_by',
  'confirm_needed',
  'rescheduled',
  'party_size',
  'payment_mode',
  'price_iqd',
  'paid_online_iqd',
  'owed_iqd',
  'refund',
  'places_taken',
  'min_places',
  'cutoff_at',
  'pending_payment',
  'hold_expires_at',
] as const;

const MY_LESSON_NESTED = {
  coach: COACH_CARD,
  refund: ['status', 'amount_iqd'],
  pending_payment: ['request_id', 'deadline_at'],
} as const;

/** A `report_coach_statements` row, also `coach_statement_detail.statement` (X22, X23). */
const STATEMENT_ROW = [
  'statement_id',
  'coach_id',
  'coach_name_en',
  'coach_name_ar',
  'venue_id',
  'venue_name_en',
  'venue_name_ar',
  'status',
  'lessons_count',
  'collected_iqd',
  'court_share_iqd',
  'coach_iqd',
  'adjustments_iqd',
  'total_iqd',
  'payable_iqd',
  'drafted_at',
  'refreshed_at',
  'approved_at',
  'approved_by_name',
  'paid_at',
  'paid_by_name',
  'paid_reference',
  'voided_at',
  'void_reason',
] as const;

/** `coach_create_course` and `desk_create_course` (X13: both `lesson_ids` and `sessions`). */
const COURSE_CREATED = {
  keys: [
    'duplicate',
    'course_id',
    'lesson_ids',
    'sessions',
    'price_iqd',
    'cutoff_at',
    'signup_closes_at',
  ],
  nested: {
    'sessions[]': [
      'session_no',
      'lesson_id',
      'start_at',
      'end_at',
      'court_name_en',
      'court_name_ar',
    ],
  },
} as const;

/** `coach_create_group` and `desk_create_group` (db.md §4.7.4). */
const GROUP_CREATED = [
  'duplicate',
  'lesson_id',
  'start_at',
  'end_at',
  'cutoff_at',
  'court_id',
  'court_name_en',
  'court_name_ar',
  'price_iqd',
  'max_places',
  'min_places',
] as const;

/** `coach_reschedule_session` and `desk_reschedule_session` (R8; db.md §4.7.6). */
const RESCHEDULED = [
  'lesson_id',
  'start_at',
  'end_at',
  'court_id',
  'court_name_en',
  'court_name_ar',
] as const;

/** `coaching_settings` and `set_coaching_settings` (X20, R50, R56, R67). */
const COACHING_SETTINGS = [
  'venue_id',
  'coaching_enabled',
  'lesson_payment_mode',
  'coach_share_bp',
  'lesson_prices_public',
  'coach_max_open_private',
  'online_payments_available',
] as const;

// ---------------------------------------------------------------------------------------------

const shapes = {
  // ---- Public reads (anon + authenticated; R12). Never a profile id, a student, a guest phone or
  // a court id (R43); the only phone is the branch's.

  coaching_public: {
    rpc: 'coaching_public',
    x: 'X1',
    keys: ['off', 'branches', 'coaches', 'lesson_types', 'sessions', 'server_now'],
    nested: {
      'branches[]': [
        'venue_id',
        'name_en',
        'name_ar',
        'timezone',
        'payment_mode',
        'prices_public',
        'cancellation_window_hours',
      ],
      'coaches[]': [
        'id',
        'display_name_en',
        'display_name_ar',
        'bio_en',
        'bio_ar',
        'photo_path',
        'sort_order',
        'venue_ids',
        'offers',
      ],
      'coaches[].offers[]': ['lesson_type_id', 'venue_id', 'price_iqd'],
      'lesson_types[]': [
        'id',
        'venue_id',
        'kind',
        'name_en',
        'name_ar',
        'description_en',
        'description_ar',
        'duration_min',
        'max_places',
        'min_places',
        'sessions_count',
        'price_iqd',
        'sort_order',
      ],
      'sessions[]': SESSION_LISTING,
    },
  },

  coach_profile: {
    rpc: 'coach_profile',
    x: 'X2',
    keys: ['off', 'coach', 'venue', 'offers', 'sessions', 'server_now'],
    nested: {
      coach: [
        'id',
        'display_name_en',
        'display_name_ar',
        'bio_en',
        'bio_ar',
        'photo_path',
        'status',
        'venue_ids',
      ],
      venue: [
        'venue_id',
        'name_en',
        'name_ar',
        'timezone',
        'phone',
        'payment_mode',
        'prices_public',
        'cancellation_window_hours',
      ],
      'offers[]': [
        'lesson_type_id',
        'kind',
        'name_en',
        'name_ar',
        'description_en',
        'description_ar',
        'duration_min',
        'max_places',
        'min_places',
        'sessions_count',
        'cutoff_hours',
        'price_iqd',
      ],
      'sessions[]': SESSION_LISTING,
    },
  },

  coach_slots: {
    rpc: 'coach_slots',
    x: 'X3',
    keys: ['off', 'venue_id', 'lesson_type_id', 'duration_min', 'bookable', 'starts'],
    nested: { 'starts[]': ['start_at', 'end_at'] },
  },

  lesson_offer: {
    rpc: 'lesson_offer',
    x: 'X4',
    keys: [
      'kind',
      'venue_id',
      'timezone',
      'phone',
      'coach',
      'type',
      'title_en',
      'title_ar',
      'start_at',
      'end_at',
      'status',
      'places_left',
      'max_places',
      'min_places',
      'places_taken',
      'cutoff_at',
      'signup_closes_at',
      'price_iqd',
      'full_price_iqd',
      'late_join',
      'payment_mode',
      'cancellation_window_hours',
      'mine',
      'server_now',
    ],
    oneOf: [['lesson_id', 'course_id']],
    optional: ['sessions'],
    nested: {
      coach: COACH_CARD,
      type: ['id', 'name_en', 'name_ar', 'description_en', 'description_ar', 'duration_min'],
      'sessions[]': ['lesson_id', 'session_no', 'start_at', 'end_at', 'status', 'started'],
      late_join: ['sessions_left', 'sessions_count'],
      mine: ['enrolment_id', 'status'],
    },
  },

  // ---- Guest (lesson_guest first).

  lesson_book_private: {
    rpc: 'lesson_book_private',
    x: 'X5',
    keys: [
      'duplicate',
      'enrolment_id',
      'lesson_id',
      'status',
      'hold_expires_at',
      'payment_mode',
      'price_iqd',
      'start_at',
      'end_at',
      'court_name_en',
      'court_name_ar',
      'venue_id',
    ],
  },

  lesson_join: {
    rpc: 'lesson_join',
    x: 'X5',
    keys: [
      'duplicate',
      'enrolment_id',
      'lesson_id',
      'status',
      'hold_expires_at',
      'payment_mode',
      'price_iqd',
      'places_left',
    ],
  },

  course_join: {
    rpc: 'course_join',
    x: 'X5',
    keys: [
      'duplicate',
      'enrolment_id',
      'course_id',
      'status',
      'hold_expires_at',
      'payment_mode',
      'price_iqd',
      'places_left',
    ],
  },

  lesson_cancel_mine: {
    rpc: 'lesson_cancel_mine',
    x: 'X6',
    keys: [
      'duplicate',
      'enrolment_id',
      'status',
      'cancel_kind',
      'refunds_started',
      'strike',
      'refund_iqd',
      'kept_iqd',
    ],
  },

  my_lessons: {
    rpc: 'my_lessons',
    x: 'X7',
    array: true,
    keys: MY_LESSON_ROW,
    nested: MY_LESSON_NESTED,
  },

  my_lesson: {
    rpc: 'my_lesson',
    x: 'X8',
    keys: [
      ...MY_LESSON_ROW,
      'friend_names',
      'court_name_en',
      'court_name_ar',
      'cancel',
      'can',
      'branch_phone',
      'timezone',
      'server_now',
    ],
    optional: ['sessions'],
    nested: {
      ...MY_LESSON_NESTED,
      'sessions[]': [
        'lesson_id',
        'session_no',
        'start_at',
        'end_at',
        'status',
        'rescheduled',
        'attendance',
      ],
      cancel: [
        'policy',
        'free_until',
        'free_because',
        'refund_iqd',
        'kept_iqd',
        'counts_late',
        'refund_sessions',
        'kept_sessions',
        'next_start_at',
      ],
      can: ['cancel', 'pay', 'confirm'],
    },
  },

  // ---- Coach (coach_self first; every row the caller's own).

  coach_me: {
    rpc: 'coach_me',
    x: 'X9',
    keys: ['coach', 'server_now'],
    nested: {
      coach: [
        'id',
        'status',
        'display_name_en',
        'display_name_ar',
        'bio_en',
        'bio_ar',
        'photo_path',
        'public_accepted',
        'branches',
        'lesson_types',
        'adds_today',
        'add_cap',
        'private_open',
        'private_cap',
      ],
      'coach.branches[]': ['venue_id', 'name_en', 'name_ar', 'timezone', 'coaching_enabled'],
      'coach.lesson_types[]': [
        'id',
        'venue_id',
        'kind',
        'name_en',
        'name_ar',
        'duration_min',
        'max_places',
        'min_places',
        'sessions_count',
        'cutoff_hours',
        'price_iqd',
        'is_active',
      ],
    },
  },

  /** `coach_me` for a retired coach (R45, C-25): the card and nothing else. */
  coach_me_retired: {
    rpc: 'coach_me',
    x: 'X9',
    keys: ['coach', 'server_now'],
    nested: { coach: ['id', 'status', 'display_name_en', 'display_name_ar'] },
  },

  coach_schedule: {
    rpc: 'coach_schedule',
    x: 'X10',
    keys: ['lessons', 'time_off', 'server_now'],
    nested: {
      'lessons[]': [
        'lesson_id',
        'venue_id',
        'kind',
        'course_id',
        'session_no',
        'sessions_count',
        'type_name_en',
        'type_name_ar',
        'title_en',
        'title_ar',
        'start_at',
        'end_at',
        'status',
        'places_taken',
        'max_places',
        'min_places',
        'cutoff_at',
        'court_name_en',
        'court_name_ar',
        'unmarked',
      ],
      'time_off[]': ['id', 'starts_at', 'ends_at'],
    },
  },

  coach_hours_mine: {
    rpc: 'coach_hours_mine',
    x: null,
    keys: ['branches', 'time_off', 'server_now'],
    nested: {
      'branches[]': ['venue_id', 'name_en', 'name_ar', 'timezone', 'windows'],
      'branches[].windows[]': ['id', 'weekday', 'start_time', 'end_time', 'set_by', 'updated_at'],
      'time_off[]': ['id', 'starts_at', 'ends_at', 'reason', 'set_by'],
    },
  },

  coach_lesson: {
    rpc: 'coach_lesson',
    x: 'X11',
    keys: ['lesson', 'course', 'roster', 'can', 'mark_until', 'server_now'],
    nested: {
      lesson: [
        'id',
        'venue_id',
        'kind',
        'course_id',
        'session_no',
        'sessions_count',
        'type_name_en',
        'type_name_ar',
        'title_en',
        'title_ar',
        'start_at',
        'end_at',
        'status',
        'cancel_reason',
        'court_name_en',
        'court_name_ar',
        'max_places',
        'min_places',
        'places_taken',
        'cutoff_at',
      ],
      course: ['id', 'status', 'sessions'],
      'course.sessions[]': ['lesson_id', 'session_no', 'start_at', 'end_at', 'status'],
      'roster[]': [
        'enrolment_id',
        'name',
        'phone',
        'party_size',
        'friend_names',
        'booked_by',
        'payment_mode',
        'status',
        'attendance',
      ],
      can: ['add', 'remove', 'cancel', 'cancel_course', 'reschedule', 'mark'],
    },
  },

  my_coach_statements: {
    rpc: 'my_coach_statements',
    x: 'X12',
    keys: ['months', 'statements', 'current_month'],
    optional: ['statements[].lines'],
    nested: {
      'statements[]': [
        'id',
        'venue_id',
        'venue_name_en',
        'venue_name_ar',
        'month',
        'status',
        'lessons_count',
        'collected_iqd',
        'court_share_iqd',
        'coach_iqd',
        'adjustments_iqd',
        'total_iqd',
        'share_bp',
        'approved_at',
        'paid_at',
        'paid_reference',
      ],
      'statements[].lines[]': [
        'lesson_id',
        'start_at',
        'kind',
        'type_name_en',
        'type_name_ar',
        'collected_iqd',
        'court_share_iqd',
        'share_bp',
        'coach_iqd',
        'is_adjustment',
      ],
      'current_month[]': ['venue_id', 'estimate', 'lessons', 'collected_iqd', 'coach_iqd'],
    },
  },

  coach_book_private: {
    rpc: 'coach_book_private',
    x: null,
    keys: [
      'duplicate',
      'lesson_id',
      'enrolment_id',
      'start_at',
      'end_at',
      'court_name_en',
      'court_name_ar',
      'price_iqd',
    ],
  },

  coach_create_group: { rpc: 'coach_create_group', x: null, keys: GROUP_CREATED },

  coach_create_course: { rpc: 'coach_create_course', x: 'X13', ...COURSE_CREATED },

  /** The same answer whether or not the typed phone matched an account (R10, R44). */
  coach_add_student: {
    rpc: 'coach_add_student',
    x: null,
    keys: ['duplicate', 'enrolment_id', 'places_left'],
  },

  coach_reschedule_session: { rpc: 'coach_reschedule_session', x: null, keys: RESCHEDULED },

  // ---- Staff: settings, coaches, desk.

  coaching_settings: { rpc: 'coaching_settings', x: 'X20', keys: COACHING_SETTINGS },

  set_coaching_settings: { rpc: 'set_coaching_settings', x: 'X20', keys: COACHING_SETTINGS },

  coaches_admin: {
    rpc: 'coaches_admin',
    x: 'X19',
    keys: ['coaching_enabled', 'server_now', 'coaches', 'lesson_types'],
    nested: {
      'coaches[]': [
        'coach_id',
        'profile_id',
        'full_name',
        'phone',
        'account_deleted',
        'display_name_en',
        'display_name_ar',
        'bio_en',
        'bio_ar',
        'photo_path',
        'status',
        'public_accepted_at',
        'sort_order',
        'venue_ids',
        'lesson_type_ids',
        'prices',
        'hours',
        'hours_set_by',
        'hours_set_by_name',
        'hours_updated_at',
        'hours_elsewhere',
        'time_off',
        'upcoming_lessons',
        'open_courses',
      ],
      'coaches[].prices[]': ['lesson_type_id', 'price_iqd'],
      'coaches[].hours[]': ['weekday', 'start_time', 'end_time'],
      'coaches[].hours_elsewhere[]': [
        'venue_id',
        'venue_name_en',
        'venue_name_ar',
        'weekday',
        'start_time',
        'end_time',
      ],
      'coaches[].time_off[]': ['id', 'starts_at', 'ends_at', 'reason', 'set_by', 'set_by_name'],
      'lesson_types[]': [
        'lesson_type_id',
        'kind',
        'name_en',
        'name_ar',
        'description_en',
        'description_ar',
        'duration_min',
        'price_iqd',
        'court_share_iqd',
        'max_places',
        'min_places',
        'cutoff_hours',
        'sessions_count',
        'is_active',
        'launched_at',
        'sort_order',
        'coach_ids',
        'pending_run',
      ],
      'lesson_types[].pending_run': ['run_id', 'change'],
    },
  },

  set_coach_status: {
    rpc: 'set_coach_status',
    x: 'X29',
    keys: ['coach_id', 'status', 'lessons_cancelled', 'courses_cancelled', 'duplicate'],
  },

  desk_lessons: {
    rpc: 'desk_lessons',
    x: 'X16',
    keys: [
      'coaching_enabled',
      'lesson_payment_mode',
      'server_now',
      'coaches',
      'lesson_types',
      'lessons',
    ],
    nested: {
      'coaches[]': [
        'coach_id',
        'display_name_en',
        'display_name_ar',
        'status',
        'photo_path',
        'lesson_type_ids',
        'prices',
      ],
      'coaches[].prices[]': ['lesson_type_id', 'price_iqd'],
      'lesson_types[]': [
        'lesson_type_id',
        'kind',
        'name_en',
        'name_ar',
        'duration_min',
        'price_iqd',
        'max_places',
        'min_places',
        'cutoff_hours',
        'sessions_count',
      ],
      'lessons[]': [
        'lesson_id',
        'reservation_id',
        'court_id',
        'court_name_en',
        'court_name_ar',
        'kind',
        'status',
        'start_at',
        'end_at',
        'hold_expires_at',
        'booked_by_kind',
        'coach_id',
        'coach_name_en',
        'coach_name_ar',
        'lesson_type_id',
        'type_name_en',
        'type_name_ar',
        'course',
        'label',
        'party_size',
        'places_taken',
        'max_places',
        'min_places',
        'cutoff_at',
        'enrolments',
        'owing',
        'owing_iqd',
        'paid_online',
      ],
      'lessons[].course': ['course_id', 'title_en', 'title_ar', 'session_no', 'sessions_count'],
    },
  },

  desk_lesson_detail: {
    rpc: 'desk_lesson_detail',
    x: 'X17',
    keys: ['lesson', 'enrolments', 'events'],
    nested: {
      lesson: [
        'id',
        'venue_id',
        'kind',
        'status',
        'cancel_reason',
        'start_at',
        'end_at',
        'duration_min',
        'rescheduled_at',
        'booked_by_kind',
        'coach',
        'lesson_type',
        'course',
        'reservation_id',
        'reservation_status',
        'court_id',
        'court_name_en',
        'court_name_ar',
        'price_iqd',
        'court_share_iqd',
        'max_places',
        'min_places',
        'places_taken',
        'cutoff_at',
        'hold_expires_at',
        'created_by_name',
        'server_now',
        'day_open',
        'can',
      ],
      'lesson.coach': ['coach_id', 'display_name_en', 'display_name_ar', 'status'],
      'lesson.lesson_type': ['lesson_type_id', 'name_en', 'name_ar'],
      'lesson.course': [
        'course_id',
        'title_en',
        'title_ar',
        'status',
        'cancel_reason',
        'session_no',
        'sessions_count',
        'signup_closes_at',
        'places_taken',
        'max_places',
        'sessions',
      ],
      'lesson.course.sessions[]': [
        'lesson_id',
        'session_no',
        'start_at',
        'end_at',
        'status',
        'court_name_en',
        'court_name_ar',
      ],
      'lesson.can': ['add_student', 'cancel', 'cancel_course', 'reschedule', 'move_court'],
      'enrolments[]': [
        'enrolment_id',
        'scope',
        'status',
        'cancel_kind',
        'cancelled_at',
        'customer_id',
        'full_name',
        'phone',
        'typed',
        'flags',
        'party_size',
        'friend_names',
        'first_session_no',
        'sessions_covered',
        'booked_by_kind',
        'booked_by_name',
        'payment_mode',
        'created_at',
        'attendance',
        'money',
        'can',
      ],
      'enrolments[].attendance': ['status', 'marked_at', 'marked_by_name'],
      'enrolments[].money': [
        'price_iqd',
        'owed_iqd',
        'desk_paid_iqd',
        'online_paid_iqd',
        'refunded_iqd',
        'kept_iqd',
        'refund_due_iqd',
        'take_iqd',
      ],
      'enrolments[].can': ['take_payment', 'cancel', 'mark_attended', 'mark_no_show', 'unmark'],
      'events[]': ['at', 'type', 'actor', 'actor_name', 'enrolment_id', 'code', 'late'],
    },
  },

  customer_lessons: {
    rpc: 'customer_lessons',
    x: 'X18',
    keys: ['coach', 'counts', 'lesson_strikes_30d', 'lessons'],
    nested: {
      coach: ['coach_id', 'status', 'display_name_en', 'display_name_ar', 'venue_ids'],
      counts: ['lessons', 'no_shows'],
      'lessons[]': [
        'enrolment_id',
        'lesson_id',
        'course_id',
        'venue_id',
        'kind',
        'start_at',
        'end_at',
        'status',
        'enrolment_status',
        'attendance',
        'type_name_en',
        'type_name_ar',
        'coach_name_en',
        'coach_name_ar',
        'course_title_en',
        'course_title_ar',
        'payment_mode',
        'money',
      ],
      'lessons[].money': [
        'owed_iqd',
        'desk_paid_iqd',
        'online_paid_iqd',
        'refund_due_iqd',
        'take_iqd',
      ],
    },
  },

  desk_book_lesson: {
    rpc: 'desk_book_lesson',
    x: 'X29',
    keys: [
      'duplicate',
      'lesson_id',
      'enrolment_id',
      'court_id',
      'court_name_en',
      'court_name_ar',
      'start_at',
      'end_at',
      'price_iqd',
    ],
  },

  desk_create_group: { rpc: 'desk_create_group', x: 'X29', keys: GROUP_CREATED },

  desk_create_course: { rpc: 'desk_create_course', x: 'X13', ...COURSE_CREATED },

  desk_add_student: {
    rpc: 'desk_add_student',
    x: 'X29',
    keys: ['duplicate', 'enrolment_id', 'price_iqd', 'places_left'],
  },

  desk_cancel_enrolment: {
    rpc: 'desk_cancel_enrolment',
    x: 'X29',
    keys: ['enrolment_id', 'status', 'refund_due_iqd', 'online_refund'],
  },

  desk_cancel_lesson: { rpc: 'desk_cancel_lesson', x: 'X29', keys: ['lesson_id', 'status'] },

  desk_cancel_course: {
    rpc: 'desk_cancel_course',
    x: 'X29',
    keys: ['course_id', 'status', 'sessions_cancelled'],
  },

  desk_reschedule_session: { rpc: 'desk_reschedule_session', x: 'X29', keys: RESCHEDULED },

  // ---- Money (money.md): the engine, desk and online money, statements, reports.

  /** Internal (service role): the money engine every lesson figure reads (money.md §5.3). */
  lesson_enrolment_money: {
    rpc: 'lesson_enrolment_money',
    x: null,
    keys: [
      'enrolment_id',
      'kind',
      'status',
      'cancel_kind',
      'payment_mode',
      'price_iqd',
      'due_iqd',
      'payable',
      'final',
      'desk_paid_iqd',
      'desk_refunded_iqd',
      'online_paid_iqd',
      'online_refunded_iqd',
      'online_refundable_iqd',
      'paid_gross_iqd',
      'net_iqd',
      'kept_iqd',
      'real_kept_iqd',
      'owed_iqd',
      'refund_due_iqd',
      'refund_due_online_iqd',
      'refund_due_desk_iqd',
      'refund_blocked_iqd',
      'sandbox',
      'if_cancelled',
      'sessions',
    ],
    nested: {
      if_cancelled: ['guest_free', 'guest_late'],
      'if_cancelled.guest_free': ['refund_iqd', 'kept_iqd'],
      'if_cancelled.guest_late': ['refund_iqd', 'kept_iqd'],
      'sessions[]': [
        'lesson_id',
        'session_no',
        'start_at',
        'status',
        'share_iqd',
        'counts',
        'alloc_iqd',
      ],
    },
  },

  lesson_settle: {
    rpc: 'lesson_settle',
    x: null,
    keys: ['duplicate', 'payment_id', 'amount_iqd', 'change_iqd'],
  },

  lesson_refunds_due: {
    rpc: 'lesson_refunds_due',
    x: 'X21',
    keys: ['venue_id', 'total_iqd', 'items'],
    nested: {
      'items[]': [
        'enrolment_id',
        'lesson_id',
        'course_id',
        'kind',
        'coach_id',
        'coach_name_en',
        'coach_name_ar',
        'type_name_en',
        'type_name_ar',
        'start_at',
        'label',
        'phone',
        'cancel_kind',
        'cancelled_at',
        'refund_due_iqd',
        'refund_due_desk_iqd',
        'online_blocked_iqd',
        'payments',
      ],
      'items[].payments[]': [
        'payment_id',
        'tab_id',
        'method',
        'amount_iqd',
        'refunded_iqd',
        'refundable_iqd',
        'created_at',
      ],
    },
  },

  /** `deposit_status` for a `purpose 'lesson'` row (money.md §6.6; the `lesson` block is X14's union). */
  deposit_status: {
    rpc: 'deposit_status',
    x: 'X14',
    keys: [
      'request_id',
      'purpose',
      'status',
      'failure_code',
      'amount_iqd',
      'price_iqd',
      'rest_iqd',
      'deadline_at',
      'form_url',
      'refund_reason',
      'refund_amount_iqd',
      'refunded_at',
      'sandbox',
      'deposit_mode',
      'attempts_left',
      'hold_live',
      'reservation',
      'ticket_count',
      'lesson',
      'server_now',
    ],
    nested: {
      lesson: [
        'enrolment_id',
        'enrolment_status',
        'kind',
        'lesson_id',
        'course_id',
        'start_at',
        'end_at',
        'venue_id',
        'coach_id',
        'coach_name_en',
        'coach_name_ar',
        'type_name_en',
        'type_name_ar',
      ],
    },
  },

  /** The `lesson-begin` edge function's 200 body (money.md §6.7). */
  'lesson-begin': {
    rpc: 'lesson-begin',
    x: null,
    keys: [
      'request_id',
      'form_url',
      'amount_iqd',
      'deadline_at',
      'status',
      'reused',
      'enrolment_id',
    ],
  },

  report_coach_statements: {
    rpc: 'report_coach_statements',
    x: 'X22',
    keys: ['month', 'current_month', 'server_now', 'statements', 'missing', 'totals'],
    nested: {
      'statements[]': STATEMENT_ROW,
      'missing[]': ['coach_id', 'coach_name_en', 'coach_name_ar', 'venue_id', 'reason'],
      totals: [
        'statements',
        'collected_iqd',
        'court_share_iqd',
        'coach_iqd',
        'adjustments_iqd',
        'total_iqd',
        'payable_iqd',
        'approved_unpaid_iqd',
        'unpaid_iqd',
        'paid_iqd',
      ],
    },
  },

  coach_statement_detail: {
    rpc: 'coach_statement_detail',
    x: 'X23',
    keys: ['statement', 'stale', 'can', 'coach_booked_no_shows', 'lines'],
    nested: {
      statement: STATEMENT_ROW,
      can: ['refresh', 'approve', 'void', 'mark_paid'],
      // R72: an array of the coach-booked no-shows, never a student's name beyond the label.
      'coach_booked_no_shows[]': ['lesson_id', 'start_at', 'student_label'],
      'lines[]': [
        'line_id',
        'lesson_id',
        'start_at',
        'kind',
        'type_name_en',
        'type_name_ar',
        'course_id',
        'course_title_en',
        'course_title_ar',
        'session_no',
        'lesson_status',
        'is_adjustment',
        'collected_iqd',
        'court_share_iqd',
        'share_bp',
        'coach_iqd',
        'enrolments',
        'attended',
        'no_shows',
      ],
    },
  },

  coach_statement_refresh: {
    rpc: 'coach_statement_refresh',
    x: null,
    keys: ['statement_id', 'status', 'created'],
  },

  coach_statement_approve: {
    rpc: 'coach_statement_approve',
    x: null,
    keys: ['statement_id', 'status', 'next_statement_id'],
  },

  coach_statement_mark_paid: {
    rpc: 'coach_statement_mark_paid',
    x: null,
    keys: ['duplicate', 'statement_id', 'status', 'paid_at', 'total_iqd'],
  },

  report_lessons: {
    rpc: 'report_lessons',
    x: 'X24',
    keys: ['period', 'totals', 'byCoach', 'byType', 'byDay', 'columns'],
    nested: {
      period: ['from', 'to'],
      totals: [
        'lessons',
        'private',
        'group',
        'courseSessions',
        'cancelled',
        'underFilled',
        'expired',
        'enrolments',
        'places',
        'placesTaken',
        'fillRatePct',
        'attended',
        'noShows',
        'lateCancels',
        'collectedIqd',
        'courtShareIqd',
        'coachShareIqd',
        'venueShareIqd',
        'deskIqd',
        'onlineIqd',
        'refundsIqd',
        'lessonRevenueIqd',
        'sandboxExcluded',
      ],
      'byCoach[]': [
        'coachId',
        'coachNameEn',
        'coachNameAr',
        'lessons',
        'enrolments',
        'collectedIqd',
        'coachShareIqd',
      ],
      'byType[]': [
        'lessonTypeId',
        'nameEn',
        'nameAr',
        'kind',
        'lessons',
        'enrolments',
        'collectedIqd',
      ],
      'byDay[]': ['date', 'lessons', 'collectedIqd', 'coachShareIqd'],
    },
  },

  /** `report_courts`: only what coaching adds (X25; R72 names the coach total `owedToCoachesIqd`). */
  report_courts: {
    rpc: 'report_courts',
    x: 'X25',
    keys: ['rows', 'totals', 'lessons'],
    nested: {
      'rows[]': ['lessons', 'lessonMinutes'],
      totals: ['lessons', 'lessonMinutes'],
      lessons: [
        'lessons',
        'private',
        'group',
        'courseSessions',
        'lessonMinutes',
        'enrolments',
        'attended',
        'noShows',
        'cancelled',
        'underFilled',
        'collectedIqd',
        'courtShareIqd',
        'owedToCoachesIqd',
      ],
    },
  },

  /** `report_revenue`: only what coaching adds (X26). */
  report_revenue: {
    rpc: 'report_revenue',
    x: 'X26',
    keys: ['rows', 'totals'],
    nested: {
      'rows[]': ['lessonIqd', 'owedToCoachesIqd'],
      totals: ['lessonIqd', 'owedToCoachesIqd'],
    },
  },

  /** `day_close_online`: only the `lessons` block coaching adds (X27: Money's keys plus `kept_*`). */
  day_close_online: {
    rpc: 'day_close_online',
    x: 'X27',
    keys: ['lessons'],
    nested: {
      lessons: [
        'desk_paid_iqd',
        'desk_paid_count',
        'desk_refunded_iqd',
        'online_received_iqd',
        'online_received_count',
        'online_refunded_iqd',
        'online_refunded_count',
        'online_refunds_waiting_iqd',
        'online_refunds_waiting_count',
        'refunds_due_desk_iqd',
        'refunds_due_desk_count',
        'kept_iqd',
        'kept_count',
        'lessons',
        'owed_iqd',
        'owed_count',
        'owed_to_coaches_iqd',
      ],
    },
  },
} satisfies Record<string, CoachingShape>;

export type CoachingShapeName = keyof typeof shapes;

/** Every coaching answer's key list, by name (R41, R72). */
export const COACHING_SHAPES: Readonly<Record<CoachingShapeName, CoachingShape>> = shapes;

/** The four anonymous reads (R12); their lists never name a person (R43). */
export const PUBLIC_COACHING_READS = [
  'coaching_public',
  'coach_profile',
  'coach_slots',
  'lesson_offer',
] as const satisfies readonly CoachingShapeName[];

// ---------------------------------------------------------------------------------------------
// Checking an answer against its shape.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** The objects a nested path names inside one row, with their concrete paths. */
function resolve(
  row: Record<string, unknown>,
  rowPath: string,
  spec: string,
  problems: string[],
): Array<[unknown, string]> {
  let current: Array<[unknown, string]> = [[row, rowPath]];
  for (const segment of spec.split('.')) {
    const isArray = segment.endsWith('[]');
    const name = isArray ? segment.slice(0, -2) : segment;
    const next: Array<[unknown, string]> = [];
    for (const [obj, path] of current) {
      if (!isRecord(obj)) continue; // reported by the spec that names this level
      const value = obj[name];
      const here = `${path}.${name}`;
      if (value === undefined || value === null) continue;
      if (isArray) {
        if (!Array.isArray(value)) {
          problems.push(here);
          continue;
        }
        value.forEach((el, i) => next.push([el, `${here}[${i}]`]));
      } else {
        next.push([value, here]);
      }
    }
    current = next;
  }
  return current;
}

function checkRow(row: unknown, rowPath: string, shape: CoachingShape, problems: string[]): void {
  if (!isRecord(row)) {
    problems.push(rowPath);
    return;
  }
  for (const key of shape.keys) {
    if (!has(row, key)) problems.push(`${rowPath}.${key}`);
  }
  for (const group of shape.oneOf ?? []) {
    if (!group.some((key) => has(row, key))) problems.push(`${rowPath}.(${group.join('|')})`);
  }
  for (const [spec, keys] of Object.entries(shape.nested ?? {})) {
    for (const [target, path] of resolve(row, rowPath, spec, problems)) {
      if (!isRecord(target)) {
        problems.push(path);
        continue;
      }
      for (const key of keys) {
        if (!has(target, key)) problems.push(`${path}.${key}`);
      }
    }
  }
}

/**
 * The places where `value` falls short of `shape`, as JSON paths from `$` (`$.coaches[0].offers[1].
 * price_iqd`): a missing key, or a path whose value is not the object or array the shape expects
 * (`$` itself when the answer is not an object, or not an array for `array: true`). Empty when the
 * answer carries everything. A bare key list checks the top level only.
 */
export function missingKeys(value: unknown, shape: CoachingShape | readonly string[]): string[] {
  const s: CoachingShape = isKeyList(shape) ? { rpc: '', x: null, keys: shape } : shape;
  const problems: string[] = [];
  if (s.array) {
    if (!Array.isArray(value)) return ['$'];
    value.forEach((row, i) => checkRow(row, `$[${i}]`, s, problems));
  } else {
    checkRow(value, '$', s, problems);
  }
  return [...new Set(problems)];
}

function isKeyList(shape: CoachingShape | readonly string[]): shape is readonly string[] {
  return Array.isArray(shape);
}

/** True when `value` carries every key of `shape` (see `missingKeys`). */
export function hasKeys(value: unknown, shape: CoachingShape | readonly string[]): boolean {
  return missingKeys(value, shape).length === 0;
}

/**
 * Coach mode's calls (docs/design/coaching/guest.md §4.7.2; build contracts
 * §1.6). Each takes the typed client, as matches/api.ts does, so the call
 * shapes are tested with a stub under plain node; hooks.ts binds the app
 * singleton.
 *
 * Reads return the PARSED shapes of logic.ts; writes return the few fields
 * the phone reads, and the screen refetches the rest. A refusal is thrown as
 * it came (a PostgREST error whose message is the code and whose `details` is
 * the detail), so `coachErrorText` and the query client's retry read it the
 * same way. Every coach write is online-only (CD-6): nothing here is queued.
 *
 * LOOSELY TYPED ON THE ARGUMENTS, CHECKED ON THE NAME. Several of these
 * arguments are NULL-able uuids the generated `Database` type spells as plain
 * strings (`p_course_id` beside `p_lesson_id`, a student with no phone), so
 * the call goes through `coachRpc`, whose name must be one of COACH_RPCS, and
 * COACH_RPCS must be functions of the generated type (the assertion below):
 * an RPC that is not in `types.gen.ts` fails typecheck here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import {
  parseAddResult,
  parseBookResult,
  parseCoachHours,
  parseCoachLesson,
  parseCoachMe,
  parseCoachSchedule,
  parseCoachSlots,
  parseCoachStatements,
  parseCourseCreated,
  parseGroupCreated,
  parseRescheduled,
  toWindowsJson,
  type AttendanceMark,
  type CoachHours,
  type CoachLessonDetail,
  type CoachMeRead,
  type CoachSchedule,
  type CoachSlots,
  type CoachStatements,
  type HoursWindow,
} from './logic';

type Client = SupabaseClient<Database>;

/** Every RPC coach mode calls (build contracts §1.6, R44, R61). */
export const COACH_RPCS = [
  'coach_me',
  'coach_accept_public',
  'coach_schedule',
  'coach_hours_mine',
  'set_my_coach_hours',
  'add_my_time_off',
  'cancel_my_time_off',
  'coach_lesson',
  'coach_slots',
  'coach_book_private',
  'coach_create_group',
  'coach_create_course',
  'coach_add_student',
  'coach_remove_student',
  'coach_mark_attendance',
  'coach_cancel_lesson',
  'coach_cancel_course',
  'coach_reschedule_session',
  'my_coach_statements',
] as const satisfies readonly (keyof Database['app']['Functions'])[];

export type CoachRpcName = (typeof COACH_RPCS)[number];

type LooseRpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

/** One coach RPC; resolves to its raw result or throws the PostgREST error. */
export async function coachRpc(
  client: Client,
  fn: CoachRpcName,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const app = client.schema('app') as unknown as { rpc: LooseRpc };
  const { data, error } = await app.rpc(fn, args ?? {});
  if (error) throw error;
  return data;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** app.coach_me (never raises; `{coach: null}` for a non-coach, R45). */
export async function fetchCoachMe(client: Client): Promise<CoachMeRead> {
  return parseCoachMe(await coachRpc(client, 'coach_me'));
}

/** app.coach_schedule over a window of at most 31 days. */
export async function fetchCoachSchedule(
  client: Client,
  from: string,
  to: string,
): Promise<CoachSchedule> {
  return parseCoachSchedule(await coachRpc(client, 'coach_schedule', { p_from: from, p_to: to }));
}

/** app.coach_hours_mine. */
export async function fetchCoachHours(client: Client): Promise<CoachHours> {
  return parseCoachHours(await coachRpc(client, 'coach_hours_mine'));
}

/** app.coach_lesson: one lesson's roster (C-16, R44, R54). Null when the answer carries no lesson. */
export async function fetchCoachLesson(
  client: Client,
  lessonId: string,
): Promise<CoachLessonDetail | null> {
  return parseCoachLesson(await coachRpc(client, 'coach_lesson', { p_lesson_id: lessonId }));
}

/** app.coach_slots for the coach's own private type (R77). */
export async function fetchCoachSlots(
  client: Client,
  args: { coachId: string; typeId: string; from: string; to: string },
): Promise<CoachSlots> {
  return parseCoachSlots(
    await coachRpc(client, 'coach_slots', {
      p_coach_id: args.coachId,
      p_lesson_type_id: args.typeId,
      p_from: args.from,
      p_to: args.to,
    }),
  );
}

/** app.my_coach_statements: the summaries (`month` null) or one month with its lines. */
export async function fetchMyCoachStatements(
  client: Client,
  month: string | null,
): Promise<CoachStatements> {
  return parseCoachStatements(
    await coachRpc(client, 'my_coach_statements', month ? { p_month: month } : {}),
  );
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** app.coach_accept_public (R61, C-22): the profile goes public. */
export async function coachAcceptPublic(client: Client): Promise<void> {
  await coachRpc(client, 'coach_accept_public');
}

/** app.set_my_coach_hours: replaces the branch's whole set of windows (CD-10). */
export async function setMyCoachHours(
  client: Client,
  venueId: string,
  windows: readonly Pick<HoursWindow, 'weekday' | 'start' | 'end'>[],
): Promise<void> {
  await coachRpc(client, 'set_my_coach_hours', {
    p_venue_id: venueId,
    p_windows: toWindowsJson(windows),
  });
}

export async function addMyTimeOff(
  client: Client,
  args: { startsAt: string; endsAt: string; reason: string },
): Promise<void> {
  await coachRpc(client, 'add_my_time_off', {
    p_starts_at: args.startsAt,
    p_ends_at: args.endsAt,
    // `coach_time_off.reason` is 0..200 characters: an empty reason is '', never NULL.
    p_reason: args.reason.trim(),
  });
}

export async function cancelMyTimeOff(client: Client, id: string): Promise<void> {
  await coachRpc(client, 'cancel_my_time_off', { p_id: id });
}

/** app.coach_book_private (C-8, CD-1: always paid at the desk; the same answer whether the phone matched). */
export async function coachBookPrivate(
  client: Client,
  args: {
    typeId: string;
    venueId: string;
    startAt: string;
    name: string;
    phone: string | null;
    partySize: number;
    idempotencyKey: string;
  },
): Promise<{ lessonId: string | null; enrolmentId: string | null; duplicate: boolean }> {
  return parseBookResult(
    await coachRpc(client, 'coach_book_private', {
      p_lesson_type_id: args.typeId,
      p_venue_id: args.venueId,
      p_start_at: args.startAt,
      p_student_name: args.name,
      p_student_phone: args.phone,
      p_party_size: args.partySize,
      p_idempotency_key: args.idempotencyKey,
    }),
  );
}

export async function coachCreateGroup(
  client: Client,
  args: { typeId: string; venueId: string; startAt: string; idempotencyKey: string },
): Promise<{ lessonId: string | null; duplicate: boolean }> {
  return parseGroupCreated(
    await coachRpc(client, 'coach_create_group', {
      p_lesson_type_id: args.typeId,
      p_venue_id: args.venueId,
      p_start_at: args.startAt,
      p_idempotency_key: args.idempotencyKey,
    }),
  );
}

export async function coachCreateCourse(
  client: Client,
  args: {
    typeId: string;
    venueId: string;
    starts: readonly string[];
    titleEn: string;
    titleAr: string;
    idempotencyKey: string;
  },
): Promise<{ courseId: string | null; lessonIds: string[]; duplicate: boolean }> {
  return parseCourseCreated(
    await coachRpc(client, 'coach_create_course', {
      p_lesson_type_id: args.typeId,
      p_venue_id: args.venueId,
      p_starts: [...args.starts],
      p_title_en: args.titleEn.trim(),
      p_title_ar: args.titleAr.trim(),
      p_idempotency_key: args.idempotencyKey,
    }),
  );
}

/** app.coach_add_student (C-8, CD-9; never reveals whether the phone matched an account). */
export async function coachAddStudent(
  client: Client,
  args: {
    lessonId: string | null;
    courseId: string | null;
    name: string;
    phone: string | null;
    idempotencyKey: string;
  },
): Promise<{ enrolmentId: string | null; placesLeft: number | null; duplicate: boolean }> {
  return parseAddResult(
    await coachRpc(client, 'coach_add_student', {
      p_lesson_id: args.lessonId,
      p_course_id: args.courseId,
      p_name: args.name,
      p_phone: args.phone,
      p_idempotency_key: args.idempotencyKey,
    }),
  );
}

export async function coachRemoveStudent(
  client: Client,
  args: { enrolmentId: string; reason: string },
): Promise<void> {
  await coachRpc(client, 'coach_remove_student', {
    p_enrolment_id: args.enrolmentId,
    p_reason: args.reason,
  });
}

/** app.coach_mark_attendance: state-idempotent (CD-11). */
export async function coachMarkAttendance(
  client: Client,
  args: { lessonId: string; enrolmentId: string; status: AttendanceMark },
): Promise<void> {
  await coachRpc(client, 'coach_mark_attendance', {
    p_lesson_id: args.lessonId,
    p_enrolment_id: args.enrolmentId,
    p_status: args.status,
  });
}

export async function coachCancelLesson(
  client: Client,
  args: { lessonId: string; reason: string },
): Promise<void> {
  await coachRpc(client, 'coach_cancel_lesson', {
    p_lesson_id: args.lessonId,
    p_reason: args.reason,
  });
}

export async function coachCancelCourse(
  client: Client,
  args: { courseId: string; reason: string },
): Promise<void> {
  await coachRpc(client, 'coach_cancel_course', {
    p_course_id: args.courseId,
    p_reason: args.reason,
  });
}

/** app.coach_reschedule_session: any kind (R8, R32). */
export async function coachRescheduleSession(
  client: Client,
  args: { lessonId: string; startAt: string },
): Promise<{ lessonId: string | null; startAt: string | null; duplicate: boolean }> {
  return parseRescheduled(
    await coachRpc(client, 'coach_reschedule_session', {
      p_lesson_id: args.lessonId,
      p_start_at: args.startAt,
    }),
  );
}

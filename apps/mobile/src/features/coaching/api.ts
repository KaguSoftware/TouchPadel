/**
 * The guest's coaching calls (docs/design/coaching/guest.md §4.7.1; build
 * contracts §1.6). Each takes the typed client, as matches/api.ts does, so the
 * call shapes are tested with a stub under plain node; hooks.ts binds the app
 * singleton.
 *
 * Reads return the PARSED shapes of logic.ts (every enum defensive); writes
 * return the few fields §4.3 lets the phone read, and the screen refetches the
 * rest (`my_lesson`, `my_lessons`, the offer). A refusal is thrown as it came
 * (a PostgREST error whose message is the code and whose `details` is the
 * detail; an edge refusal as a DepositEdgeError), so `lessonErrorText` and the
 * query client's retry policy read it the same way.
 *
 * Every coaching write is online-only (CD-6): nothing here is queued.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';
import { invokeDepositEdge } from '../deposit/api';
import type { ClassKind, LessonScope } from './keys';
import {
  parseCancelResult,
  parseCoachingPublic,
  parseCoachProfile,
  parseCoachSlots,
  parseLessonBegin,
  parseLessonOffer,
  parseLessonWrite,
  parseLinkConfirm,
  parseMyLesson,
  parseMyLessons,
  type CancelResult,
  type CoachingPublic,
  type CoachProfile,
  type CoachSlots,
  type LessonBegin,
  type LessonOffer,
  type LessonWrite,
  type LinkConfirmResult,
  type MyLesson,
  type MyLessonRow,
  type PaymentChoice,
} from './logic';

type Client = SupabaseClient<Database>;

// ── Public reads (anon and authenticated) ───────────────────────────────────

/** app.coaching_public for one branch (`{off: true}` while its switch is off). */
export async function fetchCoachingPublic(
  client: Client,
  venueId: string,
): Promise<CoachingPublic> {
  const { data, error } = await client
    .schema('app')
    .rpc('coaching_public', { p_venue_id: venueId });
  if (error) throw error;
  return parseCoachingPublic(data);
}

/** app.coach_profile; `venueId` null is the link's read (R17): the card and the branches, no offers. */
export async function fetchCoachProfile(
  client: Client,
  coachId: string,
  venueId: string | null,
): Promise<CoachProfile> {
  const { data, error } = await client.schema('app').rpc('coach_profile', {
    p_coach_id: coachId,
    ...(venueId ? { p_venue_id: venueId } : {}),
  });
  if (error) throw error;
  return parseCoachProfile(data);
}

/** app.coach_slots: a private type's bookable starts over at most 14 days. */
export async function fetchCoachSlots(
  client: Client,
  args: { coachId: string; lessonTypeId: string; from: string; to: string },
): Promise<CoachSlots> {
  const { data, error } = await client.schema('app').rpc('coach_slots', {
    p_coach_id: args.coachId,
    p_lesson_type_id: args.lessonTypeId,
    p_from: args.from,
    p_to: args.to,
  });
  if (error) throw error;
  return parseCoachSlots(data);
}

/** app.lesson_offer: a group session (`session`) or a course, with the caller's price. */
export async function fetchLessonOffer(
  client: Client,
  kind: ClassKind,
  id: string,
): Promise<LessonOffer> {
  const { data, error } = await client
    .schema('app')
    .rpc('lesson_offer', kind === 'course' ? { p_course_id: id } : { p_lesson_id: id });
  if (error) throw error;
  return parseLessonOffer(data);
}

// ── The guest's reads ───────────────────────────────────────────────────────

export async function fetchMyLessons(client: Client, scope: LessonScope): Promise<MyLessonRow[]> {
  const { data, error } = await client.schema('app').rpc('my_lessons', { p_scope: scope });
  if (error) throw error;
  return parseMyLessons(data);
}

export async function fetchMyLesson(client: Client, enrolmentId: string): Promise<MyLesson> {
  const { data, error } = await client
    .schema('app')
    .rpc('my_lesson', { p_enrolment_id: enrolmentId });
  if (error) throw error;
  return parseMyLesson(data);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface BookPrivateArgs {
  coachId: string;
  lessonTypeId: string;
  /** ISO instant, on the 30-minute grid (C-20). */
  startAt: string;
  partySize: number;
  /** Trimmed, empty ones dropped (`friendNamesFor`). */
  friendNames: string[];
  mode: PaymentChoice;
  /** The offer's `price_iqd`: PRICE_CHANGED when the server's has moved. */
  expectedPriceIqd: number;
  /** `lessonIntentKey(privateIntent(…), 'book_private')`. */
  idempotencyKey: string;
}

export async function bookPrivate(client: Client, args: BookPrivateArgs): Promise<LessonWrite> {
  const { data, error } = await client.schema('app').rpc('lesson_book_private', {
    p_coach_id: args.coachId,
    p_lesson_type_id: args.lessonTypeId,
    p_start_at: args.startAt,
    p_party_size: args.partySize,
    p_friend_names: args.friendNames,
    p_payment_mode: args.mode,
    p_expected_price_iqd: args.expectedPriceIqd,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return parseLessonWrite(data, 'lesson_book_private');
}

export interface JoinArgs {
  /** A group session's lesson id, or a course's id. */
  id: string;
  mode: PaymentChoice;
  /** The offer's `price_iqd` (a late course join's share included). */
  expectedPriceIqd: number;
  idempotencyKey: string;
}

export async function joinLesson(client: Client, args: JoinArgs): Promise<LessonWrite> {
  const { data, error } = await client.schema('app').rpc('lesson_join', {
    p_lesson_id: args.id,
    p_payment_mode: args.mode,
    p_expected_price_iqd: args.expectedPriceIqd,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return parseLessonWrite(data, 'lesson_join');
}

export async function joinCourse(client: Client, args: JoinArgs): Promise<LessonWrite> {
  const { data, error } = await client.schema('app').rpc('course_join', {
    p_course_id: args.id,
    p_payment_mode: args.mode,
    p_expected_price_iqd: args.expectedPriceIqd,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return parseLessonWrite(data, 'course_join');
}

/** app.lesson_cancel_mine: state-idempotent, no key; the server decides free or late at the call. */
export async function cancelMyLesson(client: Client, enrolmentId: string): Promise<CancelResult> {
  const { data, error } = await client
    .schema('app')
    .rpc('lesson_cancel_mine', { p_enrolment_id: enrolmentId });
  if (error) throw error;
  return parseCancelResult(data);
}

/** app.lesson_link_confirm (C-21, R44): "Yes, it's me" links it, "Not me" unlinks it silently. */
export async function confirmLessonLink(
  client: Client,
  enrolmentId: string,
  yes: boolean,
): Promise<LinkConfirmResult> {
  const { data, error } = await client
    .schema('app')
    .rpc('lesson_link_confirm', { p_enrolment_id: enrolmentId, p_yes: yes });
  if (error) throw error;
  return parseLinkConfirm(data);
}

// ── The edge `lesson-begin` (money.md §6.7) ─────────────────────────────────

/**
 * Pay a held enrolment by Qi: the attempt's ref and Qi's page. A live attempt
 * for the same enrolment is answered again with its own ref (`reused`), so
 * "Finish payment" opens one page, not two. Through the deposit's edge caller:
 * a refusal is a DepositEdgeError carrying the body's `detail`.
 */
export async function lessonBegin(
  client: Client,
  args: { enrolmentId: string; locale: Locale },
): Promise<LessonBegin> {
  const data = await invokeDepositEdge(client, 'lesson-begin', {
    enrolment_id: args.enrolmentId,
    locale: args.locale,
  });
  return parseLessonBegin(data);
}

/**
 * The guest's coaching React bindings (docs/design/coaching/guest.md §4.7):
 * every read as a query, every write as a mutation, all under `coachingKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by
 * the key prefixes: nothing under `['coaching']` is written to disk, every
 * write runs now or fails now (CD-6), and a coach's grid fails fast. A screen
 * never overrides them.
 *
 * After every write the phone refetches what shows lessons (`my_lesson`,
 * `my_lessons`, the offer): one invalidation of the `['coaching']` root does
 * all three. A private booking takes a court, so it refreshes the court grid
 * too.
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { clearLessonIntentKey, lessonIntentKey } from '../../lib/idempotency';
import { useAuth } from '../auth/context';
import { useGuestVenue, useVenueSettings } from '../availability/hooks';
import { useLocale } from '../../i18n/LocaleProvider';
import {
  bookPrivate,
  cancelMyLesson,
  confirmLessonLink,
  fetchCoachingPublic,
  fetchCoachProfile,
  fetchCoachSlots,
  fetchLessonOffer,
  fetchMyLesson,
  fetchMyLessons,
  joinCourse,
  joinLesson,
  type BookPrivateArgs,
  type JoinArgs,
} from './api';
import { keepsLessonKey } from './errors';
import { coachingKeys, type ClassKind, type LessonScope } from './keys';
import { coachingEnabled, courseJoinIntent, joinIntent, privateIntent } from './logic';

export { coachingKeys };

/** Refresh every lesson read after a write or a push (and the court grid, when a court moved). */
export function useInvalidateLessons(): (alsoGrid?: boolean) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (alsoGrid = false) => {
      void queryClient.invalidateQueries({ queryKey: coachingKeys.all });
      if (alsoGrid) void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    [queryClient],
  );
}

// ── Public reads ────────────────────────────────────────────────────────────

/**
 * One branch's coaches, lesson types and sessions with places. `venueId` null
 * (the branch's switch is off, or no branch is known) means no read at all
 * (rule 7: switch off means no work).
 */
export function useCoachingPublic(venueId: string | null) {
  return useQuery({
    queryKey: coachingKeys.public(venueId ?? ''),
    queryFn: () => fetchCoachingPublic(supabase, venueId!),
    enabled: !!venueId,
    staleTime: 30_000,
  });
}

/** A coach's card, offers and sessions at a branch; `venueId` null is the link's read (R17). */
export function useCoachProfile(coachId: string | null, venueId: string | null) {
  return useQuery({
    queryKey: coachingKeys.profile(coachId ?? '', venueId ?? ''),
    queryFn: () => fetchCoachProfile(supabase, coachId!, venueId),
    enabled: !!coachId,
    staleTime: 30_000,
  });
}

/**
 * A private type's bookable starts over one 14-day window (§4.8.3). Polled
 * on focus by the app default; the screen refetches after a COACH_BUSY or
 * NO_COURT_FREE refusal.
 */
export function useCoachSlots(
  args: { coachId: string; lessonTypeId: string; from: string; to: string } | null,
) {
  return useQuery({
    queryKey: coachingKeys.slots(
      args?.coachId ?? '',
      args?.lessonTypeId ?? '',
      args?.from ?? '',
      args?.to ?? '',
    ),
    queryFn: () => fetchCoachSlots(supabase, args!),
    enabled: !!args,
    staleTime: 30_000,
  });
}

/** A group session's or a course's offer, with the caller's price (pro-rata for a late join). */
export function useLessonOffer(kind: ClassKind | null, id: string | null) {
  return useQuery({
    queryKey: coachingKeys.offer(kind ?? 'session', id ?? ''),
    queryFn: () => fetchLessonOffer(supabase, kind!, id!),
    enabled: !!kind && !!id,
    staleTime: 15_000,
  });
}

// ── The guest's reads ───────────────────────────────────────────────────────

/**
 * The guest's lessons in one scope. `enabled` is the caller's extra gate (the
 * Bookings tab reads them only while some branch has coaching on); its own
 * query, so a failed read never turns the bookings into an error.
 */
export function useMyLessons(scope: LessonScope, opts: { enabled?: boolean } = {}) {
  const { session } = useAuth();
  return useQuery({
    queryKey: coachingKeys.mine(scope),
    queryFn: () => fetchMyLessons(supabase, scope),
    enabled: (opts.enabled ?? true) && !!session,
    staleTime: 30_000,
  });
}

/** One enrolment, with the server's cancel preview and actions. */
export function useMyLesson(enrolmentId: string | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: coachingKeys.one(enrolmentId ?? ''),
    queryFn: () => fetchMyLesson(supabase, enrolmentId!),
    enabled: !!session && !!enrolmentId,
    staleTime: 10_000,
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type BookPrivateVars = Omit<BookPrivateArgs, 'idempotencyKey'>;

/**
 * Book a private lesson (§4.9.1). The key is `lessonIntentKey` of the
 * intent, reused by every retry of it; it survives PHONE_REQUIRED,
 * TERMS_REQUIRED, PRICE_CHANGED and a dropped connection, and is cleared on
 * success (booked or held) and on any other refusal.
 */
export function useBookPrivate() {
  const invalidate = useInvalidateLessons();
  const intentOf = (v: BookPrivateVars) =>
    privateIntent({
      coachId: v.coachId,
      lessonTypeId: v.lessonTypeId,
      startAt: v.startAt,
      partySize: v.partySize,
      mode: v.mode,
    });
  return useMutation({
    mutationKey: coachingKeys.mutation('book'),
    mutationFn: (vars: BookPrivateVars) =>
      bookPrivate(supabase, {
        ...vars,
        idempotencyKey: lessonIntentKey(intentOf(vars), 'book_private'),
      }),
    onSuccess: (_data, vars) => clearLessonIntentKey(intentOf(vars)),
    onError: (error, vars) => {
      if (!keepsLessonKey(error)) clearLessonIntentKey(intentOf(vars));
    },
    onSettled: () => invalidate(true),
  });
}

export type JoinVars = Omit<JoinArgs, 'idempotencyKey'>;

/** Join a group session (§4.9.2): a place, no court. */
export function useJoinLesson() {
  const invalidate = useInvalidateLessons();
  return useMutation({
    mutationKey: coachingKeys.mutation('join'),
    mutationFn: (vars: JoinVars) =>
      joinLesson(supabase, {
        ...vars,
        idempotencyKey: lessonIntentKey(joinIntent(vars.id, vars.mode), 'join'),
      }),
    onSuccess: (_data, vars) => clearLessonIntentKey(joinIntent(vars.id, vars.mode)),
    onError: (error, vars) => {
      if (!keepsLessonKey(error)) clearLessonIntentKey(joinIntent(vars.id, vars.mode));
    },
    onSettled: () => invalidate(),
  });
}

/** Sign up to a course (§4.9.2), late joins included (C-15: the server's price). */
export function useJoinCourse() {
  const invalidate = useInvalidateLessons();
  return useMutation({
    mutationKey: coachingKeys.mutation('course'),
    mutationFn: (vars: JoinVars) =>
      joinCourse(supabase, {
        ...vars,
        idempotencyKey: lessonIntentKey(courseJoinIntent(vars.id, vars.mode), 'course_join'),
      }),
    onSuccess: (_data, vars) => clearLessonIntentKey(courseJoinIntent(vars.id, vars.mode)),
    onError: (error, vars) => {
      if (!keepsLessonKey(error)) clearLessonIntentKey(courseJoinIntent(vars.id, vars.mode));
    },
    onSettled: () => invalidate(),
  });
}

/** Cancel an enrolment (§4.9.4): state-idempotent, no key. A private lesson frees its court. */
export function useCancelMyLesson() {
  const invalidate = useInvalidateLessons();
  return useMutation({
    mutationKey: coachingKeys.mutation('cancel'),
    mutationFn: (enrolmentId: string) => cancelMyLesson(supabase, enrolmentId),
    onSettled: () => invalidate(true),
  });
}

/** "Is this you?" (§4.8.10, C-21): state-idempotent, no key. */
export function useConfirmLessonLink() {
  const invalidate = useInvalidateLessons();
  return useMutation({
    mutationKey: coachingKeys.mutation('confirm'),
    mutationFn: (vars: { enrolmentId: string; yes: boolean }) =>
      confirmLessonLink(supabase, vars.enrolmentId, vars.yes),
    onSettled: () => invalidate(),
  });
}

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * The Book tab's "Lessons with a coach" row (§4.8.1): shown only while the
 * sheet's branch has coaching on, with a static label and no query of its own
 * (the settings read is the sheet's own, already cached), so the rally's
 * thread gets no new work.
 */
export function useLessonEntry(
  venueId: string | null,
): { label: string; onPress: () => void } | null {
  const { t } = useLocale();
  const router = useRouter();
  const settings = useVenueSettings(venueId);
  const on = coachingEnabled(settings.data);
  const onPress = useCallback(() => router.push('/coaches'), [router]);
  return useMemo(
    () => (on ? { label: t('coaching.guest.entry.book'), onPress } : null),
    [on, t, onPress],
  );
}

/** The guest's branch and its coaching switch, for the browsing screens. */
export function useCoachingBranch() {
  const guest = useGuestVenue();
  const settings = useVenueSettings(guest.venueId);
  return { guest, settings, on: coachingEnabled(settings.data) };
}

/** For the root layout's foreground push listener: refresh every lesson read now. */
export function useRefreshLessons(): () => void {
  const invalidate = useInvalidateLessons();
  return useCallback(() => invalidate(), [invalidate]);
}

/**
 * Coach mode's React bindings (docs/design/coaching/guest.md §4.7.2): every
 * read a query and every write a mutation, all under `coachKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by
 * the key prefix: nothing under `['coach']` is written to disk, and every
 * write runs now or fails now (CD-6), with one retry on a dropped connection
 * (the booking and creation writes are keyed, and every other write is
 * state-idempotent on the server). A screen never overrides them.
 *
 * After every write the whole `['coach']` root is refetched (coach_me's
 * counts, the schedule, the roster, the hours). A write that takes or frees a
 * court refreshes the guest grid too. A NOT_A_COACH refusal re-reads coach_me,
 * so RequireCoach re-gates (a retired coach lands on the statements).
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { clearLessonIntentKey, lessonIntentKey } from '../../lib/idempotency';
import {
  addMyTimeOff,
  cancelMyTimeOff,
  coachAcceptPublic,
  coachAddStudent,
  coachBookPrivate,
  coachCancelCourse,
  coachCancelLesson,
  coachCreateCourse,
  coachCreateGroup,
  coachMarkAttendance,
  coachRemoveStudent,
  coachRescheduleSession,
  fetchCoachHours,
  fetchCoachLesson,
  fetchCoachSchedule,
  fetchCoachSlots,
  fetchMyCoachStatements,
  setMyCoachHours,
} from './api';
import { isNotACoach, keepsIntentKey } from './errors';
import { coachKeys } from './keys';
import type { AttendanceMark, HoursWindow } from './logic';

export { coachKeys };

/** Refresh every coach read after a write (and the guest grid when a court changed hands). */
function useAfterWrite(): { done: (courts?: boolean) => void; failed: (err: unknown) => void } {
  const queryClient = useQueryClient();
  const done = useCallback(
    (courts = false) => {
      void queryClient.invalidateQueries({ queryKey: coachKeys.all });
      if (courts) void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    [queryClient],
  );
  const failed = useCallback(
    (err: unknown) => {
      if (isNotACoach(err)) void queryClient.invalidateQueries({ queryKey: coachKeys.meAny });
    },
    [queryClient],
  );
  return { done, failed };
}

/**
 * Re-read on focus (guest.md §4.13.4: "refetched on focus"), but not a
 * just-read answer: a push or a write has already refreshed it.
 */
export function useRefetchOnFocus(
  query: Pick<UseQueryResult, 'refetch' | 'dataUpdatedAt' | 'isFetching'>,
  minAgeMs = 15_000,
) {
  const { refetch, dataUpdatedAt, isFetching } = query;
  useFocusEffect(
    useCallback(() => {
      if (!isFetching && dataUpdatedAt > 0 && Date.now() - dataUpdatedAt > minAgeMs) void refetch();
    }, [refetch, dataUpdatedAt, isFetching, minAgeMs]),
  );
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * A coach read refused with NOT_A_COACH (retired, or no longer a coach, R45)
 * re-reads coach_me, so RequireCoach re-gates: a retired coach lands on the
 * statements, anyone else on Profile (guest.md §4.10).
 */
function useRegate(): <T>(read: () => Promise<T>) => () => Promise<T> {
  const queryClient = useQueryClient();
  return useCallback(
    <T>(read: () => Promise<T>) =>
      async () => {
        try {
          return await read();
        } catch (err) {
          if (isNotACoach(err)) void queryClient.invalidateQueries({ queryKey: coachKeys.meAny });
          throw err;
        }
      },
    [queryClient],
  );
}

export function useCoachSchedule(window: { from: string; to: string } | null) {
  const regate = useRegate();
  return useQuery({
    queryKey: coachKeys.schedule(window?.from ?? '', window?.to ?? ''),
    queryFn: regate(() => fetchCoachSchedule(supabase, window!.from, window!.to)),
    enabled: window !== null,
  });
}

export function useCoachHours() {
  const regate = useRegate();
  return useQuery({ queryKey: coachKeys.hours, queryFn: regate(() => fetchCoachHours(supabase)) });
}

export function useCoachLesson(lessonId: string | null) {
  const regate = useRegate();
  return useQuery({
    queryKey: coachKeys.lesson(lessonId ?? ''),
    queryFn: regate(() => fetchCoachLesson(supabase, lessonId!)),
    enabled: !!lessonId,
  });
}

export function useCoachSlots(
  args: { coachId: string; typeId: string; from: string; to: string } | null,
) {
  return useQuery({
    queryKey: coachKeys.slots(
      args?.coachId ?? '',
      args?.typeId ?? '',
      args?.from ?? '',
      args?.to ?? '',
    ),
    queryFn: () => fetchCoachSlots(supabase, args!),
    // Fails fast (lib/queryClient.ts, `['coach', 'slots']`): the screen falls
    // back to the start picker rather than wait out backed-off retries.
    enabled: args !== null,
  });
}

/** `month` null: the summaries; 'YYYY-MM-01': that month with its lines. */
export function useMyCoachStatements(month: string | null, enabled = true) {
  const regate = useRegate();
  return useQuery({
    queryKey: coachKeys.statements(month ?? 'summary'),
    queryFn: regate(() => fetchMyCoachStatements(supabase, month)),
    enabled,
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** R61, C-22: accept the public profile. */
export function useAcceptPublic() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('accept'),
    mutationFn: () => coachAcceptPublic(supabase),
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

export function useSetMyHours() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('hours'),
    mutationFn: (args: {
      venueId: string;
      windows: readonly Pick<HoursWindow, 'weekday' | 'start' | 'end'>[];
    }) => setMyCoachHours(supabase, args.venueId, args.windows),
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

export function useAddTimeOff() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('time_off'),
    mutationFn: (args: { startsAt: string; endsAt: string; reason: string }) =>
      addMyTimeOff(supabase, args),
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

export function useCancelTimeOff() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('time_off_cancel'),
    mutationFn: (id: string) => cancelMyTimeOff(supabase, id),
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

/** A keyed write's intent rides with its arguments; the key is minted per intent (guest.md §4.7.4). */
type Keyed<A> = A & { intent: string };

export function useCoachBook() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('book'),
    mutationFn: ({
      intent,
      ...args
    }: Keyed<{
      typeId: string;
      venueId: string;
      startAt: string;
      name: string;
      phone: string | null;
      partySize: number;
    }>) =>
      coachBookPrivate(supabase, {
        ...args,
        idempotencyKey: lessonIntentKey(intent, 'coach_book'),
      }),
    onSuccess: (_data, vars) => {
      clearLessonIntentKey(vars.intent);
      after.done(true);
    },
    onError: (err, vars) => {
      if (!keepsIntentKey(err)) clearLessonIntentKey(vars.intent);
      after.failed(err);
    },
  });
}

export function useCreateGroup() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('create_group'),
    mutationFn: ({
      intent,
      ...args
    }: Keyed<{ typeId: string; venueId: string; startAt: string }>) =>
      coachCreateGroup(supabase, {
        ...args,
        idempotencyKey: lessonIntentKey(intent, 'create_group'),
      }),
    onSuccess: (_data, vars) => {
      clearLessonIntentKey(vars.intent);
      after.done(true);
    },
    onError: (err, vars) => {
      if (!keepsIntentKey(err)) clearLessonIntentKey(vars.intent);
      after.failed(err);
    },
  });
}

export function useCreateCourse() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('create_course'),
    mutationFn: ({
      intent,
      ...args
    }: Keyed<{
      typeId: string;
      venueId: string;
      starts: readonly string[];
      titleEn: string;
      titleAr: string;
    }>) =>
      coachCreateCourse(supabase, {
        ...args,
        idempotencyKey: lessonIntentKey(intent, 'create_course'),
      }),
    onSuccess: (_data, vars) => {
      clearLessonIntentKey(vars.intent);
      after.done(true);
    },
    onError: (err, vars) => {
      if (!keepsIntentKey(err)) clearLessonIntentKey(vars.intent);
      after.failed(err);
    },
  });
}

export function useAddStudent() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('add_student'),
    mutationFn: ({
      intent,
      ...args
    }: Keyed<{
      lessonId: string | null;
      courseId: string | null;
      name: string;
      phone: string | null;
    }>) =>
      coachAddStudent(supabase, {
        ...args,
        idempotencyKey: lessonIntentKey(intent, 'add_student'),
      }),
    onSuccess: (_data, vars) => {
      clearLessonIntentKey(vars.intent);
      after.done();
    },
    onError: (err, vars) => {
      if (!keepsIntentKey(err)) clearLessonIntentKey(vars.intent);
      after.failed(err);
    },
  });
}

export function useRemoveStudent() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('remove_student'),
    mutationFn: (args: { enrolmentId: string; reason: string }) =>
      coachRemoveStudent(supabase, args),
    // A private lesson's only student is never removed (LESSON_NOT_CANCELLABLE
    // `private`), so a removal frees no court.
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

export function useMarkAttendance() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('attendance'),
    mutationFn: (args: { lessonId: string; enrolmentId: string; status: AttendanceMark }) =>
      coachMarkAttendance(supabase, args),
    onSuccess: () => after.done(),
    onError: after.failed,
  });
}

export function useCancelLesson() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('cancel_lesson'),
    mutationFn: (args: { lessonId: string; reason: string }) => coachCancelLesson(supabase, args),
    onSuccess: () => after.done(true),
    onError: after.failed,
  });
}

export function useCancelCourse() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('cancel_course'),
    mutationFn: (args: { courseId: string; reason: string }) => coachCancelCourse(supabase, args),
    onSuccess: () => after.done(true),
    onError: after.failed,
  });
}

export function useReschedule() {
  const after = useAfterWrite();
  return useMutation({
    mutationKey: coachKeys.mutation('reschedule'),
    mutationFn: (args: { lessonId: string; startAt: string }) =>
      coachRescheduleSession(supabase, args),
    onSuccess: () => after.done(true),
    onError: after.failed,
  });
}

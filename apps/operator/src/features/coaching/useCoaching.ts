/**
 * The coaching reads on the operator, the invalidation after each write, and
 * the per-dialog idempotency key (docs/design/coaching/operator.md §5.1,
 * §5.3.1, §5.4–§5.5). One QK.coaching family, so one root refreshes every read;
 * it is never persisted and never wrapped in cachedQuery (P15: rosters and
 * lesson labels carry student names and phones).
 *
 * Every read goes through `lessonRead`: a server without the RPC yet
 * (RPC_MISSING, PGRST202) answers `null`, and a surface given `null` renders
 * no coaching UI at all (§5.5). A network failure stays an error, so the
 * screen can say it needs a connection.
 *
 * Every coaching WRITE is a direct `appRpc('<name>', …)` at its call site, with
 * the literal RPC name (CD-6: no queued type, no wrapper; the assistant map
 * finds callers by that literal, and a type argument hides them — cast the
 * result instead). What this module gives the writers is the key
 * (`useLessonIdemKey`) and the invalidation (`invalidateLesson*`).
 */
import { useCallback, useMemo, useRef } from 'react';
import {
  keepPreviousData,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { appRpc, isRpcMissing } from '../../lib/appRpc';
import { can, permissionsFor, useAuth } from '../../lib/auth';
import { QK, invalidateReservations } from '../../lib/queryKeys';
import { useBroadcast } from '../../lib/realtime';
import { useStationReach } from '../../lib/stationReach';
import { currentBranchId } from '../../lib/venueScope';
import { matchReadStatus, type MatchReadStatus } from '../matches/matchLogic';
import {
  readCoachesAdmin,
  readCoachingSettings,
  readCustomerLessons,
  readDeskLessons,
  readLessonDetail,
  readRefundsDue,
  readSlots,
  readStatementDetail,
  type CoachSlots,
  type CoachesAdmin,
  type CoachingSettings,
  type CustomerLessons,
  type DeskLessons,
  type LessonDetail,
  type RefundsDue,
  type StatementDetail,
} from './lessonPayloads';

/** A read's answer, or null when this server has no such RPC yet (RPC_MISSING). */
export async function lessonRead<T>(
  call: () => Promise<unknown>,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  try {
    return parse(await call());
  } catch (error) {
    if (isRpcMissing(error)) return null;
    throw error;
  }
}

/** One reading of a coaching query: absent, loading, failed, or data that may be stale (§5.5). */
export type LessonReadStatus<T> = MatchReadStatus<T>;

/** A coaching query read the §5.5 way, with the station's reach. Pair it with `LessonReadNotice`. */
export function useLessonRead<T>(q: UseQueryResult<T | null>): LessonReadStatus<T> {
  const { reachable } = useStationReach();
  return matchReadStatus(q, reachable);
}

// ---------------------------------------------------------------------------
// Reads (§5.4 table)
// ---------------------------------------------------------------------------

/**
 * app.desk_lessons over a trading night (`useTradingNight` dayStart / dayEnd,
 * ≤ 3 days; the server refuses over 7): the branch's coaching switch, payment
 * mode, server_now, coach and lesson-type catalogue (R20) and the night's
 * lessons. Answers whether coaching is on or off (the desk stages, R51).
 * 30 s, last data kept while it reloads.
 */
export function useDeskLessons(
  dayStart: Date | null | undefined,
  dayEnd: Date | null | undefined,
  enabled = true,
): UseQueryResult<DeskLessons | null> {
  const fromIso = dayStart?.toISOString() ?? '';
  const toIso = dayEnd?.toISOString() ?? '';
  return useQuery({
    queryKey: QK.coaching.desk(fromIso, toIso),
    enabled: enabled && fromIso !== '' && toIso !== '',
    queryFn: () =>
      lessonRead(
        () =>
          appRpc('desk_lessons', { p_venue_id: currentBranchId(), p_from: fromIso, p_to: toIso }),
        readDeskLessons,
      ),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * app.desk_lesson_detail: the lesson screen. 20 s, last data kept. A lesson
 * the server will not show raises LESSON_NOT_FOUND (the screen's "not at this
 * branch"); a payload with no readable lesson is null too.
 */
export function useLessonDetail(
  lessonId: string | null | undefined,
): UseQueryResult<LessonDetail | null> {
  return useQuery({
    queryKey: QK.coaching.lesson(lessonId ?? ''),
    enabled: Boolean(lessonId),
    queryFn: () =>
      lessonRead(() => appRpc('desk_lesson_detail', { p_lesson_id: lessonId }), readLessonDetail),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
  });
}

/** app.customer_lessons for the record's coach badge and Lessons panel: on mount and on focus. */
export function useCustomerLessons(
  customerId: string | null | undefined,
  enabled = true,
): UseQueryResult<CustomerLessons | null> {
  return useQuery({
    queryKey: QK.coaching.customer(customerId ?? ''),
    enabled: enabled && Boolean(customerId),
    queryFn: () =>
      lessonRead(
        () => appRpc('customer_lessons', { p_customer_id: customerId }),
        readCustomerLessons,
      ),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/**
 * app.coaches_admin for the branch in scope: /admin/coaches (60 s while open,
 * `live`) and the Setup card's status line (on mount).
 */
export function useCoachesAdmin(
  branchId: string | null,
  opts: { enabled?: boolean; live?: boolean } = {},
): UseQueryResult<CoachesAdmin | null> {
  return useQuery({
    queryKey: QK.coaching.admin(branchId),
    enabled: opts.enabled ?? true,
    queryFn: () =>
      lessonRead(() => appRpc('coaches_admin', { p_venue_id: branchId }), readCoachesAdmin),
    refetchInterval: opts.live ? 60_000 : false,
  });
}

/** app.coaching_settings for the branch in scope (Venue details). Read on mount. */
export function useCoachingSettings(
  branchId: string | null,
  enabled = true,
): UseQueryResult<CoachingSettings | null> {
  return useQuery({
    queryKey: QK.coaching.settings(branchId),
    enabled,
    queryFn: () =>
      lessonRead(() => appRpc('coaching_settings', { p_venue_id: branchId }), readCoachingSettings),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * app.coach_slots for a private lesson: one coach, one type, one local day
 * ([fromIso, toIso)). Read when the dialog opens; 15 s stale. A staff caller at
 * the type's branch is answered whether coaching is on or off (R51).
 */
export function useCoachSlots(
  coachId: string | null | undefined,
  typeId: string | null | undefined,
  fromIso: string | null | undefined,
  toIso: string | null | undefined,
  enabled = true,
): UseQueryResult<CoachSlots | null> {
  return useQuery({
    queryKey: QK.coaching.slots(coachId ?? '', typeId ?? '', fromIso ?? '', toIso ?? ''),
    enabled: enabled && Boolean(coachId && typeId && fromIso && toIso),
    queryFn: () =>
      lessonRead(
        () =>
          appRpc('coach_slots', {
            p_coach_id: coachId,
            p_lesson_type_id: typeId,
            p_from: fromIso,
            p_to: toIso,
          }),
        readSlots,
      ),
    staleTime: 15_000,
  });
}

/** app.lesson_refunds_due for the branch in scope (Ops, the lesson screen). Manager and owner. 60 s. */
export function useRefundsDue(
  branchId: string | null,
  enabled = true,
): UseQueryResult<RefundsDue | null> {
  return useQuery({
    queryKey: QK.coaching.refundsDue(branchId),
    enabled,
    queryFn: () =>
      lessonRead(() => appRpc('lesson_refunds_due', { p_venue_id: branchId }), readRefundsDue),
    refetchInterval: 60_000,
  });
}

/** app.coach_statement_detail for one statement (the statement dialog): read on open. */
export function useStatementDetail(
  statementId: string | null | undefined,
): UseQueryResult<StatementDetail | null> {
  return useQuery({
    queryKey: QK.coaching.statement(statementId ?? ''),
    enabled: Boolean(statementId),
    queryFn: () =>
      lessonRead(
        () => appRpc('coach_statement_detail', { p_statement_id: statementId }),
        readStatementDetail,
      ),
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

/**
 * The lesson screen's live refresh (§5.4): no new topic. Every lesson create,
 * cancel, reschedule and court move writes `reservations`, so `slot_changed`
 * on 'courts' fires; enrolments and payments write none, and the polls carry
 * them.
 */
export function useLessonsLive(enabled = true): void {
  useBroadcast({
    topic: 'courts',
    isPrivate: true,
    events: ['slot_changed'],
    enabled,
    invalidateKeys: [QK.coaching.all],
  });
}

// ---------------------------------------------------------------------------
// Capabilities (lib/auth.tsx CAPABILITY_ROLES, §5.3.1)
// ---------------------------------------------------------------------------

export interface CoachingCaps {
  runLessons: boolean;
  takeLessonPayment: boolean;
  manageCoaches: boolean;
  settleCoaches: boolean;
  /** Reused: editing the coaching settings panel (owner), as for MatchSettingsPanel. */
  editVenueDetails: boolean;
  /** Reused: a launched lesson price, a launched type's shape and set_coach_price (owner). */
  editLaunchedPrices: boolean;
  /** Reused: putting a lesson type on sale without a protocol (owner). */
  launchDirectly: boolean;
  /** Reused: "Propose a price" (the price-or-promotion protocol). */
  startProtocolPriceChange: boolean;
  /** Reused: Refund on the refunds-due lists (permissionsFor().refund). */
  refund: boolean;
}

/** The signed-in role's coaching capabilities. Never compare roles inline. */
export function coachingCapsFor(role: Parameters<typeof can>[0]): CoachingCaps {
  return {
    runLessons: can(role, 'runLessons'),
    takeLessonPayment: can(role, 'takeLessonPayment'),
    manageCoaches: can(role, 'manageCoaches'),
    settleCoaches: can(role, 'settleCoaches'),
    editVenueDetails: can(role, 'editVenueDetails'),
    editLaunchedPrices: can(role, 'editLaunchedPrices'),
    launchDirectly: can(role, 'launchDirectly'),
    startProtocolPriceChange: can(role, 'startProtocolPriceChange'),
    refund: permissionsFor(role).refund,
  };
}

export function useCoachingCaps(): CoachingCaps {
  const role = useAuth().staff?.role;
  return useMemo(() => coachingCapsFor(role), [role]);
}

// ---------------------------------------------------------------------------
// Writes: the key and the refresh (§5.1, §5.4)
// ---------------------------------------------------------------------------

/** `lesson.<action>:<uuid>`: the house idempotency-key form of a direct RPC (CourtBlock.tsx). */
export function mintLessonKey(action: string): string {
  return `lesson.${action}:${crypto.randomUUID()}`;
}

/**
 * One idempotency key per dialog: minted when the dialog mounts, sent again on
 * a retry (a double tap or a lost answer replays, never doubles), replaced
 * after a success so the next write is a new one (the CourtBlock.tsx
 * precedent). `desk_book_lesson`, `desk_create_group`, `desk_create_course`,
 * `desk_add_student` and `lesson_settle` send one.
 */
export function useLessonIdemKey(action: string): { key: () => string; renew: () => void } {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = mintLessonKey(action);
  const key = useCallback(() => ref.current as string, []);
  const renew = useCallback(() => {
    ref.current = mintLessonKey(action);
  }, [action]);
  return useMemo(() => ({ key, renew }), [key, renew]);
}

type Qc = Pick<QueryClient, 'invalidateQueries'>;

/** The root of every desk_lessons window (QK.coaching.desk): attendance and the catalogue writes name it. */
export const COACHING_DESK_ROOT = ['coaching', 'desk'] as const;

function refresh(qc: Qc, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey: [...queryKey] });
}

/**
 * After book, create group, create course, add student, a cancel, reschedule
 * or move court: every coaching read, the reservation lists, an open booking,
 * and the match reads (a lesson is firm and can bump a filling match, 0280).
 */
export function invalidateLessonBooking(qc: QueryClient): void {
  refresh(qc, [QK.coaching.all, QK.reservation.all, QK.deskMatches.all]);
  invalidateReservations(qc);
}

/** After an attendance mark: the lesson and the desk envelope. */
export function invalidateLessonAttendance(qc: Qc, lessonId: string): void {
  refresh(qc, [QK.coaching.lesson(lessonId), COACHING_DESK_ROOT]);
}

/** After lesson_settle: every coaching read, the day's takings and the day close's online card. */
export function invalidateLessonMoney(qc: Qc): void {
  refresh(qc, [QK.coaching.all, QK.day, ['dayCloseOnline']]);
}

/**
 * After a coach, type, hours, time-off or price write: the Coaches screen and
 * the desk envelope (it carries the catalogue). A retire cancels lessons
 * (`cancelsLessons`), so it refreshes every coaching read and the reservation
 * lists too.
 */
export function invalidateCoachesAdmin(
  qc: QueryClient,
  branchId: string | null,
  cancelsLessons = false,
): void {
  refresh(qc, [QK.coaching.admin(branchId), COACHING_DESK_ROOT]);
  if (cancelsLessons) {
    refresh(qc, [QK.coaching.all, QK.reservation.all, QK.deskMatches.all]);
    invalidateReservations(qc);
  }
}

/** After a settings save: every coaching read (desk_lessons carries the switch and the mode). */
export function invalidateCoachingSettings(qc: Qc): void {
  refresh(qc, [QK.coaching.all]);
}

/** The statements list's feature-private key root (features/reports/coaches/statementKeys.ts). */
export const STATEMENTS_ROOT = ['reports', 'report_coach_statements'] as const;

/** After a statement refresh, approve, void or mark paid: the list and that statement. */
export function invalidateStatement(qc: Qc, statementId: string): void {
  refresh(qc, [STATEMENTS_ROOT, QK.coaching.statement(statementId)]);
}

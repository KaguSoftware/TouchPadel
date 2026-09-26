/**
 * Guests' "call a waiter" on the waiter's phone (wave5-addendum-2026-09-25
 * §2.1.8, §8 Q3 answered): the open calls at the venue, newest first, with
 * "On my way" (app.ack_waiter_call) and "Done" (app.resolve_waiter_call).
 * The cashier and managers keep answering on the till; whoever acts first
 * wins, and the other screen updates from the `floor` topic.
 *
 * The waiting-age scale and its thresholds are the till's
 * (op/features/till/elapsed.ts, WaiterCallsPanel.tsx): one reading of "how
 * late is this call" in both places.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import type { StaffRole } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { rpcErrorCode } from '../../booking/errors';
import { errorMessageOf } from '../../../lib/network';

/**
 * Who answers calls on the phone: the waiter. The server's guard is wider
 * (cashier, manager, owner, waiter, 0194), but the cashier and managers answer
 * on the till (§2.1.8), and the `waiter_call_new` push goes to waiters only.
 */
export const CALL_ROLES: readonly StaffRole[] = ['waiter'];

export type CallReason = 'order' | 'bill' | 'water' | 'assistance';
export type CallStatus = 'raised' | 'acknowledged';

/** One open call as the phone reads it (`waiter_calls` + its table's label). */
export interface WaiterCall {
  id: string;
  reason: CallReason;
  status: CallStatus;
  raised_at: string;
  acknowledged_by: string | null;
  table: { table_number: string } | null;
}

/** Unanswered this long, a call reads amber; this long, red (the till's WARN_MIN, ESCALATE_MIN). */
export const WARN_MIN = 2;
export const LATE_MIN = 5;
/** Past this, a call is old news: listed last and quietly (the till's OLD_CALL_MIN). */
export const OLD_CALL_MIN = 120;

export type Urgency = 'calm' | 'warn' | 'late';

export function minutesSince(fromIso: string, now: number): number {
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

/** How urgent a call reads. One somebody is already on is nobody's alarm. */
export function callUrgency(call: Pick<WaiterCall, 'status' | 'raised_at'>, now: number): Urgency {
  if (call.status !== 'raised') return 'calm';
  const minutes = minutesSince(call.raised_at, now);
  if (minutes >= OLD_CALL_MIN) return 'calm';
  if (minutes >= LATE_MIN) return 'late';
  if (minutes >= WARN_MIN) return 'warn';
  return 'calm';
}

/**
 * Newest first (§2.1.8), then the ones older than two hours after them, also
 * newest first, so a forgotten evening never sits above tonight's calls.
 */
export function orderCalls<T extends Pick<WaiterCall, 'raised_at'>>(
  calls: readonly T[],
  now: number,
): { recent: T[]; old: T[] } {
  const byNewest = [...calls].sort(
    (a, b) => new Date(b.raised_at).getTime() - new Date(a.raised_at).getTime(),
  );
  const recent: T[] = [];
  const old: T[] = [];
  for (const c of byNewest) (minutesSince(c.raised_at, now) >= OLD_CALL_MIN ? old : recent).push(c);
  return { recent, old };
}

/**
 * The Today row's count: the open calls of the last two hours, answered or
 * not (the till's badge counts every open call; a call left from yesterday is
 * a chore for the till's "Clear old", not a number on the waiter's Today).
 */
export function openCallCount(calls: readonly WaiterCall[] | undefined, now: number): number {
  return orderCalls(calls ?? [], now).recent.length;
}

export type Elapsed =
  | { unit: 'now' }
  | { unit: 'minutes'; minutes: number }
  | { unit: 'hours'; hours: number; minutes: number }
  | { unit: 'days'; days: number; hours: number };

/** "just now" · "25 min" · "2 h 10 min" · "2 d 3 h": the till's scale. */
export function elapsedSince(fromIso: string, now: number): Elapsed {
  const minutes = minutesSince(fromIso, now);
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', minutes };
  if (minutes < 24 * 60)
    return { unit: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  return {
    unit: 'days',
    days: Math.floor(minutes / (24 * 60)),
    hours: Math.floor(minutes / 60) % 24,
  };
}

/** Who is on the way, as the row says it. */
export function answeredBy(
  call: Pick<WaiterCall, 'status' | 'acknowledged_by'>,
  me: string | null,
): 'none' | 'me' | 'other' {
  if (call.status !== 'acknowledged') return 'none';
  return call.acknowledged_by !== null && call.acknowledged_by === me ? 'me' : 'other';
}

/** A state-idempotent answer's `duplicate` flag (0032 waiter_call_transition). */
export function wasDuplicate(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { duplicate?: unknown }).duplicate === true
  );
}

export type CallAction = 'ack' | 'resolve';

/** One button's busy flag: keyed per call and action, so one tap never stills another row. */
export function actionKey(callId: string, action: CallAction): string {
  return `${callId}:${action}`;
}

/**
 * What a refused tap means. The call is gone (closed on the till, another
 * venue's, or never there: CALL_NOT_FOUND), or it was already closed when the
 * waiter said "On my way" (INVALID_TRANSITION, 0032's transition): either way
 * someone else answered it, the list is refreshed, and the row says so.
 * Anything else is the mapped reason.
 */
export function callRefusal(err: unknown): 'answered' | 'other' {
  const code = rpcErrorCode(errorMessageOf(err));
  return code === 'CALL_NOT_FOUND' || code === 'INVALID_TRANSITION' ? 'answered' : 'other';
}

/**
 * The catalog key of a reason (the till's words, written once for both apps).
 * A reason this build does not know reads as "Needs assistance".
 */
export function reasonKey(reason: string): MessageKey {
  switch (reason) {
    case 'order':
    case 'bill':
    case 'water':
      return `op.floor.reasons.${reason}`;
    default:
      return 'op.floor.reasons.assistance';
  }
}

/** A raw `waiter_calls` row, read defensively: a row without an id or a time is left out. */
export function readCalls(rows: unknown): WaiterCall[] {
  if (!Array.isArray(rows)) return [];
  const out: WaiterCall[] = [];
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.raised_at !== 'string') continue;
    if (r.status !== 'raised' && r.status !== 'acknowledged') continue;
    const table =
      typeof r.table === 'object' && r.table !== null ? (r.table as Record<string, unknown>) : null;
    out.push({
      id: r.id,
      reason: (typeof r.reason === 'string' ? r.reason : 'assistance') as CallReason,
      status: r.status,
      raised_at: r.raised_at,
      acknowledged_by: typeof r.acknowledged_by === 'string' ? r.acknowledged_by : null,
      table:
        table && typeof table.table_number === 'string'
          ? { table_number: table.table_number }
          : null,
    });
  }
  return out;
}

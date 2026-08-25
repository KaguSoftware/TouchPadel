/**
 * Pure waiter-call helpers (unit-tested) — the phase machine the bell FAB and
 * WaiterSheet render, plus the `m:ss` cooldown formatter.
 */

export type WaiterCallStatus = 'raised' | 'acknowledged' | 'resolved';

export interface WaiterCall {
  callId: string;
  status: WaiterCallStatus;
}

/**
 * idle       — no call in flight (bell offers a fresh call)
 * sending    — RPC in flight
 * raised     — staff notified, nobody has picked it up yet
 * acknowledged — "On the way"
 * done       — resolved ("Done"; the sheet auto-closes 2.5 s later)
 * failed     — the RPC errored (retryable)
 */
export type WaiterPhase = 'idle' | 'sending' | 'raised' | 'acknowledged' | 'done' | 'failed';

export interface WaiterPhaseInput {
  sending: boolean;
  failed: boolean;
  call: WaiterCall | null;
}

/** Single source of truth for the phase — never derive it inline in a component. */
export function waiterPhase({ sending, failed, call }: WaiterPhaseInput): WaiterPhase {
  if (sending) return 'sending';
  if (failed) return 'failed';
  if (!call) return 'idle';
  if (call.status === 'acknowledged') return 'acknowledged';
  if (call.status === 'resolved') return 'done';
  return 'raised';
}

/** True while a call is open (safety-poll window; the bell shows a live state). */
export function isCallOpen(call: WaiterCall | null): boolean {
  return call !== null && call.status !== 'resolved';
}

/**
 * Remaining cooldown as `m:ss` (Latin digits — `formatIQD`/clock convention).
 * Rounds UP so "1 ms left" still reads 0:01, and never goes below 0:00.
 */
export function formatCooldown(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** localStorage key holding the epoch ms at which the bell becomes available again. */
export function cooldownStorageKey(tableId: string | null | undefined): string {
  return `tp-waiter-${tableId ?? 'walkin'}`;
}

/** Parse a persisted cooldown deadline; anything stale or malformed is "no cooldown". */
export function cooldownLeftMs(raw: string | null | undefined, now: number = Date.now()): number {
  if (!raw) return 0;
  const until = Number(raw);
  if (!Number.isFinite(until)) return 0;
  const left = until - now;
  return left > 0 ? left : 0;
}

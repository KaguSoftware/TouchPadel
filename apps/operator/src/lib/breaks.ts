/**
 * Staff breaks (migration 0105) — the pure half. What `app.break_status`
 * returns, and the arithmetic the rail, the break screen and the idle lock
 * share: how long someone has been away, how much of today's allowance is
 * left, and which of the three phases the station is in.
 *
 * Time is extrapolated from the server's clock, not the machine's: the payload
 * carries `now`, and every figure is "what the server said, plus how long ago
 * it said it". A till whose clock drifts still counts the same minutes as the
 * audit log does.
 */
import type { StaffRole } from './auth';

export interface BreakPerson {
  id: string;
  display_name: string;
  role: StaffRole;
}

export interface BreakCover extends BreakPerson {
  /** When they took the station over (server time). */
  since: string;
}

export interface OpenBreak {
  id: string;
  station_id: string;
  business_date: string;
  started_at: string;
  ended_at: string | null;
  cover: BreakCover | null;
}

export interface BreakCandidate extends BreakPerson {
  /** Assigned to this station (as opposed to a manager/owner, who may cover anywhere). */
  assigned: boolean;
}

/** `app.break_status(p_device_id)`. */
export interface BreakStatus {
  now: string;
  business_date: string;
  allowance_seconds: number;
  used_seconds: number;
  remaining_seconds: number;
  open: OpenBreak | null;
  candidates: BreakCandidate[];
}

/** What start_break / end_break / cover_station return on a wrong PIN. */
export interface PinRefused {
  ok: false;
  code: 'PIN_INVALID';
}

/**
 *  - 'none'    nobody is away; the rail offers "Go on break"
 *  - 'away'    the signed-in person is on a break and nobody has taken over:
 *              the station is covered by the break screen
 *  - 'covered' somebody else is at the till; the rail says who and offers
 *              "{name} is back"
 */
export type BreakPhase = 'none' | 'away' | 'covered';

export function breakPhase(status: BreakStatus | null | undefined): BreakPhase {
  if (!status?.open) return 'none';
  return status.open.cover ? 'covered' : 'away';
}

/** Whole seconds since the server stamped the payload, never negative. */
function sinceStatus(status: BreakStatus, nowMs: number): number {
  const stamped = Date.parse(status.now);
  if (Number.isNaN(stamped)) return 0;
  return Math.max(0, Math.floor((nowMs - stamped) / 1000));
}

/** Seconds the open break has run, or 0 when there is none. */
export function elapsedSeconds(status: BreakStatus | null | undefined, nowMs: number): number {
  if (!status?.open) return 0;
  const started = Date.parse(status.open.started_at);
  const stamped = Date.parse(status.now);
  if (Number.isNaN(started) || Number.isNaN(stamped)) return 0;
  // Elapsed at the server's stamp, then the time that has passed here since.
  return Math.max(0, Math.floor((stamped - started) / 1000)) + sinceStatus(status, nowMs);
}

/**
 * Seconds of allowance left today. Goes NEGATIVE while an open break overruns
 * — the screen says "over by" rather than clamping, because the overrun is
 * the fact a manager needs. Callers wanting a floor use `Math.max(0, …)`.
 */
export function remainingSeconds(status: BreakStatus | null | undefined, nowMs: number): number {
  if (!status) return 0;
  const base = status.allowance_seconds - status.used_seconds;
  return status.open ? base - sinceStatus(status, nowMs) : base;
}

/** Minimum a break can be started with — mirrors app.start_break's own floor. */
export const MIN_BREAK_SECONDS = 60;

export function canStartBreak(status: BreakStatus | null | undefined, nowMs: number): boolean {
  if (!status || status.open) return false;
  return remainingSeconds(status, nowMs) >= MIN_BREAK_SECONDS;
}

/** Whole minutes, rounded UP so "1 min left" never reads as 0 while a break is still allowed. */
export function wholeMinutes(seconds: number): number {
  return Math.ceil(Math.abs(seconds) / 60);
}

/**
 * "m:ss" under an hour, "h:mm:ss" from an hour on. Digits are ASCII on
 * purpose: this is a running clock, and the caller wraps it in a bidi isolate
 * beside localised copy the same way the shell does its version string.
 */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Client-side mirror of app.set_station_staff's station id check. */
export function stationIdOk(id: string): boolean {
  return /^[A-Z][A-Z0-9-]{0,31}$/.test(id);
}

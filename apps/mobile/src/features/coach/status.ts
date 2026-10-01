/**
 * What the signed-in account is to coach mode (docs/design/coaching/guest.md
 * §4.13.1): no session, not asked yet, not a coach, a coach (active or
 * paused), or a retired coach who keeps their statements (C-25, R45).
 *
 * PURE (vitest, plain node): CoachStatusProvider feeds it the session's uid
 * and the `coach_me` read, and renders what it answers.
 *
 * A COACH IS A GUEST (guest.md §4.0 rule 5). There is no staff input and no
 * coaching-switch input here (R45): a staff member who coaches and a coach at
 * a branch whose lessons are switched off read `coach_me` like anyone else.
 * StaffStatusProvider keeps answering `guest` or `staff` on its own.
 */
import type { CoachMe, CoachMeRead, CoachMeRetired } from './logic';

export type CoachStatus =
  /** No session, or an anonymous one (a cafe table). */
  | { kind: 'none' }
  /** coach_me in flight (or no reader has asked yet) and no answer yet for this uid. */
  | { kind: 'pending' }
  /** coach: null — never a coach. */
  | { kind: 'guest' }
  /** Active or paused. */
  | { kind: 'coach'; coach: CoachMe }
  /** C-25, R45: statements only. */
  | { kind: 'retired'; coach: CoachMeRetired }
  /** The read failed and there is no earlier answer for this uid. */
  | { kind: 'error' };

export type CoachStatusKind = CoachStatus['kind'];

export const NO_SESSION: CoachStatus = { kind: 'none' };
export const PENDING: CoachStatus = { kind: 'pending' };
/** The context default: every screen rendered without the provider is a guest's. */
export const NOT_A_COACH: CoachStatus = { kind: 'guest' };
export const READ_ERROR: CoachStatus = { kind: 'error' };

export type CoachRead =
  /** No reader is mounted, so the query has not run. */
  | { state: 'idle' }
  | { state: 'pending' }
  | { state: 'error' }
  | { state: 'success'; data: CoachMeRead };

export interface CoachStatusInput {
  /** The session's user id; null with no session or an anonymous one. */
  uid: string | null;
  read: CoachRead;
  previous: CoachStatus;
  /** The uid `previous` was answered for: it is evidence only for the same uid. */
  previousUid: string | null;
}

/** An answer about this account, as opposed to "not known yet". */
export function isAnswer(status: CoachStatus): boolean {
  return status.kind === 'guest' || status.kind === 'coach' || status.kind === 'retired';
}

/**
 * The next status (guest.md §4.13.1):
 *
 *   no session                                → none
 *   idle or in flight, an answer for this uid → that answer
 *   idle or in flight, no answer              → pending
 *   errored, an answer for this uid           → that answer (a dropped
 *                                               connection does not throw the
 *                                               coach out)
 *   errored, no answer                        → error
 *   coach: null                               → guest
 *   coach.status = 'retired'                  → retired
 *   otherwise                                 → coach
 */
export function nextCoachStatus(input: CoachStatusInput): CoachStatus {
  const { uid, read, previous, previousUid } = input;
  if (!uid) return NO_SESSION;
  const known = previousUid === uid && isAnswer(previous) ? previous : null;
  switch (read.state) {
    case 'idle':
    case 'pending':
      return known ?? PENDING;
    case 'error':
      return known ?? READ_ERROR;
    case 'success': {
      const coach = read.data.coach;
      if (!coach) return NOT_A_COACH;
      if (coach.status === 'retired') return { kind: 'retired', coach };
      return { kind: 'coach', coach };
    }
  }
}

/** The coach the status carries (active, paused or retired), or null. */
export function coachOf(status: CoachStatus): CoachMe | CoachMeRetired | null {
  return status.kind === 'coach' || status.kind === 'retired' ? status.coach : null;
}

/** Where the "Coach mode" row of Profile and the staff hub goes, or null to hide it (C-25, C-27). */
export function coachModeEntry(
  status: CoachStatus,
): '/coach-mode' | '/coach-mode-statements' | null {
  if (status.kind === 'coach') return '/coach-mode';
  if (status.kind === 'retired') return '/coach-mode-statements';
  return null;
}

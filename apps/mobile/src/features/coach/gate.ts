/**
 * The coach-mode route gate as a pure function (vitest), in the shape of
 * `staff/gate.ts`. RequireCoach renders what it answers
 * (docs/design/coaching/guest.md §4.13.1).
 */
import type { CoachStatus } from './status';

export type CoachGateDecision =
  | 'loading'
  | 'allow'
  /** A retired coach on any screen but the statements (C-25, R45). */
  | 'redirect-statements'
  /** Not a coach, or signed out: Profile (a staff session goes on to the hub through GuestTabsGate). */
  | 'redirect-home'
  | 'error';

/** Which coach-mode screen is asking: the statements screen is the one a retired coach opens. */
export type CoachScreen = 'statements' | 'mode';

export function coachGate(status: CoachStatus, screen: CoachScreen): CoachGateDecision {
  switch (status.kind) {
    case 'pending':
      return 'loading';
    case 'coach':
      return 'allow';
    case 'retired':
      return screen === 'statements' ? 'allow' : 'redirect-statements';
    case 'error':
      return 'error';
    case 'none':
    case 'guest':
      return 'redirect-home';
  }
}

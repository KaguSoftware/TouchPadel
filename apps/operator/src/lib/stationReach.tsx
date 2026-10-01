/**
 * Can this station reach the server right now? (open matches, DF-11;
 * docs/design/open-matches/operator.md §5.5)
 *
 * Every open-match write is a direct appRpc call, never a queued mutation, so
 * a control that writes one is disabled while the station is offline, with
 * the reason on it. The answer comes from the same heartbeat state the shift
 * gate reads (routes/__root.tsx): reachable unless the last beat itself
 * failed.
 *
 * It FAILS OPEN, as the shift gate does: before the first beat (`venue` null)
 * and outside the shell (a screen test, no provider) the station counts as
 * reachable, and a write that then fails shows its own error. Nothing is
 * disabled on a guess.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { HeartbeatState } from './heartbeat';

export interface StationReach {
  /** False only when the station's last heartbeat failed to reach the server. */
  reachable: boolean;
}

const REACHABLE: StationReach = { reachable: true };

const StationReachContext = createContext<StationReach>(REACHABLE);

/** The rule, pure: reachable unless a beat has run and failed. */
export function reachFromHeartbeat(venue: HeartbeatState | null): StationReach {
  return venue === null || venue.error == null ? REACHABLE : { reachable: false };
}

/** Mounted once in WorkspaceShell, beside ShiftProvider, from the same heartbeat state. */
export function StationReachProvider({ venue, children }: { venue: HeartbeatState | null; children: ReactNode }) {
  const reachable = reachFromHeartbeat(venue).reachable;
  const value = useMemo<StationReach>(() => (reachable ? REACHABLE : { reachable: false }), [reachable]);
  return <StationReachContext.Provider value={value}>{children}</StationReachContext.Provider>;
}

/** `{ reachable }` for the screen; `true` outside the shell. */
export function useStationReach(): StationReach {
  return useContext(StationReachContext);
}

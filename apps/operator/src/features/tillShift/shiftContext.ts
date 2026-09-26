/**
 * The till-shift context (ShiftProvider): its value and the two hooks. Its own
 * module so the dialogs and the payment pane can read it without importing the
 * provider that renders them.
 */
import { createContext, useContext } from 'react';
import type { Holder, RailShift, ShiftGate, ShiftStatus, StationMode } from './tillShiftLogic';

export interface TillShiftContextValue {
  device: string;
  mode: StationMode;
  holder: Holder;
  /** The status as last read, trusted or not: the drawer card shows it. */
  lastStatus: ShiftStatus | null;
  /** The status only when it can be trusted right now; null fails the gate open. */
  status: ShiftStatus | null;
  gate: ShiftGate;
  rail: RailShift | null;
  /** The signed-in person's own shift is open at this station. */
  mineHere: boolean;
  refetch: () => void;
  openStart: () => void;
  /** End or close the station's open shift. `thenSignOut` is the leaving guard's "End my shift". */
  openClose: (opts?: { thenSignOut?: boolean }) => void;
  /** Run `next` now when the gate passes; else ask for the shift first and run it once one is open. */
  withShift: (next: () => void) => void;
  /**
   * The rail's Sign out, when the person's own shift is open here: asks first
   * (End my shift, Sign out anyway, Cancel) and returns true; false means no
   * shift of theirs is open and the caller signs out its usual way.
   */
  guardSignOut: (signOut: () => void) => boolean;
}

export const TillShiftContext = createContext<TillShiftContextValue | null>(null);

export function useTillShift(): TillShiftContextValue {
  const ctx = useContext(TillShiftContext);
  if (!ctx) throw new Error('useTillShift outside ShiftProvider');
  return ctx;
}

/** Null outside the shell (screen tests, the sign-in screen): nothing is gated there. */
export function useTillShiftOptional(): TillShiftContextValue | null {
  return useContext(TillShiftContext);
}

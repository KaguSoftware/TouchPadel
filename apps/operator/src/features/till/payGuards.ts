/**
 * F-32: the till's pay-row rules, pure, so they are tested rather than trusted
 * (TabDetailPanel and OfflineTabPanel read them).
 */

/** Does pressing Cash, Card or Split need the unsent-lines question first? */
export function needsUnsentConfirm(unsentCount: number | null | undefined): boolean {
  return (unsentCount ?? 0) > 0;
}

/**
 * Where a press of Cash, Card or Split lands: the pane (or split) itself, or
 * the unsent-lines question with the pane to follow once it is answered.
 */
export type PayTarget = { kind: 'pay'; method: 'cash' | 'card' } | { kind: 'split' };
export function payPressTarget<T extends PayTarget>(target: T, unsentCount: number | null | undefined): T | { kind: 'unsent'; then: T } {
  return needsUnsentConfirm(unsentCount) ? { kind: 'unsent', then: target } : target;
}

/**
 * "Charge to booking" moves an unsettled tab with no booking of its own onto
 * one. It showed on a settled tab too, where there is nothing left to move.
 */
export function chargeToBookingShown(t: { settled: boolean; hasBooking: boolean; bookingsVisible: boolean }): boolean {
  return !t.settled && !t.hasBooking && t.bookingsVisible;
}

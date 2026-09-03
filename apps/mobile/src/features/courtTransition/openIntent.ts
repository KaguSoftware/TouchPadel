/**
 * "Open the booking sheet once the Book tab is up" — a one-shot intent handed
 * from another screen to the court → booking transition.
 *
 * My bookings' "Book your next game →" used to push the standalone
 * Availability route, which meant the day picker arrived as a plain stack
 * push. It now switches to the Book tab and plays the same transition a tap on
 * the net button does: the court pitches away, the sheet rises.
 *
 * In-memory and one-shot, like pendingSlot: it is an intent that is seconds
 * old by the time the tab reads it, so a cold start must never revive it. The
 * Book tab TAKES it on focus — reading clears it — so a later visit to the tab
 * lands on the court, not on a sheet nobody asked for.
 *
 * Deliberately not a route param: params stick to the route, so clearing one
 * after the animation started is a second render the spring can feel, and any
 * later focus of the tab would replay the open.
 */
let requested = false;

/** Ask the Book tab to open the booking sheet the next time it is focused. */
export function requestBookingSheet(): void {
  requested = true;
}

/** Read AND clear the intent: true exactly once per request. */
export function takeBookingSheetRequest(): boolean {
  const wanted = requested;
  requested = false;
  return wanted;
}

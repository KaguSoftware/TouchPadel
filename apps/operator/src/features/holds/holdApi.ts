/**
 * The hold ladder's staff RPCs (migration 0249). Feature-private query keys:
 * nothing outside this feature invalidates them.
 */
import { appRpc } from '../../lib/appRpc';
import { holdReviewRows, parseHoldStanding, type HoldStanding } from './holdStandingLogic';

export const holdReviewsKey = (branchId: string | null) => ['holdReviews', branchId ?? ''] as const;
export const guestHoldStandingKey = (customerId: string) => ['guestHoldStanding', customerId] as const;

/** Guests the ladder suspended at the branch that nobody has decided on (manager, owner). */
export function fetchHoldReviews(venueId: string | null): Promise<HoldStanding[]> {
  return appRpc<unknown>('hold_reviews', { p_venue_id: venueId }).then(holdReviewRows);
}

/** One customer's standing, or null when they never let a hold lapse. */
export function fetchGuestHoldStanding(customerId: string): Promise<HoldStanding | null> {
  return appRpc<unknown>('guest_hold_standing', { p_customer_id: customerId }).then(parseHoldStanding);
}

/** lift: may hold again at once; ban: never again until lifted (manager, owner). */
export function decideHoldStanding(standingId: string, decision: 'lift' | 'ban'): Promise<HoldStanding | null> {
  return appRpc<unknown>('hold_standing_decide', { p_standing_id: standingId, p_decision: decision }).then(parseHoldStanding);
}

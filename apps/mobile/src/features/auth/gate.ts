/**
 * Route-gate decisions, as pure functions.
 *
 * The `(auth)` and `(gated)` group layouts used to hold these rules. Flattening
 * both groups onto the root stack — so that every push leaves real history and
 * UIKit draws its OWN back item on every screen — moved the rules into
 * per-screen guards. That made them worth isolating: the decision is the part
 * that must not drift, and here it is testable without a React Native renderer
 * (the components import these, so the tests exercise the shipped logic rather
 * than a copy of it).
 */

import type { StaffStatusKind } from '../staff/status';

/** What a guard should render. */
export type GateDecision = 'loading' | 'redirect' | 'allow';

/**
 * Signed-in only (profile-edit, change-password, review, booking, success).
 *
 * `loading` while auth initializes matters: returning `redirect` during that
 * window would flash the welcome screen at a user who IS signed in, on every
 * cold start.
 */
export function sessionGate(input: { initializing: boolean; hasSession: boolean }): GateDecision {
  if (input.initializing) return 'loading';
  if (!input.hasSession) return 'redirect';
  return 'allow';
}

/**
 * Signed-out only (welcome, sign-in, sign-up, forgot-password).
 *
 * The pending-slot exemption is load-bearing, not a nicety: a guest who taps a
 * slot signs in mid-flow, and the screen's own continuation is about to place
 * the hold and route to Review. A redirect firing the instant the session lands
 * would win that race and strand them on the tabs, losing the slot. The intent
 * stays set until the hold settles, so `allow` must survive a live session for
 * exactly as long as it does.
 *
 * verify-email / verify-result deliberately use no gate at all — they render
 * around the moment the session arrives.
 *
 * WHERE a redirected user goes is decided from DERIVED state (the own-profile
 * row), carried over from the `(auth)` layout on 2026-09-01: a first social
 * sign-in has no phone (the trigger writes NULL for OAuth users), so it owes
 * the complete-profile step (owner decision D3) before the tabs. Deciding it
 * here rather than in useSocialSignIn is what lets that hook navigate ONLY
 * while a pending slot exists — a second replace would re-key the route and
 * remount the form, discarding anything typed.
 *
 * `profile: 'pending'` holds on `loading` so the tabs never flash before the
 * row arrives; an errored query reports 'complete' and fails open to the tabs,
 * because the booking path re-checks the phone anyway.
 *
 * `staff` (build-contracts-2026-09-23 §6.5) comes BEFORE the profile: a staff
 * account has no phone, and the complete-profile step is the guest's. `pending`
 * (a hinted staff read in flight) waits; a staff, switched-off or
 * update-the-app account goes to the staff area, never to the guest tabs.
 * `staffAnswered: false` (the signed-in account's own row not read yet) waits
 * too: a staff account reads `guest` until then, and its missing phone would
 * send it to complete-profile. For a guest that is one round trip, alongside
 * the profile's. Left out, or `guest` / `none` once answered, the rule is
 * exactly what it was.
 */
export type ProfileCompletion = 'pending' | 'incomplete' | 'complete';

export function noSessionGate(input: {
  initializing: boolean;
  hasSession: boolean;
  hasPendingSlot: boolean;
  profile?: ProfileCompletion;
  staff?: StaffStatusKind;
  staffAnswered?: boolean;
}): GateDecision | 'redirect-complete-profile' | 'redirect-staff' {
  if (input.initializing) return 'loading';
  if (input.hasSession && !input.hasPendingSlot) {
    if (input.staff === 'pending' || input.staffAnswered === false) return 'loading';
    if (input.staff === 'staff' || input.staff === 'revoked' || input.staff === 'unsupported') {
      return 'redirect-staff';
    }
    if (input.profile === 'pending') return 'loading';
    if (input.profile === 'incomplete') return 'redirect-complete-profile';
    return 'redirect';
  }
  return 'allow';
}

/**
 * SEC-35, client half — deciding what a failed role lookup MEANS.
 *
 * Migration 0081 did the server half: `set_staff_active(false)` deletes the
 * user's `auth.sessions`, so their refresh token stops working and every device
 * is ended atomically with the deactivation. It documents its own honest limit:
 * an ACCESS token already issued stays valid until `jwt_expiry`, which is 3600s
 * today, and nothing server-side can retract a signed JWT.
 *
 * That hour is what this file is about. During it a deactivated staff member's
 * till keeps a SUBSCRIBED Realtime channel. Realtime authorises a private topic
 * when the channel subscribes; it does not re-authorise a channel that is
 * already open. So the leaver's screen goes on receiving live kds / floor /
 * courts broadcasts — order traffic, table state, court movements — from a
 * venue they no longer work at, until the token expires.
 *
 * The fix has two halves and this module is the first: TELL THE DIFFERENCE
 * BETWEEN "revoked" AND "we could not ask".
 *
 * `AuthProvider.fetchStaff` used to return `null` for both. That single null is
 * wrong in both directions at once:
 *
 *   - a transient failure (the venue's wifi dropping for two seconds, a
 *     PostgREST 503) read as REVOKED, and threw a working till out to the
 *     "you are not staff" screen mid-service; and
 *   - because that was so disruptive, nothing dared re-run the lookup on a
 *     timer, which is exactly what leaves the leaver's channel alive for an
 *     hour.
 *
 * Separating them makes the re-check safe: 'unknown' keeps the previous answer
 * and changes nothing, so a blip costs nothing, and only a DEFINITE 'revoked'
 * — the row is gone, or `is_active` is false — drops the channel.
 *
 * Pure: no supabase, no react. The policy is what has to be right, so the
 * policy is what is tested (`roleResolution.test.ts`).
 */
/**
 * The role list, the row shape and the classification itself now live in
 * `@touch/core/staff/roles`, shared with the staff phone
 * (docs/design/protocols/build-contracts-2026-09-23.md §7.1). This file keeps
 * what is the operator's own: what a resolution means for a till (below), and
 * re-exports the rest so every import site stays as it was.
 */
import {
  resolveStaffRow as resolveStaffRowShared,
  type RoleResolution as SharedRoleResolution,
  type StaffRow,
} from '@touch/core/staff/roles';

export {
  ROLE_RECHECK_MS,
  STAFF_ROLES,
  nextStaff,
  type StaffInfo,
  type StaffRole,
  type StaffRow,
} from '@touch/core/staff/roles';

/**
 * The operator's three answers. The shared classifier has a fourth,
 * `unknown_role` (an active row holding a role this build does not know); here
 * it never escapes `resolveStaffRow` below.
 */
export type RoleResolution = Exclude<SharedRoleResolution, { kind: 'unknown_role' }>;

/**
 * Classify one staff lookup, the operator's way.
 *
 * ERROR WINS OVER DATA, deliberately: PostgREST can return both, and a response
 * carrying an error is not one to draw conclusions from. Reading a partial row
 * beside an error is how a 503 would come to mean "you were sacked".
 *
 * An unrecognised `role` string is 'revoked', not 'active'. A role this build
 * does not know cannot be checked against ROUTE_ROLES, and a value that fails
 * every comparison would render an operator with no navigation and no
 * explanation. Refusing it is both safer and more legible. (The phone reads
 * the same answer as "update the app"; a station's build is installed by
 * whoever runs the venue, not by the person signing in.)
 */
export function resolveStaffRow(
  row: Partial<StaffRow> | null | undefined,
  error: unknown,
): RoleResolution {
  const resolution = resolveStaffRowShared(row, error);
  return resolution.kind === 'unknown_role' ? { kind: 'revoked' } : resolution;
}

/**
 * Drop the live Realtime channel?
 *
 * ONLY on a definite revocation. Dropping on 'unknown' would tear a till's live
 * feed down every time the venue's wifi hiccups, and a control that costs
 * service every hour is one that gets switched off within a week.
 */
export function shouldDropRealtime(resolution: RoleResolution): boolean {
  return resolution.kind === 'revoked';
}

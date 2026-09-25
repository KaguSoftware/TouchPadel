/**
 * What the signed-in account is to this phone: a guest, staff, or a staff
 * account that can no longer work here (build-contracts-2026-09-23 §6.5).
 *
 * PURE (vitest, plain node): StaffStatusProvider feeds it the session, the
 * device hint and the own-staff-row read, and renders what it answers. The
 * classification of the row itself is @touch/core's `resolveStaffRow`, shared
 * with the operator, so the two apps cannot disagree about a role.
 *
 * WHY THE HINT. Every guest session reads its own staff row and gets none, so
 * on the phone "no row" means "guest" unless the phone KNOWS this uid was
 * staff: the device hint (`tp.staff-hint`), written when a row resolves to
 * staff. With it, no row means the account was taken away (revoked), and a
 * read still in flight means "staff, probably" (pending) rather than "guest",
 * so a staff cold start never mounts the guest tabs.
 */
import { resolveStaffRow, type StaffInfo, type StaffRow } from '@touch/core';

export type StaffStatus =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'guest' }
  | { kind: 'staff'; staff: StaffInfo; venues: string[] }
  | { kind: 'revoked' }
  | { kind: 'unsupported'; role: string };

export type StaffStatusKind = StaffStatus['kind'];

export const NO_SESSION: StaffStatus = { kind: 'none' };
export const PENDING: StaffStatus = { kind: 'pending' };
/** The context default: every screen rendered without the provider is a guest's. */
export const GUEST_STATUS: StaffStatus = { kind: 'guest' };
export const REVOKED: StaffStatus = { kind: 'revoked' };

/**
 * One read of the caller's own staff row, with `app.staff_venue_ids()` when
 * the row is active (the owner holds no staff_venues rows and gets every
 * active venue, 0123; everyone else their active memberships).
 */
export interface StaffStatusRead {
  row: Partial<StaffRow> | null;
  venueIds: string[];
}

export type StaffRead =
  { state: 'pending' } | { state: 'error' } | { state: 'success'; data: StaffStatusRead };

export interface StaffStatusInput {
  /** The session's user id; null with no session (or an anonymous one). */
  uid: string | null;
  /**
   * AuthProvider is still restoring the stored session (its `initializing`),
   * which can include a token refresh: the uid is not known yet, not absent.
   */
  restoring: boolean;
  /** The uid the device hint names, or null. */
  hintUid: string | null;
  /**
   * A Google or Apple sign-in is being checked, or the session came from one
   * (§6.6): an active row stays `guest` until the refusal signs it out, so
   * nothing routes to the staff area on the way.
   */
  holdStaff: boolean;
  read: StaffRead;
}

/**
 * The next status (§6.5's table, in its order). `previous` is only evidence
 * when it belongs to the same uid: an account switch starts from nothing.
 *
 *   session restoring, a hint on this phone     → pending
 *   no session                                  → none
 *   read in flight, hint for this uid           → pending
 *   read in flight, no hint for this uid        → guest
 *   read errored                                → previous (a pending stays pending)
 *   no row, no hint for this uid                → guest
 *   no row, hint for this uid                   → revoked
 *   row with is_active = false                  → revoked
 *   active row, role unknown to this build      → unsupported
 *   active row, known role                      → staff
 *
 * Revoked is sticky for the session: the provider clears the hint once it
 * says revoked, and "no row, no hint" must not then turn a switched-off
 * account back into a guest.
 *
 * The first row is why the hint is read before the splash: while the stored
 * session is restored there is no uid yet, and "none" would mount the guest
 * tabs (and the 3D court) on a staff phone. A phone with no hint is unchanged.
 */
export function nextStaffStatus(
  previous: StaffStatus,
  previousUid: string | null,
  input: StaffStatusInput,
): StaffStatus {
  if (!input.uid) return input.restoring && input.hintUid !== null ? PENDING : NO_SESSION;
  const hinted = input.hintUid === input.uid;
  const sameUid = previousUid === input.uid && previous.kind !== 'none';
  const unanswered = hinted ? PENDING : GUEST_STATUS;

  switch (input.read.state) {
    case 'pending':
      // A read starting over for a uid that already had a staff-area answer
      // keeps it: a refetch from an empty cache must not flash the guest tabs.
      return sameUid && isStaffArea(previous.kind) ? previous : unanswered;
    case 'error':
      return sameUid ? previous : unanswered;
    case 'success': {
      const { row, venueIds } = input.read.data;
      const resolution = resolveStaffRow(row, null);
      switch (resolution.kind) {
        case 'active':
          if (input.holdStaff) return GUEST_STATUS;
          return { kind: 'staff', staff: resolution.info, venues: [...venueIds] };
        case 'unknown_role':
          if (input.holdStaff) return GUEST_STATUS;
          return { kind: 'unsupported', role: resolution.role };
        case 'revoked':
        case 'unknown':
          // A row that exists but is switched off is revoked whatever the hint
          // says; a missing row is revoked only when this phone knew the uid.
          if (row) return REVOKED;
          return hinted || (sameUid && previous.kind === 'revoked') ? REVOKED : GUEST_STATUS;
      }
    }
  }
}

/** Anything but a guest (or no session): the account belongs in the staff area. */
export function isStaffArea(kind: StaffStatusKind): boolean {
  return kind === 'pending' || kind === 'staff' || kind === 'revoked' || kind === 'unsupported';
}

// ── The device hint (`tp.staff-hint`, AsyncStorage; hint.ts does the IO) ────

export const STAFF_HINT_KEY = 'tp.staff-hint';

export interface StaffHint {
  uid: string;
  surface: 'staff';
  v: 1;
}

/** The stored hint, or null for anything that is not exactly one. */
export function parseStaffHint(raw: string | null | undefined): StaffHint | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StaffHint> | null;
    if (
      value &&
      typeof value.uid === 'string' &&
      value.uid &&
      value.surface === 'staff' &&
      value.v === 1
    ) {
      return { uid: value.uid, surface: 'staff', v: 1 };
    }
  } catch {
    // A corrupt value is no hint; the next staff resolution rewrites it.
  }
  return null;
}

export function serializeStaffHint(uid: string): string {
  const hint: StaffHint = { uid, surface: 'staff', v: 1 };
  return JSON.stringify(hint);
}

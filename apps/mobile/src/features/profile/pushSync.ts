/**
 * The push-token decision logic, with no react-native / expo imports — so it is
 * unit-testable under plain node (vitest.config.ts: the suite runs against the
 * PURE modules only). `push.ts` owns every native call and delegates the
 * decisions here.
 *
 * The decisions are worth isolating because each one encodes a way the old
 * code lost notifications silently, and none of them is observable by hand:
 * the server refuses to enqueue a notification when profiles.expo_push_token
 * is null (migration 0075's trigger returns early, and nothing backfills), so
 * "should we write the token now?" answered wrongly is a notification that
 * never existed rather than one that arrives late.
 */

import { isStaffPushRoute, staffPushHref, type StaffHref } from '../staff/pushRoutes';
import type { StaffStatusKind } from '../staff/status';

/** What a registration attempt concluded. See PushRegistrationResult. */
export type PushOutcome = 'registered' | 'denied' | 'unavailable' | 'failed';

/**
 * Should `persistToken` write, given what this app instance last wrote?
 *
 * The foreground re-check runs on every resume, so the common case must be a
 * string compare rather than a network write. Two things defeat the cache:
 *   - `force`, used by the OS token-rotation listener, where the cached value
 *     is precisely what went stale;
 *   - a cleared cache (sign-out nulls the column server-side, SEC-21), which
 *     is why forgetWrittenPushToken exists — without it the next sign-in would
 *     skip the rewrite as redundant and the profile would stay unreachable.
 */
export function shouldPersistToken(args: {
  token: string;
  lastWritten: string | null;
  force?: boolean;
}): boolean {
  if (args.force) return true;
  return args.lastWritten !== args.token;
}

/**
 * Should a silent (non-prompting) sync actually run?
 *
 * Guards, in order: a torn-down lifecycle, a sync already in flight (resume can
 * fire twice in quick succession), and no session — the token is written to the
 * signed-in guest's own profile row, so there is nothing to attach it to.
 */
export function shouldSync(args: {
  cancelled: boolean;
  inFlight: boolean;
  hasSession: boolean;
}): boolean {
  return !args.cancelled && !args.inFlight && args.hasSession;
}

/**
 * How Settings should render after a registration attempt.
 *
 * `failed` is the case this function exists for. It used to be folded into
 * `unavailable`, which told a guest with a perfectly capable phone that their
 * device does not support notifications — unactionable, and untrue. A fault
 * keeps the permission state we can still observe and reports an error instead.
 */
export type PushPermissionState = 'undetermined' | 'granted' | 'denied' | 'unavailable';

export function permissionStateAfter(
  outcome: PushOutcome,
  observed: PushPermissionState,
): { state: PushPermissionState; errored: boolean } {
  switch (outcome) {
    case 'registered':
      return { state: 'granted', errored: false };
    case 'denied':
      return { state: 'denied', errored: false };
    case 'unavailable':
      return { state: 'unavailable', errored: false };
    case 'failed':
      // Keep what the OS actually reports; the failure is transient, not a
      // property of the handset.
      return { state: observed, errored: true };
  }
}

/**
 * A cold start can deliver the SAME notification tap twice — once from
 * getLastNotificationResponseAsync and once from the response listener — which
 * pushed the booking screen onto itself. Notification ids are unique per
 * delivery, so the id dedupes. An id-less response is routed rather than
 * dropped: a missed dedupe is better than a missed booking.
 */
export function shouldRouteTap(args: { id: string | null; handled: ReadonlySet<string> }): boolean {
  if (!args.id) return true;
  return !args.handled.has(args.id);
}

/** What a tapped notification's data may carry: a booking kind's reservation, or a staff kind's route. */
export interface PushTapData {
  kind?: unknown;
  reservation_id?: unknown;
  /** Staff kinds only (send-push, build-contracts-2026-09-23 §2.21). */
  route?: unknown;
  id?: unknown;
}

export type TapDestination =
  | { kind: 'reservation'; id: string }
  | { kind: 'staff'; href: StaffHref }
  | null;

/** A staff kind: its data names a route (the booking kinds never do). */
export function isStaffTap(data: PushTapData | undefined): boolean {
  return data?.route !== undefined && data?.route !== null;
}

/**
 * Where a tapped notification goes. Only the booking kinds carry a
 * reservation_id; `test` (and any future kind without one) routes nowhere, and
 * must NOT be breadcrumbed as an open — a log claiming a navigation that never
 * happened sent the last audit hunting a routing bug that did not exist.
 *
 * With the staff status (§6.8 item 8), a staff kind's `route` opens its staff
 * screen, but only while this phone is signed in as staff and only for a route
 * the phone lists (STAFF_PUSH_ROUTES, compared with _shared/staff-push.json):
 * a staff push that reaches a phone now signed in as a guest, or names a route
 * this build does not know, opens nothing. A booking kind opens its booking as
 * it always has. Called with the data alone, it answers the booking half, the
 * reservation id, as it always did.
 */
export function tapDestination(data: PushTapData | undefined): string | null;
export function tapDestination(data: PushTapData | undefined, status: StaffStatusKind): TapDestination;
export function tapDestination(
  data: PushTapData | undefined,
  status?: StaffStatusKind,
): string | null | TapDestination {
  const id = data?.reservation_id;
  const reservationId = typeof id === 'string' && id ? id : null;
  if (status === undefined) return reservationId;
  if (isStaffTap(data)) {
    const route = data?.route;
    if (status !== 'staff' || !isStaffPushRoute(route)) return null;
    const target = typeof data?.id === 'string' && data.id ? data.id : null;
    return { kind: 'staff', href: staffPushHref(route, target) };
  }
  return reservationId ? { kind: 'reservation', id: reservationId } : null;
}

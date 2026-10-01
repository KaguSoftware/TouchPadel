/**
 * The payment this device has in flight, per signed-in guest
 * (build-contracts-2026-09-27 §4; plan §5.2 path 3).
 *
 * PERSISTED, unlike `pendingSlot`, and on purpose. A slot tap is a few seconds
 * old and cheap to lose; a payment is money the bank may already have taken.
 * If the app is killed on the bank's 3-D Secure page, the next launch has to
 * know there is a payment to go and look at, so the pointer outlives the
 * process: `tp.pendingPayment.<userId>` → `{ref, reservationId, deadlineAt}`.
 *
 * It is a POINTER, never a result. It says "go and ask the server about this
 * ref", and the status screen renders only what the server answers. It is
 * cleared once that answer is terminal, and by the SEC-16 account-deletion
 * purge (profile/purgeKeys.ts names the key).
 *
 * PURE: the store is injected (`KeyValueStore`), so vitest drives it with a
 * Map; hooks.ts binds AsyncStorage. The key has to be buildable from a pure
 * module anyway, because the deletion purge list is one.
 *
 * An open-match ticket purchase uses the same pointer (guest.md §4.10.2):
 * `purpose: 'ticket'`, an empty `reservationId` (a ticket holds no slot), and
 * the action the tickets were bought for as `after`, so a purchase killed on
 * Qi's page still continues into the join once the payment lands (§4.10.3).
 *
 * A lesson payment uses it too (docs/design/coaching/guest.md §4.9.3):
 * `purpose: 'lesson'`, an empty `reservationId` and the enrolment as
 * `lessonEnrolmentId`, so a payment killed on Qi's page resumes the payment
 * screen and its "View the lesson" opens the right enrolment. Same key, same
 * SEC-16 purge: no new storage key.
 */
import { parseTicketContinuation, type TicketContinuation } from '../matches/continuation';
import type { PaymentPurpose } from './logic';

export interface PendingPayment {
  /** The attempt's request_id — what deposit-status is asked about. */
  ref: string;
  /** The hold the payment began on; '' for a ticket purchase or a lesson. */
  reservationId: string;
  /** The payment window's end (ISO). */
  deadlineAt: string;
  /** Absent on every pointer written before open matches: a deposit. */
  purpose?: PaymentPurpose;
  /** A ticket purchase's continuation (§4.10.3), when it was bought for one. */
  after?: TicketContinuation;
  /** A lesson payment's enrolment (coaching guest.md §4.9.3). */
  lessonEnrolmentId?: string;
}

/** The three calls the pointer needs; AsyncStorage satisfies it. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Per user: two accounts on one phone never share a payment. */
export const pendingPaymentKey = (userId: string) => `tp.pendingPayment.${userId}`;

/**
 * How long past its window a pointer still resumes the status screen.
 * Ten minutes covers the reconciler's sweep and a slow bank; after that the
 * booking list is the honest place to look, and the pointer is dropped.
 */
export const RESUME_GRACE_MS = 10 * 60_000;

export function serializePendingPayment(p: PendingPayment): string {
  return JSON.stringify({
    ref: p.ref,
    reservationId: p.reservationId,
    deadlineAt: p.deadlineAt,
    ...(p.purpose === 'ticket' ? { purpose: 'ticket' } : {}),
    ...(p.purpose === 'ticket' && p.after ? { after: p.after } : {}),
    ...(p.purpose === 'lesson' ? { purpose: 'lesson' } : {}),
    ...(p.purpose === 'lesson' && p.lessonEnrolmentId
      ? { lessonEnrolmentId: p.lessonEnrolmentId }
      : {}),
  });
}

/**
 * A stored pointer, or null when there is none or it is not one of ours. An
 * old pointer (no `purpose`) is a deposit; a malformed `after` is dropped and
 * the pointer kept, because the payment still has to be looked at and only
 * the continuation is lost.
 */
export function parsePendingPayment(raw: string | null): PendingPayment | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (typeof o.ref !== 'string' || !o.ref) return null;
    if (typeof o.reservationId !== 'string' || typeof o.deadlineAt !== 'string') return null;
    const base = { ref: o.ref, reservationId: o.reservationId, deadlineAt: o.deadlineAt };
    if (o.purpose === 'lesson') {
      const enrolment =
        typeof o.lessonEnrolmentId === 'string' && o.lessonEnrolmentId ? o.lessonEnrolmentId : null;
      return enrolment
        ? { ...base, purpose: 'lesson', lessonEnrolmentId: enrolment }
        : { ...base, purpose: 'lesson' };
    }
    if (o.purpose !== 'ticket') return base;
    const after = o.after === undefined ? null : parseTicketContinuation(o.after);
    return after ? { ...base, purpose: 'ticket', after } : { ...base, purpose: 'ticket' };
  } catch {
    return null;
  }
}

/** Read the pointer. A corrupt value is removed rather than read again forever. */
export async function readPendingPayment(
  store: KeyValueStore,
  userId: string,
): Promise<PendingPayment | null> {
  if (!userId) return null;
  const raw = await store.getItem(pendingPaymentKey(userId));
  const parsed = parsePendingPayment(raw);
  if (raw && !parsed) await store.removeItem(pendingPaymentKey(userId));
  return parsed;
}

export async function writePendingPayment(
  store: KeyValueStore,
  userId: string,
  p: PendingPayment,
): Promise<void> {
  // No user, no key: `tp.pendingPayment.` would belong to nobody (purgeKeys.ts guards the same).
  if (!userId) return;
  await store.setItem(pendingPaymentKey(userId), serializePendingPayment(p));
}

/**
 * Forget the pointer. With `onlyRef`, only if it still points at that attempt:
 * a failed attempt's screen must not wipe the pointer the guest's "Try again"
 * has just written for the NEW attempt.
 */
export async function removePendingPayment(
  store: KeyValueStore,
  userId: string,
  onlyRef?: string,
): Promise<void> {
  if (!userId) return;
  if (onlyRef !== undefined) {
    const current = parsePendingPayment(await store.getItem(pendingPaymentKey(userId)));
    if (current && current.ref !== onlyRef) return;
  }
  await store.removeItem(pendingPaymentKey(userId));
}

/** Still worth reopening: the window, plus the grace, has not passed. */
export function isResumable(p: PendingPayment, now: Date): boolean {
  const deadline = Date.parse(p.deadlineAt);
  if (!Number.isFinite(deadline)) return false;
  return deadline + RESUME_GRACE_MS > now.getTime();
}

// ── Resuming ────────────────────────────────────────────────────────────────

/**
 * Screens the resume must never jump over.
 *
 * The auth screens run their own continuation (usePostAuthContinue checks the
 * pointer before the pending slot), Review and the payment pages are mid-flow
 * already, and a staff session has no guest payment to show. Everywhere else —
 * the tabs, a booking, settings — is somewhere the guest is simply resting.
 */
const NOT_RESTING = new Set([
  '/welcome',
  '/sign-in',
  '/sign-up',
  '/verify-email',
  '/verify-result',
  '/verify-otp',
  '/phone-sign-in',
  '/complete-profile',
  '/forgot-password',
  '/reset-password',
  '/accept-terms',
  '/delete-account',
  '/review',
  '/success',
  // Open matches (guest.md §4.10.2): the wallet is mid-purchase, and a new
  // match or a report is a form the guest is filling in.
  '/tickets',
  '/match-new',
  '/match-report',
  // Coaching (coaching guest.md §4.9.3): the lesson review is a form the
  // guest is filling in.
  '/lesson-review',
]);

export function isResumeSafePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (NOT_RESTING.has(pathname)) return false;
  if (pathname.startsWith('/pay/') || pathname === '/pay') return false;
  // A match link is mid-flow: it is continuing into a join (§4.18).
  if (pathname.startsWith('/m/')) return false;
  if (pathname === '/staff' || pathname.startsWith('/staff-') || pathname.startsWith('/staff/')) {
    return false;
  }
  // Coach mode (docs/design/coaching/guest.md §4.17, §4.9.3): a working area with
  // forms in progress (hours, a new session, a booking for a student), never
  // somewhere a guest payment should take over the screen.
  if (pathname === '/coach-mode' || pathname.startsWith('/coach-mode-')) return false;
  return true;
}

/**
 * One resume per attempt per app life. Two paths can find the same pointer —
 * the post-auth continuation and the root resume hook — and the first to
 * claim it is the only one that navigates. A guest who then leaves the status
 * screen on purpose is not dragged back to it on the next tab switch.
 */
const claimed = new Set<string>();

export function claimResume(ref: string): boolean {
  if (claimed.has(ref)) return false;
  claimed.add(ref);
  return true;
}

/** Test seam: forget every claim. */
export function resetResumeClaims(): void {
  claimed.clear();
}

/**
 * The ref of a return link that arrived while nobody was signed in.
 *
 * `touchpadel://pay/return?ref=` lands on the status screen, whose session
 * guard sends a signed-out guest to /welcome and drops the ref with the route.
 * In memory only, like `pendingSlot`: the persisted pointer already covers the
 * device that began the payment; this is the fallback for one that did not.
 */
let returnRef: string | null = null;

export function rememberReturnRef(ref: string): void {
  returnRef = ref;
}

/** Read AND clear the remembered ref. */
export function takeReturnRef(): string | null {
  const ref = returnRef;
  returnRef = null;
  return ref;
}

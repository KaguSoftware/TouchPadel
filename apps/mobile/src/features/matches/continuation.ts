/**
 * NEED_TICKETS → buy → continue the same action
 * (docs/design/open-matches/guest.md §4.10.3, GD-1). PURE; the thin hook that
 * runs it is `useRunTicketContinuation` in tickets.ts.
 *
 * The screen that met the shortage (the match's action card, `match-new`)
 * records what the guest was doing with `setTicketContinuation` and opens
 * `/tickets?buy=<missing>&for=<kind>`. The purchase hook writes it into the
 * payment pointer as `after` (features/deposit/pendingPayment.ts,
 * `tp.pendingPayment.<uid>`, already on the SEC-16 purge list), so it survives
 * the app being killed on Qi's page. When the payment screen reads
 * `ticketsBought`, it runs the same RPC with the same arguments ONCE per ref
 * per app life, within 30 minutes of `savedAt`, also after a cold start. For
 * `start` that includes the same `p_idempotency_key`: a refused `match_start`
 * created no match with that key, so the key is unspent (D34). Stale, or
 * already claimed: no automatic call, one tap runs it.
 *
 * Nothing is retried by itself, and the in-memory copy is never persisted
 * beyond the pointer (§4.23). Once a replayed start answers,
 * `settleContinuationKey` spends or keeps its key as `useStartMatch` does.
 */
import { clearMatchIntentKey } from '../../lib/idempotency';
import { keepsStartKey } from './errors';
import { matchStartIntent, type FriendSeat, type JoinPolicy, type MatchCategory, type Visibility } from './logic';

export type ContinuationKind = 'join' | 'request' | 'start';

export type TicketContinuation = { savedAt: string } & (
  | { kind: 'join'; matchId: string; token: string | null; friends: FriendSeat[] }
  | { kind: 'request'; matchId: string; token: string | null; friends: FriendSeat[] }
  | {
      kind: 'start';
      venueId: string;
      courtId: string;
      startAt: string;
      durationMin: number;
      category: MatchCategory;
      visibility: Visibility;
      joinPolicy: JoinPolicy;
      friends: FriendSeat[];
      quotedPriceIqd: number;
      idempotencyKey: string;
    }
);

/** How long after `savedAt` a continuation still runs by itself (§4.10.3 step 4, draft OQ5). */
export const CONTINUATION_TTL_MS = 30 * 60_000;

// ── In memory (the screen that met the shortage → the purchase) ─────────────

/**
 * The continuation the guest is buying for, and the purchase it became once
 * `ticket-begin` answered. `ref` is null between the shortage and the answer.
 */
let current: { ref: string | null; continuation: TicketContinuation } | null = null;

export function setTicketContinuation(c: TicketContinuation): void {
  current = { ref: null, continuation: c };
}

/** The continuation not yet tied to a purchase (what the purchase hook writes into the pointer). */
export function getTicketContinuation(): TicketContinuation | null {
  return current?.continuation ?? null;
}

/** Tie the in-memory continuation to the purchase `ticket-begin` answered with. */
export function bindTicketContinuation(ref: string): void {
  if (current) current = { ...current, ref };
}

/** Backing out of the tickets screen, or after the continuation ran. */
export function clearTicketContinuation(): void {
  current = null;
}

/**
 * The continuation for a purchase (§4.10.3 step 3): the in-memory one for the
 * same ref wins (it is this app life's), else the one the pointer carried.
 */
export function continuationFor(
  ref: string,
  stored: TicketContinuation | null | undefined,
): TicketContinuation | null {
  if (current && current.ref === ref) return current.continuation;
  return stored ?? null;
}

// ── Once per ref per app life ───────────────────────────────────────────────

const claimed = new Set<string>();

/** True the first time for a ref in this app life, false after (step 4). */
export function claimContinuation(ref: string): boolean {
  if (claimed.has(ref)) return false;
  claimed.add(ref);
  return true;
}

/** Test seam: forget every claim and the in-memory continuation. */
export function resetContinuations(): void {
  claimed.clear();
  current = null;
}

/**
 * A replayed start's key once the call has answered (§4.23): spent on success
 * (also `duplicate: true`, R24) and on a refusal that ends the intent; kept for
 * the refusals the guest fixes and a dropped connection (`keepsStartKey`), as
 * `useStartMatch` does. Without it, a later start of the same slot in this app
 * life replays the spent key and gets the old match back. A join or a request
 * carries no key. `err` is null on success.
 */
export function settleContinuationKey(c: TicketContinuation, err: unknown): void {
  if (c.kind !== 'start') return;
  if (err !== null && err !== undefined && keepsStartKey(err)) return;
  clearMatchIntentKey(matchStartIntent(c));
}

export function isContinuationFresh(c: TicketContinuation, nowMs: number): boolean {
  const saved = Date.parse(c.savedAt);
  if (!Number.isFinite(saved)) return false;
  return nowMs - saved <= CONTINUATION_TTL_MS && nowMs >= saved - 60_000;
}

/**
 * What the payment screen does with a continuation once the tickets are in
 * (step 4 and 7): `auto` runs it now (and claims the ref), `tap` offers "Back
 * to the match" / "Start the match", `none` has nothing to continue. Call it
 * once, when `ticketsBought` first shows: an `auto` answer has spent the claim.
 */
export function continuationPlan(
  ref: string,
  c: TicketContinuation | null,
  nowMs: number,
): 'auto' | 'tap' | 'none' {
  if (!c) return 'none';
  if (!isContinuationFresh(c, nowMs)) return 'tap';
  return claimContinuation(ref) ? 'auto' : 'tap';
}

// ── The pointer's `after` ───────────────────────────────────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function friendsOf(v: unknown): FriendSeat[] | null {
  if (!Array.isArray(v) || v.length > 2) return null;
  const out: FriendSeat[] = [];
  for (const f of v) {
    const g = f && typeof f === 'object' ? (f as { gender?: unknown }).gender : undefined;
    if (g !== null && g !== 'female' && g !== 'male') return null;
    out.push({ gender: g });
  }
  return out;
}

const CATEGORIES: readonly string[] = ['open', 'women', 'men'];
const VISIBILITIES: readonly string[] = ['public', 'link'];
const POLICIES: readonly string[] = ['open', 'approve'];

/**
 * A stored `after`, or null when it is not one this build can run. The
 * pointer's parser drops a malformed `after` and keeps the pointer (§4.10.2):
 * the payment still has to be looked at, only the continuation is lost.
 */
export function parseTicketContinuation(raw: unknown): TicketContinuation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const savedAt = str(o.savedAt);
  const friends = friendsOf(o.friends);
  if (!savedAt || !Number.isFinite(Date.parse(savedAt)) || !friends) return null;
  if (o.kind === 'join' || o.kind === 'request') {
    const matchId = str(o.matchId);
    if (!matchId) return null;
    const token = o.token === null || o.token === undefined ? null : str(o.token);
    if (o.token !== null && o.token !== undefined && token === null) return null;
    return { kind: o.kind, savedAt, matchId, token, friends };
  }
  if (o.kind === 'start') {
    const venueId = str(o.venueId);
    const courtId = str(o.courtId);
    const startAt = str(o.startAt);
    const idempotencyKey = str(o.idempotencyKey);
    const durationMin = o.durationMin;
    const quoted = o.quotedPriceIqd;
    if (!venueId || !courtId || !startAt || !idempotencyKey) return null;
    if (typeof durationMin !== 'number' || !Number.isInteger(durationMin) || durationMin <= 0) return null;
    if (typeof quoted !== 'number' || !Number.isInteger(quoted) || quoted < 0) return null;
    if (
      typeof o.category !== 'string' || !CATEGORIES.includes(o.category) ||
      typeof o.visibility !== 'string' || !VISIBILITIES.includes(o.visibility) ||
      typeof o.joinPolicy !== 'string' || !POLICIES.includes(o.joinPolicy)
    ) {
      return null;
    }
    return {
      kind: 'start',
      savedAt,
      venueId,
      courtId,
      startAt,
      durationMin,
      category: o.category as MatchCategory,
      visibility: o.visibility as Visibility,
      joinPolicy: o.joinPolicy as JoinPolicy,
      friends,
      quotedPriceIqd: quoted,
      idempotencyKey,
    };
  }
  return null;
}

// ── Where it goes ───────────────────────────────────────────────────────────

/** The screen a continuation returns to on a refusal or a tap (step 6): the match, or the form re-quoting. */
export type ContinuationHref =
  | { pathname: '/match/[id]'; params: { id: string; t?: string } }
  | {
      pathname: '/match-new';
      params: { venueId: string; courtId: string; startAt: string; durationMin: string; priceIqd: string };
    };

export function continuationBackHref(c: TicketContinuation): ContinuationHref {
  if (c.kind === 'start') {
    return {
      pathname: '/match-new',
      params: {
        venueId: c.venueId,
        courtId: c.courtId,
        startAt: c.startAt,
        durationMin: String(c.durationMin),
        priceIqd: String(c.quotedPriceIqd),
      },
    };
  }
  return {
    pathname: '/match/[id]',
    params: c.token ? { id: c.matchId, t: c.token } : { id: c.matchId },
  };
}

/** The `for` param of `/tickets?buy=&for=` (§4.10.1): which context line the tickets screen shows. */
export function ticketsHref(missing: number, kind: ContinuationKind): {
  pathname: '/tickets';
  params: { buy: string; for: ContinuationKind };
} {
  const buy = Math.min(3, Math.max(1, Math.floor(missing)));
  return { pathname: '/tickets', params: { buy: String(buy), for: kind } };
}

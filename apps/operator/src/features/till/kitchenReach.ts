/**
 * F-11 (0396): did an order reach a kitchen screen? Pure decisions; the
 * stores and hooks are in kitchenReachStore.ts, the flags in KitchenReach.tsx.
 *
 * Two ways a kitchen screen says it has drawn a ticket:
 *   - the cloud board stamps tickets.kds_seen_at (app.kds_ack_tickets), which
 *     the till reads back with the order's idempotency key and tab;
 *   - a board working from the LAN acks the till's own order key over the
 *     socket (operator-shell lan-kds-server, IPC lanReach).
 * A ticket a kitchen screen has moved on (preparing, ready, completed) has
 * been seen, whatever the stamp says (a board on an older build sends none).
 *
 * The till remembers the orders it sent itself (key, tab, when, queued or
 * not), because an order still waiting in an offline queue is not on the
 * server at all: only the LAN can vouch for it. Twenty seconds after a send
 * with no sighting, the order is flagged "not received by the kitchen yet",
 * on the tab and under the basket, so the cashier tells the kitchen instead of
 * trusting "Order sent." with no screen on.
 */

/** No sighting this long after the order was sent: flag it. */
export const NOT_RECEIVED_AFTER_MS = 20_000;
/** How far back the till reads tickets and remembers its own sends. */
export const REACH_WINDOW_MS = 2 * 60 * 60 * 1000;
/** The status line under the basket says "on the kitchen screen" this long, then goes. */
export const SEEN_SHOWN_MS = 60_000;

export type CloudTicketStatus = 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';

/** One row of the till's tickets read (kitchenReachStore). */
export interface CloudTicket {
  id: string;
  status: CloudTicketStatus;
  createdAtMs: number;
  seenAtMs: number | null;
  tabId: string | null;
  /** The order's idempotency key: the till's envelope key, and the LAN ref. */
  key: string | null;
}

/** An order this till sent (noteKitchenSend). */
export interface KitchenSend {
  key: string;
  /** The tab as the till names it: a server id, or LOCAL_TAB_PREFIX + key offline. */
  tabId: string;
  sentAtMs: number;
  /** Still in the station's queue when mutate() answered. */
  queued: boolean;
}

export type ReachState = 'seen' | 'waiting' | 'queued' | 'notReceived';

export function cloudSeen(t: CloudTicket): boolean {
  return t.seenAtMs !== null || t.status !== 'queued';
}

/** Where one of this till's own sends stands. */
export function sendReachState(
  send: KitchenSend,
  cloudByKey: ReadonlyMap<string, CloudTicket>,
  lanAcked: ReadonlySet<string>,
  nowMs: number,
): ReachState {
  if (lanAcked.has(send.key)) return 'seen';
  const cloud = cloudByKey.get(send.key);
  if (cloud && cloudSeen(cloud)) return 'seen';
  if (cloud?.status === 'voided') return 'seen'; // nothing left for the kitchen to see
  if (nowMs - send.sentAtMs < NOT_RECEIVED_AFTER_MS) return send.queued && !cloud ? 'queued' : 'waiting';
  return 'notReceived';
}

/** The tabs with at least one order no kitchen screen has drawn after the grace. */
export function notReceivedTabs(
  sends: readonly KitchenSend[],
  cloud: readonly CloudTicket[],
  lanAcked: ReadonlySet<string>,
  nowMs: number,
): Set<string> {
  const tabs = new Set<string>();
  const byKey = indexByKey(cloud);
  for (const t of cloud) {
    if (t.status !== 'queued' || cloudSeen(t) || !t.tabId) continue;
    if (t.key && lanAcked.has(t.key)) continue;
    if (nowMs - t.createdAtMs < NOT_RECEIVED_AFTER_MS) continue;
    tabs.add(t.tabId);
  }
  for (const s of sends) {
    if (sendReachState(s, byKey, lanAcked, nowMs) !== 'notReceived') continue;
    tabs.add(s.tabId);
    // The same order on its server tab, once an offline tab has been replayed.
    const tabId = byKey.get(s.key)?.tabId;
    if (tabId) tabs.add(tabId);
  }
  return tabs;
}

export function indexByKey(cloud: readonly CloudTicket[]): Map<string, CloudTicket> {
  const out = new Map<string, CloudTicket>();
  for (const t of cloud) if (t.key) out.set(t.key, t);
  return out;
}

/** The latest of this till's sends to a tab, if it is recent enough to talk about. */
export function latestSendTo(sends: readonly KitchenSend[], tabId: string, nowMs: number): KitchenSend | null {
  let best: KitchenSend | null = null;
  for (const s of sends) {
    if (s.tabId !== tabId || nowMs - s.sentAtMs > REACH_WINDOW_MS) continue;
    if (!best || s.sentAtMs > best.sentAtMs) best = s;
  }
  return best;
}

/**
 * The line under the basket for the latest send to this tab, or null for none.
 * 'queued' is left to the basket's own notice (the till's offline path says
 * that already); a sighting is said for a minute, then the line goes.
 */
export function sendStatusLine(
  send: KitchenSend | null,
  cloudByKey: ReadonlyMap<string, CloudTicket>,
  lanAcked: ReadonlySet<string>,
  nowMs: number,
): Exclude<ReachState, 'queued'> | null {
  if (!send) return null;
  const state = sendReachState(send, cloudByKey, lanAcked, nowMs);
  if (state === 'queued') return null;
  if (state === 'seen') return nowMs - send.sentAtMs < SEEN_SHOWN_MS ? 'seen' : null;
  return state;
}

/**
 * The cloud's statuses of the till's own orders, for the LAN ring (F-11: a
 * KDS that falls back to the LAN never gets a ticket finished on the cloud
 * board as new work). Voided reads as completed: off the board either way.
 */
export function cloudStatusesForLan(
  cloud: readonly CloudTicket[],
): { ref: string; status: 'queued' | 'preparing' | 'ready' | 'completed' }[] {
  const out: { ref: string; status: 'queued' | 'preparing' | 'ready' | 'completed' }[] = [];
  for (const t of cloud) {
    if (!t.key || !t.key.includes(':')) continue;
    out.push({ ref: t.key, status: t.status === 'voided' ? 'completed' : t.status });
    if (out.length === 500) break;
  }
  return out;
}

/** Forget sends older than the window (the store keeps itself small). */
export function pruneSends(sends: readonly KitchenSend[], nowMs: number): KitchenSend[] {
  return sends.filter((s) => nowMs - s.sentAtMs <= REACH_WINDOW_MS);
}

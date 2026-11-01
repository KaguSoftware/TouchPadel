/**
 * F-11: the till's live view of kitchen reach (decisions in kitchenReach.ts).
 *
 *   - sends: the orders this till sent, kept in memory for two hours
 *     (noteKitchenSend, called by TillScreen after mutate()).
 *   - cloud: one shared read of the branch's tickets of the last two hours
 *     with their kds_seen_at, the order's key and tab (tickets_staff_read;
 *     a role that cannot read tickets simply sees no flags). Every 10 s.
 *     In Electron it also hands the statuses to the LAN ring (pushLanCloudStatus).
 *   - lan: which of the till's LAN tickets a kitchen screen drew (onLanReach).
 *   - a shared 5 s clock, so a flag appears on its own after the 20 s grace.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { supabase } from '../../lib/supabase';
import { appRpc, isRpcMissing } from '../../lib/appRpc';
import { touch, type LanReach } from '../../ipc/bridge';
import { isElectron } from '../../lib/mutate';
import {
  REACH_WINDOW_MS,
  cloudStatusesForLan,
  indexByKey,
  latestSendTo,
  notReceivedTabs,
  pruneSends,
  sendStatusLine,
  type CloudTicket,
  type CloudTicketStatus,
  type KitchenSend,
} from './kitchenReach';

// ---------------------------------------------------------------------------
// Sends
// ---------------------------------------------------------------------------
let sends: KitchenSend[] = [];
const sendListeners = new Set<() => void>();

/** Remember an order this till sent to the kitchen (not a shop sale: no ticket). */
export function noteKitchenSend(s: { key: string; tabId: string; queued: boolean }, nowMs = Date.now()): void {
  if (!s.key) return;
  sends = [...pruneSends(sends, nowMs).filter((x) => x.key !== s.key), { ...s, sentAtMs: nowMs }];
  for (const l of sendListeners) l();
}

function subscribeSends(cb: () => void): () => void {
  sendListeners.add(cb);
  return () => sendListeners.delete(cb);
}

/** Tests only. */
export function resetKitchenSendsForTests(): void {
  sends = [];
  for (const l of sendListeners) l();
}

// ---------------------------------------------------------------------------
// LAN reach (main process push)
// ---------------------------------------------------------------------------
let lanAcked: ReadonlySet<string> = new Set();
let lanSubscribed = false;
const lanListeners = new Set<() => void>();

function subscribeLan(cb: () => void): () => void {
  lanListeners.add(cb);
  if (!lanSubscribed && isElectron()) {
    lanSubscribed = true;
    touch.onLanReach((reach: LanReach | null) => {
      lanAcked = new Set(reach?.acked ?? []);
      for (const l of lanListeners) l();
    });
  }
  return () => lanListeners.delete(cb);
}

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeClock(cb: () => void): () => void {
  clockListeners.add(cb);
  if (!clockTimer) {
    // The clock was stopped while nothing watched it: catch up first.
    clockNow = Date.now();
    queueMicrotask(cb);
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const l of clockListeners) l();
    }, 5_000);
  }
  return () => {
    clockListeners.delete(cb);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Cloud tickets
// ---------------------------------------------------------------------------
interface TicketReadRow {
  id: string;
  status: CloudTicketStatus;
  created_at: string;
  kds_seen_at: string | null;
  order: { tab_id: string | null; idempotency_key: string | null } | null;
}

export function toCloudTickets(rows: readonly TicketReadRow[]): CloudTicket[] {
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    createdAtMs: new Date(r.created_at).getTime(),
    seenAtMs: r.kds_seen_at ? new Date(r.kds_seen_at).getTime() : null,
    tabId: r.order?.tab_id ?? null,
    key: r.order?.idempotency_key ?? null,
  }));
}

/** One row of app.kitchen_reach (0399): flat, the order's tab and key beside the ticket. */
interface ReachRpcRow {
  id: string;
  status: CloudTicketStatus;
  created_at: string;
  kds_seen_at: string | null;
  tab_id: string | null;
  idempotency_key: string | null;
}

export function fromReachRows(rows: readonly ReachRpcRow[]): CloudTicket[] {
  return toCloudTickets(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      kds_seen_at: r.kds_seen_at,
      order: { tab_id: r.tab_id, idempotency_key: r.idempotency_key },
    })),
  );
}

/**
 * 0399: app.kitchen_reach, which every station's people may call (the court
 * desk included, whom the tickets table policy leaves out), so the flag shows
 * wherever an order can be sent. A server before 0399 answers RPC_MISSING and
 * the till falls back to its own table read.
 */
export async function fetchCloudTickets(): Promise<CloudTicket[]> {
  const since = new Date(Date.now() - REACH_WINDOW_MS).toISOString();
  try {
    const rows = await appRpc<ReachRpcRow[] | null>('kitchen_reach', { p_since: since });
    return fromReachRows(Array.isArray(rows) ? rows : []);
  } catch (error) {
    if (!isRpcMissing(error)) throw error;
  }
  const { data, error } = await supabase
    .from('tickets')
    .select('id, status, created_at, kds_seen_at, order:orders!inner(tab_id, idempotency_key)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return toCloudTickets((data ?? []) as unknown as TicketReadRow[]);
}

/*
 * The cloud read is a module poller, not a react-query: the flag sits in rows
 * and panels that render without a query client (and one read serves them
 * all). It runs while anything watches it, every 10 s; a failed read (offline)
 * keeps the last answer, and the LAN and the sends still count.
 */
export const CLOUD_POLL_MS = 10_000;
let cloud: CloudTicket[] = [];
let cloudTimer: ReturnType<typeof setInterval> | null = null;
let cloudFetcher: () => Promise<CloudTicket[]> = fetchCloudTickets;
const cloudListeners = new Set<() => void>();

async function pollCloud(): Promise<void> {
  try {
    cloud = await cloudFetcher();
  } catch {
    return;
  }
  if (isElectron()) {
    const updates = cloudStatusesForLan(cloud);
    if (updates.length > 0) touch.pushLanCloudStatus(updates);
  }
  for (const l of cloudListeners) l();
}

function subscribeCloud(cb: () => void): () => void {
  cloudListeners.add(cb);
  if (!cloudTimer) {
    void pollCloud();
    cloudTimer = setInterval(() => void pollCloud(), CLOUD_POLL_MS);
  }
  return () => {
    cloudListeners.delete(cb);
    if (cloudListeners.size === 0 && cloudTimer) {
      clearInterval(cloudTimer);
      cloudTimer = null;
    }
  };
}

/** Tests only: what the poller reads, and a clean slate. */
export function setCloudFetcherForTests(f: () => Promise<CloudTicket[]>): void {
  cloudFetcher = f;
  cloud = [];
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
function useReachInputs() {
  const s = useSyncExternalStore(subscribeSends, () => sends);
  const lan = useSyncExternalStore(subscribeLan, () => lanAcked);
  const now = useSyncExternalStore(subscribeClock, () => clockNow);
  const c = useSyncExternalStore(subscribeCloud, () => cloud);
  return { sends: s, lan, now, cloud: c };
}

/** The tabs with an order no kitchen screen has drawn after the grace. */
export function useNotReceivedTabs(): ReadonlySet<string> {
  const { sends: s, lan, now, cloud } = useReachInputs();
  return useMemo(() => notReceivedTabs(s, cloud, lan, now), [s, cloud, lan, now]);
}

/** The line under the basket for the latest send to this tab. */
export function useSendStatus(tabId: string | null) {
  const { sends: s, lan, now, cloud } = useReachInputs();
  return useMemo(() => {
    if (!tabId) return null;
    return sendStatusLine(latestSendTo(s, tabId, now), indexByKey(cloud), lan, now);
  }, [s, cloud, lan, now, tabId]);
}

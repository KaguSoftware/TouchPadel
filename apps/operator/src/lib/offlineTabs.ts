/**
 * offlineTabs — local identity for tabs opened while disconnected.
 *
 * A tab opened offline has no server id until its tab.open replays; what it
 * does have is its envelope's idempotency key, which is unique on `tabs` and
 * is what order.add_items / tab.settle reference as `tabIdemKey` (resolved
 * server-side at replay — strictly after the open, same queue). This store
 * keeps the human-facing half: the label/table for the rail, and the lines the
 * cashier has sent, priced from the cached menu — the same prices the server
 * will snapshot at replay, so the estimate and the eventual bill agree unless
 * an admin reprices mid-outage.
 *
 * Persisted to localStorage: a till reboot mid-outage (the power-cut drill)
 * must bring the open offline tabs back alongside the queue itself. Entries
 * retire ONLY on 'acked' — the server tab then appears through the normal
 * invalidations. A 'failed' or 'conflict' entry stays on the rail, marked, so
 * the cashier can still see the tab and its lines; the abstract queue row in
 * day close is not a substitute for the bill someone is standing at.
 *
 * A SETTLED tab also stays until its tab.settle acks. It used to leave the rail
 * the instant the settle was ENQUEUED, which meant a taken payment was visible
 * nowhere at all while it sat undelivered in the outbox — 30,000 IQD in the
 * 2026-09-04 case.
 */
import { touch, type Unsub } from '../ipc/bridge';

export interface OfflineTabLine {
  name: string;
  qty: number;
  /** Estimate from the cached menu (unit price incl. modifier deltas). */
  priceIqd: number;
}

export interface OfflineTab {
  /** The tab.open envelope's idempotency key — the offline tab's identity. */
  idemKey: string;
  localId: string;
  label: string | null;
  tableNumber: string | null;
  openedAt: string;
  lines: OfflineTabLine[];
  /** A settle has been queued. The rail KEEPS it until `settleIdemKey` acks. */
  settled: boolean;
  /**
   * The tab.settle envelope's idempotency key, once one has been queued.
   * `undefined` on entries restored from a build older than this field — those
   * retire on the old rule so a mid-upgrade till cannot strand a tab forever.
   */
  settleIdemKey?: string | null;
  /** Set when this tab's own mutation came back terminal. Never auto-clears. */
  failure?: { state: 'failed' | 'conflict'; error?: string };
}

/** Rail selection ids for offline tabs are namespaced to never collide with uuids. */
export const LOCAL_TAB_PREFIX = 'local:';

const STORAGE_KEY = 'touch-operator-offline-tabs';

let tabs: OfflineTab[] = load();
/** Stable snapshot for useSyncExternalStore — recomputed only on writes. */
let openSnapshot: OfflineTab[] = tabs.filter(isOnRail);
const listeners = new Set<() => void>();

/**
 * A settled tab leaves the rail only once its settle has actually landed. Old
 * entries (no `settleIdemKey`) keep the previous behaviour.
 */
function isOnRail(t: OfflineTab): boolean {
  if (!t.settled) return true;
  return t.settleIdemKey != null;
}

function load(): OfflineTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OfflineTab[]) : [];
  } catch {
    return [];
  }
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    /* private mode — the queue itself is still durable in main */
  }
}

function emit(): void {
  openSnapshot = tabs.filter(isOnRail);
  persist();
  for (const fn of listeners) fn();
}

export function listOfflineTabs(): OfflineTab[] {
  return openSnapshot;
}

export function getOfflineTab(idemKey: string): OfflineTab | undefined {
  return tabs.find((t) => t.idemKey === idemKey);
}

export function addOfflineTab(
  entry: Omit<OfflineTab, 'lines' | 'settled' | 'openedAt'> & { openedAt?: string },
): void {
  tabs = [
    ...tabs,
    { lines: [], settled: false, openedAt: entry.openedAt ?? new Date().toISOString(), ...entry },
  ];
  emit();
}

export function appendOfflineLines(idemKey: string, lines: OfflineTabLine[]): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, lines: [...t.lines, ...lines] } : t));
  emit();
}

export function markOfflineSettled(idemKey: string, settleIdemKey: string): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, settled: true, settleIdemKey } : t));
  emit();
}

/** Terminal outcome on a tab's own mutation — kept visible, never silently dropped. */
export function markOfflineTabFailed(
  idemKey: string,
  failure: { state: 'failed' | 'conflict'; error?: string },
): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, failure } : t));
  emit();
}

export function removeOfflineTab(idemKey: string): void {
  tabs = tabs.filter((t) => t.idemKey !== idemKey);
  emit();
}

export function subscribeOfflineTabs(fn: () => void): Unsub {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Retire entries as their mutations land. Mounted once at app root; separate
 * from queueResults so this store has no React/query dependencies.
 *
 * Only 'acked' retires. This used to remove the entry on ANY result, so a
 * deterministic 4xx deleted the tab, its table and its priced lines out from
 * under a cashier mid-service, leaving only an abstract row in day close.
 */
export function initOfflineTabRetirement(): Unsub {
  return touch.onMutationResult((r) => {
    if (r.mutationType === 'tab.open') {
      const entry = tabs.find((t) => t.localId === r.localId || t.idemKey === r.idempotencyKey);
      if (!entry) return;
      if (r.state === 'acked') removeOfflineTab(entry.idemKey);
      else markOfflineTabFailed(entry.idemKey, { state: r.state, error: r.error });
      return;
    }
    if (r.mutationType === 'tab.settle') {
      const entry = tabs.find((t) => t.settleIdemKey === r.idempotencyKey);
      if (!entry) return;
      // The money is now the server's problem — the tab can leave the rail.
      if (r.state === 'acked') removeOfflineTab(entry.idemKey);
      else markOfflineTabFailed(entry.idemKey, { state: r.state, error: r.error });
    }
  });
}

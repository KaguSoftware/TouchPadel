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
 * retire themselves when the tab.open reaches a terminal state — acked means
 * the server tab appears through the normal invalidations; failed/conflict
 * stays visible in the day-close queue panel.
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
  /** A settle has been queued; the rail drops it but the record survives. */
  settled: boolean;
}

/** Rail selection ids for offline tabs are namespaced to never collide with uuids. */
export const LOCAL_TAB_PREFIX = 'local:';

const STORAGE_KEY = 'touch-operator-offline-tabs';

let tabs: OfflineTab[] = load();
/** Stable snapshot for useSyncExternalStore — recomputed only on writes. */
let openSnapshot: OfflineTab[] = tabs.filter((t) => !t.settled);
const listeners = new Set<() => void>();

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
  openSnapshot = tabs.filter((t) => !t.settled);
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

export function markOfflineSettled(idemKey: string): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, settled: true } : t));
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
 * Retire entries as their tab.open lands. Mounted once at app root; separate
 * from queueResults so this store has no React/query dependencies.
 */
export function initOfflineTabRetirement(): Unsub {
  return touch.onMutationResult((r) => {
    if (r.mutationType !== 'tab.open') return;
    const entry = tabs.find((t) => t.localId === r.localId || t.idemKey === r.idempotencyKey);
    if (entry) removeOfflineTab(entry.idemKey);
  });
}

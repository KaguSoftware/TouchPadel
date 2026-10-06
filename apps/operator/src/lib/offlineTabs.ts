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
 * must bring the open offline tabs back alongside the queue itself.
 *
 * Entries retire ONLY on 'acked': the server tab then appears through the
 * normal invalidations. A 'failed' or 'conflict' tab.open (or tab.settle)
 * keeps its entry, marked, so the cashier still sees the tab and its priced
 * lines; the abstract queue row in day close is not a substitute for the bill
 * someone is standing at. This used to retire on ANY result, which deleted a
 * refused tab out from under the cashier.
 *
 * A SETTLED tab also stays until its tab.settle acks. It used to leave the
 * plan the instant the settle was ENQUEUED, so a taken payment was visible
 * nowhere but day close while it sat in the outbox (30,000 IQD on card,
 * 2026-09-04). Callers hand markOfflineSettled the settle's own key only when
 * mutate() reports it queued; a settle that acked inside mutate()'s wait has
 * already fired its result, so the caller removes the entry itself.
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
  /** A settle has been queued. The plan KEEPS it until `settleIdemKey` acks. */
  settled: boolean;
  /**
   * The tab.settle envelope's idempotency key, once one has been queued.
   * Absent on entries restored from a build older than this field: those
   * leave the plan on the old rule, so a mid-upgrade till cannot strand a tab.
   */
  settleIdemKey?: string | null;
  /** Set when this tab's own open or settle came back terminal. Never auto-clears. */
  failure?: { state: 'failed' | 'conflict'; error?: string };
}

/** What the floor says about an offline tab. */
export type OfflineTabState = 'queued' | 'settled' | 'failed';

export function offlineTabState(t: Pick<OfflineTab, 'settled' | 'failure'>): OfflineTabState {
  return t.failure ? 'failed' : t.settled ? 'settled' : 'queued';
}

/** Rail selection ids for offline tabs are namespaced to never collide with uuids. */
export const LOCAL_TAB_PREFIX = 'local:';

const STORAGE_KEY = 'touch-operator-offline-tabs';

let tabs: OfflineTab[] = load();
/** Stable snapshot for useSyncExternalStore — recomputed only on writes. */
let openSnapshot: OfflineTab[] = tabs.filter(isOnPlan);
const listeners = new Set<() => void>();

/**
 * A settled tab leaves the plan only once its settle has landed. Entries
 * without a `settleIdemKey` (older builds) keep the previous behaviour.
 */
function isOnPlan(t: OfflineTab): boolean {
  return !t.settled || t.settleIdemKey != null;
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
  openSnapshot = tabs.filter(isOnPlan);
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

/**
 * A settle for this tab is QUEUED (mutate() answered `queued: true`) under
 * `settleIdemKey`; the entry stays on the plan until that key acks.
 */
export function markOfflineSettled(idemKey: string, settleIdemKey: string): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, settled: true, settleIdemKey } : t));
  emit();
}

/** Terminal outcome on a tab's own mutation: kept visible, never silently dropped. */
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
 * from queueResults so this store has no React/query dependencies. Only
 * 'acked' retires; anything else marks the entry failed.
 */
export function initOfflineTabRetirement(): Unsub {
  return touch.onMutationResult((r) => {
    let entry: OfflineTab | undefined;
    if (r.mutationType === 'tab.open') {
      entry = tabs.find((t) => t.localId === r.localId || t.idemKey === r.idempotencyKey);
    } else if (r.mutationType === 'tab.settle') {
      entry = tabs.find((t) => t.settleIdemKey != null && t.settleIdemKey === r.idempotencyKey);
    }
    if (!entry) return;
    if (r.state === 'acked') removeOfflineTab(entry.idemKey);
    else
      markOfflineTabFailed(entry.idemKey, {
        state: r.state,
        ...(r.error ? { error: r.error } : {}),
      });
  });
}

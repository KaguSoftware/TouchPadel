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
 *
 * F-09: a settled entry also outlives its OPEN's ack (it goes off the plan,
 * since the server tab now shows there) until the settle answers. A settle
 * refused at replay (TOTAL_CHANGED when the server's total is not the one the
 * cashier charged, F-06) comes back on the plan as a failure on 'settle', with
 * the server's total, so the cashier can take the payment again at that
 * figure or have a manager resolve the refused queue row. It used to retire
 * with the open, and the refusal reached nobody but day close.
 */
import { touch, type MutationResult, type Unsub } from '../ipc/bridge';
import { resultErrorCode } from './queueResults';

export interface OfflineTabLine {
  name: string;
  qty: number;
  /** Estimate from the cached menu (unit price incl. modifier deltas). */
  priceIqd: number;
  /**
   * The line's menu category (F-06): its tax group is looked up from the
   * cached menu, the way app.compute_tab_totals does. Absent on an entry
   * from an older build, which then counts as untaxed.
   */
  categoryId?: string | null;
}

/**
 * A whole-tab discount queued against an offline tab (F-09, adjustment.apply
 * with tabIdemKey). `amountIqd` is what app.apply_discount will write at
 * replay, worked out the same way (features/till/offlineTotals).
 */
export interface OfflineAdjustment {
  kind: 'discount_percent' | 'discount_amount';
  /** Basis points for a percent, IQD for an amount — the payload's `value`. */
  value: number;
  amountIqd: number;
  /** The adjustment.apply envelope's key. */
  idemKey: string;
}

/** What the cashier recorded when the payment was queued, so a refusal can be shown against it. */
export interface OfflineSettleInfo {
  method: 'cash' | 'card';
  amountIqd: number;
  tenderedIqd: number | null;
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
  failure?: OfflineTabFailure;
  /** Discounts queued on this tab (F-09). Absent = none. */
  adjustments?: OfflineAdjustment[];
  /** The payment queued with `settleIdemKey` (F-06/F-09). */
  settle?: OfflineSettleInfo | null;
  /**
   * The tab.open has replayed: the server tab exists. A settled entry is kept
   * (off the plan) until its settle answers, so a refused settle comes back to
   * the cashier instead of vanishing with the open (F-09).
   */
  opened?: boolean;
}

export interface OfflineTabFailure {
  state: 'failed' | 'conflict';
  error?: string;
  /** Which of the tab's own writes came back refused. Absent on older entries (the open). */
  on?: 'open' | 'settle';
  /** The server's refusal code, when it named one (TOTAL_CHANGED, TENDER_SHORT…). */
  code?: string | null;
  /** TOTAL_CHANGED's "now N": the server's own total for the tab. */
  serverTotalIqd?: number | null;
  /** The refused settle's envelope key — what a manager resolves in the queue (F-09). */
  settleIdemKey?: string | null;
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
  if (t.failure) return true;
  if (!t.settled) return true;
  // Settled and its open already replayed: the server tab is on the plan; this
  // entry only waits for the settle's answer.
  return t.settleIdemKey != null && !t.opened;
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

/** A discount queued against this offline tab (F-09). */
export function appendOfflineAdjustment(idemKey: string, adjustment: OfflineAdjustment): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, adjustments: [...(t.adjustments ?? []), adjustment] } : t));
  emit();
}

/**
 * A settle for this tab is QUEUED (mutate() answered `queued: true`) under
 * `settleIdemKey`; the entry stays on the plan until that key acks. A retry
 * after a refusal (F-09) clears the refusal and waits on the new key.
 */
export function markOfflineSettled(idemKey: string, settleIdemKey: string, settle?: OfflineSettleInfo): void {
  tabs = tabs.map((t) => {
    if (t.idemKey !== idemKey) return t;
    const next: OfflineTab = { ...t, settled: true, settleIdemKey, ...(settle ? { settle } : {}) };
    delete next.failure;
    return next;
  });
  emit();
}

/** Terminal outcome on a tab's own mutation: kept visible, never silently dropped. */
export function markOfflineTabFailed(idemKey: string, failure: OfflineTabFailure): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, failure } : t));
  emit();
}

/** The open replayed while a settle is still waiting: keep the entry, off the plan. */
function markOfflineOpened(idemKey: string): void {
  tabs = tabs.map((t) => (t.idemKey === idemKey ? { ...t, opened: true } : t));
  emit();
}

/**
 * TOTAL_CHANGED's detail is "expected X, now Y" (settle_tab, 0106): Y is the
 * server's total. Read from the result's details, else its error text.
 */
export function serverTotalFrom(r: Pick<MutationResult, 'serverResult' | 'error'>): number | null {
  const body = r.serverResult as { details?: unknown; detail?: unknown } | null | undefined;
  const texts = [body?.details, body?.detail, r.error].filter((x): x is string => typeof x === 'string');
  for (const text of texts) {
    const m = /now\s+(\d+)/.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
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
    if (r.mutationType === 'tab.open') {
      const entry = tabs.find((t) => t.localId === r.localId || t.idemKey === r.idempotencyKey);
      if (!entry) return;
      if (r.state === 'acked') {
        // A payment still on the queue keeps the entry until it answers (F-09).
        if (entry.settled && entry.settleIdemKey != null) markOfflineOpened(entry.idemKey);
        else removeOfflineTab(entry.idemKey);
        return;
      }
      markOfflineTabFailed(entry.idemKey, { state: r.state, ...(r.error ? { error: r.error } : {}), on: 'open' });
      return;
    }
    if (r.mutationType === 'tab.settle') {
      const entry = tabs.find((t) => t.settleIdemKey != null && t.settleIdemKey === r.idempotencyKey);
      if (!entry) return;
      if (r.state === 'acked') {
        removeOfflineTab(entry.idemKey);
        return;
      }
      // Refused at replay: back on the plan as a row to retry or resolve (F-09).
      markOfflineTabFailed(entry.idemKey, {
        state: r.state,
        ...(r.error ? { error: r.error } : {}),
        on: 'settle',
        code: resultErrorCode(r),
        serverTotalIqd: serverTotalFrom(r),
        settleIdemKey: r.idempotencyKey,
      });
    }
  });
}

// Typed IPC bridge to the Electron main process — TouchBridge per design-arch.md §2.1.
// Preload counterpart: apps/operator-shell/src/preload/index.ts (channels in
// apps/operator-shell/src/ipc-channels.ts).
//
// TODO(W2): replace these local type mirrors with the canonical zod-derived types from
// @touch/core/schemas + @touch/core/queue once they land ("Critical Files" in
// design-arch.md) — this file must not drift from the preload.

export type Unsub = () => void;

export interface MutationEnvelope {
  /** Client entity ref: '{station}-{ulid}', e.g. 'TILL1-01J5X...' (plan override #2). */
  localId: string;
  /** '{station}:{mutation_type}:{ulid}' — station segment MUST equal deviceId. */
  idempotencyKey: string;
  /** 'order.create' | 'order.add_items' | 'ticket.status' | 'payment.record' | 'reservation.create' | ... */
  mutationType: string;
  /** zod-validated by the main process before the SQLite insert (design-arch.md §2.2). */
  payload: unknown;
  /** Station clock, informational. */
  createdAt: string;
  /** The staff member the write is attributed to — replay 400s without it. */
  staffId: string;
  /** The station that owns the durable queue, e.g. 'TILL-01'. */
  deviceId: string;
}

export interface QueueStatus {
  depth: number;
  degraded: boolean;
  conflicts: number;
}

export interface KitchenTicket {
  clientRef: string;
  status: string;
  payload: unknown;
}

// Cached reference data keys (design-arch.md §2.3). Payload types tighten when
// @touch/db types.gen.ts exists.
export interface RefData {
  menu: unknown;
  prices: unknown;
  recipes: unknown;
  courts: unknown;
  tables: unknown;
  tax_config: unknown;
  staff_pins: unknown;
  reservations: unknown;
  open_tabs: unknown;
}
export type RefKey = keyof RefData;

export interface PrintJob {
  kind: 'receipt' | 'kitchen' | 'reprint';
  /** Structured bill data, not markup (design-arch.md §6.1). */
  data: unknown;
}
export interface PrintResult {
  ok: boolean;
  error?: string;
}

export type Role = 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner';

export interface StationInfo {
  stationId: string; // e.g. 'TILL1'
  mode: 'till' | 'desk' | 'kds';
  tillHost?: string;
}

export interface TouchBridge {
  enqueue(m: MutationEnvelope): Promise<{ localId: string; state: 'queued' }>;
  onQueueUpdate(cb: (s: QueueStatus) => void): Unsub;
  onLanTicket(cb: (t: KitchenTicket) => void): Unsub;
  getCachedRef<K extends RefKey>(key: K): Promise<RefData[K]>;
  print(job: PrintJob): Promise<PrintResult>;
  unlockPin(pin: string): Promise<{ staffId: string; role: Role; grantToken: string } | null>;
  getStation(): StationInfo;
}

declare global {
  interface Window {
    touch?: TouchBridge;
  }
}

// Browser-mode mock so the SPA runs under plain `vite dev` outside Electron.
// Nothing here is durable — the real write path is IPC → SQLite queue → replay,
// exercised even when online (design-arch.md §2.1 "one write path").
const mock: TouchBridge = {
  async enqueue(m) {
    console.warn('[touch:mock] enqueue (NOT durable):', m.mutationType, m.idempotencyKey);
    return { localId: m.localId, state: 'queued' };
  },
  onQueueUpdate(cb) {
    cb({ depth: 0, degraded: false, conflicts: 0 });
    return () => {};
  },
  onLanTicket() {
    return () => {};
  },
  async getCachedRef(key) {
    console.warn('[touch:mock] getCachedRef miss:', key);
    return undefined;
  },
  async print(job) {
    console.warn('[touch:mock] print skipped:', job.kind);
    return { ok: false, error: 'not-in-electron' };
  },
  async unlockPin() {
    // PIN check is online server-side crypt() (plan override #6); mock always refuses.
    return null;
  },
  getStation() {
    return { stationId: 'DEV1', mode: 'till' };
  },
};

export const touch: TouchBridge = typeof window !== 'undefined' && window.touch ? window.touch : mock;

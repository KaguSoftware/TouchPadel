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
  /** pending + inflight — what is still travelling. */
  depth: number;
  degraded: boolean;
  conflicts: number;
  failed: number;
  /** Everything non-acked — what day close refuses on and the heartbeat reports. */
  blocking: number;
}

/** The staff session + backend config the main-process sync worker replays with. */
export interface AuthState {
  accessToken: string;
  staffId: string;
  supabaseUrl: string;
  anonKey: string;
}

/** A queued mutation's terminal outcome, pushed as it lands. */
export interface MutationResult {
  localId: string;
  idempotencyKey: string;
  mutationType: string;
  state: 'acked' | 'conflict' | 'failed';
  serverResult?: unknown;
  error?: string;
}

/** A non-acked queue row (payload deliberately omitted — PINs ride in payloads). */
export interface QueueRowInfo {
  seq: number;
  localId: string;
  idempotencyKey: string;
  mutationType: string;
  state: 'pending' | 'inflight' | 'conflict' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** A LAN-delivered kitchen ticket — identified by the order envelope's key. */
export interface KitchenTicket {
  ref: string;
  tabLabel: string | null;
  items: {
    variantId: string;
    qty: number;
    notes?: string;
    modifiers: { modifierId: string; qty: number }[];
  }[];
  createdAt: string;
  status: 'queued' | 'preparing' | 'ready' | 'completed';
}

export type LanFrame =
  | { type: 'ticket.new'; data: KitchenTicket }
  | { type: 'ticket.snapshot'; data: KitchenTicket[] }
  | { type: 'status.update'; data: { ref: string; status: KitchenTicket['status'] } };

// Cached reference data keys (design-arch.md §2.3). Payload types tighten when
// @touch/db types.gen.ts exists. 'day' joined on day 14 — the till's
// "no business day is open" gate must not fire just because the network died.
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
  day: unknown;
}
export type RefKey = keyof RefData;

/** A cached row: payload + when it was fetched (the degraded banner shows the age). */
export interface CachedRef {
  payload: unknown;
  fetchedAt: string;
}

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
  onLanTicket(cb: (frame: LanFrame) => void): Unsub;
  /** KDS stations only: carry a bump to the till over the LAN when the cloud is down. */
  sendLanStatus(update: { ref: string; status: 'preparing' | 'ready' | 'completed' }): void;
  getCachedRef(key: RefKey): Promise<CachedRef | undefined>;
  print(job: PrintJob): Promise<PrintResult>;
  /** OFFLINE pin check only (authorisation-token cache, 14-day TTL) — online
   *  verification lives inside the PIN-gated RPCs as always. */
  unlockPin(pin: string): Promise<{ staffId?: string; role: Role; grantToken: string } | null>;
  getStation(): StationInfo;
  /** Push the staff session (or null on sign-out) for the main-process sync worker. */
  pushAuthState(s: AuthState | null): void;
  /** Push the heartbeat's server-reachability verdict after every beat. */
  pushConnState(online: boolean): void;
  /** Store a fresh reference-data payload for offline trading (fetched_at stamped in main). */
  cachePut(key: RefKey, payload: unknown): void;
  /** A PIN just succeeded server-side — cache its hash for offline unlock. */
  pinObserved(pin: string): void;
  onMutationResult(cb: (r: MutationResult) => void): Unsub;
  getQueueRows(): Promise<QueueRowInfo[]>;
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
    cb({ depth: 0, degraded: false, conflicts: 0, failed: 0, blocking: 0 });
    return () => {};
  },
  onLanTicket() {
    return () => {};
  },
  sendLanStatus() {
    // Browser mode has no LAN peer.
  },
  pushAuthState() {
    // Browser mode has no main process; writes go straight to the network.
  },
  pushConnState() {},
  onMutationResult() {
    return () => {};
  },
  async getQueueRows() {
    return [];
  },
  async getCachedRef(key) {
    console.warn('[touch:mock] getCachedRef miss:', key);
    return undefined;
  },
  cachePut() {
    // Browser mode has no durable cache; reads simply stay online.
  },
  pinObserved() {},
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

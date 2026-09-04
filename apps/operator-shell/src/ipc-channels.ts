// IPC channel names + wire types shared by main and preload.
// Renderer-side counterpart types: apps/operator/src/ipc/bridge.ts.
// TODO(W2): unify both mirrors via @touch/core/schemas + @touch/core/queue once the
// zod mutation schemas land ("Critical Files", design-arch.md).

export const IPC = {
  enqueue: 'touch:enqueue',
  queueUpdate: 'touch:queue-update',
  lanTicket: 'touch:lan-ticket',
  getCachedRef: 'touch:get-cached-ref',
  print: 'touch:print',
  unlockPin: 'touch:unlock-pin',
  getStation: 'touch:get-station',
  /** Renderer → main (send): the staff session the sync worker replays with. */
  authState: 'touch:auth-state',
  /** Renderer → main (send): the heartbeat's verdict on server reachability. */
  connState: 'touch:conn-state',
  /** Main → renderer (push): a queued mutation reached a terminal state. */
  mutationResult: 'touch:mutation-result',
  /** Invoke: every non-acked row — the day-close pre-check and conflicts panel. */
  queueRows: 'touch:queue-rows',
  /** Renderer → main (send): a fresh reference-data payload for the offline cache. */
  cachePut: 'touch:cache-put',
  /** Renderer → main (send): a PIN that just succeeded server-side — cache its hash. */
  pinObserved: 'touch:pin-observed',
  /** Renderer → main (send, KDS stations): a bump to carry over the LAN to the till. */
  lanStatus: 'touch:lan-status',
  /** Invoke: manager-PIN quit — the only way a production window closes. */
  quitApp: 'touch:quit-app',
} as const;

/**
 * Pushed by the renderer on every auth change (sign-in, TOKEN_REFRESHED,
 * sign-out → null). Held in main-process MEMORY only — a stale token on disk
 * is a liability, and the renderer re-pushes within seconds of boot. Also the
 * main process's only source of the backend URL: the renderer is the config
 * authority (resolveSupabaseEnv fails loud there).
 */
export interface AuthState {
  accessToken: string;
  /** auth.uid() === staff.id — what replay attributes the writes to. */
  staffId: string;
  supabaseUrl: string;
  anonKey: string;
}

/** A queued mutation's terminal outcome, pushed to the renderer as it lands. */
export interface MutationResult {
  localId: string;
  idempotencyKey: string;
  mutationType: string;
  state: 'acked' | 'conflict' | 'failed';
  /** Replay echo on ack (server ids/timestamps) or conflict detail. */
  serverResult?: unknown;
  error?: string;
}

/** A non-acked queue row as the UI sees it — payload deliberately omitted
 *  (adjustment payloads carry the typed PIN; the row list needs none of it). */
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

export interface MutationEnvelope {
  /** Client entity ref: '{station}-{ulid}' (plan override #2). The station segment may
   *  differ from deviceId when the till enqueues on the KDS's behalf. */
  localId: string;
  /** '{station}:{mutation_type}:{ulid}' — station segment MUST equal deviceId (the
   *  queue owner mints the key; the replay function enforces the same pair). */
  idempotencyKey: string;
  /** 'order.create' | 'order.add_items' | 'ticket.status' | 'payment.record' | ... */
  mutationType: string;
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
  /**
   * This STATION cannot get its writes out: the renderer reported its beat
   * failing, or the sync worker has hit >=2 consecutive transport failures.
   * Distinct from HeartbeatState.degraded, which is the SERVER's verdict on the
   * venue. The two used to share the name `degraded`, and that collision is
   * exactly how this one ended up with no consumer at all — a till showed a
   * green banner through 144 consecutive failed uploads (2026-09-04).
   */
  uploadBlocked: boolean;
  conflicts: number;
  failed: number;
  /** Everything non-acked (depth + conflicts + failed) — what day close refuses on
   *  and what the heartbeat reports as p_queue_depth. */
  blocking: number;
}

/** What the LAN delivers (the wire types live in main/lan-frames.ts) — frames
 *  are forwarded to the KDS renderer verbatim over IPC.lanTicket. */
export interface KitchenTicket {
  /** The order envelope's idempotency key — the ticket's LAN identity. */
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

export type LanFrameForRenderer =
  | { type: 'ticket.new'; data: KitchenTicket }
  | { type: 'ticket.snapshot'; data: KitchenTicket[] }
  | { type: 'status.update'; data: { ref: string; status: KitchenTicket['status'] } };

export interface PrintJob {
  kind: 'receipt' | 'kitchen' | 'reprint';
  data: unknown;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
}

export type Role = 'cashier' | 'prep' | 'court_desk' | 'manager' | 'owner';

export interface StationInfo {
  stationId: string;
  mode: 'till' | 'desk' | 'kds';
  tillHost?: string;
}

/** A cached ref-data row: the payload plus when it was fetched (banner shows the age). */
export interface CachedRef {
  payload: unknown;
  fetchedAt: string;
}

/**
 * Offline PIN unlock is an AUTHORISATION TOKEN check, not an identity check:
 * the cache stores scrypt hashes of pins that succeeded server-side recently
 * (the server never exposes who owns a pin), and every queued PIN-gated
 * mutation is re-verified server-side at replay — the cache gates UX, the
 * server remains the wall. staffId is therefore absent offline.
 */
export interface PinUnlockResult {
  staffId?: string;
  role: Role;
  grantToken: string;
}

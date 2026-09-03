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
} as const;

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
  depth: number;
  degraded: boolean;
  conflicts: number;
}

export interface KitchenTicket {
  clientRef: string;
  status: string;
  payload: unknown;
}

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

export interface PinUnlockResult {
  staffId: string;
  role: Role;
  grantToken: string;
}

/**
 * mutate() — the single write path (design-arch.md §2.1/§2.2).
 *
 * In Electron, every registered mutation type ALWAYS goes through the durable
 * queue — online too. The insert is fsynced before the IPC promise resolves,
 * the main-process sync worker replays it (sub-second when online), and the
 * result comes back over touch:mutation-result. In browser mode (vite dev,
 * Playwright) there is no main process, so the same payload is dispatched
 * straight to the app.* RPC through a mapping table that MIRRORS the replay
 * function's arg mappers (packages/db/supabase/functions/replay/index.ts) —
 * one payload shape, two transports, identical server behaviour.
 *
 * Admin editors deliberately stay on direct appRpc: replay does not register
 * their types, and offline menu editing is pointless.
 */
import {
  makeIdempotencyKey,
  mutationEnvelopeSchema,
  type MutationType,
} from '@touch/core/schemas/mutations';
import { touch } from '../ipc/bridge';
import { appRpc, AppRpcError, type AppFunctionName } from './appRpc';
import { clientRef, deviceId } from './idem';
import { awaitResult } from './queueResults';

export interface MutateOutcome<T = unknown> {
  /** true = durably queued with no server echo yet (offline / slow link). */
  queued: boolean;
  localId: string;
  /** The envelope's key — a queued tab.open's key IS the offline tab identity. */
  idempotencyKey: string;
  result: T | null;
}

/** How long an online round trip may take before the UI treats it as queued. */
const AWAIT_MS = 8_000;

let currentStaffId: string | null = null;
/** Set by AuthProvider on every session change. */
export function setMutateStaffId(id: string | null): void {
  currentStaffId = id;
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.touch;
}

// ---------------------------------------------------------------------------
// Browser-mode dispatch: payload -> { rpc, args }. MIRRORS replay/index.ts
// MUTATION_RPCS — a change there must land here, and vice versa. Pure and
// exported so the mirror is asserted by tests instead of trusted.
// ---------------------------------------------------------------------------

export interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type PayloadMapper = (p: any, key: string, device: string) => RpcCall;

function orderItems(p: any): unknown[] {
  const items = Array.isArray(p?.items) ? p.items : [];
  return items.map((it: any) => ({
    variant_id: it?.variantId,
    qty: it?.qty,
    ...(it?.notes ? { notes: it.notes } : {}),
    modifiers: (Array.isArray(it?.modifiers) ? it.modifiers : []).map((m: any) => ({
      modifier_id: m?.modifierId,
      qty: m?.qty ?? 1,
    })),
  }));
}

export const DIRECT_RPC: Record<MutationType, PayloadMapper> = {
  'order.create': (p, key, device) => ({
    fn: 'till_add_items',
    args: { p_tab_id: p?.tabId, p_items: orderItems(p), p_idempotency_key: key, p_device_id: device },
  }),
  'order.add_items': (p, key, device) => ({
    fn: 'till_add_items',
    args: { p_tab_id: p?.tabId, p_items: orderItems(p), p_idempotency_key: key, p_device_id: device },
  }),
  'tab.open': (p, key, device) => ({
    fn: 'open_tab',
    args: {
      p_table_id: p?.tableId ?? null,
      p_label: p?.label ?? null,
      p_reservation_id: p?.reservationId ?? null,
      p_idempotency_key: key,
      p_device_id: device,
    },
  }),
  'tab.settle': (p, key, device) => ({
    fn: 'settle_tab',
    args: {
      p_tab_id: p?.tabId,
      p_method: p?.method,
      p_tendered_iqd: p?.tenderedIqd ?? null,
      p_amount_iqd: p?.amountIqd ?? null,
      p_idempotency_key: key,
      p_device_id: device,
    },
  }),
  'payment.record': (p, key, device) => ({
    fn: 'settle_tab',
    args: {
      p_tab_id: p?.tabId,
      p_method: p?.method,
      p_tendered_iqd: p?.tenderedIqd ?? null,
      p_amount_iqd: p?.amountIqd ?? null,
      p_idempotency_key: key,
      p_device_id: device,
    },
  }),
  'ticket.status': (p, _key, device) => ({
    // set_ticket_status is transition-idempotent; it declares NO p_idempotency_key.
    fn: 'set_ticket_status',
    args: { p_ticket_id: p?.ticketId, p_status: p?.status, p_device_id: device },
  }),
  'adjustment.apply': (p, key, device) =>
    p?.kind === 'price_override'
      ? {
          fn: 'override_price',
          args: {
            p_order_item_id: p?.orderItemId,
            p_new_unit_price_iqd: p?.newUnitPriceIqd,
            p_pin: p?.pin,
            p_reason_code: p?.reasonCode,
            p_idempotency_key: key,
            p_device_id: device,
          },
        }
      : {
          fn: 'apply_discount',
          args: {
            p_tab_id: p?.tabId,
            p_kind: p?.kind,
            p_value: p?.value,
            p_pin: p?.pin,
            p_reason_code: p?.reasonCode,
            p_order_item_id: p?.orderItemId ?? null,
            p_idempotency_key: key,
            p_device_id: device,
          },
        },
  'reservation.create': (p, key, device) => ({
    fn: 'staff_create_reservation',
    args: {
      p_court_id: p?.courtId,
      p_kind: p?.kind,
      p_start_at: p?.startAt,
      p_end_at: p?.endAt,
      p_guest_name: p?.guestName ?? null,
      p_guest_phone: p?.guestPhone ?? null,
      p_guest_id: p?.guestId ?? null,
      p_notes: p?.notes ?? null,
      p_client_ref: p?.clientRef ?? null,
      p_idempotency_key: key,
      p_device_id: device,
    },
  }),
  'reservation.update': (p) => {
    // Every desk override carries its reason (SOW L313) — the RPCs take
    // p_reason since 0048 and the replay mappers pass it for all four actions.
    switch (p?.action) {
      case 'move':
        return {
          fn: 'move_reservation',
          args: {
            p_reservation_id: p?.reservationId,
            p_court_id: p?.courtId ?? null,
            p_start_at: p?.startAt ?? null,
            p_end_at: p?.endAt ?? null,
            p_reason: p?.reason ?? null,
          },
        };
      case 'extend':
        return {
          fn: 'extend_reservation',
          args: {
            p_reservation_id: p?.reservationId,
            p_new_end_at: p?.newEndAt,
            p_reason: p?.reason ?? null,
          },
        };
      case 'cancel':
        return {
          fn: 'cancel_reservation',
          args: { p_reservation_id: p?.reservationId, p_reason: p?.reason ?? null },
        };
      case 'mark':
        return {
          fn: 'mark_reservation',
          args: {
            p_reservation_id: p?.reservationId,
            p_status: p?.status,
            p_reason: p?.reason ?? null,
          },
        };
      default:
        throw new AppRpcError('UNKNOWN', `reservation.update: unknown action '${String(p?.action)}'`);
    }
  },
  'waiter_call.action': (p) => ({
    fn: p?.action === 'resolve' ? 'resolve_waiter_call' : 'ack_waiter_call',
    args: { p_call_id: p?.callId },
  }),
  'stock.waste': (p, key, device) => ({
    fn: 'record_waste',
    args: {
      p_ingredient_id: p?.ingredientId,
      p_qty: p?.qty,
      p_movement_type: p?.movementType ?? 'waste_spill',
      p_reason_code: p?.reasonCode ?? null,
      p_idempotency_key: key,
      p_device_id: device,
    },
  }),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Result extraction — the replay function wraps the RPC result as { result,
// echo }; browser mode returns the raw RPC result. Both normalise to the echo.
// ---------------------------------------------------------------------------

function extractEcho(serverResult: unknown): unknown {
  if (serverResult && typeof serverResult === 'object' && 'echo' in serverResult) {
    return (serverResult as { echo: unknown }).echo;
  }
  return serverResult;
}

function toError(state: 'conflict' | 'failed', serverResult: unknown, fallback?: string): AppRpcError {
  const body = (serverResult ?? {}) as Record<string, unknown>;
  const code =
    typeof body.error === 'string' && /^[A-Z][A-Z0-9_]*$/.test(body.error)
      ? body.error
      : typeof body.code === 'string'
        ? body.code
        : state === 'conflict'
          ? 'SLOT_TAKEN'
          : 'UNKNOWN';
  const message = typeof body.message === 'string' ? body.message : (fallback ?? code);
  return new AppRpcError(code, message, undefined, typeof body.details === 'string' ? body.details : undefined);
}

/**
 * Fire one registered mutation through the single write path.
 *
 * Online (either transport) this resolves with the server echo and throws
 * AppRpcError on refusal — exactly like the appRpc call it replaces. When the
 * durable queue cannot reach the server inside AWAIT_MS the write is already
 * safe on disk and the call resolves `{ queued: true, result: null }`; the
 * caller shows its queued state and the reconciliation arrives later through
 * queueResults' invalidations.
 */
export async function mutate<T = unknown>(
  type: MutationType,
  payload: unknown,
): Promise<MutateOutcome<T>> {
  const device = deviceId();
  const key = makeIdempotencyKey(device, type);

  if (!isElectron()) {
    // tabIdemKey/ticketIdemKey only exist for rows queued OFFLINE — impossible
    // in browser mode, which has no queue. Refuse loudly rather than send null ids.
    const p = payload as { tabIdemKey?: unknown; ticketIdemKey?: unknown } | null;
    if (p && typeof p === 'object' && (p.tabIdemKey != null || p.ticketIdemKey != null)) {
      throw new AppRpcError('UNKNOWN', 'idemKey references are queue-only');
    }
    const { fn, args } = DIRECT_RPC[type](payload, key, device);
    const result = await appRpc<T>(fn as AppFunctionName, args);
    return { queued: false, localId: '', idempotencyKey: key, result };
  }

  const staffId = currentStaffId;
  if (!staffId) throw new AppRpcError('AUTH_REQUIRED', 'AUTH_REQUIRED');

  const parsed = mutationEnvelopeSchema.parse({
    localId: clientRef(),
    idempotencyKey: key,
    mutationType: type,
    payload,
    createdAt: new Date().toISOString(),
    staffId,
    deviceId: device,
  });
  const envelope = {
    localId: parsed.localId,
    idempotencyKey: parsed.idempotencyKey,
    mutationType: parsed.mutationType,
    // The PARSED payload rides the queue — zod applied defaults (modifier qty 1).
    payload: (parsed as { payload?: unknown }).payload ?? null,
    createdAt: parsed.createdAt,
    staffId: parsed.staffId,
    deviceId: parsed.deviceId,
  };

  const enqueued = (await touch.enqueue(envelope)) as { localId?: string; error?: string };
  if (enqueued?.error) {
    // Main-process validation refused the envelope — a bug in our own code.
    throw new AppRpcError('UNKNOWN', `enqueue refused: ${enqueued.error}`);
  }

  const settled = await awaitResult(envelope.localId, AWAIT_MS);
  if (!settled) {
    return { queued: true, localId: envelope.localId, idempotencyKey: key, result: null };
  }
  if (settled.state === 'acked') {
    return {
      queued: false,
      localId: envelope.localId,
      idempotencyKey: key,
      result: extractEcho(settled.serverResult) as T,
    };
  }
  throw toError(settled.state, settled.serverResult, settled.error);
}

/**
 * replay — idempotent replay endpoint for the till's durable SQLite queue
 * (design-arch §2.2). POST body:
 *   { idempotency_key, mutation_type, payload, station_id, staff_id }
 *
 * Contract:
 *  - duplicate idempotency_key  -> the STORED result, HTTP 200 (never re-applies)
 *  - applied                    -> RPC result echo, HTTP 200, sync_replays 'applied'
 *  - exclusion conflict (23P01 / SLOT_TAKEN) -> HTTP 409, sync_replays 'conflict'
 *    + manager_alerts('replay_conflict') — the desk resolves manually, no overwrite
 *  - anything else (validation, forbidden, ...) -> mapped error, AND a
 *    sync_replays row (result 'conflict' with the error detail): a queued write
 *    must never vanish without a durable trace — the till still marks the queue
 *    row failed and surfaces it, but the server keeps the record.
 *
 * AuthZ: the request must carry a STAFF session JWT. The RPC dispatch reuses
 * that JWT (a client bound to the caller's Authorization header) so every
 * role guard / audit row inside the app.* functions sees the real staff
 * auth.uid() — the service client is used only for verification + bookkeeping
 * (sync_replays, manager_alerts), never to bypass RPC security.
 */
import {
  createServiceClient,
  getCallerUserId,
} from '../_shared/supabase.ts';
import { json, mapPgError, isExclusionConflict, type PgError } from '../_shared/http.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---------------------------------------------------------------------------
// mutation_type -> RPC map. MIRRORS packages/core/src/schemas/mutations.ts
// (MUTATION_TYPES) — a type added there must be added here, and vice versa.
// `args` maps the (camelCase, zod-validated-at-enqueue) payload to the RPC's
// p_* arguments — passing ONLY the parameters that RPC declares (an undeclared
// arg makes PostgREST fail the whole call with PGRST202 "no matching function").
// ---------------------------------------------------------------------------
type Ctx = { idempotencyKey: string; stationId: string; staffId: string };
type Route = { rpc: string; entity: string; args: (p: any, c: Ctx) => Record<string, unknown> };

const common = (c: Ctx) => ({ p_idempotency_key: c.idempotencyKey, p_device_id: c.stationId });

const MUTATION_RPCS: Record<string, (p: any, c: Ctx) => Route> = {
  // --- wired today (migration 0008) ------------------------------------------------
  'reservation.create': (p, c) => ({
    rpc: 'staff_create_reservation',
    entity: 'reservation',
    args: () => ({
      p_court_id: p.courtId,
      p_kind: p.kind,
      p_start_at: p.startAt,
      p_end_at: p.endAt,
      p_guest_name: p.guestName ?? null,
      p_guest_phone: p.guestPhone ?? null,
      p_guest_id: p.guestId ?? null,
      p_notes: p.notes ?? null,
      p_client_ref: p.clientRef ?? null,
      ...common(c),
    }),
  }),
  // payload.action discriminates the desk edit; all four RPCs are live (0008).
  'reservation.update': (p) => {
    const routes: Record<string, Route> = {
      move: {
        rpc: 'move_reservation',
        entity: 'reservation',
        args: () => ({
          p_reservation_id: p.reservationId,
          p_court_id: p.courtId ?? null,
          p_start_at: p.startAt ?? null,
          p_end_at: p.endAt ?? null,
        }),
      },
      extend: {
        rpc: 'extend_reservation',
        entity: 'reservation',
        args: () => ({ p_reservation_id: p.reservationId, p_new_end_at: p.newEndAt }),
      },
      cancel: {
        rpc: 'cancel_reservation',
        entity: 'reservation',
        args: () => ({ p_reservation_id: p.reservationId, p_reason: p.reason ?? null }),
      },
      mark: {
        rpc: 'mark_reservation',
        entity: 'reservation',
        args: () => ({ p_reservation_id: p.reservationId, p_status: p.status }),
      },
    };
    const route = routes[p?.action];
    if (!route) throw new BadRequest(`reservation.update: unknown action '${p?.action}'`);
    return route;
  },

  // --- Drop-2/3 RPCs (0015/0016/0018). Arg mappers pass ONLY the parameters
  // each function declares — verified against the migration SQL:
  //   open_tab(p_table_id, p_label, p_reservation_id, p_idempotency_key, p_device_id)
  //   till_add_items(p_tab_id, p_items, p_idempotency_key, p_device_id)
  //   set_ticket_status(p_ticket_id, p_status, p_device_id)              — no idem key
  //   settle_tab(p_tab_id, p_method, p_tendered_iqd, p_amount_iqd,
  //              p_idempotency_key, p_device_id)
  //   apply_discount(p_tab_id, p_kind, p_value, p_pin, p_reason_code,
  //                  p_order_item_id, p_device_id)                       — no idem key
  //   override_price(p_order_item_id, p_new_unit_price_iqd, p_pin,
  //                  p_reason_code, p_device_id)                         — no idem key
  //   record_waste(p_ingredient_id, p_qty, p_movement_type, p_reason_code,
  //                p_device_id)                                          — no idem key
  'tab.open': (p, c) => ({
    rpc: 'open_tab',
    entity: 'tab',
    args: () => ({
      p_table_id: p?.tableId ?? null,
      p_label: p?.label ?? null,
      p_reservation_id: p?.reservationId ?? null,
      ...common(c),
    }),
  }),
  'order.create': (p, c) => ({
    rpc: 'till_add_items', // creates the order + items on a tab (till path)
    entity: 'order',
    args: () => ({ p_tab_id: p?.tabId, p_items: orderItems(p), ...common(c) }),
  }),
  'order.add_items': (p, c) => ({
    rpc: 'till_add_items',
    entity: 'order',
    args: () => ({ p_tab_id: p?.tabId, p_items: orderItems(p), ...common(c) }),
  }),
  'ticket.status': (p, c) => ({
    rpc: 'set_ticket_status',
    entity: 'ticket_status',
    // set_ticket_status is transition-idempotent (same-status replay echoes
    // {duplicate:true}); it declares NO p_idempotency_key.
    args: () => ({ p_ticket_id: p?.ticketId, p_status: p?.status, p_device_id: c.stationId }),
  }),
  // A queued payment settles the tab — settle_tab IS the payment-recording RPC
  // (there is no record_payment function; payments rows are inserted by it).
  'payment.record': (p, c) => ({
    rpc: 'settle_tab',
    entity: 'payment',
    args: () => ({
      p_tab_id: p?.tabId,
      p_method: p?.method,
      p_tendered_iqd: p?.tenderedIqd ?? null,
      p_amount_iqd: p?.amountIqd ?? null,
      ...common(c),
    }),
  }),
  'tab.settle': (p, c) => ({
    rpc: 'settle_tab',
    entity: 'tab',
    args: () => ({
      p_tab_id: p?.tabId,
      p_method: p?.method,
      p_tendered_iqd: p?.tenderedIqd ?? null,
      p_amount_iqd: p?.amountIqd ?? null,
      ...common(c),
    }),
  }),
  'adjustment.apply': (p, c) => {
    if (p?.kind === 'price_override') {
      return {
        rpc: 'override_price',
        entity: 'adjustment',
        args: () => ({
          p_order_item_id: p?.orderItemId,
          p_new_unit_price_iqd: p?.newUnitPriceIqd,
          p_pin: p?.pin,
          p_reason_code: p?.reasonCode,
          p_device_id: c.stationId,
        }),
      };
    }
    return {
      rpc: 'apply_discount',
      entity: 'adjustment',
      args: () => ({
        p_tab_id: p?.tabId,
        p_kind: p?.kind,
        p_value: p?.value,
        p_pin: p?.pin,
        p_reason_code: p?.reasonCode,
        p_order_item_id: p?.orderItemId ?? null,
        p_device_id: c.stationId,
      }),
    };
  },
  'waiter_call.action': (p) => ({
    rpc: p?.action === 'resolve' ? 'resolve_waiter_call' : 'ack_waiter_call',
    entity: 'waiter_call',
    args: () => ({ p_call_id: p.callId }),
  }),
  'stock.waste': (p, c) => ({
    rpc: 'record_waste',
    entity: 'stock',
    args: () => ({
      p_ingredient_id: p?.ingredientId,
      p_qty: p?.qty,
      p_movement_type: p?.movementType ?? 'waste_spill',
      p_reason_code: p?.reasonCode ?? null,
      p_device_id: c.stationId,
    }),
  }),
};

/**
 * order payload items (camelCase, zod-validated at enqueue) -> the p_items
 * jsonb shape app.add_order_items reads: variant_id / qty / notes /
 * modifiers[{modifier_id, qty}].
 */
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

class BadRequest extends Error {}

interface ReplayBody {
  idempotency_key: string;
  mutation_type: string;
  payload: unknown;
  station_id: string;
  staff_id: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: ReplayBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  const { idempotency_key, mutation_type, payload, station_id, staff_id } = body ?? {};
  if (
    typeof idempotency_key !== 'string' || !idempotency_key ||
    typeof mutation_type !== 'string' ||
    typeof station_id !== 'string' || !station_id ||
    typeof staff_id !== 'string' || !staff_id
  ) {
    return json({ error: 'idempotency_key, mutation_type, payload, station_id, staff_id required' }, 400);
  }
  // Key discipline (mirrors mutationEnvelopeSchema): "{station}:{type}:{ulid}".
  const [keyStation, keyType] = idempotency_key.split(':');
  if (keyStation !== station_id || keyType !== mutation_type) {
    return json({ error: 'idempotency_key does not match station_id/mutation_type' }, 400);
  }

  const service = createServiceClient();

  // The caller must be a live staff session, and the recorded actor must be an
  // active staff row (they can differ: the till replays a colleague's queue).
  const callerId = await getCallerUserId(req, service);
  if (!callerId) return json({ error: 'staff session required' }, 401);
  const staffCheck = await service
    .from('staff')
    .select('id')
    .in('id', callerId === staff_id ? [callerId] : [callerId, staff_id])
    .eq('is_active', true);
  if (staffCheck.error) return json({ error: staffCheck.error.message }, 500);
  const activeIds = new Set((staffCheck.data ?? []).map((s) => s.id));
  if (!activeIds.has(callerId)) return json({ error: 'caller is not active staff' }, 403);
  if (!activeIds.has(staff_id)) return json({ error: 'staff_id is not active staff' }, 403);

  // Replay-level idempotency: same key => the stored result, 200, no re-apply.
  const dup = await service
    .from('sync_replays')
    .select('result, conflict_detail')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();
  if (dup.error) return json({ error: dup.error.message }, 500);
  if (dup.data) {
    return json({ result: 'duplicate', prior_result: dup.data.result, echo: dup.data.conflict_detail });
  }

  const routeFor = MUTATION_RPCS[mutation_type];
  if (!routeFor) return json({ error: `unknown mutation_type '${mutation_type}'` }, 400);

  const ctx: Ctx = { idempotencyKey: idempotency_key, stationId: station_id, staffId: staff_id };
  let route: Route;
  try {
    route = routeFor(payload, ctx);
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400);
    throw e;
  }

  // Dispatch AS THE STAFF SESSION so role guards + audit attribution hold.
  const asStaff = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    },
  );
  const { data: rpcResult, error: rpcError } = await asStaff
    .schema('app')
    .rpc(route.rpc, route.args(payload, ctx));

  // NOTE on sync_replays: canonical DDL (design-data §1.9) has `conflict_detail
  // jsonb`; this endpoint uses that column as the generic result echo for ALL
  // outcomes (applied echo / conflict detail) so duplicates can return the
  // stored answer. If the degraded-sync migration adds a dedicated result
  // column, switch these writes to it.
  async function record(result: 'applied' | 'duplicate' | 'conflict', detail: unknown) {
    const ins = await service.from('sync_replays').insert({
      device_id: station_id,
      idempotency_key,
      entity: route.entity,
      result,
      conflict_detail: detail ?? null,
    });
    if (ins.error && ins.error.code === '23505') {
      // Concurrent replay won the insert race — fetch and hand back its answer.
      const prior = await service
        .from('sync_replays')
        .select('result, conflict_detail')
        .eq('idempotency_key', idempotency_key)
        .maybeSingle();
      return prior.data ?? null;
    }
    if (ins.error) console.error('sync_replays insert failed:', ins.error.message);
    return null;
  }

  if (rpcError) {
    const pgErr = rpcError as PgError;
    if (isExclusionConflict(pgErr)) {
      const detail = {
        code: 'SLOT_TAKEN',
        message: pgErr.message,
        details: pgErr.details ?? null,
        mutation_type,
        payload,
      };
      const prior = await record('conflict', detail);
      if (prior) return json({ result: 'duplicate', prior_result: prior.result, echo: prior.conflict_detail });
      // Surface to the desk: shows a conflict rather than an overwrite (SoW).
      const alert = await service.from('manager_alerts').insert({
        kind: 'replay_conflict',
        payload: {
          idempotency_key,
          mutation_type,
          station_id,
          staff_id,
          detail: pgErr.details ?? pgErr.message,
        },
      });
      if (alert.error) console.error('manager_alerts insert failed:', alert.error.message);
      return json({ result: 'conflict', error: 'SLOT_TAKEN', detail: pgErr.details ?? null }, 409);
    }
    // Not a conflict: validation/authz/... error. STILL recorded (result
    // 'conflict', detail = the error) so the queued write never vanishes —
    // duplicates return the stored outcome instead of silently re-applying.
    const mapped = mapPgError(pgErr);
    const errDetail = {
      code: mapped.code,
      message: pgErr.message,
      details: pgErr.details ?? null,
      mutation_type,
      payload,
    };
    const priorErr = await record('conflict', errDetail);
    if (priorErr) {
      return json({ result: 'duplicate', prior_result: priorErr.result, echo: priorErr.conflict_detail });
    }
    return json({ result: 'error', ...mapped }, mapped.status);
  }

  // RPCs are themselves idempotent and echo { duplicate: true } when the write
  // already existed (e.g. an online race): record the truthful outcome.
  const wasDuplicate = !!(rpcResult && typeof rpcResult === 'object' && (rpcResult as any).duplicate);
  const prior = await record(wasDuplicate ? 'duplicate' : 'applied', rpcResult);
  if (prior) return json({ result: 'duplicate', prior_result: prior.result, echo: prior.conflict_detail });

  return json({ result: wasDuplicate ? 'duplicate' : 'applied', echo: rpcResult });
});

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
 *  - the server could not judge the write: any answer ≥ 500 that is not a
 *    deterministic SQLSTATE (_shared/http.ts isUnjudgedReplayError) — 503
 *    RETRY_LATER (serialization, deadlock, lock/statement timeout, pool,
 *    connection), 501 RPC_NOT_DEPLOYED (a till updated ahead of its migration),
 *    503 DEGRADED_LOCKOUT, a transport-ish 500 (no SQLSTATE, PGRST*, system or
 *    internal errors)
 *                               -> that status with { result: 'retry' }, NOTHING
 *    recorded. The till's sync worker retries every ≥ 500; a sync_replays row
 *    written here would turn that retry into a 'duplicate' of a 'conflict', a
 *    permanent refusal for a write that was never judged (C1, W2 #11)
 *  - PIN-gated types (adjustment.apply): verify_manager_pin runs first as the staff
 *    session (0115) so the lockout counts; its refusal is handled like the RPC's
 *  - anything else (validation, forbidden, a deterministic SQLSTATE, ...) ->
 *    mapped error, AND a sync_replays row (result 'conflict' with the error
 *    detail): a queued write must never vanish without a durable trace — the
 *    till still marks the queue row failed and surfaces it, but the server
 *    keeps the record. Secrets in the payload (a manager PIN on
 *    adjustment.apply) are redacted before the record is written or echoed (S2).
 *
 * Bodies: capped at 256 KB (413). A response carries the stable code, never
 * raw Postgres text: a P0001 refusal answers its code and its own detail, any
 * other SQLSTATE its code (the raw text goes to the log and to the
 * sync_replays record, the server-side trace).
 *
 * AuthZ: the request must carry a STAFF session JWT. The RPC dispatch reuses
 * that JWT (a client bound to the caller's Authorization header) so every
 * role guard / audit row inside the app.* functions sees the real staff
 * auth.uid() — the service client is used only for verification + bookkeeping
 * (sync_replays, manager_alerts), never to bypass RPC security. The staff check
 * is replay's own, not requireStaffRole: it checks two people (the caller and
 * the queued actor) and answers its historical error strings, which the till
 * surfaces.
 */
import {
  callerClient,
  createServiceClient,
  getCallerUserId,
} from '../_shared/supabase.ts';
import {
  handle,
  isExclusionConflict,
  isUnjudgedReplayError,
  isUuid,
  json,
  KB,
  logError,
  mapPgError,
  readJsonBody,
  type MappedError,
  type PgError,
} from '../_shared/http.ts';
import { redactSecrets } from '../_shared/redact.ts';
import mutationTypes from '../_shared/mutation-types.json' with { type: 'json' };

/** A queued order with every modifier is a few KB; 256 KB is generous and still bounded. */
const MAX_BODY = 256 * KB;

/**
 * What the till sees of a refusal: the mapped code and status; `message` is the
 * code (for a P0001 refusal it always was); `details` only when our own RAISE
 * set it (P0001), never a raw constraint's "Key (...)=(...)".
 */
function publicMapped(mapped: MappedError, err: PgError): MappedError {
  return {
    status: mapped.status,
    code: mapped.code,
    message: mapped.code,
    details: err.code === 'P0001' ? (err.details ?? null) : null,
  };
}

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
  // p_reason on every action (the RPCs take it since 0048): a desk override
  // replayed through the queue must land with its reason (SOW L313), not as
  // the bare default the audit row would otherwise show.
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
          p_reason: p.reason ?? null,
        }),
      },
      extend: {
        rpc: 'extend_reservation',
        entity: 'reservation',
        args: () => ({
          p_reservation_id: p.reservationId,
          p_new_end_at: p.newEndAt,
          p_reason: p.reason ?? null,
        }),
      },
      cancel: {
        rpc: 'cancel_reservation',
        entity: 'reservation',
        args: () => ({ p_reservation_id: p.reservationId, p_reason: p.reason ?? null }),
      },
      mark: {
        rpc: 'mark_reservation',
        entity: 'reservation',
        args: () => ({
          p_reservation_id: p.reservationId,
          p_status: p.status,
          p_reason: p.reason ?? null,
        }),
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
  //                  p_order_item_id, p_device_id, p_idempotency_key)    — keyed since 0049 (0119)
  //   override_price(p_order_item_id, p_new_unit_price_iqd, p_pin,
  //                  p_reason_code, p_device_id, p_idempotency_key)      — keyed since 0049 (0119)
  //   record_waste(p_ingredient_id, p_qty, p_movement_type, p_reason_code,
  //                p_device_id, p_idempotency_key)                       — keyed since 0049
  // Item 9 / C3 (0120):
  //   cancel_tab(p_tab_id, p_reason_code, p_device_id, p_idempotency_key)
  //   settle_zero_tab(p_tab_id, p_reason_code, p_device_id, p_idempotency_key)
  //   refund(p_payment_id, p_amount_iqd, p_pin, p_reason_code, p_items,
  //          p_device_id, p_idempotency_key)
  //   void_after_send(p_order_item_id, p_pin, p_reason_code, p_device_id)  — no idem key
  //                  (void_order_item_internal is state-idempotent, 0039)
  'tab.open': (p, c) => ({
    rpc: 'open_tab',
    entity: 'tab',
    args: () => ({
      p_table_id: p?.tableId ?? null,
      p_label: p?.label ?? null,
      p_reservation_id: p?.reservationId ?? null,
      // 0145: a shop counter sale; omitted for a café tab (same call as mutate.ts).
      ...(p?.kind === 'shop' ? { p_kind: 'shop' } : {}),
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
      p_expected_total_iqd: p?.expectedTotalIqd ?? null, // 0106: TOTAL_CHANGED guard
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
      p_expected_total_iqd: p?.expectedTotalIqd ?? null, // 0106: TOTAL_CHANGED guard
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
          ...common(c),        // 0049: was p_device_id only -- a replay re-overrode
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
        ...common(c),          // 0049: was p_device_id only -- a replay discounted twice
      }),
    };
  },
  'waiter_call.action': (p) => ({
    rpc: p?.action === 'resolve' ? 'resolve_waiter_call' : 'ack_waiter_call',
    entity: 'waiter_call',
    // Transition-idempotent (app.waiter_call_transition, 0032:648 "idempotent
    // double-tap" -> {duplicate:true}), so it needs no key -- audited in 0049.
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
      ...common(c),            // 0049: was p_device_id only -- a replay deducted stock twice
      ...wasteLocation(p),     // wave 5: the store, only when the payload names one
    }),
  }),

  // --- Item 9 / C3 (0120): the till's money corrections ------------------------
  'tab.cancel': (p, c) => ({
    rpc: 'cancel_tab',
    entity: 'tab',
    args: () => ({ p_tab_id: p?.tabId, p_reason_code: p?.reasonCode, ...common(c) }),
  }),
  'tab.settle_zero': (p, c) => ({
    rpc: 'settle_zero_tab',
    entity: 'tab',
    args: () => ({ p_tab_id: p?.tabId, p_reason_code: p?.reasonCode, ...common(c) }),
  }),
  'payment.refund': (p, c) => ({
    rpc: 'refund',
    entity: 'refund',
    args: () => ({
      p_payment_id: p?.paymentId,
      p_amount_iqd: p?.amountIqd,
      p_pin: p?.pin,
      p_reason_code: p?.reasonCode,
      p_items: refundItems(p),
      ...common(c),
    }),
  }),
  'order_item.void': (p, c) => ({
    rpc: 'void_after_send',
    entity: 'order_item',
    // State-idempotent (void_order_item_internal returns {duplicate:true} on a
    // voided line, 0039), so no p_idempotency_key -- like set_ticket_status.
    args: () => ({
      p_order_item_id: p?.orderItemId,
      p_pin: p?.pin,
      p_reason_code: p?.reasonCode,
      p_device_id: c.stationId,
    }),
  }),
};

/**
 * order payload items (camelCase, zod-validated at enqueue) -> the p_items
 * jsonb shape app.add_order_items reads: variant_id / qty / notes /
 * modifiers[{modifier_id, qty}].
 */
// Parity with the shared list (C4): a type added in one place and not the
// other fails this function at BOOT, which fails the deploy loudly instead of a
// 400 on the first real replay of the missing type.
{
  const here = Object.keys(MUTATION_RPCS).sort();
  const shared = [...mutationTypes.types].sort();
  if (JSON.stringify(here) !== JSON.stringify(shared)) {
    throw new Error(`replay MUTATION_RPCS drifted from _shared/mutation-types.json: ${JSON.stringify({ here, shared })}`);
  }
}

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

/** payment.refund items -> app.refund's p_items jsonb, or null for a money-only refund. */
function refundItems(p: any): unknown[] | null {
  const items = Array.isArray(p?.items) ? p.items : [];
  if (items.length === 0) return null;
  return items.map((it: any) => ({ order_item_id: it?.orderItemId, qty: it?.qty }));
}

/** stock.waste's store (wave 5 §2.8.6): p_location only when the payload names one. */
function wasteLocation(p: any): Record<string, unknown> {
  return p?.location ? { p_location: p.location } : {};
}

class BadRequest extends Error {}

interface ReplayBody {
  idempotency_key: string;
  mutation_type: string;
  payload: unknown;
  station_id: string;
  staff_id: string;
  /** The branch the write was queued under (0228); optional. */
  venue_scope?: string;
}

/** A failed bookkeeping read: the till gets a 500 (it retries), the log gets the text. */
function readFailed(what: string, error: unknown): Response {
  logError('replay', error, `${what} read failed`);
  return json({ error: 'INTERNAL' }, 500);
}

Deno.serve(handle('replay', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Typed as the contract; every field is still checked below.
  const read = await readJsonBody<ReplayBody>(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'invalid JSON body' }, 400),
  });
  if (!read.ok) return read.response;
  const { idempotency_key, mutation_type, payload, station_id, staff_id, venue_scope } = read.value;
  if (
    typeof idempotency_key !== 'string' || !idempotency_key ||
    typeof mutation_type !== 'string' ||
    typeof station_id !== 'string' || !station_id ||
    typeof staff_id !== 'string' || !staff_id
  ) {
    return json({ error: 'idempotency_key, mutation_type, payload, station_id, staff_id required' }, 400);
  }
  if (venue_scope !== undefined && venue_scope !== null && !isUuid(venue_scope)) {
    return json({ error: 'venue_scope must be a uuid' }, 400);
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
  if (staffCheck.error) return readFailed('staff', staffCheck.error);
  const activeIds = new Set((staffCheck.data ?? []).map((s) => s.id));
  if (!activeIds.has(callerId)) return json({ error: 'caller is not active staff' }, 403);
  if (!activeIds.has(staff_id)) return json({ error: 'staff_id is not active staff' }, 403);

  // Replay-level idempotency: same key => the stored result, 200, no re-apply.
  const dup = await service
    .from('sync_replays')
    .select('result, conflict_detail')
    .eq('idempotency_key', idempotency_key)
    .maybeSingle();
  if (dup.error) return readFailed('sync_replays', dup.error);
  if (dup.data) {
    return json({ result: 'duplicate', prior_result: dup.data.result, echo: redactSecrets(dup.data.conflict_detail) });
  }

  const routeFor = MUTATION_RPCS[mutation_type];
  if (!routeFor) return json({ error: `unknown mutation_type '${mutation_type}'` }, 400);

  // Offline tab reference: a tab opened while disconnected has no server id, so
  // the queued row names its tab.open envelope's idempotency key instead —
  // unique on `tabs`, and strictly BEFORE this row in the same queue, so by the
  // time this row replays the tab either exists or its open terminally failed
  // (in which case failing this row too is the correct cascade). Service client
  // is lookup-only; the RPC still enforces everything as the staff session.
  let effectivePayload = payload;
  const p = payload as { tabId?: unknown; tabIdemKey?: unknown } | null;
  if (p && typeof p === 'object' && typeof p.tabIdemKey === 'string' && p.tabId == null) {
    const tab = await service
      .from('tabs')
      .select('id')
      .eq('idempotency_key', p.tabIdemKey)
      .maybeSingle();
    if (tab.error) return readFailed('tabs', tab.error);
    if (!tab.data) {
      return json(
        { error: `no tab for tabIdemKey '${p.tabIdemKey}' — its tab.open never applied` },
        400,
      );
    }
    effectivePayload = { ...(payload as Record<string, unknown>), tabId: tab.data.id };
  }
  // Same idea for a KDS bump of an offline ticket: the order envelope's key →
  // orders.idempotency_key → tickets.order_id. Ordered strictly after the
  // order's own replay in the same queue.
  const pt = payload as { ticketId?: unknown; ticketIdemKey?: unknown } | null;
  if (pt && typeof pt === 'object' && typeof pt.ticketIdemKey === 'string' && pt.ticketId == null) {
    const order = await service
      .from('orders')
      .select('id, tickets(id)')
      .eq('idempotency_key', pt.ticketIdemKey)
      .maybeSingle();
    if (order.error) return readFailed('orders', order.error);
    const ticketId = (order.data?.tickets as { id: string }[] | null)?.[0]?.id;
    if (!ticketId) {
      return json(
        { error: `no ticket for ticketIdemKey '${pt.ticketIdemKey}' — its order never applied` },
        400,
      );
    }
    effectivePayload = { ...(effectivePayload as Record<string, unknown>), ticketId };
  }

  const ctx: Ctx = { idempotencyKey: idempotency_key, stationId: station_id, staffId: staff_id };
  let route: Route;
  try {
    route = routeFor(effectivePayload, ctx);
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: e.message }, 400);
    throw e;
  }

  // Dispatch AS THE STAFF SESSION so role guards + audit attribution hold.
  // 0215: the queued write's station names the branch on the replayed
  // request, exactly as the till did when it queued it; 0228: so does the
  // branch the screens showed then (a machine that is not a station). Both
  // count on the server only for the owner or a member of that branch.
  const asStaff = callerClient(req, {
    'x-station-id': station_id,
    ...(venue_scope ? { 'x-venue-scope': venue_scope } : {}),
  });
  // 0115 (S3): a queued PIN-gated mutation still carries the typed PIN. Prove
  // it to verify_manager_pin FIRST, as the staff session — its own statement, so
  // the attempt persists whatever the money RPC does next — and let the RPC
  // consume the grant that verification minted. A refusal here (PIN_INVALID,
  // PIN_LOCKED) is terminal for the row and is recorded below exactly like any
  // other RPC refusal; a transient error is retried like any other.
  let rpcResult: unknown = null;
  let rpcError: PgError | null = null;
  const queuedPin = (effectivePayload as { pin?: unknown } | null)?.pin;
  if (mutationTypes.pinGatedRpcs.includes(route.rpc) && typeof queuedPin === 'string') {
    const verified = await asStaff
      .schema('app')
      .rpc('verify_manager_pin', { p_pin: queuedPin, p_device_id: station_id });
    if (verified.error) rpcError = verified.error as PgError;
    // A wrong PIN RETURNS null (the attempt is already recorded); make it the
    // same terminal refusal the RPC used to raise.
    else if (verified.data === null) rpcError = { code: 'P0001', message: 'PIN_INVALID' };
  }
  if (!rpcError) {
    const dispatched = await asStaff
      .schema('app')
      .rpc(route.rpc, route.args(effectivePayload, ctx));
    rpcResult = dispatched.data;
    rpcError = (dispatched.error as PgError | null) ?? null;
  }

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
      if (prior.error) logError('replay', prior.error, `sync_replays re-read failed for ${idempotency_key}`);
      return prior.data ?? null;
    }
    // The write itself stands (the RPC's own key still guards a retry), but the
    // replay-level record is missing: loud, with the key.
    if (ins.error) logError('replay', ins.error, `sync_replays insert (${result}) failed for ${idempotency_key}`);
    return null;
  }

  if (rpcError) {
    const pgErr = rpcError as PgError;
    // Not judged: transient, not deployed, degraded, transport-ish 5xx. Record
    // NOTHING (see header) and answer its ≥ 500 status so the worker releases
    // the row to pending with backoff and sends it again.
    if (isUnjudgedReplayError(pgErr)) {
      const mapped = mapPgError(pgErr);
      if (mapped.code !== 'RETRY_LATER' && mapped.code !== 'DEGRADED_LOCKOUT') {
        logError('replay', pgErr, `${mutation_type} not judged (${mapped.status} ${mapped.code}); left for the till to retry`);
      }
      return json({ result: 'retry', ...publicMapped(mapped, pgErr) }, mapped.status);
    }
    if (isExclusionConflict(pgErr)) {
      const detail = {
        code: 'SLOT_TAKEN',
        message: pgErr.message,
        details: pgErr.details ?? null,
        mutation_type,
        payload: redactSecrets(payload),
      };
      const prior = await record('conflict', detail);
      if (prior) return json({ result: 'duplicate', prior_result: prior.result, echo: redactSecrets(prior.conflict_detail) });
      // Surface to the desk: shows a conflict rather than an overwrite (SoW).
      // 0220: filed at the station's branch (the service role resolves no venue).
      const { data: stationRow, error: stationErr } = await service.from('stations').select('venue_id').eq('id', station_id).maybeSingle();
      if (stationErr) logError('replay', stationErr, `station ${station_id} read failed; alert filed without a branch`);
      const stationVenue = (stationRow as { venue_id?: string } | null)?.venue_id;
      const alert = await service.from('manager_alerts').insert({
        ...(stationVenue ? { venue_id: stationVenue } : {}),
        kind: 'replay_conflict',
        payload: {
          idempotency_key,
          mutation_type,
          station_id,
          staff_id,
          detail: pgErr.details ?? pgErr.message,
        },
      });
      if (alert.error) logError('replay', alert.error, `manager_alerts insert failed for ${idempotency_key}`);
      // The detail only when our own RAISE set it; a raw 23P01 names key values.
      return json({ result: 'conflict', error: 'SLOT_TAKEN', detail: pgErr.code === 'P0001' ? (pgErr.details ?? null) : null }, 409);
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
      payload: redactSecrets(payload),
    };
    const priorErr = await record('conflict', errDetail);
    if (priorErr) {
      return json({ result: 'duplicate', prior_result: priorErr.result, echo: redactSecrets(priorErr.conflict_detail) });
    }
    if (pgErr.code !== 'P0001') logError('replay', pgErr, `${mutation_type} refused (${mapped.status} ${mapped.code})`);
    return json({ result: 'error', ...publicMapped(mapped, pgErr) }, mapped.status);
  }

  // RPCs are themselves idempotent and echo { duplicate: true } when the write
  // already existed (e.g. an online race): record the truthful outcome.
  const wasDuplicate = !!(rpcResult && typeof rpcResult === 'object' && (rpcResult as any).duplicate);
  const prior = await record(wasDuplicate ? 'duplicate' : 'applied', rpcResult);
  if (prior) return json({ result: 'duplicate', prior_result: prior.result, echo: redactSecrets(prior.conflict_detail) });

  return json({ result: wasDuplicate ? 'duplicate' : 'applied', echo: rpcResult });
}));

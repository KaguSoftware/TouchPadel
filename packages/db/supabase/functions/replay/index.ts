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
 *  - anything else (validation, forbidden, ...) -> mapped error, NOT recorded in
 *    sync_replays: the till marks the queue row failed and surfaces it.
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
// p_* arguments. Types whose Drop-2/3 RPCs have not landed yet are marked
// `expected:` — dispatching them returns 501 RPC_NOT_DEPLOYED until the
// migration ships, at which point only the arg mapper may need aligning.
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

  // --- expected: Drop-2/3 RPC names per design-data.md §5.1 inventory --------------
  // Align arg mappers when 0013+ land (verify names against the migrations).
  'tab.open': (p, c) => ({
    rpc: 'open_tab',
    entity: 'tab',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'order.create': (p, c) => ({
    rpc: 'till_add_items', // creates the order + items on a tab (till path)
    entity: 'order',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'order.add_items': (p, c) => ({
    rpc: 'till_add_items',
    entity: 'order',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'ticket.status': (p, c) => ({
    rpc: 'ticket_status',
    entity: 'ticket_status',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'payment.record': (p, c) => ({
    rpc: 'record_payment',
    entity: 'payment',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'tab.settle': (p, c) => ({
    rpc: 'settle_tab',
    entity: 'tab',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'adjustment.apply': (p, c) => ({
    rpc: p?.kind === 'price_override' ? 'override_price' : 'apply_discount',
    entity: 'adjustment',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
  'waiter_call.action': (p) => ({
    rpc: p?.action === 'resolve' ? 'resolve_waiter_call' : 'ack_waiter_call',
    entity: 'waiter_call',
    args: () => ({ p_call_id: p.callId }),
  }),
  'stock.waste': (p, c) => ({
    rpc: 'record_waste',
    entity: 'stock',
    args: () => ({ ...snake(p), ...common(c) }),
  }),
};

class BadRequest extends Error {}

/** Generic camelCase -> p_snake_case arg conversion for not-yet-typed payloads. */
function snake(p: unknown): Record<string, unknown> {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    out['p_' + k.replace(/([A-Z])/g, '_$1').toLowerCase()] = v;
  }
  return out;
}

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
    // Not a conflict: validation/authz/transport error. Not recorded — the till
    // marks the queue row failed and retries or surfaces it.
    const mapped = mapPgError(pgErr);
    return json({ result: 'error', ...mapped }, mapped.status);
  }

  // RPCs are themselves idempotent and echo { duplicate: true } when the write
  // already existed (e.g. an online race): record the truthful outcome.
  const wasDuplicate = !!(rpcResult && typeof rpcResult === 'object' && (rpcResult as any).duplicate);
  const prior = await record(wasDuplicate ? 'duplicate' : 'applied', rpcResult);
  if (prior) return json({ result: 'duplicate', prior_result: prior.result, echo: prior.conflict_detail });

  return json({ result: wasDuplicate ? 'duplicate' : 'applied', echo: rpcResult });
});

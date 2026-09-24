/**
 * The staff area's calls to the server. Every staff write is an `app.*` RPC on
 * the shared client, named in STAFF_RPCS below, so the phone's reach is one
 * readable list; the two edge functions go through `callStaffEdge`.
 *
 * NO STATION, TILL, DESK OR KITCHEN RPC. The database cannot tell a phone from
 * a station (0156 guards breaks, cover and the heartbeat with "any staff", and
 * the kitchen list admits a bar or kitchen phone), so the wall is on this side:
 * __tests__/noStationRpc.test.ts fails on any staff file that names one
 * (build-contracts-2026-09-23 §6.7).
 */
import type { QueryClient } from '@tanstack/react-query';
import type { StaffRequestArgs, StaffRequestKind } from '@touch/core';
import { supabase } from '../../lib/supabase';
import { StaffEdgeError, edgeErrorCode, type StaffEdgeFunction } from './edge';
import { staffKeys } from './keys';
import type { StaffStatusRead } from './status';

/**
 * Every RPC a staff page may call (§6.1). Several land in later migrations of
 * this work and are not in the generated `Database` type until their commit
 * regenerates it, which is why the call below is loosely typed on the name
 * and this list is what keeps it honest.
 */
export const STAFF_RPCS = [
  // status and venue
  'staff_venue_ids',
  // Today
  'my_protocol_work',
  'protocols_waiting_count',
  // requests (0072)
  'staff_requests_page',
  'submit_staff_request',
  'withdraw_staff_request',
  // checklists
  'my_checklists_today',
  'mark_checklist_item',
  // protocols
  'start_protocol',
  'protocol_runs_page',
  'protocol_run_detail',
  'protocol_step_detail',
  'submit_step',
  'withdraw_step',
  'tick_run_item',
  'decide_step',
  'skip_step',
  'stop_protocol',
  'withdraw_protocol',
  'cancel_schedule',
  'staff_ingredient_options',
  'price_promo_targets',
  'price_promo_numbers',
  'release_test_context',
  'release_cost',
  'release_readiness',
  'release_review',
  'tournament_context',
  'tournament_feasibility',
  'block_courts_for_event',
  'hiring_candidates',
  'save_hiring_candidate',
  'delete_hiring_candidate',
  // photos
  'staff_media_slot',
  // supplies
  'production_today',
  'production_log_today',
  'record_batch',
  'shopping_list',
  'add_shopping_item',
  'cancel_shopping_item',
  'my_purchases',
  'record_purchase',
  // marketing
  'suggest_campaign',
  'my_campaign_drafts',
  'add_marketing_note',
  'my_marketing_notes',
  'marketing_notes_for',
  // notes on new items
  'release_notes_for_me',
  'release_notes_for_item',
  'add_release_note',
] as const;

export type StaffRpcName = (typeof STAFF_RPCS)[number];

type LooseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;

/** Call one staff RPC; resolves to its result or throws the PostgREST error (its message is the code). */
export async function staffRpc<T>(
  fn: StaffRpcName,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await (supabase.schema('app').rpc as unknown as LooseRpc)(fn, args);
  if (error) throw error;
  return data as T;
}

/**
 * Call `protocol-action` or `staff-admin` as the signed-in staff member. A
 * refusal becomes a StaffEdgeError carrying the body's code (edge.ts maps it);
 * a request that never came back rethrows the fetch's own error, so the
 * transport classifier (lib/network.ts) reads it as a connection problem.
 */
export async function callStaffEdge<T>(
  name: StaffEdgeFunction,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as T;
  const failure = error as { name?: string; context?: unknown };
  if (failure.name === 'FunctionsHttpError') {
    const response = failure.context as
      { status?: unknown; json?: () => Promise<unknown> } | undefined;
    let payload: unknown = null;
    try {
      payload = await response?.json?.();
    } catch {
      // A body that is not JSON carries no code.
    }
    throw new StaffEdgeError(
      edgeErrorCode(payload),
      typeof response?.status === 'number' ? response.status : null,
    );
  }
  if (failure.name === 'FunctionsFetchError' && failure.context) throw failure.context;
  throw error;
}

// ── Status (StaffStatusProvider) ────────────────────────────────────────────

/**
 * The caller's own staff row (the 0004 own-row read) and, when it is active,
 * the venues it works at. One query, so the status never sees a row without
 * its venues. A guest's read comes back with no row and stops there.
 */
export async function fetchStaffStatusRead(uid: string): Promise<StaffStatusRead> {
  const { data: row, error } = await supabase
    .from('staff')
    .select('id, display_name, role, is_active')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  if (!row || row.is_active !== true) return { row: row ?? null, venueIds: [] };
  const venueIds = await staffRpc<string[] | null>('staff_venue_ids');
  return { row, venueIds: Array.isArray(venueIds) ? venueIds : [] };
}

/**
 * The own staff row right after a sign-in, read through the query cache under
 * the provider's own key, so StaffStatusProvider reuses the answer instead of
 * asking again. Throws when the read fails: the caller decides what an
 * unanswered read means (the social sign-in refuses to continue on one).
 */
export async function readOwnStaffRow(
  queryClient: QueryClient,
  uid: string,
): Promise<StaffStatusRead['row']> {
  const read = await queryClient.fetchQuery({
    queryKey: staffKeys.status(uid),
    queryFn: () => fetchStaffStatusRead(uid),
    staleTime: 0,
  });
  return read.row;
}

export interface StaffVenue {
  id: string;
  name_en: string;
  name_ar: string;
}

/** Names for the venue picker, in the order the ids came. */
export async function fetchStaffVenues(ids: readonly string[]): Promise<StaffVenue[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('venues')
    .select('id, name_en, name_ar')
    .in('id', [...ids]);
  if (error) throw error;
  const rows = (data ?? []) as StaffVenue[];
  return ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is StaffVenue => r !== undefined);
}

// ── Requests (0072; staff-request.tsx) ──────────────────────────────────────

export type StaffRequestStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

/** One row of `app.staff_requests_page`: the caller's own, or the venue's for management. */
export interface StaffRequestRow {
  id: string;
  kind: StaffRequestKind;
  status: StaffRequestStatus;
  from_date: string | null;
  to_date: string | null;
  amount_iqd: number | null;
  note: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  staff_id: string;
  staff_name: string;
  staff_role: string;
  decided_by_name: string | null;
}

export interface StaffRequestsPage {
  requests: StaffRequestRow[];
  total: number;
  pending: number;
}

export function fetchStaffRequests(): Promise<StaffRequestsPage> {
  return staffRpc<StaffRequestsPage>('staff_requests_page', { p_limit: 100 });
}

/**
 * `submit_staff_request` takes no idempotency key: a second pending request of
 * the same kind is refused (REQUEST_ALREADY_PENDING), which is what makes a
 * retried submit safe.
 */
export function submitStaffRequest(request: StaffRequestArgs): Promise<string> {
  return staffRpc<string>('submit_staff_request', {
    p_kind: request.kind,
    p_from: request.from,
    p_to: request.to,
    p_amount_iqd: request.amountIqd,
    p_note: request.note,
  });
}

export function withdrawStaffRequest(id: string): Promise<void> {
  return staffRpc<void>('withdraw_staff_request', { p_id: id });
}

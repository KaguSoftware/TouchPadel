/**
 * The open-match reads at the desk, the invalidation after each write, and
 * the per-dialog idempotency key (docs/design/open-matches/operator.md §5.1,
 * §5.4–§5.6). One QK.deskMatches family, so one root refreshes every read.
 *
 * Every read goes through `matchRead`: a server without the RPC yet
 * (RPC_MISSING, PGRST202) answers `null`, and a screen given `null` renders
 * no match UI at all, as if matches were off (§5.5). A network failure stays
 * an error, so the screen can say it needs a connection.
 *
 * Every match WRITE is a direct `appRpc('<name>', …)` at its call site, with
 * the literal RPC name (DF-11: no queued type, no wrapper; the assistant map
 * finds callers by that literal). What this module gives the writers is the
 * key (`useMatchIdemKey`) and the invalidation (`invalidateMatch*`).
 */
import { useCallback, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { AppRpcError, appRpc, isRpcMissing } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { QK, invalidateReservations } from '../../lib/queryKeys';
import { useBroadcast } from '../../lib/realtime';
import { useStationReach } from '../../lib/stationReach';
import { isMatchLiteral, matchReadStatus, type MatchCaps, type MatchReadStatus } from './matchLogic';
import {
  readGuestTickets,
  readMatchDetail,
  readMatchReports,
  readMatchSettings,
  readMatchStates,
  readOpenMatches,
  type GuestTickets,
  type MatchDetail,
  type MatchReport,
  type MatchSettings,
  type MatchState,
  type OpenMatches,
} from './matchPayloads';
import type { ReservationRow } from '../desk/deskTypes';

/** A read's answer, or null when this server has no such RPC yet (RPC_MISSING). */
async function matchRead<T>(call: () => Promise<unknown>, parse: (raw: unknown) => T): Promise<T | null> {
  try {
    return parse(await call());
  } catch (error) {
    if (isRpcMissing(error)) return null;
    throw error;
  }
}

/**
 * Retry a failure that carries no server code once (a network failure, which
 * PostgREST's client reports as UNKNOWN "TypeError: Failed to fetch"); never
 * a refusal the server raised (MATCH_NOT_FOUND, FORBIDDEN): asking again gets
 * the same answer.
 */
export function retryNetworkOnce(failureCount: number, error: Error): boolean {
  if (failureCount >= 1) return false;
  return !(error instanceof AppRpcError) || error.code === 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Reads (§5.4 table)
// ---------------------------------------------------------------------------

/**
 * app.desk_open_matches over a trading night (`useTradingNight` dayStart /
 * dayEnd, ≤ 3 days): the settings envelope and the night's filling,
 * awaiting and part-booked matches. 30 s, last data kept while it reloads.
 */
export function useOpenMatches(
  dayStart: Date | null | undefined,
  dayEnd: Date | null | undefined,
  enabled = true,
): UseQueryResult<OpenMatches | null> {
  const fromIso = dayStart?.toISOString() ?? '';
  const toIso = dayEnd?.toISOString() ?? '';
  return useQuery({
    queryKey: QK.deskMatches.open(fromIso, toIso),
    enabled: enabled && fromIso !== '' && toIso !== '',
    queryFn: () => matchRead(() => appRpc('desk_open_matches', { p_from: fromIso, p_to: toIso }), readOpenMatches),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    retry: retryNetworkOnce,
  });
}

/**
 * The reservation ids worth asking app.desk_match_states about: the rows that
 * read as a match booking. A night without one makes no call at all.
 */
export function matchBookingIds(rows: readonly Pick<ReservationRow, 'id' | 'guest_id' | 'guest_name'>[]): string[] {
  return rows.filter(isMatchLiteral).map((r) => r.id);
}

/**
 * app.desk_match_states for the board and the calendar, keyed by reservation
 * id (only match bookings come back). 60 s, no retry, last data kept (the
 * chips must not blink when the list changes); disabled with no ids.
 */
export function useMatchStates(reservationIds: readonly string[]): UseQueryResult<Record<string, MatchState> | null> {
  const ids = useMemo(() => [...reservationIds].sort(), [reservationIds]);
  return useQuery({
    queryKey: QK.deskMatches.states(ids),
    enabled: ids.length > 0,
    queryFn: () => matchRead(() => appRpc('desk_match_states', { p_reservation_ids: ids }), readMatchStates),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * app.desk_match_detail: the match screen and a match booking's Players
 * panel share this key, so a write on either refreshes both. 20 s, last data
 * kept. A match the server cannot show raises MATCH_NOT_FOUND (the screen's
 * "not at this branch"); a payload with no readable match is null too.
 */
export function useMatchDetail(matchId: string | null | undefined): UseQueryResult<MatchDetail | null> {
  return useQuery({
    queryKey: QK.deskMatches.one(matchId ?? ''),
    enabled: Boolean(matchId),
    queryFn: () => matchRead(() => appRpc('desk_match_detail', { p_match_id: matchId }), readMatchDetail),
    refetchInterval: 20_000,
    placeholderData: keepPreviousData,
    retry: retryNetworkOnce,
  });
}

/** app.guest_tickets for the record's Tickets panel: read on mount and on focus. */
export function useGuestTickets(customerId: string | null | undefined, enabled = true): UseQueryResult<GuestTickets | null> {
  return useQuery({
    queryKey: QK.deskMatches.tickets(customerId ?? ''),
    enabled: enabled && Boolean(customerId),
    queryFn: () => matchRead(() => appRpc('guest_tickets', { p_customer_id: customerId }), readGuestTickets),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: retryNetworkOnce,
  });
}

/** app.match_reports_open for the branch in scope (Ops, reviewMatchReports), oldest first. 60 s. */
export function useMatchReports(branchId: string | null, enabled = true): UseQueryResult<MatchReport[] | null> {
  return useQuery({
    queryKey: QK.deskMatches.reports(branchId),
    enabled,
    queryFn: () => matchRead(() => appRpc('match_reports_open', { p_venue_id: branchId }), readMatchReports),
    refetchInterval: 60_000,
    retry: retryNetworkOnce,
  });
}

/** app.match_settings for the branch in scope (Venue details). Read on mount. */
export function useMatchSettings(branchId: string | null, enabled = true): UseQueryResult<MatchSettings | null> {
  return useQuery({
    queryKey: QK.deskMatches.settings(branchId),
    enabled,
    queryFn: () => matchRead(() => appRpc('match_settings', { p_venue_id: branchId }), readMatchSettings),
    staleTime: 0,
    refetchOnMount: 'always',
    retry: retryNetworkOnce,
  });
}

/**
 * A match query read the §5.5 way (absent, loading, failed, or data that may
 * be stale), with the station's reach. Pair it with `MatchReadNotice`.
 */
export function useMatchRead<T>(q: UseQueryResult<T | null>): MatchReadStatus<T> {
  const { reachable } = useStationReach();
  return matchReadStatus(q, reachable);
}

/**
 * The match screen's live refresh (§5.4): no new topic. `slot_changed` on
 * 'courts' fires when a match books and when a booking bumps one; joins and
 * requests write no reservation, so the polls carry them.
 */
export function useMatchesLive(enabled = true): void {
  useBroadcast({ topic: 'courts', isPrivate: true, events: ['slot_changed'], enabled, invalidateKeys: [QK.deskMatches.all] });
}

// ---------------------------------------------------------------------------
// Capabilities (lib/auth.tsx CAPABILITY_ROLES, §5.3)
// ---------------------------------------------------------------------------

export interface AllMatchCaps extends MatchCaps {
  cashOutTickets: boolean;
  banFromMatches: boolean;
  reviewMatchReports: boolean;
}

/** The signed-in role's open-match capabilities. Never compare roles inline. */
export function useMatchCaps(): AllMatchCaps {
  const role = useAuth().staff?.role;
  return useMemo(
    () => ({
      runMatches: can(role, 'runMatches'),
      takeSeatPayment: can(role, 'takeSeatPayment'),
      writeOffSeat: can(role, 'writeOffSeat'),
      cashOutTickets: can(role, 'cashOutTickets'),
      banFromMatches: can(role, 'banFromMatches'),
      reviewMatchReports: can(role, 'reviewMatchReports'),
    }),
    [role],
  );
}

// ---------------------------------------------------------------------------
// Writes: the key and the refresh (§5.1, §5.4)
// ---------------------------------------------------------------------------

/** `match.<action>:<uuid>`: the house idempotency-key form of a direct RPC (CourtBlock.tsx). */
export function mintMatchKey(action: string): string {
  return `match.${action}:${crypto.randomUUID()}`;
}

/**
 * One idempotency key per dialog: minted when the dialog mounts, sent again on
 * a retry (a double tap or a lost answer replays, never doubles), replaced
 * after a success so the next write is a new one (the CourtBlock.tsx
 * precedent). `match_seat_settle` and `match_link_payment` always need one;
 * so do `desk_start_match` and `desk_add_seat`.
 */
export function useMatchIdemKey(action: string): { key: () => string; renew: () => void } {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = mintMatchKey(action);
  const key = useCallback(() => ref.current as string, []);
  const renew = useCallback(() => {
    ref.current = mintMatchKey(action);
  }, [action]);
  return useMemo(() => ({ key, renew }), [key, renew]);
}

type Qc = Pick<QueryClient, 'invalidateQueries'>;

function refresh(qc: Qc, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey: [...queryKey] });
}

/** After start, add, remove, cancel, a mark or call-off: the match, its booking and its bill. */
export function invalidateMatchSeats(qc: QueryClient): void {
  refresh(qc, [QK.deskMatches.all, QK.reservation.all, QK.bookingBill.all, QK.bookingBillStates.all]);
  invalidateReservations(qc);
}

/** After a seat settle, a payment link or a write-off: the match, the bill and the day's takings. */
export function invalidateMatchMoney(qc: Qc): void {
  refresh(qc, [QK.deskMatches.all, QK.bookingBill.all, QK.bookingBillStates.all, QK.day]);
}

/** After a ban or a gender change: the match reads and the customer's record. */
export function invalidateMatchCustomer(qc: Qc, customerId: string): void {
  refresh(qc, [QK.deskMatches.all, ['customer', customerId]]);
}

/** After a cash-out: the customer's tickets and record, and Ops' online refunds. */
export function invalidateTicketCashOut(qc: Qc, customerId: string): void {
  refresh(qc, [QK.deskMatches.tickets(customerId), ['customer', customerId], ['depositAttention']]);
}

/** After a report decision: the queue and the reported player's record. */
export function invalidateMatchReport(qc: Qc, branchId: string | null, reportedCustomerId: string | null): void {
  refresh(qc, [QK.deskMatches.reports(branchId), ...(reportedCustomerId ? [['customer', reportedCustomerId]] : [])]);
}

/** After a settings save: every match read (desk_open_matches carries the settings). */
export function invalidateMatchSettings(qc: Qc): void {
  refresh(qc, [QK.deskMatches.all]);
}

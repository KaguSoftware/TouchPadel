/**
 * The tournament reads on the operator, the refresh after each write, the
 * per-dialog idempotency key and the capabilities (docs/design/tournaments/
 * build-contracts-2026-10-03.md §1.6, §1.11). The coaching module's shape
 * (features/coaching/useCoaching.ts): one QK.tournaments family, never
 * persisted, never wrapped in cachedQuery (the detail carries names and
 * phones).
 *
 * Every read goes through `tourRead`: a server without the RPC yet
 * (RPC_MISSING, PGRST202) answers `null`, and a surface given `null` shows no
 * tournament UI. A network failure stays an error.
 *
 * Every tournament WRITE is a direct `appRpc('<name>', …)` at its call site,
 * with the literal RPC name (online only, no queued type; the assistant map
 * finds callers by that literal, and a type argument hides them).
 */
import { useCallback, useMemo, useRef } from 'react';
import {
  keepPreviousData,
  useQuery,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { appRpc, isRpcMissing } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { QK, invalidateReservations } from '../../lib/queryKeys';
import { useBroadcast } from '../../lib/realtime';
import { supabase } from '../../lib/supabase';
import { currentBranchId } from '../../lib/venueScope';
import {
  readDeskTournaments,
  readTournamentDetail,
  type DeskTournaments,
  type TournamentDetail,
} from './tournamentPayloads';

/** A read's answer, or null when this server has no such RPC yet (RPC_MISSING). */
export async function tourRead<T>(
  call: () => Promise<unknown>,
  parse: (raw: unknown) => T,
): Promise<T | null> {
  try {
    return parse(await call());
  } catch (error) {
    if (isRpcMissing(error)) return null;
    throw error;
  }
}

/**
 * app.desk_tournaments over `[from, to)`: the switch, server_now and the
 * branch's tournaments with their adopted blocks (the calendar overlay and the
 * list). 30 s, last data kept while it reloads.
 */
export function useDeskTournaments(
  from: Date | null | undefined,
  to: Date | null | undefined,
  enabled = true,
): UseQueryResult<DeskTournaments | null> {
  const fromIso = from?.toISOString() ?? '';
  const toIso = to?.toISOString() ?? '';
  return useQuery({
    queryKey: QK.tournaments.desk(fromIso, toIso),
    enabled: enabled && fromIso !== '' && toIso !== '',
    queryFn: () =>
      tourRead(
        () =>
          appRpc('desk_tournaments', {
            p_venue_id: currentBranchId(),
            p_from: fromIso,
            p_to: toIso,
          }),
        readDeskTournaments,
      ),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

/** app.desk_tournament_detail: one tournament's screen. 15 s while in play, last data kept. */
export function useTournamentDetail(
  tournamentId: string | null | undefined,
): UseQueryResult<TournamentDetail | null> {
  return useQuery({
    queryKey: QK.tournaments.one(tournamentId ?? ''),
    enabled: Boolean(tournamentId),
    queryFn: () =>
      tourRead(
        () => appRpc('desk_tournament_detail', { p_tournament_id: tournamentId }),
        readTournamentDetail,
      ),
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * The branch's switch (`venue_settings.tournaments_enabled`, granted by
 * column since the schema file). Null on a server without the column, which
 * hides the settings panel.
 */
export function useTournamentsSwitch(branchId: string | null): UseQueryResult<boolean | null> {
  return useQuery({
    queryKey: QK.tournaments.settings(branchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_settings')
        .select('tournaments_enabled')
        .single();
      if (error) {
        // 42703: no such column (a server before the tournaments migrations).
        if (error.code === '42703' || error.code === 'PGRST204') return null;
        throw error;
      }
      return (data as { tournaments_enabled?: boolean } | null)?.tournaments_enabled === true;
    },
  });
}

/** A court write elsewhere (a booking, a block) moves the adopted blocks: refresh on the 'courts' broadcast. */
export function useTournamentsLive(enabled = true): void {
  useBroadcast({
    topic: 'courts',
    isPrivate: true,
    events: ['slot_changed'],
    enabled,
    invalidateKeys: [QK.tournaments.all],
  });
}

// ── capabilities ─────────────────────────────────────────────────────────────

export interface TournamentCaps {
  runTournaments: boolean;
  publishTournaments: boolean;
  takeTournamentPayment: boolean;
  /** Reused: the owner's switch in Venue details (the coaching panel's gate). */
  editVenueDetails: boolean;
}

export function tournamentCapsFor(role: Parameters<typeof can>[0]): TournamentCaps {
  return {
    runTournaments: can(role, 'runTournaments'),
    publishTournaments: can(role, 'publishTournaments'),
    takeTournamentPayment: can(role, 'takeTournamentPayment'),
    editVenueDetails: can(role, 'editVenueDetails'),
  };
}

export function useTournamentCaps(): TournamentCaps {
  const role = useAuth().staff?.role;
  return useMemo(() => tournamentCapsFor(role), [role]);
}

// ── writes: the key and the refresh ──────────────────────────────────────────

/** `tournament.<action>:<uuid>`: the house idempotency-key form of a direct RPC (CourtBlock.tsx). */
export function mintTournamentKey(action: string): string {
  return `tournament.${action}:${crypto.randomUUID()}`;
}

/**
 * One idempotency key per dialog: minted on mount, sent again on a retry (a
 * double tap or a lost answer replays, never doubles), renewed after a success.
 * `tournament_publish`, `tournament_set_rounds` and `tournament_settle` send one.
 */
export function useTournamentIdemKey(action: string): { key: () => string; renew: () => void } {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = mintTournamentKey(action);
  const key = useCallback(() => ref.current as string, []);
  const renew = useCallback(() => {
    ref.current = mintTournamentKey(action);
  }, [action]);
  return useMemo(() => ({ key, renew }), [key, renew]);
}

type Qc = Pick<QueryClient, 'invalidateQueries'>;

function refresh(qc: Qc, keys: readonly (readonly unknown[])[]): void {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey: [...queryKey] });
}

/** After an entry, rounds, score or no-show write: the tournament reads (the list counts too). */
export function invalidateTournament(qc: Qc): void {
  refresh(qc, [QK.tournaments.all]);
}

/** After publish, cancel or a finish: the blocks changed hands, so the reservation lists too. */
export function invalidateTournamentCourts(qc: QueryClient): void {
  refresh(qc, [QK.tournaments.all, QK.reservation.all, QK.deskMatches.all]);
  invalidateReservations(qc);
}

/** After tournament_settle: the tournament, the day's takings and the day close's online card. */
export function invalidateTournamentMoney(qc: Qc): void {
  refresh(qc, [QK.tournaments.all, QK.day, ['dayCloseOnline']]);
}

/**
 * The guest's tournament React bindings (plan §5.2): the two public reads as queries, register
 * and withdraw as mutations, all under `tournamentKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by the key prefixes:
 * nothing under `['tournament']` is written to disk, and both writes run now or fail now. A screen
 * never overrides them.
 *
 * After a write the phone refetches what shows tournaments (the list with Mine, the detail): one
 * invalidation of the `['tournament']` root does both.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  fetchTournamentPublic,
  fetchTournamentsPublic,
  registerTournament,
  withdrawTournament,
} from './api';
import { tournamentKeys } from './keys';
import { isLive } from './logic';
import { tournamentsShipped } from './shipped';

export { tournamentKeys };

/** Refresh every tournament read after a write or a push. */
export function useInvalidateTournaments(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: tournamentKeys.all });
  }, [queryClient]);
}

/** Every live branch's tournaments (`tournaments_public(null)`), with the guest's own entries. */
export function useTournamentsPublic(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tournamentKeys.list,
    queryFn: () => fetchTournamentsPublic(supabase),
    staleTime: 30_000,
    // My reservations reads it only while some branch has tournaments on (the lessons' rule).
    // Not in this build (shipped.ts): never read, and every screen treats it as off.
    enabled: (opts.enabled ?? true) && tournamentsShipped(),
  });
}

/**
 * One tournament. While play is under way and the screen is focused (`poll`), it is read again
 * every 30 s so the schedule and the standings follow the desk's scores (plan §5.2).
 */
export function useTournamentPublic(id: string | null, opts: { poll?: boolean } = {}) {
  const poll = opts.poll ?? false;
  return useQuery({
    queryKey: tournamentKeys.one(id ?? ''),
    queryFn: () => fetchTournamentPublic(supabase, id!),
    enabled: !!id,
    staleTime: 15_000,
    refetchInterval: (query) => (poll && isLive(query.state.data) ? 30_000 : false),
  });
}

/** Register, or join the waitlist when no place is left (the server decides which). */
export function useRegisterTournament() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationKey: tournamentKeys.mutation('register'),
    mutationFn: ({ tournamentId, seatNo }: { tournamentId: string; seatNo: number | null }) =>
      registerTournament(supabase, tournamentId, seatNo),
    onSettled: () => invalidate(),
  });
}

/** Withdraw, or leave the waitlist: free while open and before the cut-off. */
export function useWithdrawTournament() {
  const invalidate = useInvalidateTournaments();
  return useMutation({
    mutationKey: tournamentKeys.mutation('withdraw'),
    mutationFn: (tournamentId: string) => withdrawTournament(supabase, tournamentId),
    onSettled: () => invalidate(),
  });
}


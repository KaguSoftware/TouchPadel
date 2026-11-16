/**
 * The leaderboard's React bindings: the board and the guest's own page as queries, the report
 * and the answer as mutations, all under `ranksKeys`. Retry, online-pause and persistence are set
 * once in lib/queryClient.ts by the key prefix: nothing here reaches the disk cache, and both
 * writes run now or fail now.
 *
 * After a write the board and the guest's page are read again: one invalidation of `['ranks']`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  answerResult,
  coachRecordGame,
  fetchBoard,
  fetchMyRanks,
  findPlayer,
  reportGame,
  setMyPlayLevel,
  type ReportInput,
} from './api';
import { profileKeys } from '../profile/hooks';
import { ranksKeys } from './keys';
import { normaliseUsername, type CoachRecordInput, type TypeCode } from './logic';

export { ranksKeys };

/** The public board: read signed in or out. */
export function useRanksBoard(enabled = true) {
  return useQuery({
    queryKey: ranksKeys.board,
    queryFn: () => fetchBoard(supabase),
    enabled,
    staleTime: 30_000,
  });
}

/** The guest's own points, place, level, results and bookings to report. Signed in only. */
export function useMyRanks(enabled: boolean) {
  return useQuery({
    queryKey: ranksKeys.mine,
    queryFn: () => fetchMyRanks(supabase),
    enabled,
    staleTime: 30_000,
  });
}

/** A username looked up as the guest types it, once it is long enough to be one (3+). */
export function useFindPlayer(username: string) {
  const name = normaliseUsername(username);
  return useQuery({
    queryKey: ranksKeys.player(name),
    queryFn: () => findPlayer(supabase, name),
    enabled: name.length >= 3,
    staleTime: 60_000,
  });
}

export function useReportGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ranksKeys.mutation('report'),
    mutationFn: (input: ReportInput) => reportGame(supabase, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ranksKeys.all }),
  });
}

export function useAnswerResult() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ranksKeys.mutation('confirm'),
    mutationFn: (v: { resultId: string; accept: boolean }) => answerResult(supabase, v.resultId, v.accept),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ranksKeys.all }),
  });
}

/** The player picks their own type (0444); their page, and the profile that stores it, re-read. */
export function useSetMyType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ranksKeys.mutation('my-type'),
    mutationFn: (level: TypeCode) => setMyPlayLevel(supabase, level),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
      return queryClient.invalidateQueries({ queryKey: ranksKeys.all });
    },
  });
}

/** A coach enters a game they watched (0444), confirmed at once. */
export function useCoachRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ranksKeys.mutation('coach-record'),
    mutationFn: (input: CoachRecordInput) => coachRecordGame(supabase, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ranksKeys.all }),
  });
}

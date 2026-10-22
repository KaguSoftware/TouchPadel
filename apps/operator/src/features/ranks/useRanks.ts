/**
 * Player ranks reads and writes (0364). Every write is an online-only app.* RPC through appRpc
 * (the migration adds no queued mutation type), so the six-place parity lists stay untouched.
 * Keys are this feature's own; a write re-reads all three.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import {
  filterStatus,
  type DeskResult,
  type RanksAdmin,
  type RanksBoard,
  type RanksLevel,
  type RanksSettings,
  type ResultsFilter,
} from './ranksLogic';

export const RANKS_KEYS = {
  all: ['ranks'] as const,
  admin: ['ranks', 'admin'] as const,
  board: ['ranks', 'board'] as const,
  results: (filter: ResultsFilter) => ['ranks', 'results', filter] as const,
};

/** How many results the list reads (the server clamps 1-200). */
export const RESULTS_LIMIT = 50;

export function useRanksAdmin(enabled = true) {
  return useQuery({
    queryKey: RANKS_KEYS.admin,
    enabled,
    queryFn: () => appRpc<RanksAdmin>('ranks_admin'),
  });
}

/** The public board as players see it: the preview, and whether ranks are on at all. */
export function useRanksBoard(enabled = true) {
  return useQuery({
    queryKey: RANKS_KEYS.board,
    enabled,
    queryFn: () => appRpc<RanksBoard>('ranks_board'),
    staleTime: 30_000,
  });
}

export function useRanksResults(filter: ResultsFilter, enabled = true) {
  return useQuery({
    queryKey: RANKS_KEYS.results(filter),
    enabled,
    queryFn: () =>
      appRpc<DeskResult[]>('ranks_desk_results', {
        p_status: filterStatus(filter),
        p_limit: RESULTS_LIMIT,
      }),
  });
}

export function invalidateRanks(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: RANKS_KEYS.all });
}

export function saveRanksSettings(patch: Partial<RanksSettings>): Promise<RanksSettings> {
  return appRpc<RanksSettings>('set_ranks_settings', { p_patch: patch });
}

export function saveRanksLevels(levels: RanksLevel[]): Promise<RanksLevel[]> {
  return appRpc<RanksLevel[]>('set_ranks_levels', { p_levels: levels });
}

export function adjustRanks(profileId: string, delta: number, note: string): Promise<{ id: string }> {
  return appRpc<{ id: string }>('ranks_adjust', {
    p_profile_id: profileId,
    p_delta: delta,
    p_note: note.trim(),
  });
}

export function recordResult(args: Record<string, string | null>): Promise<{ id: string; status: string }> {
  return appRpc<{ id: string; status: string }>('ranks_desk_record', args);
}

export function voidResult(resultId: string, reason: string): Promise<{ id: string; status: string }> {
  return appRpc<{ id: string; status: string }>('ranks_void', {
    p_result_id: resultId,
    p_reason: reason.trim(),
  });
}

/**
 * Player ranks reads and writes (0364; 0444 adds the rules, the Level checks list and the
 * results to check). Every write is an online-only app.* RPC through appRpc
 * (the migration adds no queued mutation type), so the six-place parity lists stay untouched.
 * Keys are this feature's own; a write re-reads all three.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import {
  filterStatus,
  type DeskResult,
  type LevelCheck,
  type RanksAdmin,
  type ResultPair,
  type RuleKey,
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
  levelChecks: ['ranks', 'level-checks'] as const,
  toCheck: ['ranks', 'to-check'] as const,
};

/** How many Level checks the list reads (the server clamps 1-300). */
export const LEVEL_CHECKS_LIMIT = 100;
/** How far back "Results to check" looks (the server clamps 7-365). */
export const TO_CHECK_DAYS = 60;

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

/** Every Level check, newest first (manager, owner). */
export function useLevelChecks(enabled = true) {
  return useQuery({
    queryKey: RANKS_KEYS.levelChecks,
    enabled,
    queryFn: () => appRpc<LevelCheck[]>('ranks_level_checks_list', { p_limit: LEVEL_CHECKS_LIMIT }),
  });
}

/** The same two pairs with the winner flipped within 7 days (court desk, manager, owner). */
export function useResultsToCheck(enabled = true) {
  return useQuery({
    queryKey: RANKS_KEYS.toCheck,
    enabled,
    queryFn: () => appRpc<ResultPair[]>('ranks_results_to_check', { p_days: TO_CHECK_DAYS }),
  });
}

export function invalidateRanks(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: RANKS_KEYS.all });
}

export function saveRanksSettings(patch: Partial<RanksSettings>): Promise<RanksSettings> {
  return appRpc<RanksSettings>('set_ranks_settings', { p_patch: patch });
}

/**
 * Replaces the owner's rule changes (only what differs from the default is kept; a rule left
 * out is its default) and replays every level, which can take a moment: no deadline of 15 s.
 */
export function saveRanksRules(overrides: Partial<Record<RuleKey, unknown>>): Promise<RanksAdmin> {
  return appRpc<RanksAdmin>('set_ranks_rules', { p_rules: overrides }, { timeoutMs: 60_000 });
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

/** A player's report confirmed by the desk, as an opponent would (ranks_staff_confirm). */
export function staffConfirmResult(resultId: string): Promise<{ id: string; status: string }> {
  return appRpc<{ id: string; status: string }>('ranks_staff_confirm', { p_result_id: resultId });
}

/** A corrected result: the old row voided, a confirmed desk result in its place (ranks_edit_result). */
export function editResult(args: Record<string, string | null>): Promise<{ id: string; status: string; replaces: string }> {
  return appRpc<{ id: string; status: string; replaces: string }>('ranks_edit_result', args);
}

/**
 * The figures the tournament screens' layout shows (the cards list and the
 * detail banner, 2026-10-05 redesign): which round is being played, how far it
 * is scored, the money on the entries, and the list's filter and counts. PURE.
 */
import type { TourStatus } from '@touch/core/tournaments';
import { isCorrection, roundComplete } from './roundsLogic';
import type { DeskTournament, TourDetailRound, TourEntry } from './tournamentPayloads';

export type RoundState = 'done' | 'now' | 'drawn';

/** The first round with a match still to score, or null when every round is scored. */
export function currentRoundNo(rounds: readonly TourDetailRound[]): number | null {
  const open = rounds.find((r) => !roundComplete(r));
  return open ? open.round_no : null;
}

/** A round before the current one is done; the current one is now; after it, drawn. */
export function roundState(round: TourDetailRound, current: number | null): RoundState {
  if (current === null || round.round_no < current) return 'done';
  return round.round_no === current ? 'now' : 'drawn';
}

/** How many of a round's matches carry a score. */
export function scoredCount(round: TourDetailRound): number {
  return round.matches.filter(isCorrection).length;
}

export interface EntryMoney {
  /** Registered players who owe nothing. */
  paid: number;
  /** Registered players who still owe their fee. */
  owing: number;
  /** Net taken across every entry. */
  collected: number;
  /** Still owed by the registered players. */
  due: number;
}

export function entryMoney(entries: readonly TourEntry[]): EntryMoney {
  const registered = entries.filter((e) => e.status === 'registered');
  return {
    paid: registered.filter((e) => e.owed_iqd === 0).length,
    owing: registered.filter((e) => e.owed_iqd > 0).length,
    collected: entries.reduce((sum, e) => sum + e.net_paid_iqd, 0),
    due: registered.reduce((sum, e) => sum + e.owed_iqd, 0),
  };
}

export type ListFilter = 'all' | TourStatus;

export function filterTournaments(
  list: readonly DeskTournament[],
  filter: ListFilter,
): DeskTournament[] {
  return filter === 'all' ? [...list] : list.filter((t) => t.status === filter);
}

/** One count per status, for the filter chips (a status with none still reads 0). */
export function statusCounts(list: readonly DeskTournament[]): Record<TourStatus, number> {
  const out: Record<TourStatus, number> = {
    open: 0,
    closed: 0,
    running: 0,
    finished: 0,
    cancelled: 0,
  };
  for (const t of list) out[t.status] += 1;
  return out;
}

export interface ListTotals {
  /** Not started yet: registration open or closed. */
  upcoming: number;
  running: number;
  /** Registered players across the tournaments not cancelled. */
  players: number;
  waitlisted: number;
}

export function listTotals(list: readonly DeskTournament[]): ListTotals {
  const live = list.filter((t) => t.status !== 'cancelled');
  return {
    upcoming: list.filter((t) => t.status === 'open' || t.status === 'closed').length,
    running: list.filter((t) => t.status === 'running').length,
    players: live.reduce((sum, t) => sum + t.registered, 0),
    waitlisted: live.reduce((sum, t) => sum + t.waitlisted, 0),
  };
}

/** How full a tournament is, 0–100, for its bar. */
export function fillPercent(registered: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((registered / max) * 100)));
}

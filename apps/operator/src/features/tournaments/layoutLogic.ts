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

/**
 * What the detail banner says about play. Finished (or cancelled) comes from
 * the tournament's status, never from the scores: every drawn round scored is
 * also how a running Mexicano looks between rounds (the next round is drawn
 * only once the last is scored), and after a correction trims later rounds.
 */
export type PlayLabel =
  | { kind: 'round'; round: number; total: number }
  | { kind: 'nextToDraw'; round: number; total: number }
  | { kind: 'allScored'; total: number }
  | { kind: 'ended'; status: 'finished' | 'cancelled' };

export interface PlayProgress {
  /** The round being scored; null between rounds or once play has ended. */
  current: number | null;
  /** Rounds in the plan (the drawn ones when the plan names fewer or none). */
  total: number;
  /** Rounds fully scored. */
  doneRounds: number;
  /** 0–100 through the plan; 100 once finished. */
  percent: number;
  label: PlayLabel;
}

export function playProgress(
  status: TourStatus,
  rounds: readonly TourDetailRound[],
  roundsPlanned: number | null,
): PlayProgress {
  const open = currentRoundNo(rounds);
  const total = Math.max(roundsPlanned ?? 0, rounds.length);
  const openRound = open !== null ? rounds.find((r) => r.round_no === open) : undefined;
  const doneRounds = rounds.filter((r) => open === null || r.round_no < open).length;
  const partial =
    openRound && openRound.matches.length > 0
      ? scoredCount(openRound) / openRound.matches.length
      : 0;
  const ended = status === 'finished' || status === 'cancelled';
  const percent =
    status === 'finished'
      ? 100
      : total > 0
        ? Math.min(100, Math.round(((doneRounds + partial) / total) * 100))
        : 0;
  let label: PlayLabel;
  if (ended) label = { kind: 'ended', status };
  else if (open !== null) label = { kind: 'round', round: open, total };
  else if (doneRounds < total) label = { kind: 'nextToDraw', round: doneRounds, total };
  else label = { kind: 'allScored', total };
  return { current: ended ? null : open, total, doneRounds, percent, label };
}

export interface EntryMoney {
  /** Registered players who owe nothing (none on a cancelled tournament: nobody pays it). */
  paid: number;
  /** Registered players who still owe their fee. */
  owing: number;
  /** Net taken and kept: every entry's net less what is due back to it. */
  collected: number;
  /** Still owed by the registered players. */
  due: number;
  /** Due back: a withdrawn entry's net, or every net on a cancelled tournament. */
  refundDue: number;
}

/**
 * The money on a tournament's entries. The server sets `owed_iqd` to 0 for
 * everyone on a cancelled tournament and carries the money to hand back in
 * `refund_due_iqd` (0299 `tournament_entry_money`), so a cancelled tournament
 * counts nobody as paid and keeps none of it as collected.
 */
export function entryMoney(entries: readonly TourEntry[], status: TourStatus): EntryMoney {
  const registered = entries.filter((e) => e.status === 'registered');
  const cancelled = status === 'cancelled';
  const net = entries.reduce((sum, e) => sum + e.net_paid_iqd, 0);
  const refundDue = entries.reduce((sum, e) => sum + e.refund_due_iqd, 0);
  return {
    paid: cancelled ? 0 : registered.filter((e) => e.owed_iqd === 0).length,
    owing: cancelled ? 0 : registered.filter((e) => e.owed_iqd > 0).length,
    collected: Math.max(0, net - refundDue),
    due: cancelled ? 0 : registered.reduce((sum, e) => sum + e.owed_iqd, 0),
    refundDue,
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

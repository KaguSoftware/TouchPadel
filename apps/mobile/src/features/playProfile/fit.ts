/**
 * Is a tournament for this guest? (0339, owner 2026-10-13) PURE, and the twin of
 * `app.tournament_register`'s check, which refuses what this calls a mismatch:
 *
 *   level  must fit one of its classes (0359; advanced A, intermediate B, beginner or new C)
 *   years  when the tournament names a bracket, the guest's answer is that bracket
 *          exactly (`never` counts as `under_one`); no bracket asks nothing
 *
 *   fits       every question the tournament asks is answered and matches
 *   mismatch   an answer is another one: the Join tab hides it, its page says why
 *   unanswered a question it asks has no answer: it stays listed, with a nudge, and
 *              registering asks for the answer first (TOURNAMENT_PROFILE_REQUIRED)
 *
 * A tournament from a server before 0339 (no class) asks nothing: it fits.
 * One from a server before 0359 names a single class: a list of one.
 */
import type { TourClass, TourYears } from '../tournaments/logic';
import type { PlayLevel, PlayYears } from './logic';

export type TournamentFit = 'fits' | 'mismatch' | 'unanswered';

/** The class a player's level plays in. */
export function classOfLevel(level: PlayLevel): TourClass {
  if (level === 'advanced') return 'A';
  if (level === 'intermediate') return 'B';
  return 'C';
}

/** The bracket a player's years answer falls in: "Not yet" is under a year. */
export function bracketOfYears(years: PlayYears): TourYears {
  return years === 'never' ? 'under_one' : years;
}

export interface FitAnswers {
  level: PlayLevel | null;
  years: PlayYears | null;
}

/** Which way the check goes, and on which question (the first that decides it). */
export interface FitResult {
  fit: TournamentFit;
  /** The question that made it a mismatch or left it unanswered; null when it fits. */
  on: 'level' | 'years' | null;
}

export function tournamentFit(
  t: { tourClasses: readonly TourClass[]; playYears: TourYears | null },
  a: FitAnswers | null,
): FitResult {
  if (t.tourClasses.length > 0) {
    if (!a?.level) return { fit: 'unanswered', on: 'level' };
    if (!t.tourClasses.includes(classOfLevel(a.level))) return { fit: 'mismatch', on: 'level' };
  }
  if (t.playYears !== null) {
    if (!a?.years) return { fit: 'unanswered', on: 'years' };
    if (bracketOfYears(a.years) !== t.playYears) return { fit: 'mismatch', on: 'years' };
  }
  return { fit: 'fits', on: null };
}

/**
 * Should the Join tab list it? Every tournament the guest has entered (an entry is never
 * undone by a later answer), and every one that is not a mismatch.
 */
export function showsTournament(
  t: { tourClasses: readonly TourClass[]; playYears: TourYears | null; mine: unknown },
  a: FitAnswers | null,
): boolean {
  return t.mine != null || tournamentFit(t, a).fit !== 'mismatch';
}

/**
 * Which tournament suggestions have something behind them (suggest.ts `available`): an
 * Americano or a Mexicano still taking entries that the guest is not a mismatch for. A
 * format with none sinks below everything and leaves the strip, so it never offers a night
 * the guest could not join.
 */
export function tournamentAvailability(
  rows: readonly {
    format: string | null;
    status: string | null;
    tourClasses: readonly TourClass[];
    playYears: TourYears | null;
    mine: unknown;
  }[],
  a: FitAnswers | null,
): { americano: boolean; mexicano: boolean } {
  const open = rows.filter((r) => r.status === 'open' && tournamentFit(r, a).fit !== 'mismatch');
  return {
    americano: open.some((r) => r.format === 'americano'),
    mexicano: open.some((r) => r.format === 'mexicano'),
  };
}

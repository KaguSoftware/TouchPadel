/**
 * The Rounds tab's logic (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.9, §1.10; plan §5.1 "Rounds"). PURE: the board renders these and calls
 * `tournament_set_rounds` / `tournament_score`.
 *
 * - What the board offers next (`boardAction`): Start (closed, nothing drawn),
 *   Next round (Mexicano, the last round scored), Regenerate from round k
 *   (rounds missing after a no-show or a Mexicano correction removed them), or
 *   nothing.
 * - The payload of each, drawn by the core engine (TD-7) and checked with the
 *   server's own rules (`validateRoundsPayload`) before it is sent, so a
 *   refusal the desk could have seen never leaves the screen.
 * - The score cell: one side typed, the other `target − a` (TD-9).
 */
import {
  TOUR_ENGINE,
  TOUR_LIMITS,
  otherSide,
  validateRoundsPayload,
  type TourCourt,
  type TourEntryRef,
  type TourRound,
  type TourRoundsCheck,
  type TourRoundsContext,
  type TourRoundsPayload,
} from '@touch/core/tournaments';
import { asciiDigits } from '@touch/i18n';
import { americanoSchedule, mexicanoRound, seedFrom } from './engine';
import type {
  TourDetailMatch,
  TourDetailRound,
  TourEntry,
  TournamentDetail,
} from './tournamentPayloads';

/**
 * The registered entries in seed order, each with a seed: the server's
 * `seed_no` once stamped (at close or the first set_rounds), otherwise the
 * next number in list order (the detail lists entries by `entered_at`, the
 * order the server stamps in).
 */
export function activeEntries(d: Pick<TournamentDetail, 'entries'>): TourEntryRef[] {
  const registered = d.entries.filter((e) => e.status === 'registered');
  const stamped = registered
    .filter((e) => e.seed_no !== null)
    .sort((x, y) => x.seed_no! - y.seed_no!);
  const top = stamped.reduce((m, e) => Math.max(m, e.seed_no!), 0);
  const unstamped = registered.filter((e) => e.seed_no === null);
  return [
    ...stamped.map((e) => ({ entry_id: e.entry_id, seed_no: e.seed_no! })),
    ...unstamped.map((e, i) => ({ entry_id: e.entry_id, seed_no: top + i + 1 })),
  ];
}

/** The adopted courts the desk picked, lowest `sort_order` first (group 1 plays on the first). */
export function pickedCourts(
  d: Pick<TournamentDetail, 'courts'>,
  courtIds?: readonly string[],
): TourCourt[] {
  const want = courtIds ? new Set(courtIds) : null;
  return d.courts
    .filter((c) => !want || want.has(c.court_id))
    .map((c) => ({ court_id: c.court_id, sort: c.sort_order }));
}

/**
 * The courts the desk chose at Start, read back from the play: every adopted
 * court a drawn round has used. Next round and Regenerate draw on these, so a
 * court the desk left out at Start stays out. Undefined (every adopted court)
 * before anything is drawn, or when none of those courts is adopted any more.
 */
export function courtsInPlay(d: Pick<TournamentDetail, 'courts' | 'rounds'>): string[] | undefined {
  const used = new Set(d.rounds.flatMap((r) => r.matches.map((m) => m.court_id)));
  const ids = d.courts.filter((c) => used.has(c.court_id)).map((c) => c.court_id);
  return ids.length > 0 ? ids : undefined;
}

/**
 * Why Next round or Regenerate cannot draw now, as its `ws.tournaments.rounds`
 * line (the engine refuses fewer than four players or no court with a
 * RangeError, which reads as nothing); null when it can.
 */
export function drawBlocker(
  d: Pick<TournamentDetail, 'entries' | 'courts' | 'rounds'>,
): 'needPlayers' | 'needCourts' | null {
  if (activeEntries(d).length < TOUR_LIMITS.entriesMin) return 'needPlayers';
  if (pickedCourts(d, courtsInPlay(d)).length === 0) return 'needCourts';
  return null;
}

const isScored = (m: Pick<TourDetailMatch, 'points_a' | 'points_b'>) =>
  m.points_a !== null && m.points_b !== null;

/** True when every match of the round has a score (and it has one). */
export function roundComplete(r: TourDetailRound): boolean {
  return r.matches.length > 0 && r.matches.every(isScored);
}

/** The server's view of the play, for `validateRoundsPayload`. */
export function roundsContext(d: TournamentDetail): TourRoundsContext {
  return {
    status: d.status,
    revision: d.revision,
    format: d.format,
    rounds_planned: d.rounds_planned,
    last_round: d.rounds.reduce((m, r) => Math.max(m, r.round_no), 0),
    scored_rounds: d.rounds.filter((r) => r.matches.some(isScored)).map((r) => r.round_no),
    complete_rounds: d.rounds.filter(roundComplete).map((r) => r.round_no),
    active: activeEntries(d).map((e) => e.entry_id),
    courts: d.courts.map((c) => c.court_id),
    sit_outs: d.rounds.map((r) => ({ round_no: r.round_no, sit_out: r.sit_out })),
    round_courts: d.rounds.map((r) => ({
      round_no: r.round_no,
      courts: r.matches.map((m) => m.court_id),
    })),
  };
}

export type BoardAction =
  /** Nothing drawn yet: pick the courts (and, Americano, the rounds) and draw. */
  | { kind: 'start' }
  /** Mexicano: the last round is scored and more are planned. */
  | { kind: 'next'; fromRound: number }
  /** Rounds from `fromRound` were removed (a no-show, a correction) and are drawn again. */
  | { kind: 'regenerate'; fromRound: number }
  /** Mexicano: the current round still has a match to score. */
  | { kind: 'scoreFirst' }
  | { kind: 'none' };

export function boardAction(d: TournamentDetail): BoardAction {
  if (d.status !== 'closed' && d.status !== 'running') return { kind: 'none' };
  const last = d.rounds.reduce((m, r) => Math.max(m, r.round_no), 0);
  if (last === 0) return { kind: 'start' };
  const planned = d.rounds_planned ?? last;
  if (last >= planned) return { kind: 'none' };
  if (d.format === 'americano') return { kind: 'regenerate', fromRound: last + 1 };
  const lastRound = d.rounds.find((r) => r.round_no === last);
  return lastRound && roundComplete(lastRound)
    ? { kind: 'next', fromRound: last + 1 }
    : { kind: 'scoreFirst' };
}

/** The Americano default (plan §4): every partner once, at most 30, at least 1. */
export function defaultAmericanoRounds(players: number): number {
  return Math.max(1, Math.min(players - 1, TOUR_LIMITS.roundsMax));
}

/** A detail round as the engine reads history. */
function asTourRound(r: TourDetailRound): TourRound {
  return {
    round_no: r.round_no,
    sit_out: [...r.sit_out],
    matches: r.matches.map((m) => ({ court_id: m.court_id, a: [...m.a], b: [...m.b] })),
  };
}

/** The engine's rounds numbered on from `from` (the payload's numbering rule, §1.9 check 5). */
export function renumber(rounds: readonly TourRound[], from: number): TourRound[] {
  return rounds.map((r, i) => ({ ...r, round_no: from + i }));
}

function payload(d: TournamentDetail, fromRound: number, rounds: TourRound[]): TourRoundsPayload {
  return {
    engine: TOUR_ENGINE,
    format: d.format,
    based_on_revision: d.revision,
    from_round: fromRound,
    rounds,
  };
}

/**
 * The start: Americano draws its whole schedule (`rounds` of them), Mexicano
 * its first round from a seeded shuffle. On the courts the desk picked.
 */
export function buildStart(
  d: TournamentDetail,
  opts: { courtIds: readonly string[]; rounds: number },
): TourRoundsPayload {
  const entries = activeEntries(d);
  const courts = pickedCourts(d, opts.courtIds);
  const seed = seedFrom(d.id);
  if (d.format === 'americano') {
    const drawn = americanoSchedule({ entries, courts, rounds: opts.rounds, seed, history: [] });
    return payload(d, 1, renumber(drawn, 1));
  }
  const first = mexicanoRound({
    entries,
    courts,
    standings: d.standings,
    lastRound: null,
    roundNo: 1,
    seed,
  });
  return payload(d, 1, renumber([first], 1));
}

/**
 * Next round or regeneration from `fromRound`: Americano draws the planned
 * rounds still missing with the played ones as history; Mexicano draws the one
 * round from the server's standings. On `courtIds`, else the courts the play
 * has used (`courtsInPlay`: the desk's choice at Start).
 */
export function buildFrom(
  d: TournamentDetail,
  fromRound: number,
  courtIds?: readonly string[],
): TourRoundsPayload {
  const entries = activeEntries(d);
  const courts = pickedCourts(d, courtIds ?? courtsInPlay(d));
  const seed = seedFrom(d.id);
  const played = d.rounds.filter((r) => r.round_no < fromRound).map(asTourRound);
  if (d.format === 'americano') {
    const remaining = Math.max(1, (d.rounds_planned ?? fromRound) - (fromRound - 1));
    const drawn = americanoSchedule({ entries, courts, rounds: remaining, seed, history: played });
    return payload(d, fromRound, renumber(drawn, fromRound));
  }
  const lastRound = played.find((r) => r.round_no === fromRound - 1) ?? null;
  const next = mexicanoRound({
    entries,
    courts,
    standings: d.standings,
    lastRound,
    roundNo: fromRound,
    seed,
  });
  return payload(d, fromRound, renumber([next], fromRound));
}

/** The server's refusals this payload would meet, first one first; `[]` to send. */
export function checkPayload(d: TournamentDetail, p: TourRoundsPayload): TourRoundsCheck[] {
  return validateRoundsPayload(p, roundsContext(d));
}

// ── the score cell ───────────────────────────────────────────────────────────

/**
 * What the desk typed for side A, read as a score: a whole number in
 * 0..target, the other side `target − a`. Null while it cannot score.
 */
export function readScoreInput(text: string, target: number): { a: number; b: number } | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const a = Number(t);
  const b = otherSide(a, target);
  return b === null ? null : { a, b };
}

/**
 * What the score box holds after a keystroke: digits only, the last two typed,
 * and never more than the target. Typing over a full box keeps the newest
 * digits (15, then 9 → 59 → too many → 9), so staff never have to clear it.
 * An Arabic keyboard's digits (١٥) count as digits.
 */
export function scoreTyping(raw: string, target: number): string {
  const digits = asciiDigits(raw).replace(/[^\d]/g, '');
  const two = digits.slice(-2);
  if (two === '' || Number(two) <= target) return two;
  return digits.slice(-1);
}

/** A correction: the match already has a score (it needs a reason, §1.6 score). */
export function isCorrection(m: Pick<TourDetailMatch, 'points_a' | 'points_b'>): boolean {
  return isScored(m);
}

/**
 * Whether a score write needs a reason (0311, c35): a correction, or any score on a finished
 * tournament (a manager's late entry, made within 48 hours of the finish, always says why).
 */
export function needsScoreReason(
  m: Pick<TourDetailMatch, 'points_a' | 'points_b'>,
  status: TournamentDetail['status'],
): boolean {
  return isCorrection(m) || status === 'finished';
}

/** Whether a match can take a score now: a running or finished tournament the role may score. */
export function canScore(d: Pick<TournamentDetail, 'status' | 'can'>): boolean {
  return d.can.score && (d.status === 'running' || d.status === 'finished');
}

// ── names ────────────────────────────────────────────────────────────────────

/** Every entry by id, for the board's names. */
export function entriesById(d: Pick<TournamentDetail, 'entries'>): Map<string, TourEntry> {
  return new Map(d.entries.map((e) => [e.entry_id, e]));
}

/** "Sara K." from a full name: the first word and the next one's initial (the public "First I."). */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${Array.from(parts[1]!)[0]}.`;
}

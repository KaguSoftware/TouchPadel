/**
 * The tournament seating board, arranged in PURE code (play-coaches contracts §5; vitest runs it
 * under plain node, no RN / expo / supabase imports).
 *
 * Americano and Mexicano both play four to a court, two a side, so the board draws
 * `ceil(max_entries / 4)` courts with two chairs on each side of the net. Before the draw each
 * entry sits on the chair the server says (`seat`, 0373: the chair the guest tapped, Majed
 * 2026-10-29), numbered court by court, side A's two chairs then side B's; an entry with no
 * chair (a server before 0373) takes the lowest one left, in registration order. Once the desk has
 * drawn the play, the board shows round 1's real courts from `rounds[0]` instead.
 *
 * Nothing here decides who plays where or whether a guest may register: it lays out what
 * `tournament_public` sent (`entries`, `rounds`) and which entry is the guest's own (`mine`).
 */
import type {
  TourFormat,
  TourPlayer,
  TourPublicEntry,
  TourPublicRound,
  TournamentPublic,
} from './logic';

/** Four to a court, two a side (T-1). */
export const CHAIRS_PER_COURT = 4;
export const CHAIRS_PER_SIDE = 2;

export type ChairSide = 'a' | 'b';

/**
 * A chair's state. `taken` carries the player, or null when the server counted an entry it did
 * not list (a server older than §4.3); `none` is a chair past the tournament's maximum, which the
 * board leaves off the court.
 */
export type ChairState = 'taken' | 'mine' | 'open' | 'none';

export interface BoardChair {
  side: ChairSide;
  /** 1 or 2, within its side. */
  seat: 1 | 2;
  /** 1–4 within the court: side A's two, then side B's (the order a screen reader says). */
  no: number;
  /**
   * The chair's number on the whole board before the draw, `(court - 1) * 4 + no`: what a tap on
   * an open one asks `tournament_register` for (0373). Null on round 1's courts.
   */
  boardNo: number | null;
  state: ChairState;
  player: TourPlayer | null;
}

export interface BoardCourt {
  /** The court's number as the board names it: 1… before the draw, the round's `court_no` after. */
  no: number;
  /** Always four: side A seat 1, seat 2, side B seat 1, seat 2. */
  chairs: BoardChair[];
}

export interface BoardSitOut {
  player: TourPlayer;
  mine: boolean;
}

export interface SeatingBoard {
  /** `entries`: the chairs the entries sit on; `draw`: round 1's real courts. */
  phase: 'entries' | 'draw';
  courts: BoardCourt[];
  /** Round 1's players sitting out (the draw only). */
  sitOut: BoardSitOut[];
  /** Index into `courts` of the court holding the guest's own chair, or null. */
  ownCourt: number | null;
  /** Some chair is open: a tap on one can register. */
  hasOpen: boolean;
}

/** `ceil(max_entries / 4)`, at least 1, and never fewer than the listed entries need. */
export function boardCourtsCount(maxEntries: number | null, listed: number): number {
  const byMax =
    maxEntries !== null && maxEntries > 0 ? Math.ceil(maxEntries / CHAIRS_PER_COURT) : 0;
  const byListed = Math.ceil(Math.max(0, listed) / CHAIRS_PER_COURT);
  return Math.max(1, byMax, byListed);
}

/** Where the n-th chair of a court (0-based) stands: side A's two, then side B's. */
export function chairPlace(index: number): { side: ChairSide; seat: 1 | 2 } {
  const i = ((index % CHAIRS_PER_COURT) + CHAIRS_PER_COURT) % CHAIRS_PER_COURT;
  return { side: i < CHAIRS_PER_SIDE ? 'a' : 'b', seat: i % CHAIRS_PER_SIDE === 0 ? 1 : 2 };
}

/**
 * The chairs before the draw. An entry with a `seat` on the board sits there (the first of two that
 * claim one); every other entry takes the lowest chair left, in registration order, which is how
 * `app.tournament_seats` places a desk add. `entriesCount` is the server's count: when it exceeds
 * the listed entries, the lowest chairs still free read as taken with no name, so a server without
 * `entries` never shows a full tournament as empty. Chairs past `maxEntries` are `none`.
 */
export function seatEntries(
  entries: readonly TourPublicEntry[],
  maxEntries: number | null,
  entriesCount = entries.length,
): BoardCourt[] {
  const taken = Math.max(entries.length, entriesCount);
  const courts = boardCourtsCount(maxEntries, taken);
  const chairs = courts * CHAIRS_PER_COURT;
  const capacity = maxEntries !== null && maxEntries > 0 ? maxEntries : chairs;
  // Board chair index (0-based) → the entry on it, or 'unlisted' for a counted, unnamed one.
  const on: (TourPublicEntry | 'unlisted' | undefined)[] = new Array(chairs);
  const unseated: TourPublicEntry[] = [];
  for (const entry of entries) {
    const i = entry.seat !== null ? entry.seat - 1 : -1;
    if (i >= 0 && i < chairs && on[i] === undefined) on[i] = entry;
    else unseated.push(entry);
  }
  const rest: (TourPublicEntry | 'unlisted')[] = [
    ...unseated,
    ...Array.from({ length: taken - entries.length }, () => 'unlisted' as const),
  ];
  for (let i = 0; i < chairs && rest.length > 0; i++) {
    if (on[i] === undefined) on[i] = rest.shift();
  }
  return Array.from({ length: courts }, (_, c) => ({
    no: c + 1,
    chairs: Array.from({ length: CHAIRS_PER_COURT }, (_, k) => {
      const i = c * CHAIRS_PER_COURT + k;
      const sat = on[i];
      const entry = sat !== undefined && sat !== 'unlisted' ? sat : undefined;
      const state: ChairState = entry
        ? entry.mine
          ? 'mine'
          : 'taken'
        : sat === 'unlisted'
          ? 'taken'
          : i < capacity
            ? 'open'
            : 'none';
      return { ...chairPlace(k), no: k + 1, boardNo: i + 1, state, player: entry?.player ?? null };
    }),
  }));
}

/** The guest's own seed number, from the entry the server marked `mine`; null when none. */
export function ownSeedNo(entries: readonly TourPublicEntry[]): number | null {
  return entries.find((e) => e.mine)?.player.no ?? null;
}

const isOwn = (p: TourPlayer, own: number | null) => own !== null && p.no === own;

/**
 * Round 1's real courts (the draw): each match's side A on one half, side B on the other, the
 * courts in their `court_no` order. The guest's chair is the player whose seed number is their own
 * entry's (rounds carry no `mine`). A side the server sent short shows its missing chair as open.
 */
export function seatRound(
  round: TourPublicRound,
  own: number | null,
): { courts: BoardCourt[]; sitOut: BoardSitOut[] } {
  const ordered = round.matches
    .map((m, i) => ({ m, no: m.courtNo ?? i + 1 }))
    .sort((x, y) => x.no - y.no);
  const chair = (p: TourPlayer | undefined, k: number): BoardChair => ({
    ...chairPlace(k),
    no: k + 1,
    boardNo: null,
    state: !p ? 'open' : isOwn(p, own) ? 'mine' : 'taken',
    player: p ?? null,
  });
  return {
    courts: ordered.map(({ m, no }) => ({
      no,
      chairs: [chair(m.a[0], 0), chair(m.a[1], 1), chair(m.b[0], 2), chair(m.b[1], 3)],
    })),
    sitOut: round.sitOut.map((player) => ({ player, mine: isOwn(player, own) })),
  };
}

/**
 * The board the detail draws, or null when there is nothing to seat: a missing or cancelled
 * tournament, or one whose state the phone does not know. After the draw (play under way or
 * finished, a round drawn) it is round 1; before, the entries.
 */
export function seatingBoardOf(d: TournamentPublic): SeatingBoard | null {
  if (d.missing || d.status === null || d.status === 'cancelled') return null;
  const first = d.rounds[0];
  const drawn = (d.status === 'running' || d.status === 'finished') && first !== undefined;
  if (drawn) {
    const { courts, sitOut } = seatRound(first, ownSeedNo(d.entries));
    if (courts.length > 0) return finish('draw', courts, sitOut);
  }
  return finish('entries', seatEntries(d.entries, d.maxEntries, d.entriesCount), []);
}

function finish(
  phase: SeatingBoard['phase'],
  courts: BoardCourt[],
  sitOut: BoardSitOut[],
): SeatingBoard {
  const own = courts.findIndex((c) => c.chairs.some((ch) => ch.state === 'mine'));
  return {
    phase,
    courts,
    sitOut,
    ownCourt: own >= 0 ? own : null,
    hasOpen: courts.some((c) => c.chairs.some((ch) => ch.state === 'open')),
  };
}

/** Courts the board shows before "Show all": four, or up to the guest's own court. */
export const BOARD_COURTS_FOLDED = 4;

export function visibleCourtsCount(board: SeatingBoard, expanded: boolean): number {
  if (expanded) return board.courts.length;
  const own = board.ownCourt === null ? 0 : board.ownCourt + 1;
  return Math.min(board.courts.length, Math.max(BOARD_COURTS_FOLDED, own));
}

/** The board's caption: how partners change in this format (§5); null for an unknown one. */
export function boardCaptionKey(
  format: TourFormat | null,
): 'seating.caption.americano' | 'seating.caption.mexicano' | null {
  if (format === 'americano') return 'seating.caption.americano';
  if (format === 'mexicano') return 'seating.caption.mexicano';
  return null;
}

import { describe, expect, it } from 'vitest';
import {
  BOARD_COURTS_FOLDED,
  boardCaptionKey,
  boardCourtsCount,
  chairPlace,
  ownSeedNo,
  seatEntries,
  seatRound,
  seatingBoardOf,
  visibleCourtsCount,
} from '../seating';
import { parseTournamentPublic, type TourPublicEntry } from '../logic';
import {
  TOUR_ID,
  entriesFixture,
  openTournamentFixture,
  tournamentPublicFixture,
} from '../../../test/tournamentsFixtures';

/** The seating board (play-coaches contracts §5): four to a court, two a side, entry order. */

const entries = (n: number, mineAt: number | null = null): TourPublicEntry[] =>
  parseTournamentPublic(openTournamentFixture({ entries: entriesFixture(n, mineAt) }), TOUR_ID)
    .entries;

const states = (courts: ReturnType<typeof seatEntries>) =>
  courts.map((c) => c.chairs.map((ch) => ch.state));

describe('boardCourtsCount', () => {
  it('is ceil(max_entries / 4), at least one', () => {
    expect(boardCourtsCount(16, 0)).toBe(4);
    expect(boardCourtsCount(10, 0)).toBe(3);
    expect(boardCourtsCount(4, 0)).toBe(1);
    expect(boardCourtsCount(1, 0)).toBe(1);
    expect(boardCourtsCount(0, 0)).toBe(1);
    expect(boardCourtsCount(null, 0)).toBe(1);
    expect(boardCourtsCount(64, 0)).toBe(16);
  });

  it('never seats fewer chairs than the entries listed', () => {
    expect(boardCourtsCount(8, 9)).toBe(3);
    expect(boardCourtsCount(null, 6)).toBe(2);
  });
});

describe('chairPlace', () => {
  it('fills side A’s two chairs, then side B’s', () => {
    expect([0, 1, 2, 3].map(chairPlace)).toEqual([
      { side: 'a', seat: 1 },
      { side: 'a', seat: 2 },
      { side: 'b', seat: 1 },
      { side: 'b', seat: 2 },
    ]);
    expect(chairPlace(5)).toEqual({ side: 'a', seat: 2 });
  });
});

describe('seatEntries', () => {
  it('seats the entries in registration order, court by court', () => {
    const courts = seatEntries(entries(6), 8);
    expect(courts.map((c) => c.no)).toEqual([1, 2]);
    expect(states(courts)).toEqual([
      ['taken', 'taken', 'taken', 'taken'],
      ['taken', 'taken', 'open', 'open'],
    ]);
    expect(courts[0]!.chairs.map((ch) => ch.player?.no)).toEqual([1, 2, 3, 4]);
    expect(courts[1]!.chairs[0]!.player?.no).toBe(5);
    expect(courts[1]!.chairs.map((ch) => ch.no)).toEqual([1, 2, 3, 4]);
  });

  it('marks the guest’s own chair', () => {
    const courts = seatEntries(entries(3, 2), 4);
    expect(states(courts)).toEqual([['taken', 'taken', 'mine', 'open']]);
    expect(courts[0]!.chairs[2]).toMatchObject({ side: 'b', seat: 1, state: 'mine' });
  });

  it('leaves the chairs past the maximum off the court', () => {
    expect(states(seatEntries(entries(2), 6))).toEqual([
      ['taken', 'taken', 'open', 'open'],
      ['open', 'open', 'none', 'none'],
    ]);
  });

  it('counts entries the server did not list as taken, without a name', () => {
    const courts = seatEntries([], 8, 5);
    expect(states(courts)).toEqual([
      ['taken', 'taken', 'taken', 'taken'],
      ['taken', 'open', 'open', 'open'],
    ]);
    expect(courts[0]!.chairs[0]!.player).toBeNull();
  });

  it('draws one empty court for a tournament with no maximum and no entries', () => {
    expect(states(seatEntries([], null))).toEqual([['open', 'open', 'open', 'open']]);
  });

  // 0373 (Majed, 2026-10-29): the chair a guest tapped is the chair they sit on.
  const seated = (no: number, seat: number | null, mine = false): TourPublicEntry => ({
    player: { name: `P${no}`, former: false, no },
    mine,
    seat,
  });

  it('seats each entry on its own chair, wherever on the board it is', () => {
    // Court 2's second chair is board chair 6.
    const courts = seatEntries([seated(1, 6, true), seated(2, 1)], 8);
    expect(states(courts)).toEqual([
      ['taken', 'open', 'open', 'open'],
      ['open', 'mine', 'open', 'open'],
    ]);
    expect(courts[1]!.chairs[1]!.player?.no).toBe(1);
  });

  it('numbers every chair across the board, the number a tap on an open one sends', () => {
    const courts = seatEntries([], 8);
    expect(courts.map((c) => c.chairs.map((ch) => ch.boardNo))).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('puts an entry with no chair, or a second claim on one, on the lowest chair left', () => {
    const courts = seatEntries([seated(1, 2), seated(2, null), seated(3, 2), seated(4, 99)], 8);
    expect(courts[0]!.chairs.map((ch) => ch.player?.no ?? null)).toEqual([2, 1, 3, 4]);
    expect(states(courts)[1]).toEqual(['open', 'open', 'open', 'open']);
  });

  it('fills the unlisted count after the seated entries', () => {
    expect(states(seatEntries([seated(1, 4)], 8, 3))).toEqual([
      ['taken', 'taken', 'open', 'taken'],
      ['open', 'open', 'open', 'open'],
    ]);
  });
});

describe('ownSeedNo', () => {
  it('is the seed number of the entry marked mine', () => {
    expect(ownSeedNo(entries(5, 3))).toBe(4);
    expect(ownSeedNo(entries(5))).toBeNull();
    expect(ownSeedNo([])).toBeNull();
  });
});

describe('seatRound (after the draw)', () => {
  const d = parseTournamentPublic(tournamentPublicFixture(), TOUR_ID);

  it('puts side A on one half and side B on the other, with the guest found by seed', () => {
    const { courts, sitOut } = seatRound(d.rounds[0]!, ownSeedNo(d.entries));
    expect(courts).toHaveLength(1);
    expect(courts[0]!.no).toBe(1);
    expect(courts[0]!.chairs.map((ch) => [ch.side, ch.player?.no, ch.state])).toEqual([
      ['a', 1, 'taken'],
      ['a', 2, 'taken'],
      ['b', 3, 'mine'],
      ['b', 4, 'taken'],
    ]);
    expect(sitOut).toEqual([{ player: { name: null, former: false, no: 5 }, mine: false }]);
  });

  it('orders the courts by court_no and opens a chair a short side lacks', () => {
    const p = (no: number) => ({ name: `P${no}.`, former: false, no });
    const { courts, sitOut } = seatRound(
      {
        roundNo: 1,
        sitOut: [p(9)],
        matches: [
          { courtNo: 2, a: [p(5), p(6)], b: [p(7)], pointsA: null, pointsB: null },
          { courtNo: 1, a: [p(1), p(2)], b: [p(3), p(4)], pointsA: null, pointsB: null },
        ],
      },
      9,
    );
    expect(courts.map((c) => c.no)).toEqual([1, 2]);
    expect(courts[1]!.chairs[3]!.state).toBe('open');
    expect(sitOut[0]!.mine).toBe(true);
  });
});

describe('seatingBoardOf', () => {
  it('seats the entries before the draw', () => {
    const board = seatingBoardOf(
      parseTournamentPublic(openTournamentFixture({ entries: entriesFixture(10, 5) }), TOUR_ID),
    )!;
    expect(board.phase).toBe('entries');
    expect(board.courts).toHaveLength(4);
    expect(board.ownCourt).toBe(1);
    expect(board.hasOpen).toBe(true);
    expect(board.sitOut).toEqual([]);
  });

  it('shows round 1 once play is drawn', () => {
    const board = seatingBoardOf(parseTournamentPublic(tournamentPublicFixture(), TOUR_ID))!;
    expect(board.phase).toBe('draw');
    expect(board.ownCourt).toBe(0);
    expect(board.hasOpen).toBe(false);
    expect(board.sitOut).toHaveLength(1);
  });

  it('keeps seating the entries while closed, before the desk draws', () => {
    const board = seatingBoardOf(
      parseTournamentPublic(openTournamentFixture({ status: 'closed' }), TOUR_ID),
    )!;
    expect(board.phase).toBe('entries');
  });

  it('a full board has no open chair', () => {
    const board = seatingBoardOf(
      parseTournamentPublic(
        openTournamentFixture({
          max_entries: 8,
          entries_count: 8,
          places_left: 0,
          entries: entriesFixture(8),
        }),
        TOUR_ID,
      ),
    )!;
    expect(board.hasOpen).toBe(false);
  });

  it('draws nothing for a cancelled, missing or unknown-state tournament', () => {
    expect(
      seatingBoardOf(
        parseTournamentPublic(openTournamentFixture({ status: 'cancelled' }), TOUR_ID),
      ),
    ).toBeNull();
    expect(seatingBoardOf(parseTournamentPublic({ missing: true }, TOUR_ID))).toBeNull();
    expect(
      seatingBoardOf(parseTournamentPublic(openTournamentFixture({ status: 'paused' }), TOUR_ID)),
    ).toBeNull();
  });
});

describe('visibleCourtsCount', () => {
  const board = (n: number, mineAt: number | null) =>
    seatingBoardOf(
      parseTournamentPublic(
        openTournamentFixture({ max_entries: 64, entries: entriesFixture(n, mineAt) }),
        TOUR_ID,
      ),
    )!;

  it('folds to four courts, or as far as the guest’s own', () => {
    expect(visibleCourtsCount(board(10, null), false)).toBe(BOARD_COURTS_FOLDED);
    expect(visibleCourtsCount(board(30, 25), false)).toBe(7);
    expect(visibleCourtsCount(board(10, null), true)).toBe(16);
  });

  it('shows every court of a small board', () => {
    const small = seatingBoardOf(
      parseTournamentPublic(
        openTournamentFixture({ max_entries: 8, entries_count: 6, entries: entriesFixture(6) }),
        TOUR_ID,
      ),
    )!;
    expect(visibleCourtsCount(small, false)).toBe(2);
  });
});

describe('boardCaptionKey', () => {
  it('names how partners change in each format', () => {
    expect(boardCaptionKey('americano')).toBe('seating.caption.americano');
    expect(boardCaptionKey('mexicano')).toBe('seating.caption.mexicano');
    expect(boardCaptionKey(null)).toBeNull();
  });
});

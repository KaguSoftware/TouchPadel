import { describe, expect, it } from 'vitest';
import {
  currentRoundNo,
  entryMoney,
  fillPercent,
  filterTournaments,
  listTotals,
  roundState,
  scoredCount,
  statusCounts,
} from './layoutLogic';
import type { DeskTournament, TourDetailRound, TourEntry } from './tournamentPayloads';

function match(id: string, a: number | null, b: number | null) {
  return {
    match_id: id,
    court_id: 'c1',
    a: ['p1', 'p2'] as [string, string],
    b: ['p3', 'p4'] as [string, string],
    points_a: a,
    points_b: b,
    revision: 0,
    corrections: 0,
  };
}
function round(no: number, scores: [number | null, number | null][]): TourDetailRound {
  return { round_no: no, sit_out: [], matches: scores.map(([a, b], i) => match(`${no}-${i}`, a, b)) };
}

describe('rounds', () => {
  const rounds = [
    round(1, [[15, 9], [12, 12]]),
    round(2, [[15, 9], [null, null]]),
    round(3, [[null, null], [null, null]]),
  ];

  it('finds the first round with a match left to score', () => {
    expect(currentRoundNo(rounds)).toBe(2);
    expect(currentRoundNo([rounds[0]!])).toBeNull();
    expect(currentRoundNo([])).toBeNull();
  });

  it('marks rounds done, now and drawn around the current one', () => {
    expect(rounds.map((r) => roundState(r, 2))).toEqual(['done', 'now', 'drawn']);
    expect(roundState(rounds[0]!, null)).toBe('done');
  });

  it('counts the scored matches of a round', () => {
    expect(scoredCount(rounds[1]!)).toBe(1);
    expect(scoredCount(rounds[2]!)).toBe(0);
  });
});

function entry(status: TourEntry['status'], owed: number, paid: number): TourEntry {
  return {
    entry_id: `${status}-${owed}-${paid}`,
    guest_id: null,
    full_name: 'X',
    phone: null,
    status,
    seed_no: null,
    waitlist_position: null,
    added_by_kind: 'staff',
    owed_iqd: owed,
    net_paid_iqd: paid,
    refund_due_iqd: 0,
    substitute_for: null,
  };
}

describe('entryMoney', () => {
  it('splits the registered players into paid and owing, and sums the money', () => {
    expect(
      entryMoney([
        entry('registered', 0, 15000),
        entry('registered', 15000, 0),
        entry('waitlisted', 15000, 0),
        entry('withdrawn', 0, 5000),
      ]),
    ).toEqual({ paid: 1, owing: 1, collected: 20000, due: 15000 });
  });
});

function tour(id: string, status: DeskTournament['status'], registered: number, waitlisted = 0): DeskTournament {
  return {
    id,
    name_en: id,
    name_ar: id,
    status,
    format: 'americano',
    category: 'open',
    starts_at: '',
    ends_at: '',
    registered,
    waitlisted,
    max_entries: 16,
    blocks: [],
  };
}

describe('the list', () => {
  const list = [tour('a', 'open', 6, 1), tour('b', 'running', 16), tour('c', 'cancelled', 5, 2), tour('d', 'closed', 12)];

  it('filters by status, or shows all', () => {
    expect(filterTournaments(list, 'all').map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(filterTournaments(list, 'running').map((t) => t.id)).toEqual(['b']);
  });

  it('counts each status', () => {
    expect(statusCounts(list)).toEqual({ open: 1, closed: 1, running: 1, finished: 0, cancelled: 1 });
  });

  it('totals players and the waitlist without the cancelled ones', () => {
    expect(listTotals(list)).toEqual({ upcoming: 2, running: 1, players: 34, waitlisted: 1 });
  });

  it('clamps the fill bar', () => {
    expect(fillPercent(6, 16)).toBe(38);
    expect(fillPercent(20, 16)).toBe(100);
    expect(fillPercent(3, 0)).toBe(0);
  });
});

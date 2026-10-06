import { describe, expect, it } from 'vitest';
import { TOURNAMENT_SHAPES, tourMissingKeys } from '@touch/core/tournaments';
import {
  readDeskTournaments,
  readPlayAnswer,
  readPublishAnswer,
  readTournamentDetail,
} from './tournamentPayloads';

// The answers the operator parses (tournaments build contracts §1.6, §1.8).
// Each fixture carries every key TOURNAMENT_SHAPES lists, so a shape change
// that the parser does not follow fails here first.

const BLOCK = {
  reservation_id: 'r1',
  court_id: 'c1',
  start_at: '2026-10-09T15:00:00Z',
  end_at: '2026-10-09T19:00:00Z',
};

const DESK = {
  tournaments_enabled: true,
  server_now: '2026-10-03T09:00:00Z',
  tournaments: [
    {
      id: 't1',
      name_en: 'Cup',
      name_ar: 'كأس',
      status: 'open',
      format: 'mexicano',
      category: 'women',
      starts_at: BLOCK.start_at,
      ends_at: BLOCK.end_at,
      registered: 6,
      waitlisted: 1,
      max_entries: 16,
      refund_due_iqd: 0,
      blocks: [BLOCK, { reservation_id: null }],
    },
    { name_en: 'no id' },
  ],
};

const DETAIL = {
  id: 't1',
  venue_id: 'v1',
  protocol_run_id: 'run1',
  name_en: 'Cup',
  name_ar: 'كأس',
  format: 'americano',
  category: 'open',
  class: 'B',
  points_target: 24,
  rounds_planned: 7,
  max_entries: 16,
  min_entries: 4,
  waitlist_max: 8,
  entry_fee_iqd: 25000,
  prize_en: null,
  prize_ar: null,
  starts_at: BLOCK.start_at,
  ends_at: BLOCK.end_at,
  registration_closes_at: '2026-10-09T13:00:00Z',
  status: 'running',
  cancel_reason: null,
  revision: 5,
  closed_at: '2026-10-09T13:00:00Z',
  finished_at: null,
  cancelled_at: null,
  sweep_errors: 0,
  timezone: 'Asia/Baghdad',
  server_now: '2026-10-09T15:30:00Z',
  entries: [
    {
      entry_id: 'e1',
      guest_id: 'g1',
      full_name: 'Sara Kareem',
      phone: '+9647700000001',
      status: 'registered',
      seed_no: 1,
      waitlist_position: null,
      added_by_kind: 'staff',
      owed_iqd: 25000,
      net_paid_iqd: 0,
      refund_due_iqd: 0,
      substitute_for: null,
      payments: [],
    },
  ],
  courts: [
    { court_id: 'c2', name_en: 'Court 2', name_ar: 'ملعب ٢', sort_order: 2 },
    { court_id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', sort_order: 1 },
  ],
  rounds: [
    {
      round_no: 2,
      sit_out: [],
      matches: [
        {
          match_id: 'm2',
          court_id: 'c1',
          a: ['e1', 'e2'],
          b: ['e3', 'e4'],
          points_a: null,
          points_b: null,
          revision: 0,
          corrections: 0,
        },
      ],
    },
    {
      round_no: 1,
      sit_out: ['e5'],
      matches: [
        {
          match_id: 'm1',
          court_id: 'c1',
          a: ['e1', 'e2'],
          b: ['e3', 'e4'],
          points_a: 14,
          points_b: 10,
          revision: 2,
          corrections: 1,
        },
        { match_id: 'bad', court_id: 'c1', a: ['e1'], b: ['e3', 'e4'] },
      ],
    },
  ],
  standings: [
    {
      entry_id: 'e2',
      rank: 2,
      points_won: 10,
      points_against: 14,
      diff: -4,
      h2h: 0,
      played: 1,
      sat_out: 0,
      withdrawn: false,
    },
    {
      entry_id: 'e1',
      rank: 1,
      points_won: 14,
      points_against: 10,
      diff: 4,
      h2h: 0,
      played: 1,
      sat_out: 0,
      withdrawn: false,
    },
  ],
  can: {
    add: true,
    set_rounds: true,
    score: true,
    cancel: true,
    close: false,
    finish: false,
    settle: true,
  },
};

describe('the fixtures carry the frozen shapes', () => {
  it('desk_tournaments and desk_tournament_detail', () => {
    const desk = { ...DESK, tournaments: [DESK.tournaments[0]!] };
    expect(
      tourMissingKeys(
        { ...desk, tournaments: [{ ...desk.tournaments[0], blocks: [BLOCK] }] },
        TOURNAMENT_SHAPES.desk_tournaments,
      ),
    ).toEqual([]);
    const clean = { ...DETAIL, rounds: [DETAIL.rounds[0]] };
    expect(tourMissingKeys(clean, TOURNAMENT_SHAPES.desk_tournament_detail)).toEqual([]);
  });
});

describe('readDeskTournaments', () => {
  it('reads each tournament with its blocks and drops rows without an id', () => {
    const d = readDeskTournaments(DESK);
    expect(d.tournaments_enabled).toBe(true);
    expect(d.tournaments).toHaveLength(1);
    expect(d.tournaments[0]).toMatchObject({
      id: 't1',
      format: 'mexicano',
      category: 'women',
      registered: 6,
      waitlisted: 1,
    });
    expect(d.tournaments[0]!.blocks).toEqual([BLOCK]);
    expect(readDeskTournaments(undefined)).toEqual({
      tournaments_enabled: false,
      server_now: null,
      tournaments: [],
    });
  });
});

describe('readTournamentDetail', () => {
  it('reads the tournament, sorts courts, rounds and standings, and drops an unreadable match', () => {
    const d = readTournamentDetail(DETAIL)!;
    expect(d).toMatchObject({
      id: 't1',
      format: 'americano',
      points_target: 24,
      rounds_planned: 7,
      revision: 5,
      entry_fee_iqd: 25000,
    });
    expect(d.courts.map((c) => c.court_id)).toEqual(['c1', 'c2']);
    expect(d.rounds.map((r) => r.round_no)).toEqual([1, 2]);
    expect(d.rounds[0]!.matches.map((m) => m.match_id)).toEqual(['m1']);
    expect(d.rounds[0]!.sit_out).toEqual(['e5']);
    expect(d.standings.map((s) => s.entry_id)).toEqual(['e1', 'e2']);
    expect(d.entries[0]).toMatchObject({ added_by_kind: 'staff', owed_iqd: 25000, seed_no: 1 });
    expect(d.can.settle).toBe(true);
  });

  it('is null without a tournament id', () => {
    expect(readTournamentDetail({})).toBeNull();
    expect(readTournamentDetail(null)).toBeNull();
  });
});

describe('write answers', () => {
  it('reads publish and play answers', () => {
    expect(
      readPublishAnswer({
        tournament_id: 't1',
        starts_at: 'a',
        ends_at: 'b',
        blocks: [BLOCK],
        unblocked_windows: [{ court_id: 'c3', start_at: 'a', end_at: 'b' }],
      }),
    ).toMatchObject({
      tournament_id: 't1',
      unblocked_windows: [{ court_id: 'c3' }],
    });
    expect(
      readPlayAnswer({
        match_id: 'm',
        revision: 3,
        tournament_revision: 9,
        removed_from_round: 4,
        status: 'running',
      }),
    ).toEqual({
      revision: 3,
      tournament_revision: 9,
      removed_from_round: 4,
      status: 'running',
    });
    expect(readPlayAnswer({}).removed_from_round).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { TOURNAMENT_SHAPES, tourMissingKeys, type TourShape } from '@touch/core/tournaments';
import {
  anyTournaments,
  filterFromParam,
  isLive,
  isOwnEntry,
  parseRegisterResult,
  parseTournamentPublic,
  parseTournamentsPublic,
  parseWithdrawResult,
  playerLabel,
  prizeText,
  showsPlay,
  timezoneOf,
  tourActionOf,
  tourPlacesOf,
  tournamentName,
  tournamentRows,
  tournamentsEnabled,
} from '../logic';
import {
  TOUR_ENTRY_ID,
  TOUR_ID,
  TOUR_ID_2,
  openTournamentFixture,
  tournamentListItemFixture,
  tournamentPublicFixture,
  tournamentsPublicFixture,
} from '../../../test/tournamentsFixtures';

/**
 * The phone's tournament rules (plan §5.2; build contracts §1.6, §1.8, S13). The server stays the
 * wall: these hold the parsers to the frozen shapes and keep the screens from offering what it
 * would refuse.
 */

// ── Reading the keys of the shapes ──────────────────────────────────────────

/** Wrap a JSON value so every key read through it is recorded as a shape path (`rounds[].matches[].a[].name`). */
function track(value: unknown, path: string, reads: Set<string>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return new Proxy(value, {
      get(target, key, receiver) {
        const v = Reflect.get(target, key, receiver);
        return typeof key === 'string' && /^\d+$/.test(key) ? track(v, `${path}[]`, reads) : v;
      },
    });
  }
  return new Proxy(value as object, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver);
      if (typeof key !== 'string') return v;
      const here = path ? `${path}.${key}` : key;
      reads.add(here);
      return track(v, here, reads);
    },
  });
}

/** Every path a shape names: its keys and its nested keys. */
function shapePaths(shape: TourShape): string[] {
  const out = new Set<string>();
  for (const k of shape.keys) out.add(k);
  for (const [nested, keys] of Object.entries(shape.nested ?? {})) {
    for (const k of keys) out.add(`${nested}.${k}`);
  }
  return [...out].sort();
}

function readsOf(raw: unknown, parse: (json: unknown) => unknown): string[] {
  const reads = new Set<string>();
  parse(track(raw, '', reads));
  return [...reads].sort();
}

describe('the parsers read exactly their TOURNAMENT_SHAPES keys', () => {
  const cases: [string, TourShape, unknown, (json: unknown) => unknown][] = [
    [
      'tournaments_public',
      TOURNAMENT_SHAPES.tournaments_public,
      tournamentsPublicFixture(),
      parseTournamentsPublic,
    ],
    [
      'tournament_public',
      TOURNAMENT_SHAPES.tournament_public,
      tournamentPublicFixture(),
      (j) => parseTournamentPublic(j, TOUR_ID),
    ],
    [
      'tournament_register',
      TOURNAMENT_SHAPES.tournament_register,
      { entry_id: TOUR_ENTRY_ID, status: 'waitlisted', waitlist_position: 2, duplicate: false },
      parseRegisterResult,
    ],
    [
      'tournament_withdraw',
      TOURNAMENT_SHAPES.tournament_withdraw,
      { entry_id: TOUR_ENTRY_ID, status: 'withdrawn', refund_due_iqd: 0, duplicate: false },
      parseWithdrawResult,
    ],
  ];

  it.each(cases)('%s: the fixture carries the shape', (_name, shape, raw) => {
    expect(tourMissingKeys(raw, shape)).toEqual([]);
  });

  it.each(cases)('%s: the parser reads the shape and nothing else', (_name, shape, raw, parse) => {
    expect(readsOf(raw, parse)).toEqual(shapePaths(shape));
  });
});

// ── tournaments_public ──────────────────────────────────────────────────────

describe('parseTournamentsPublic', () => {
  it('reads the branches, the rows and the guest’s own entry', () => {
    const pub = parseTournamentsPublic(tournamentsPublicFixture());
    expect(pub.off).toBe(false);
    expect(pub.branches).toEqual([
      {
        venueId: expect.any(String),
        nameEn: 'Touch Padel',
        nameAr: 'تاتش بادل',
        timezone: 'Asia/Baghdad',
      },
    ]);
    expect(pub.tournaments.map((t) => t.id)).toEqual([TOUR_ID, TOUR_ID_2]);
    expect(pub.tournaments[0]!.mine).toEqual({
      entryId: TOUR_ENTRY_ID,
      status: 'registered',
      waitlistPosition: null,
    });
    expect(pub.tournaments[1]!).toMatchObject({
      category: 'women',
      format: 'mexicano',
      mine: null,
    });
  });

  it('answers off with nothing else', () => {
    expect(parseTournamentsPublic({ off: true })).toEqual({
      off: true,
      serverNow: null,
      branches: [],
      tournaments: [],
    });
  });

  it('parses every enum defensively and drops a row without an id or a start', () => {
    const pub = parseTournamentsPublic({
      off: false,
      tournaments: [
        tournamentListItemFixture({
          format: 'knockout',
          category: 'mixed',
          status: 'paused',
          places_left: -2,
        }),
        tournamentListItemFixture({ id: null }),
        tournamentListItemFixture({ id: TOUR_ID_2, starts_at: '' }),
      ],
    });
    expect(pub.tournaments).toHaveLength(1);
    expect(pub.tournaments[0]).toMatchObject({
      format: null,
      category: 'open',
      status: null,
      placesLeft: 0,
    });
    expect(parseTournamentsPublic(null).tournaments).toEqual([]);
    expect(parseTournamentsPublic('junk').branches).toEqual([]);
  });
});

// ── tournament_public ───────────────────────────────────────────────────────

describe('parseTournamentPublic', () => {
  it('reads the play: rounds, players as {name, former, no}, standings, the guest’s money', () => {
    const d = parseTournamentPublic(tournamentPublicFixture(), TOUR_ID);
    expect(d.missing).toBe(false);
    expect(d.rounds).toHaveLength(1);
    expect(d.rounds[0]!.sitOut).toEqual([{ name: null, former: false, no: 5 }]);
    expect(d.rounds[0]!.matches[0]!.b[1]).toEqual({ name: null, former: true, no: 4 });
    expect(d.rounds[0]!.matches[0]).toMatchObject({ courtNo: 1, pointsA: 15, pointsB: 9 });
    expect(d.standings[0]).toEqual({
      rank: 1,
      player: { name: 'Ali K.', former: false, no: 1 },
      pointsWon: 15,
      diff: 6,
      played: 1,
      withdrawn: false,
    });
    // 0311 (c27): an entry that left the play says so.
    expect(d.standings.map((s) => s.withdrawn)).toEqual([false, false, false, true]);
    expect(d.me).toEqual({
      entryId: TOUR_ENTRY_ID,
      status: 'registered',
      waitlistPosition: null,
      owedIqd: 15000,
    });
  });

  it('is one "not available" state for {missing: true}, keeping the id asked for', () => {
    const d = parseTournamentPublic({ missing: true }, TOUR_ID);
    expect(d.missing).toBe(true);
    expect(d.id).toBe(TOUR_ID);
    expect(d.rounds).toEqual([]);
    expect(parseTournamentPublic(null, TOUR_ID).missing).toBe(true);
  });

  it('orders the rounds by number whatever order they came in', () => {
    const d = parseTournamentPublic(
      tournamentPublicFixture({
        rounds: [
          { round_no: 2, sit_out: [], matches: [] },
          { round_no: 1, sit_out: [], matches: [] },
        ],
      }),
      TOUR_ID,
    );
    expect(d.rounds.map((r) => r.roundNo)).toEqual([1, 2]);
  });
});

describe('the write answers', () => {
  it('register reads the status, the waitlist place and a duplicate', () => {
    expect(
      parseRegisterResult({
        entry_id: 'e',
        status: 'waitlisted',
        waitlist_position: 3,
        duplicate: true,
      }),
    ).toEqual({ entryId: 'e', status: 'waitlisted', waitlistPosition: 3, duplicate: true });
    expect(() => parseRegisterResult({})).toThrow('MALFORMED_TOURNAMENT_REGISTER');
  });

  it('withdraw reads the refund the desk hands back', () => {
    expect(
      parseWithdrawResult({
        entry_id: 'e',
        status: 'withdrawn',
        refund_due_iqd: 15000,
        duplicate: false,
      }),
    ).toEqual({ entryId: 'e', status: 'withdrawn', refundDueIqd: 15000, duplicate: false });
    expect(() => parseWithdrawResult(null)).toThrow('MALFORMED_TOURNAMENT_WITHDRAW');
  });
});

// ── Gating and arranging ────────────────────────────────────────────────────

describe('the switch', () => {
  it('is on only when the branch says true', () => {
    expect(tournamentsEnabled({ tournaments_enabled: true })).toBe(true);
    expect(tournamentsEnabled({ tournaments_enabled: false })).toBe(false);
    expect(tournamentsEnabled({})).toBe(false);
    expect(tournamentsEnabled(null)).toBe(false);
    expect(anyTournaments([{ tournaments_enabled: false }, { tournaments_enabled: true }])).toBe(
      true,
    );
    expect(anyTournaments([{}])).toBe(false);
    expect(anyTournaments(undefined)).toBe(false);
  });
});

describe('the list', () => {
  const pub = parseTournamentsPublic(
    tournamentsPublicFixture({
      tournaments: [
        tournamentListItemFixture({ id: 'late', starts_at: '2026-10-09T18:00:00Z', mine: null }),
        tournamentListItemFixture({ id: 'soon', starts_at: '2026-10-05T18:00:00Z' }),
        tournamentListItemFixture({
          id: 'done',
          status: 'finished',
          starts_at: '2026-10-01T18:00:00Z',
        }),
        tournamentListItemFixture({
          id: 'left',
          starts_at: '2026-10-06T18:00:00Z',
          mine: { entry_id: 'x', status: 'withdrawn', waitlist_position: null },
        }),
      ],
    }),
  );

  it('Upcoming lists what is not finished, soonest first', () => {
    expect(tournamentRows(pub, 'upcoming').map((t) => t.id)).toEqual(['soon', 'left', 'late']);
  });

  it('Mine lists every live own entry, finished ones included, never a withdrawal', () => {
    expect(tournamentRows(pub, 'mine').map((t) => t.id)).toEqual(['done', 'soon']);
    expect(isOwnEntry(null)).toBe(false);
    expect(isOwnEntry({ entryId: 'e', status: 'no_show', waitlistPosition: null })).toBe(true);
  });

  it('opens on Mine only when asked', () => {
    expect(filterFromParam('mine')).toBe('mine');
    expect(filterFromParam(undefined)).toBe('upcoming');
    expect(filterFromParam(['mine'])).toBe('upcoming');
  });

  it('reads times in the row’s branch zone', () => {
    expect(timezoneOf(pub, pub.tournaments[0]!.venueId)).toBe('Asia/Baghdad');
    expect(timezoneOf(pub, 'elsewhere')).toBe('Asia/Baghdad');
  });
});

describe('names and players', () => {
  const labels = { former: 'Former player', numbered: (no: string) => `Player ${no}` };

  it('a player reads their name, "Former player", or "Player n" (§1.8)', () => {
    expect(playerLabel({ name: 'Ali K.', former: false, no: 1 }, labels)).toBe('Ali K.');
    expect(playerLabel({ name: 'Ali K.', former: true, no: 1 }, labels)).toBe('Former player');
    expect(playerLabel({ name: null, former: false, no: 7 }, labels)).toBe('Player 7');
    expect(playerLabel({ name: null, former: false, no: null }, labels)).toBe('Player ?');
  });

  it('names and prizes follow the screen language, the other as a fallback', () => {
    expect(tournamentName({ nameEn: 'Cup', nameAr: 'كأس' }, 'ar')).toBe('كأس');
    expect(tournamentName({ nameEn: 'Cup', nameAr: null }, 'ar')).toBe('Cup');
    expect(tournamentName({ nameEn: null, nameAr: null }, 'en')).toBe('');
    expect(prizeText({ prizeEn: null, prizeAr: 'مضرب' }, 'en')).toBe('مضرب');
    expect(prizeText({ prizeEn: null, prizeAr: null }, 'en')).toBeNull();
  });
});

describe('what the detail offers', () => {
  const now = Date.now();
  const open = (over: Record<string, unknown> = {}) =>
    parseTournamentPublic(openTournamentFixture(over), TOUR_ID);

  it('Register while open with a place left, the waitlist when full, nothing when that is full too', () => {
    expect(tourActionOf(open(), now)).toBe('register');
    expect(tourActionOf(open({ places_left: 0 }), now)).toBe('waitlist');
    expect(tourActionOf(open({ places_left: 0, waitlist_open: false }), now)).toBe('full');
  });

  it('Withdraw for a registered or waitlisted guest', () => {
    const me = (status: string) => ({ entry_id: 'e', status, waitlist_position: 1, owed_iqd: 0 });
    expect(tourActionOf(open({ me: me('registered') }), now)).toBe('withdraw');
    expect(tourActionOf(open({ me: me('waitlisted'), places_left: 0 }), now)).toBe('withdraw');
    expect(tourActionOf(open({ me: me('withdrawn') }), now)).toBe('register');
  });

  it('nothing past the cut-off or once registration is no longer open', () => {
    const past = new Date(now - 60_000).toISOString();
    expect(tourActionOf(open({ registration_closes_at: past }), now)).toBe('closed');
    for (const status of ['closed', 'running', 'finished', 'cancelled']) {
      expect(tourActionOf(open({ status }), now), status).toBe('closed');
    }
  });

  it('polls only while play is under way, and shows play once a schedule exists', () => {
    const running = parseTournamentPublic(tournamentPublicFixture(), TOUR_ID);
    expect(isLive(running)).toBe(true);
    expect(isLive(open())).toBe(false);
    expect(isLive(parseTournamentPublic({ missing: true }, TOUR_ID))).toBe(false);
    expect(isLive(undefined)).toBe(false);
    expect(showsPlay(running)).toBe(true);
    expect(showsPlay(open())).toBe(false);
    expect(showsPlay(parseTournamentPublic(tournamentPublicFixture({ rounds: [] }), TOUR_ID))).toBe(
      false,
    );
  });
});

describe('where the registration stands (tourPlacesOf)', () => {
  const row = (over: Parameters<typeof tournamentListItemFixture>[0]) =>
    parseTournamentsPublic(
      tournamentsPublicFixture({ tournaments: [tournamentListItemFixture(over)] }),
    ).tournaments[0]!;

  it('counts the places, then the waitlist, then full, while registration is open', () => {
    expect(tourPlacesOf(row({ status: 'open', places_left: 4 }))).toEqual({
      kind: 'left',
      count: 4,
    });
    expect(tourPlacesOf(row({ status: 'open', places_left: 0, waitlist_open: true }))).toEqual({
      kind: 'waitlist',
    });
    expect(tourPlacesOf(row({ status: 'open', places_left: 0, waitlist_open: false }))).toEqual({
      kind: 'full',
    });
  });

  it('reads the state once closed, though the server still counts places (12 of 16 at the cut-off)', () => {
    expect(tourPlacesOf(row({ status: 'closed', places_left: 4 }))).toEqual({
      kind: 'status',
      status: 'closed',
    });
    expect(tourPlacesOf(row({ status: 'running', places_left: 4 }))).toEqual({
      kind: 'status',
      status: 'running',
    });
  });
});

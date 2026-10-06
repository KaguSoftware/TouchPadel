/**
 * The tournament reads as the SERVER answers them (snake_case, every key of `TOURNAMENT_SHAPES`,
 * packages/core/src/tournaments/shapes.ts), for the parser tests (vitest) and the smoke renders
 * (jest, which seed the PARSED shapes: `parseX(xFixture())`). Each fixture carries every key its
 * shape lists, every nullable object filled in, so `tourMissingKeys(fixture, shape)` is empty and
 * a parser that read a key the shape does not list would be caught
 * (features/tournaments/__tests__/logic.test.ts).
 *
 * PURE: no react-native, no expo. Times are relative to now, so a fixture never goes stale.
 */
export const TOUR_VENUE_ID = 'c0000000-0000-4000-8000-000000000001';
export const TOUR_ID = '70a70000-0000-4000-8000-000000000001';
export const TOUR_ID_2 = '70a70000-0000-4000-8000-000000000002';
export const TOUR_ENTRY_ID = '70a70000-0000-4000-8000-0000000000e1';

const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

const branch = () => ({
  venue_id: TOUR_VENUE_ID,
  name_en: 'Touch Padel',
  name_ar: 'تاتش بادل',
  timezone: 'Asia/Baghdad',
});

const player = (name: string | null, no: number, former = false) => ({ name, former, no });

/** One `tournaments_public` row: open, places left, starting in two days. */
export function tournamentListItemFixture(over: Record<string, unknown> = {}) {
  return {
    id: TOUR_ID,
    venue_id: TOUR_VENUE_ID,
    name_en: 'Friday Americano',
    name_ar: 'أمريكانو الجمعة',
    format: 'americano',
    category: 'open',
    starts_at: at(48),
    ends_at: at(51),
    registration_closes_at: at(24),
    entry_fee_iqd: 15000,
    prize_en: 'Rackets for the winners',
    prize_ar: 'مضارب للفائزين',
    max_entries: 16,
    places_left: 6,
    waitlist_open: true,
    status: 'open',
    mine: { entry_id: TOUR_ENTRY_ID, status: 'registered', waitlist_position: null },
    ...over,
  };
}

/** `tournaments_public(null)`: one live branch, two tournaments (one entered). */
export function tournamentsPublicFixture(over: Record<string, unknown> = {}) {
  return {
    off: false,
    server_now: new Date().toISOString(),
    branches: [branch()],
    tournaments: [
      tournamentListItemFixture(),
      tournamentListItemFixture({
        id: TOUR_ID_2,
        name_en: 'Women’s Mexicano',
        name_ar: 'مكسيكانو السيدات',
        format: 'mexicano',
        category: 'women',
        starts_at: at(72),
        ends_at: at(75),
        registration_closes_at: at(60),
        places_left: 0,
        mine: null,
      }),
    ],
    ...over,
  };
}

/**
 * `tournament_public` for a tournament in play: a scored first round, standings, and the guest's
 * own registered entry with money owed. `over` replaces top-level keys (an open tournament with
 * no entry is `{status: 'open', me: null, rounds: [], standings: []}`).
 */
export function tournamentPublicFixture(over: Record<string, unknown> = {}) {
  return {
    missing: false,
    id: TOUR_ID,
    venue_id: TOUR_VENUE_ID,
    branch: branch(),
    name_en: 'Friday Americano',
    name_ar: 'أمريكانو الجمعة',
    format: 'americano',
    category: 'open',
    points_target: 24,
    rounds_planned: 7,
    starts_at: at(-1),
    ends_at: at(2),
    registration_closes_at: at(-3),
    entry_fee_iqd: 15000,
    prize_en: 'Rackets for the winners',
    prize_ar: 'مضارب للفائزين',
    status: 'running',
    max_entries: 16,
    entries_count: 5,
    places_left: 11,
    waitlist_open: true,
    server_now: new Date().toISOString(),
    rounds: [
      {
        round_no: 1,
        sit_out: [player(null, 5)],
        matches: [
          {
            court_no: 1,
            a: [player('Ali K.', 1), player('Sara M.', 2)],
            b: [player('Omar H.', 3), player(null, 4, true)],
            points_a: 15,
            points_b: 9,
          },
        ],
      },
    ],
    standings: [
      {
        rank: 1,
        player: player('Ali K.', 1),
        points_won: 15,
        diff: 6,
        played: 1,
        withdrawn: false,
      },
      {
        rank: 1,
        player: player('Sara M.', 2),
        points_won: 15,
        diff: 6,
        played: 1,
        withdrawn: false,
      },
      { rank: 3, player: player(null, 5), points_won: 12, diff: 0, played: 0, withdrawn: false },
      // 0311 (c27): a no-show, ranked after every registered entry.
      {
        rank: 1,
        player: player('Huda R.', 4),
        points_won: 9,
        diff: -6,
        played: 1,
        withdrawn: true,
      },
    ],
    me: { entry_id: TOUR_ENTRY_ID, status: 'registered', waitlist_position: null, owed_iqd: 15000 },
    ...over,
  };
}

/** An open tournament, before the cut-off, places left, the guest not entered. */
export function openTournamentFixture(over: Record<string, unknown> = {}) {
  return tournamentPublicFixture({
    status: 'open',
    starts_at: at(48),
    ends_at: at(51),
    registration_closes_at: at(24),
    entries_count: 10,
    places_left: 6,
    rounds: [],
    standings: [],
    me: null,
    ...over,
  });
}

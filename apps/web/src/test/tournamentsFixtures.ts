import {
  parseTournamentPublic,
  parseTournamentsPublic,
  tournamentsStatus,
  type TournamentPageRead,
  type TournamentsRead,
} from '@/lib/tournaments';

/**
 * `app.tournaments_public` / `app.tournament_public` answers for the tournament tests (build
 * contracts §1.8): raw jsonb as the server sends it, built on the read contracts' key lists
 * (`TOURNAMENT_SHAPES`; tournaments.test.ts holds the fixtures to them, so a fixture missing a key
 * fails its own test).
 *
 * Every answer also carries what a page must NEVER print, should a server ever send it: a guest
 * id, a phone, a full name, a court id (§1.8, T-8). The tests scan the rendered HTML for these
 * values. Invented names, like src/test/fixtures.ts. Ids are uuids: a tournament's builds its
 * `/events/` link.
 */
export const BRANCH_A = 'c0000000-0000-4000-8000-000000000001';
export const BRANCH_B = 'c0000000-0000-4000-8000-000000000002';

export const TOUR_FRIDAY = 'e0000000-0000-4000-8000-0000000000a1';
export const TOUR_WOMEN = 'e0000000-0000-4000-8000-0000000000a2';
export const TOUR_RUNNING = 'e0000000-0000-4000-8000-0000000000a3';
export const TOUR_FINISHED = 'e0000000-0000-4000-8000-0000000000a4';
export const TOUR_FULL = 'e0000000-0000-4000-8000-0000000000a5';

/** Values that must never reach a rendered page: guest ids, phones, full names, court ids. */
export const NEVER_SHOWN = [
  'f9f9f9f9-1111-4222-8333-999999999999', // a guest id
  '7701234567', // a guest phone
  'Saleh', // a family name (the page shows "First I.")
  'Kareem', // another
  'd1d1d1d1-0000-4000-8000-00000000c0c1', // a court id
];

export const FEE_IQD = 25000;

const branch = (venueId: string, nameEn: string, nameAr: string) => ({
  venue_id: venueId,
  name_en: nameEn,
  name_ar: nameAr,
  timezone: 'Asia/Baghdad',
});

interface CardOverrides {
  id: string;
  name_en: string;
  name_ar: string;
  status?: string;
  starts_at: string;
  category?: string;
  format?: string;
  entry_fee_iqd?: number;
  places_left?: number;
  waitlist_open?: boolean;
  venue_id?: string;
}

function card(o: CardOverrides): Record<string, unknown> {
  const start = Date.parse(o.starts_at);
  return {
    id: o.id,
    venue_id: o.venue_id ?? BRANCH_A,
    name_en: o.name_en,
    name_ar: o.name_ar,
    format: o.format ?? 'americano',
    category: o.category ?? 'open',
    starts_at: o.starts_at,
    ends_at: new Date(start + 4 * 3600_000).toISOString(),
    registration_closes_at: new Date(start - 24 * 3600_000).toISOString(),
    entry_fee_iqd: o.entry_fee_iqd ?? FEE_IQD,
    prize_en: 'A racket for the winners',
    prize_ar: 'مضرب للفائزين',
    max_entries: 16,
    places_left: o.places_left ?? 5,
    waitlist_open: o.waitlist_open ?? true,
    status: o.status ?? 'open',
    mine: null,
    // Never public: a server that ever sent these must not reach the markup.
    court_id: 'd1d1d1d1-0000-4000-8000-00000000c0c1',
    guest_id: 'f9f9f9f9-1111-4222-8333-999999999999',
  };
}

/**
 * The list answer: two branches; an open Americano (paid), a women's Mexicano (free), one in
 * play, one full with the waitlist open, and one finished this week. Out of date order on purpose.
 */
export function tournamentsAnswer({ only }: { only?: readonly string[] } = {}): Record<
  string,
  unknown
> {
  const all = [
    card({
      id: TOUR_WOMEN,
      name_en: 'Women’s Mexicano',
      name_ar: 'مكسيكانو السيدات',
      format: 'mexicano',
      category: 'women',
      starts_at: '2026-10-16T15:00:00+00:00',
      entry_fee_iqd: 0,
      places_left: 9,
      venue_id: BRANCH_B,
    }),
    card({
      id: TOUR_FRIDAY,
      name_en: 'Friday Americano',
      name_ar: 'أمريكانو الجمعة',
      starts_at: '2026-10-09T15:00:00+00:00',
    }),
    card({
      id: TOUR_RUNNING,
      name_en: 'Club Night',
      name_ar: 'ليلة النادي',
      status: 'running',
      starts_at: '2026-10-03T15:00:00+00:00',
      places_left: 0,
    }),
    card({
      id: TOUR_FINISHED,
      name_en: 'Last Week Cup',
      name_ar: 'كأس الأسبوع الماضي',
      status: 'finished',
      starts_at: '2026-09-30T15:00:00+00:00',
      places_left: 0,
    }),
    card({
      id: TOUR_FULL,
      name_en: 'Sold Out Smash',
      name_ar: 'سماش المكتمل',
      starts_at: '2026-10-12T15:00:00+00:00',
      places_left: 0,
      waitlist_open: true,
    }),
  ];
  return {
    off: false,
    server_now: '2026-10-03T12:00:00+00:00',
    branches: [
      branch(BRANCH_A, 'Fixture Padel', 'بادل التجربة'),
      branch(BRANCH_B, 'Fixture Padel Two', 'بادل التجربة الثاني'),
    ],
    tournaments: only ? all.filter((t) => only.includes(t.id as string)) : all,
  };
}

const player = (name: string | null, no: number, former = false) => ({
  name,
  former,
  no,
  // Never public (§1.8).
  guest_id: 'f9f9f9f9-1111-4222-8333-999999999999',
  full_name: name ? `${name.split(' ')[0]} Saleh` : 'Hidden Kareem',
  phone: '+9647701234567',
});

/** The eight players of the page fixture: "First I." names, one former account, one "Player 7". */
const P = [
  player('Aya S.', 1),
  player('Basma K.', 2),
  player('Celine N.', 3),
  player('Dalia H.', 4),
  player('Eman J.', 5),
  player(null, 6, true),
  player(null, 7),
  player('Hala Q.', 8),
];

/**
 * The page answer: a running Americano with one scored round, one unplayed round, and the
 * standings after round 1. `status` changes the state only; `rounds: false` is the answer before
 * the draw (no schedule, so no names: §1.8); `serverNow` is the read's clock (the cut-off is
 * 2026-10-02 15:00 UTC).
 */
export function tournamentAnswer({
  status = 'running',
  rounds = true,
  serverNow = '2026-10-03T16:00:00+00:00',
}: { status?: string; rounds?: boolean; serverNow?: string } = {}): Record<string, unknown> {
  return {
    missing: false,
    id: TOUR_RUNNING,
    venue_id: BRANCH_A,
    branch: branch(BRANCH_A, 'Fixture Padel', 'بادل التجربة'),
    name_en: 'Club Night',
    name_ar: 'ليلة النادي',
    format: 'americano',
    category: 'open',
    points_target: 24,
    rounds_planned: 7,
    starts_at: '2026-10-03T15:00:00+00:00',
    ends_at: '2026-10-03T19:00:00+00:00',
    registration_closes_at: '2026-10-02T15:00:00+00:00',
    entry_fee_iqd: FEE_IQD,
    prize_en: 'A racket for the winners',
    prize_ar: 'مضرب للفائزين',
    status,
    ...(status === 'cancelled' ? { cancel_reason: 'under_filled' } : {}),
    max_entries: 8,
    entries_count: 8,
    places_left: 0,
    waitlist_open: false,
    server_now: serverNow,
    rounds: rounds
      ? [
          {
            round_no: 2,
            sit_out: [],
            matches: [
              { court_no: 2, a: [P[1], P[3]], b: [P[5], P[7]], points_a: null, points_b: null },
              { court_no: 1, a: [P[0], P[2]], b: [P[4], P[6]], points_a: null, points_b: null },
            ],
          },
          {
            round_no: 1,
            sit_out: [],
            matches: [
              {
                court_no: 1,
                a: [P[0], P[1]],
                b: [P[2], P[3]],
                points_a: 15,
                points_b: 9,
                court_id: 'd1d1d1d1-0000-4000-8000-00000000c0c1',
              },
              { court_no: 2, a: [P[4], P[5]], b: [P[6], P[7]], points_a: 12, points_b: 12 },
            ],
          },
        ]
      : [],
    standings: rounds
      ? [
          { rank: 1, player: P[0], points_won: 15, diff: 6, played: 1, entry_id: 'x' },
          { rank: 1, player: P[1], points_won: 15, diff: 6, played: 1 },
          { rank: 3, player: P[4], points_won: 12, diff: 0, played: 1 },
          { rank: 3, player: P[5], points_won: 12, diff: 0, played: 1 },
          { rank: 3, player: P[6], points_won: 12, diff: 0, played: 1 },
          { rank: 3, player: P[7], points_won: 12, diff: 0, played: 1 },
          { rank: 7, player: P[2], points_won: 9, diff: -6, played: 1 },
          { rank: 7, player: P[3], points_won: 9, diff: -6, played: 1 },
        ]
      : [],
    me: null,
  };
}

/** A list answer as the server read hands it to a page. */
export function tournamentsRead(raw: unknown): TournamentsRead {
  const parsed = parseTournamentsPublic(raw);
  if (!parsed) return { status: 'error', tournaments: null };
  const status = tournamentsStatus(parsed);
  return { status, tournaments: status === 'off' ? null : parsed };
}

/** A page answer as the server read hands it to the page. */
export function tournamentRead(raw: unknown): TournamentPageRead {
  return parseTournamentPublic(raw) ?? { status: 'error', tournament: null };
}

export const TOURNAMENTS_OFF: TournamentsRead = { status: 'off', tournaments: null };
export const TOURNAMENTS_ERROR: TournamentsRead = { status: 'error', tournaments: null };
export const TOURNAMENT_MISSING: TournamentPageRead = { status: 'missing', tournament: null };
export const TOURNAMENT_ERROR: TournamentPageRead = { status: 'error', tournament: null };

/**
 * What the mocked `@/lib/tournaments.server` answers. Pages read it through the mock in their
 * test, so a case sets `tournamentsServer.list` / `.page` and renders. `calls` counts page reads.
 */
export const tournamentsServer: {
  list: TournamentsRead;
  page: TournamentPageRead;
  calls: number;
  ids: string[];
} = { list: TOURNAMENTS_OFF, page: TOURNAMENT_MISSING, calls: 0, ids: [] };

export function resetTournamentsServer(
  list: TournamentsRead = TOURNAMENTS_OFF,
  page: TournamentPageRead = TOURNAMENT_MISSING,
): void {
  tournamentsServer.list = list;
  tournamentsServer.page = page;
  tournamentsServer.calls = 0;
  tournamentsServer.ids = [];
}

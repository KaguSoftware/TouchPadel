import { describe, expect, it } from 'vitest';
import { TOURNAMENT_SHAPES, tourMissingKeys } from '@touch/core/tournaments';
import { formatIQD, t } from '@touch/i18n';
import {
  BRANCH_A,
  BRANCH_B,
  FEE_IQD,
  NEVER_SHOWN,
  TOUR_FINISHED,
  TOUR_FRIDAY,
  TOUR_FULL,
  TOUR_RUNNING,
  TOUR_WOMEN,
  tournamentAnswer,
  tournamentsAnswer,
} from '@/test/tournamentsFixtures';
import {
  WEB_DROPPED_KEYS,
  appTournamentHref,
  branchOf,
  feeLine,
  formatLine,
  parseTournamentId,
  parseTournamentPublic,
  parseTournamentsPublic,
  placesLine,
  registrationOpen,
  playerLabel,
  signedDiff,
  teamLabel,
  tournamentName,
  tournamentPath,
  tournamentPrize,
  tournamentWhen,
  tournamentsStatus,
  upcomingTournaments,
  type PublicTournament,
  type PublicTournaments,
} from './tournaments';

/**
 * The website's tournament parser (build contracts §1.8, T-8): the contract's keys and nothing a
 * server adds, no guest id / phone / full name / court id at any depth, every fallback, and the
 * words the cards and the page print.
 */
const LIST = TOURNAMENT_SHAPES.tournaments_public;
const PAGE = TOURNAMENT_SHAPES.tournament_public;

const nestedKeys = (shape: { nested?: Record<string, readonly string[]> }, path: string) =>
  [...(shape.nested?.[path] ?? [])].sort();

const without = (keys: readonly string[], drop: readonly string[]) =>
  keys.filter((k) => !drop.includes(k)).sort();

const list = (raw: unknown = tournamentsAnswer()): PublicTournaments => {
  const parsed = parseTournamentsPublic(raw);
  if (!parsed) throw new Error('fixture unreadable');
  return parsed;
};

const page = (raw: unknown = tournamentAnswer()): PublicTournament => {
  const read = parseTournamentPublic(raw);
  if (read?.status !== 'ok' || !read.tournament) throw new Error('fixture not ok');
  return read.tournament;
};

const plain = (s: string) => s.replace(/[⁦-⁩]/g, '');

describe('the fixtures', () => {
  it('carry every key of the read contracts (a fixture missing one fails here)', () => {
    expect(tourMissingKeys(tournamentsAnswer(), LIST)).toEqual([]);
    expect(tourMissingKeys(tournamentAnswer(), PAGE)).toEqual([]);
    expect(tourMissingKeys(tournamentAnswer({ rounds: false }), PAGE)).toEqual([]);
  });
});

describe('parseTournamentsPublic', () => {
  it('keeps exactly the read contract’s keys on every row (less mine), and nothing a server adds', () => {
    const l = list();
    expect(Object.keys(l).sort()).toEqual([...LIST.keys].sort());
    for (const b of l.branches)
      expect(Object.keys(b).sort()).toEqual(nestedKeys(LIST, 'branches[]'));
    expect(l.tournaments).toHaveLength(5);
    for (const row of l.tournaments) {
      expect(Object.keys(row).sort()).toEqual(
        without(LIST.nested['tournaments[]'], WEB_DROPPED_KEYS.tournaments_public),
      );
    }
    const text = JSON.stringify(l);
    for (const secret of [...NEVER_SHOWN, 'court_id', 'guest_id', 'mine']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('sorts soonest first, and finds each row’s branch', () => {
    const l = list();
    expect(l.tournaments.map((r) => r.id)).toEqual([
      TOUR_FINISHED,
      TOUR_RUNNING,
      TOUR_FRIDAY,
      TOUR_FULL,
      TOUR_WOMEN,
    ]);
    expect(branchOf(l, BRANCH_B)?.name_en).toBe('Fixture Padel Two');
    expect(branchOf(l, 'c0000000-0000-4000-8000-00000000ffff')).toBeNull();
  });

  it('lists the upcoming ones (open, closed, in play), never the finished or cancelled', () => {
    const raw = tournamentsAnswer();
    const rows = raw.tournaments as Record<string, unknown>[];
    rows.push({ ...rows[1], id: 'e0000000-0000-4000-8000-0000000000b9', status: 'cancelled' });
    rows.push({ ...rows[1], id: 'e0000000-0000-4000-8000-0000000000b8', status: 'closed' });
    const ids = upcomingTournaments(list(raw)).map((r) => r.id);
    expect(ids).toContain(TOUR_RUNNING);
    expect(ids).toContain('e0000000-0000-4000-8000-0000000000b8');
    expect(ids).not.toContain(TOUR_FINISHED);
    expect(ids).not.toContain('e0000000-0000-4000-8000-0000000000b9');
  });

  it('is ok with an upcoming one, empty with none (a finished one only), off when off', () => {
    expect(tournamentsStatus(list())).toBe('ok');
    expect(tournamentsStatus(list(tournamentsAnswer({ only: [TOUR_FINISHED] })))).toBe('empty');
    expect(tournamentsStatus(list(tournamentsAnswer({ only: [] })))).toBe('empty');
    const off = list({ off: true, server_now: null });
    expect(off).toEqual({ off: true, server_now: null, branches: [], tournaments: [] });
    expect(tournamentsStatus(off)).toBe('off');
  });

  it('falls back instead of throwing: unknown enums and bad ids drop the row, missing fields default', () => {
    const base = (tournamentsAnswer().tournaments as Record<string, unknown>[])[1]!;
    const l = list({
      off: false,
      branches: [{ name_en: 'no id' }, 'nope'],
      tournaments: [
        { ...base, status: 'paused' },
        { ...base, format: 'knockout' },
        { ...base, category: 'mixed' },
        { ...base, id: 'not-a-uuid' },
        { ...base, starts_at: 'soon' },
        { ...base, name_en: '', name_ar: '' },
        'a string',
        {
          id: TOUR_FRIDAY.toUpperCase(),
          venue_id: BRANCH_A,
          name_en: 'Bare',
          format: 'mexicano',
          category: 'men',
          status: 'open',
          starts_at: '2026-10-09T15:00:00+00:00',
          entry_fee_iqd: -5,
          places_left: 2.5,
          waitlist_open: 'yes',
        },
      ],
    });
    expect(l.branches).toEqual([]);
    expect(l.server_now).toBeNull();
    expect(l.tournaments).toHaveLength(1);
    expect(l.tournaments[0]).toMatchObject({
      id: TOUR_FRIDAY,
      name_ar: '',
      ends_at: '2026-10-09T15:00:00+00:00',
      registration_closes_at: null,
      entry_fee_iqd: 0,
      places_left: 0,
      waitlist_open: false,
      prize_en: '',
    });
  });

  it('is null only for an answer that is not an object', () => {
    for (const raw of [null, undefined, 'x', 3, []]) expect(parseTournamentsPublic(raw)).toBeNull();
    expect(parseTournamentsPublic({})).toEqual({
      off: false,
      server_now: null,
      branches: [],
      tournaments: [],
    });
  });
});

describe('parseTournamentPublic', () => {
  it('keeps exactly the read contract’s keys at every depth (less me and missing)', () => {
    const p = page();
    expect(Object.keys(p).sort()).toEqual(without(PAGE.keys, WEB_DROPPED_KEYS.tournament_public));
    expect(Object.keys(p.branch!).sort()).toEqual(nestedKeys(PAGE, 'branch'));
    for (const round of p.rounds) {
      expect(Object.keys(round).sort()).toEqual(nestedKeys(PAGE, 'rounds[]'));
      for (const m of round.matches) {
        expect(Object.keys(m).sort()).toEqual(nestedKeys(PAGE, 'rounds[].matches[]'));
        for (const pl of [...m.a, ...m.b])
          expect(Object.keys(pl).sort()).toEqual(nestedKeys(PAGE, 'rounds[].matches[].a[]'));
      }
    }
    for (const s of p.standings) {
      expect(Object.keys(s).sort()).toEqual(nestedKeys(PAGE, 'standings[]'));
      expect(Object.keys(s.player).sort()).toEqual(nestedKeys(PAGE, 'standings[].player'));
    }
    const text = JSON.stringify(p);
    for (const secret of [
      ...NEVER_SHOWN,
      'court_id',
      'guest_id',
      'full_name',
      'phone',
      'entry_id',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('orders rounds, courts and standings, and keeps a shared rank', () => {
    const p = page();
    expect(p.rounds.map((r) => r.round_no)).toEqual([1, 2]);
    expect(p.rounds[1]!.matches.map((m) => m.court_no)).toEqual([1, 2]);
    expect(p.standings.map((s) => s.rank)).toEqual([1, 1, 3, 3, 3, 3, 7, 7]);
    expect(p.standings[6]!.diff).toBe(-6);
    expect(p.rounds[1]!.matches[0]!.points_a).toBeNull();
  });

  it('reads {missing: true}, and an answer it cannot place, as missing', () => {
    expect(parseTournamentPublic({ missing: true })).toEqual({
      status: 'missing',
      tournament: null,
    });
    expect(parseTournamentPublic({ ...tournamentAnswer(), status: 'paused' })?.status).toBe(
      'missing',
    );
    expect(parseTournamentPublic({ ...tournamentAnswer(), id: 'x' })?.status).toBe('missing');
    for (const raw of [null, 'x', 7, []]) expect(parseTournamentPublic(raw)).toBeNull();
  });

  it('drops a match without two full teams, and a half score', () => {
    const raw = tournamentAnswer();
    const rounds = raw.rounds as { matches: Record<string, unknown>[] }[];
    const first = rounds[1]!.matches[0]!;
    rounds[1]!.matches.push({ ...first, court_no: 3, b: [first.a] });
    rounds[1]!.matches.push({ ...first, court_no: 4, points_b: null });
    rounds[1]!.matches.push({ ...first, court_no: 0 });
    const p = page(raw);
    const r1 = p.rounds[0]!;
    expect(r1.matches.map((m) => m.court_no)).toEqual([1, 2, 4]);
    expect(r1.matches[2]).toMatchObject({ points_a: null, points_b: null });
  });

  it('reads a player as their shown name, a former account, or a number', () => {
    const p = page();
    const [r1] = p.rounds;
    expect(r1!.matches[1]!.a[1]).toEqual({ name: null, former: true, no: 6 });
    expect(r1!.matches[1]!.b[0]).toEqual({ name: null, former: false, no: 7 });
    expect(r1!.matches[0]!.a[0]).toEqual({ name: 'Aya S.', former: false, no: 1 });
  });
});

describe('words', () => {
  const card = () => list().tournaments.find((r) => r.id === TOUR_FRIDAY)!;

  it('names the tournament and its prize in the page’s language, English when the Arabic is blank', () => {
    expect(tournamentName(card(), 'ar')).toBe('أمريكانو الجمعة');
    expect(tournamentName({ name_en: 'Only EN', name_ar: ' ' }, 'ar')).toBe('Only EN');
    expect(tournamentPrize(card(), 'en')).toBe('A racket for the winners');
    expect(tournamentPrize({ prize_en: '', prize_ar: '' }, 'ar')).toBe('');
  });

  it.each(['en', 'ar'] as const)('says the format, category and fee (%s)', (locale) => {
    const women = list().tournaments.find((r) => r.id === TOUR_WOMEN)!;
    expect(formatLine(women, locale)).toBe(
      `${t(locale, 'tournaments.common.format.mexicano')} · ${t(locale, 'matches.common.categoryWomen')}`,
    );
    expect(feeLine(0, locale)).toBe(t(locale, 'tournaments.common.free'));
    expect(feeLine(FEE_IQD, locale)).toBe(
      t(locale, 'tournaments.web.fee', { amount: formatIQD(FEE_IQD, locale) }),
    );
  });

  it('says places left while open, full (with or without the waitlist), else the state', () => {
    const c = card();
    expect(plain(placesLine(c, 'en'))).toBe('Places left: 5');
    expect(placesLine({ ...c, places_left: 0 }, 'en')).toBe(
      t('en', 'tournaments.web.eventsCards.full'),
    );
    expect(placesLine({ ...c, places_left: 0, waitlist_open: false }, 'en')).toBe(
      t('en', 'tournaments.web.eventsCards.fullNoWaitlist'),
    );
    for (const status of ['closed', 'running', 'finished', 'cancelled'] as const) {
      expect(placesLine({ ...c, status }, 'ar')).toBe(
        t('ar', `tournaments.common.status.${status}`),
      );
    }
  });

  it('dates the tournament in the branch’s timezone, with its end time', () => {
    // 15:00 UTC is 18:00 in Baghdad; four hours later, 22:00.
    const when = plain(tournamentWhen(card(), 'Asia/Baghdad', 'en') ?? '');
    // ICU may join the time and its PM with a narrow no-break space.
    expect(when.replace(/\s/g, ' ')).toBe('Fri Oct 9, 2026 · 6:00 PM – 10:00 PM');
    expect(tournamentWhen({ starts_at: 'x', ends_at: 'y' }, 'Asia/Baghdad', 'en')).toBeNull();
  });

  it.each(['en', 'ar'] as const)(
    'names players: "First I.", a former account, "Player n" (%s)',
    (locale) => {
      expect(plain(playerLabel({ name: 'Aya S.', former: false, no: 1 }, locale))).toBe('Aya S.');
      expect(playerLabel({ name: null, former: true, no: 6 }, locale)).toBe(
        t(locale, 'tournaments.common.formerPlayer'),
      );
      expect(plain(playerLabel({ name: null, former: false, no: 7 }, locale))).toBe(
        plain(t(locale, 'tournaments.common.player', { no: '7' })),
      );
      expect(
        plain(
          teamLabel(
            [
              { name: 'Aya S.', former: false, no: 1 },
              { name: 'Basma K.', former: false, no: 2 },
            ],
            locale,
          ),
        ),
      ).toBe(t(locale, 'tournaments.web.page.team', { one: 'Aya S.', two: 'Basma K.' }));
    },
  );

  it('signs a difference', () => {
    expect(plain(signedDiff(6))).toBe('+6');
    expect(plain(signedDiff(-4))).toBe('−4');
    expect(plain(signedDiff(0))).toBe('0');
  });
});

describe('ids and links', () => {
  it('accepts a uuid only, lower-cased', () => {
    expect(parseTournamentId(TOUR_RUNNING.toUpperCase())).toBe(TOUR_RUNNING);
    expect(parseTournamentId([TOUR_RUNNING])).toBe(TOUR_RUNNING);
    for (const bad of ['x', TOUR_RUNNING.slice(1), '"><script>', undefined]) {
      expect(parseTournamentId(bad)).toBeNull();
    }
  });

  it('builds the page and the app links', () => {
    expect(tournamentPath('ar', TOUR_RUNNING)).toBe(`/ar/events/${TOUR_RUNNING}`);
    expect(appTournamentHref(TOUR_RUNNING)).toBe(`touchpadel://tournament/${TOUR_RUNNING}`);
    expect(appTournamentHref(null)).toBe('touchpadel://');
  });
});

describe('registrationOpen', () => {
  const closes = '2026-10-08T15:00:00+00:00';

  it('is open while the status is open and the read is before the cut-off', () => {
    expect(
      registrationOpen({ status: 'open', registration_closes_at: closes }, '2026-10-08T14:59:59Z'),
    ).toBe(true);
    expect(
      registrationOpen({ status: 'open', registration_closes_at: null }, '2026-10-08T16:00:00Z'),
    ).toBe(true);
    expect(registrationOpen({ status: 'open', registration_closes_at: closes }, null)).toBe(true);
  });

  it('is shut from the cut-off, before the sweep flips the status, and for any other status', () => {
    expect(
      registrationOpen({ status: 'open', registration_closes_at: closes }, '2026-10-08T15:00:00Z'),
    ).toBe(false);
    expect(
      registrationOpen({ status: 'open', registration_closes_at: closes }, '2026-10-08T15:00:40Z'),
    ).toBe(false);
    expect(
      registrationOpen(
        { status: 'closed', registration_closes_at: closes },
        '2026-10-01T00:00:00Z',
      ),
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  isAtEntry,
  playNights,
  playScrollTarget,
  showFromParam,
  type PlayCategory,
  type PlayKind,
} from '../timeline';
import type { OpenMatch, SlotMatch } from '../../matches/logic';
import type { TourListItem } from '../../tournaments/logic';

/**
 * The Play tab's timeline (play-coaches contracts §7): open matches and
 * tournaments interleaved by start time inside each trading night, the kind and
 * category chips, the signed-out `match_slots` rows, and where `at` / `date`
 * scroll to.
 */

const match = (id: string, startAt: string, over: Partial<OpenMatch> = {}): OpenMatch => ({
  matchId: id,
  startAt,
  endAt: startAt,
  durationMin: 90,
  category: 'open',
  joinPolicy: 'open',
  status: 'filling',
  seatsTaken: 2,
  seatsLeft: 2,
  refill: false,
  fillDeadlineAt: null,
  shareIqd: 10000,
  mine: null,
  ...over,
});

const slot = (startAt: string, over: Partial<SlotMatch> = {}): SlotMatch => ({
  startAt,
  endAt: startAt,
  durationMin: 90,
  category: 'open',
  joinPolicy: 'open',
  seatsLeft: 1,
  mine: false,
  ...over,
});

const tour = (id: string, startsAt: string, over: Partial<TourListItem> = {}): TourListItem => ({
  id,
  venueId: 'v',
  nameEn: id,
  nameAr: null,
  format: 'americano',
  category: 'open',
  startsAt,
  endsAt: null,
  registrationClosesAt: null,
  entryFeeIqd: 0,
  prizeEn: null,
  prizeAr: null,
  maxEntries: 16,
  placesLeft: 4,
  waitlistOpen: false,
  status: 'open',
  mine: null,
  ...over,
});

/** A plain UTC night: the date part of the instant. */
const nightOf = (iso: string) => iso.slice(0, 10);

const nights = (
  over: {
    matches?: OpenMatch[];
    slots?: SlotMatch[];
    tournaments?: TourListItem[];
    kind?: PlayKind;
    category?: PlayCategory;
    today?: string;
  } = {},
) =>
  playNights({
    matches: over.matches ?? [],
    slots: over.slots ?? [],
    tournaments: over.tournaments ?? [],
    kind: over.kind ?? 'all',
    category: over.category ?? 'all',
    nightOf,
    today: over.today ?? '2026-10-11',
  });

const keys = (ns: ReturnType<typeof nights>) => ns.map((n) => n.entries.map((e) => e.key));

describe('showFromParam', () => {
  it('reads matches and tournaments, and everything else as All', () => {
    expect(showFromParam('matches')).toBe('matches');
    expect(showFromParam('tournaments')).toBe('tournaments');
    expect(showFromParam('mine')).toBe('all');
    expect(showFromParam(undefined)).toBe('all');
    expect(showFromParam(['matches'])).toBe('all');
  });
});

describe('playNights', () => {
  const ALL = {
    matches: [match('m2', '2026-10-12T19:00:00.000Z'), match('m1', '2026-10-11T18:00:00.000Z')],
    tournaments: [tour('t1', '2026-10-11T17:00:00.000Z'), tour('t2', '2026-10-12T19:00:00.000Z')],
  };

  it('interleaves matches and tournaments by start time, night by night', () => {
    const ns = nights(ALL);
    expect(ns.map((n) => n.key)).toEqual(['2026-10-11', '2026-10-12']);
    // A tournament first at a shared minute.
    expect(keys(ns)).toEqual([
      ['t1', 'm1'],
      ['t2', 'm2'],
    ]);
    expect(ns.map((n) => [n.matches, n.tournaments])).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it('narrows to one kind', () => {
    expect(keys(nights({ ...ALL, kind: 'matches' }))).toEqual([['m1'], ['m2']]);
    expect(keys(nights({ ...ALL, kind: 'tournaments' }))).toEqual([['t1'], ['t2']]);
  });

  it('narrows both kinds to one category', () => {
    const ns = nights({
      matches: [match('mw', '2026-10-11T18:00:00.000Z', { category: 'women' })],
      tournaments: [
        tour('tw', '2026-10-11T19:00:00.000Z', { category: 'women' }),
        tour('to', '2026-10-11T20:00:00.000Z'),
      ],
      category: 'women',
    });
    expect(keys(ns)).toEqual([['mw', 'tw']]);
  });

  it('keeps signed-out slots with a seat left, told apart at one minute', () => {
    const at = '2026-10-11T18:00:00.000Z';
    const ns = nights({
      slots: [slot(at), slot(at, { category: 'men' }), slot(at, { seatsLeft: 0 })],
    });
    const atMs = Date.parse(at);
    expect(keys(ns)).toEqual([[`${atMs}-0`, `${atMs}-1`]]);
    expect(ns[0]!.entries.every((e) => e.kind === 'slot')).toBe(true);
  });

  it('files a tournament still in play from an earlier night under tonight', () => {
    const ns = nights({
      tournaments: [tour('running', '2026-10-10T17:00:00.000Z', { status: 'running' })],
      matches: [match('m', '2026-10-11T18:00:00.000Z')],
    });
    expect(ns.map((n) => n.key)).toEqual(['2026-10-11']);
    expect(keys(ns)).toEqual([['running', 'm']]);
  });

  it('is empty with nothing to show', () => {
    expect(nights()).toEqual([]);
    expect(nights({ ...ALL, kind: 'tournaments', category: 'men' })).toEqual([]);
  });
});

describe('playScrollTarget and isAtEntry', () => {
  const ns = nights({
    matches: [match('a', '2026-10-11T18:00:00.000Z'), match('b', '2026-10-12T19:00:00.000Z')],
    tournaments: [tour('t', '2026-10-12T17:00:00.000Z')],
  });

  it('finds the match at `at`, never a tournament at that minute', () => {
    expect(playScrollTarget(ns, { atMs: Date.parse('2026-10-12T19:00:00.000Z'), date: null })).toEqual({
      sectionIndex: 1,
      itemIndex: 1,
    });
    expect(playScrollTarget(ns, { atMs: Date.parse('2026-10-12T17:00:00.000Z'), date: null })).toBeNull();
    expect(isAtEntry(ns[1]!.entries[0]!, Date.parse('2026-10-12T17:00:00.000Z'))).toBe(false);
    expect(isAtEntry(ns[1]!.entries[1]!, Date.parse('2026-10-12T19:00:00.000Z'))).toBe(true);
  });

  it('finds the night `date` names, and nothing for a night with no rows', () => {
    expect(playScrollTarget(ns, { atMs: NaN, date: '2026-10-12' })).toEqual({
      sectionIndex: 1,
      itemIndex: 0,
    });
    expect(playScrollTarget(ns, { atMs: NaN, date: '2026-10-20' })).toBeNull();
    expect(playScrollTarget(ns, { atMs: NaN, date: null })).toBeNull();
  });
});

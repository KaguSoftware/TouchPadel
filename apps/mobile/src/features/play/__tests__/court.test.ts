import { describe, expect, it } from 'vitest';
import { nextOpenSeat, playCourt } from '../court';
import { playNights, type PlayCategory, type PlayKind } from '../timeline';
import type { OpenMatch, SlotMatch } from '../../matches/logic';
import type { TourListItem } from '../../tournaments/logic';

/**
 * The Play tab's court (join.ts): the next open match on the timeline, as a
 * seat count, or what the court shows when there is none.
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

const tour = (id: string, startsAt: string): TourListItem => ({
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
});

const NOW = Date.parse('2026-10-12T15:00:00Z');

const nights = (
  over: {
    matches?: OpenMatch[];
    slots?: SlotMatch[];
    tournaments?: TourListItem[];
    kind?: PlayKind;
    category?: PlayCategory;
  } = {},
) =>
  playNights({
    matches: over.matches ?? [],
    slots: over.slots ?? [],
    tournaments: over.tournaments ?? [],
    kind: over.kind ?? 'all',
    category: over.category ?? 'all',
    nightOf: (iso) => iso.slice(0, 10),
    today: '2026-10-12',
  });

describe('nextOpenSeat', () => {
  it('is the first match on the timeline with a seat open, skipping full ones and tournaments', () => {
    const n = nights({
      matches: [
        match('full', '2026-10-12T18:00:00Z', { seatsTaken: 4, seatsLeft: 0 }),
        match('later', '2026-10-13T18:00:00Z', { seatsTaken: 1, seatsLeft: 3 }),
        match('next', '2026-10-12T20:00:00Z', { seatsTaken: 3, seatsLeft: 1 }),
      ],
      tournaments: [tour('t', '2026-10-12T17:00:00Z')],
    });
    const got = nextOpenSeat(n, NOW)!;
    expect(got.key).toBe('next');
    expect(got.seatsTaken).toBe(3);
    expect(got.seatsLeft).toBe(1);
    // Where it sits, for the scroll: tonight, after the tournament and the full match.
    expect(n[got.sectionIndex]!.entries[got.itemIndex]!.key).toBe('next');
  });

  it("includes the guest's own match, and says so", () => {
    const got = nextOpenSeat(
      nights({ matches: [match('mine', '2026-10-12T18:00:00Z', { mine: 'seated' })] }),
      NOW,
    )!;
    expect(got.key).toBe('mine');
    expect(got.mine).toBe(true);
  });

  it('never a match that has started', () => {
    const n = nights({
      matches: [
        match('started', '2026-10-12T14:30:00Z'),
        match('ahead', '2026-10-12T19:00:00Z'),
      ],
    });
    expect(nextOpenSeat(n, NOW)!.key).toBe('ahead');
  });

  it('signed out: a match_slots row, its seats taken = four less the seats left', () => {
    const got = nextOpenSeat(nights({ slots: [slot('2026-10-12T19:00:00Z', { seatsLeft: 3 })] }), NOW)!;
    expect(got.kind).toBe('slot');
    expect(got.seatsTaken).toBe(1);
  });

  it('follows the chips: a women-only list never puts an open match on the court', () => {
    const n = nights({
      matches: [match('open', '2026-10-12T18:00:00Z')],
      category: 'women',
    });
    expect(nextOpenSeat(n, NOW)).toBeNull();
  });
});

describe('playCourt', () => {
  const some = nights({ matches: [match('m', '2026-10-12T18:00:00Z', { seatsTaken: 1, seatsLeft: 3 })] });

  it('the next match: its seats taken, the open ones marked', () => {
    const c = playCourt({ matches: 'ready', kind: 'all', nights: some, nowMs: NOW });
    expect(c).toMatchObject({ show: 'match', taken: 1, spots: true });
  });

  it('none with a seat: four open spots', () => {
    expect(playCourt({ matches: 'ready', kind: 'all', nights: [], nowMs: NOW })).toEqual({
      show: 'none',
      taken: 0,
      spots: true,
    });
  });

  it('loading: an empty court, nothing claimed', () => {
    expect(playCourt({ matches: 'loading', kind: 'all', nights: [], nowMs: NOW })).toEqual({
      show: 'loading',
      taken: 0,
      spots: false,
    });
  });

  it('off, failed or filtered to tournaments: four rackets, no spot', () => {
    for (const c of [
      playCourt({ matches: 'off', kind: 'all', nights: some, nowMs: NOW }),
      playCourt({ matches: 'error', kind: 'all', nights: some, nowMs: NOW }),
      playCourt({ matches: 'ready', kind: 'tournaments', nights: some, nowMs: NOW }),
    ]) {
      expect(c).toEqual({ show: 'quiet', taken: 4, spots: false });
    }
  });
});

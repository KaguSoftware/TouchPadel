import { describe, expect, it } from 'vitest';
import type { GenderRuleLike } from '@touch/core';
import type { MergedCell } from '../assemble';
import { isKeptOut, keepCells, keepLanes, keptTagKey, matchKeepOf, type KeepContext } from '../genderKeep';

const TZ = 'Asia/Baghdad'; // UTC+3, no DST
const COURT_A = 'court-a';
const COURT_B = 'court-b';
// 2026-10-20 is a Tuesday (2).
const at = (hhmm: string) => new Date(`2026-10-20T${hhmm}:00+03:00`);

const rule = (over: Partial<GenderRuleLike> = {}): GenderRuleLike => ({
  id: 'r1',
  gender: 'female',
  court_id: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_time: '16:00',
  end_time: '18:00',
  valid_from: null,
  valid_to: null,
  is_active: true,
  ...over,
});

const cell = (hhmm: string, state: MergedCell['state'] = 'free'): MergedCell => ({
  startAt: at(hhmm),
  state,
  freeCount: state === 'free' ? 1 : 0,
  capacity: 1,
  priceIqd: 30000,
  courtId: state === 'free' ? COURT_A : null,
});

const ctx = (over: Partial<KeepContext> = {}): KeepContext => ({
  rules: [rule()],
  tz: TZ,
  durationMin: 60,
  signedIn: true,
  gender: 'female',
  ...over,
});

describe('keepCells: the Book tab marks kept times (0353)', () => {
  it('a time no rule touches is the same object; no rules, the same array', () => {
    const cells = [cell('12:00'), cell('14:00')];
    expect(keepCells(cells, COURT_A, ctx())).toBe(cells);
    expect(keepCells(cells, COURT_A, ctx({ rules: [] }))).toBe(cells);
    expect(keepCells(cells, COURT_A, ctx({ rules: undefined }))).toBe(cells);
  });

  it('a woman sees a women-only time as free, with the tag', () => {
    const [c] = keepCells([cell('16:00')], COURT_A, ctx());
    expect(c!.state).toBe('free');
    expect(isKeptOut(c!)).toBe(false);
    expect(keptTagKey(c!)).toBe('matches.common.categoryWomen');
  });

  it('a man sees it as taken, the tag saying why', () => {
    const [c] = keepCells([cell('16:00')], COURT_A, ctx({ gender: 'male' }));
    expect(c!.state).toBe('booked');
    expect(c!.freeCount).toBe(0);
    expect(isKeptOut(c!)).toBe(true);
    expect(keptTagKey(c!)).toBe('matches.common.categoryWomen');
  });

  it('no gender yet, or signed out: free with the tag (the gate or sign-in decides)', () => {
    for (const over of [{ gender: null }, { gender: undefined }, { signedIn: false, gender: undefined }]) {
      const [c] = keepCells([cell('16:00')], COURT_A, ctx(over));
      expect(c!.state).toBe('free');
      expect(keptTagKey(c!)).toBe('matches.common.categoryWomen');
    }
  });

  it('any overlap counts: a 90-minute booking from 15:00 touches 16:00', () => {
    const [c] = keepCells([cell('15:00')], COURT_A, ctx({ durationMin: 90, gender: 'male' }));
    expect(isKeptOut(c!)).toBe(true);
    const [d] = keepCells([cell('15:00')], COURT_A, ctx({ durationMin: 60, gender: 'male' }));
    expect(isKeptOut(d!)).toBe(false);
  });

  it('a court rule keeps only its court', () => {
    const rules = [rule({ court_id: COURT_B, gender: 'male' })];
    const [onA] = keepCells([cell('16:00')], COURT_A, ctx({ rules }));
    const [onB] = keepCells([cell('16:00')], COURT_B, ctx({ rules }));
    expect(keptTagKey(onA!)).toBeNull();
    expect(keptTagKey(onB!)).toBe('matches.common.categoryMen');
    expect(isKeptOut(onB!)).toBe(true);
  });

  it('two rules that disagree keep the time from everyone', () => {
    const rules = [rule(), rule({ id: 'r2', gender: 'male' })];
    const [c] = keepCells([cell('16:00')], COURT_A, ctx({ rules, signedIn: false }));
    expect(isKeptOut(c!)).toBe(true);
    expect(keptTagKey(c!)).toBe('guestGender.tagBoth');
  });

  it('taken, held or blocked times are left as they are', () => {
    const cells = [cell('16:00', 'booked'), cell('17:00', 'held')];
    expect(keepCells(cells, COURT_A, ctx({ gender: 'male' }))).toBe(cells);
  });

  it('keepLanes applies each lane against its own court', () => {
    const lanes = [
      { courtId: COURT_A, cells: [cell('16:00')] },
      { courtId: COURT_B, cells: [cell('16:00')] },
    ];
    const rules = [rule({ court_id: COURT_A })];
    const out = keepLanes(lanes, ctx({ rules, gender: 'male' }));
    expect(isKeptOut(out[0]!.cells[0]!)).toBe(true);
    expect(out[1]).toBe(lanes[1]);
    expect(keepLanes(lanes, ctx({ rules: [] }))).toBe(lanes);
  });
});

describe('matchKeepOf: an open match at a kept time (any court)', () => {
  const kept = [rule({ court_id: COURT_B })];

  it('locks a woman to a women-only match', () => {
    expect(matchKeepOf(kept, at('16:00'), 90, TZ, ['open', 'women'])).toEqual({
      kind: 'locked',
      category: 'women',
      noteKey: 'guestGender.match.lockedWomen',
    });
  });

  it('closes the time for a man (the quote offers him no women match)', () => {
    expect(matchKeepOf(kept, at('16:00'), 90, TZ, ['open', 'men'])).toEqual({
      kind: 'closed',
      noteKey: 'guestGender.match.closedWomen',
    });
  });

  it('closes a time two rules disagree on, and leaves an open time alone', () => {
    const both = [...kept, rule({ id: 'r2', gender: 'male' })];
    expect(matchKeepOf(both, at('16:00'), 60, TZ, ['open', 'women']).kind).toBe('closed');
    expect(matchKeepOf(kept, at('12:00'), 90, TZ, ['open', 'women'])).toEqual({ kind: 'open' });
    expect(matchKeepOf(undefined, at('16:00'), 90, TZ, ['open'])).toEqual({ kind: 'open' });
  });
});

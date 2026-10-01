import { describe, expect, it } from 'vitest';
import { isolateLtr, makeT } from '@touch/i18n';
import {
  chipLineOf,
  chipLines,
  entryLabelOf,
  joinableAhead,
  matchTargetOf,
  slotChoiceOptions,
} from '../matchChips';
import {
  chipKey,
  slotActions,
  slotMatchesByStart,
  type ChipLane,
  type OpenMatch,
  type SlotMatch,
} from '../../matches/logic';

/**
 * The Book tab's open matches (docs/design/open-matches/guest.md §4.11): the
 * words on a chip, where the chips go on a night, the choice sheet's buttons,
 * where "Join" lands and the entry row. Placement itself (`chipCellKeys`,
 * `slotActions`) is pinned in features/matches' logic test; this file pins
 * what the sheet makes of it, in both languages.
 */

const en = makeT('en');
const ar = makeT('ar');
const n = (v: number) => isolateLtr(String(v));

const AT = '2026-10-01T16:00:00.000Z';
const AT_MS = Date.parse(AT);
const LATER = '2026-10-01T17:00:00.000Z';
const LATER_MS = Date.parse(LATER);

const slot = (over: Partial<SlotMatch> = {}): SlotMatch => ({
  startAt: AT,
  endAt: '2026-10-01T17:30:00.000Z',
  durationMin: 90,
  category: 'open',
  joinPolicy: 'open',
  seatsLeft: 1,
  mine: false,
  ...over,
});

const open = (over: Partial<OpenMatch> = {}): OpenMatch => ({
  matchId: 'm-1',
  startAt: AT,
  endAt: '2026-10-01T17:30:00.000Z',
  durationMin: 90,
  category: 'open',
  joinPolicy: 'open',
  status: 'filling',
  seatsTaken: 3,
  seatsLeft: 1,
  refill: false,
  fillDeadlineAt: null,
  shareIqd: 10000,
  mine: null,
  ...over,
});

const cell = (iso: string, state = 'free') => ({ startAt: new Date(iso), state });

describe('chipLineOf', () => {
  it('says nothing for no match', () => {
    expect(chipLineOf([], en, 'en')).toBe('');
  });

  it('names the seats left and Join for one open match', () => {
    expect(chipLineOf([slot()], en, 'en')).toBe('1 seat left · Join');
    expect(chipLineOf([slot({ seatsLeft: 2 })], en, 'en')).toBe(`${n(2)} seats left · Join`);
    expect(chipLineOf([slot({ seatsLeft: 3 })], ar, 'ar')).toBe(`${n(3)} مقاعد متاحة · انضمام`);
  });

  it('leads with the category for a women or men match', () => {
    expect(chipLineOf([slot({ category: 'women', seatsLeft: 2 })], en, 'en')).toBe(
      `Women · ${n(2)} seats left`,
    );
    expect(chipLineOf([slot({ category: 'men' })], en, 'en')).toBe('Men · 1 seat left');
    expect(chipLineOf([slot({ category: 'women' })], ar, 'ar')).toBe('للنساء · مقعد واحد متاح');
  });

  it("shows the guest's own match with its seats taken, first", () => {
    const line = chipLineOf([slot(), slot({ mine: true, seatsLeft: 1 })], en, 'en');
    // "3/4" is ONE LTR isolate: two would let the slash flip in Arabic ("4/3").
    expect(line).toBe(`Your match · ${isolateLtr('3/4')}`);
    expect(chipLineOf([slot({ mine: true, seatsLeft: 2 })], ar, 'ar')).toBe(
      `مباراتك · ${isolateLtr('2/4')}`,
    );
  });

  it('counts the matches when several share the time', () => {
    expect(chipLineOf([slot(), slot({ seatsLeft: 2 })], en, 'en')).toBe(`${n(2)} open matches`);
    expect(chipLineOf([slot(), slot()], ar, 'ar')).toBe('مباراتان مفتوحتان');
  });

  it('offers no Join on a match with no seat left', () => {
    expect(chipLineOf([slot({ seatsLeft: 0 })], en, 'en')).toBe('No seats left');
  });

  it('writes no Arabic-Indic digit (R38)', () => {
    const line =
      chipLineOf([slot({ seatsLeft: 3 })], ar, 'ar') + chipLineOf([slot({ mine: true })], ar, 'ar');
    expect(line).not.toMatch(/[٠-٩]/);
  });
});

describe('chipLines', () => {
  const lanes: ChipLane[] = [
    { courtId: 'c1', cells: [cell(AT), cell(LATER, 'booked')] },
    { courtId: 'c2', cells: [cell(AT), cell(LATER)] },
  ];

  it('puts one chip per time, on the first free lane cell', () => {
    const byStart = slotMatchesByStart([slot(), slot({ startAt: LATER, seatsLeft: 2 })]);
    const lines = chipLines(lanes, byStart, en, 'en');
    expect([...lines.keys()].sort()).toEqual(
      [chipKey('c1', AT_MS), chipKey('c2', LATER_MS)].sort(),
    );
    expect(lines.get(chipKey('c1', AT_MS))).toBe('1 seat left · Join');
    expect(lines.has(chipKey('c2', AT_MS))).toBe(false);
    expect(lines.get(chipKey('c2', LATER_MS))).toBe(`${n(2)} seats left · Join`);
  });

  it('draws no chip where no lane is free at that time', () => {
    const full: ChipLane[] = [{ courtId: 'c1', cells: [cell(AT, 'booked')] }];
    expect(chipLines(full, slotMatchesByStart([slot()]), en, 'en').size).toBe(0);
  });

  it('is empty with no matches', () => {
    expect(chipLines(lanes, new Map(), en, 'en').size).toBe(0);
  });
});

describe('slotChoiceOptions', () => {
  it("labels slotActions' buttons in order", () => {
    const matches = [slot()];
    const actions = slotActions({ slotMatches: matches, canStart: true, freeCourts: 2 });
    expect(slotChoiceOptions(actions, matches, en, 'en')).toEqual([
      { value: 'join', label: 'Join the open match · 1 seat left' },
      { value: 'book', label: 'Book the court' },
      { value: 'start', label: 'Start an open match' },
    ]);
  });

  it('never gives Android more than three buttons', () => {
    const matches = [slot(), slot({ mine: true })];
    const actions = slotActions({ slotMatches: matches, canStart: true, freeCourts: 4 });
    expect(slotChoiceOptions(actions, matches, en, 'en').length).toBeLessThanOrEqual(3);
  });

  it('counts the matches on Join when several could be joined', () => {
    const matches = [slot(), slot({ seatsLeft: 3 })];
    const [join] = slotChoiceOptions(['join', 'book'], matches, en, 'en');
    expect(join).toEqual({ value: 'join', label: `Join an open match · ${n(2)} open matches` });
  });

  it("names the guest's own match, in both languages, with verbal nouns in Arabic", () => {
    const matches = [slot({ mine: true })];
    expect(slotChoiceOptions(['view-mine', 'book'], matches, en, 'en').map((o) => o.label)).toEqual(
      ['Your open match', 'Book the court'],
    );
    expect(
      slotChoiceOptions(['join', 'book', 'start'], [slot()], ar, 'ar').map((o) => o.label),
    ).toEqual([
      'الانضمام إلى المباراة المفتوحة · مقعد واحد متاح',
      'حجز الملعب',
      'بدء مباراة مفتوحة',
    ]);
  });
});

describe('matchTargetOf', () => {
  it('opens the one match a join means', () => {
    expect(matchTargetOf('join', [open()])).toEqual({ matchId: 'm-1' });
    expect(matchTargetOf('join', [open(), open({ matchId: 'm-2', seatsLeft: 0 })])).toEqual({
      matchId: 'm-1',
    });
  });

  it('opens the list at that time when several fit', () => {
    expect(matchTargetOf('join', [open(), open({ matchId: 'm-2' })])).toBe('list');
  });

  it("opens the guest's own match for view-mine", () => {
    expect(
      matchTargetOf('view-mine', [open(), open({ matchId: 'm-2', mine: 'requested' })]),
    ).toEqual({
      matchId: 'm-2',
    });
  });

  it('falls back to the list when the match the chip meant has changed hands', () => {
    expect(matchTargetOf('join', [open({ mine: 'seated' })])).toBe('list');
    expect(matchTargetOf('view-mine', [open()])).toBe('list');
  });

  it('answers null when nothing is left at that time', () => {
    expect(matchTargetOf('join', [])).toBeNull();
  });
});

describe('joinableAhead', () => {
  it('counts the future matches the guest could join', () => {
    const byStart = slotMatchesByStart([
      slot(),
      slot({ mine: true }),
      slot({ seatsLeft: 0 }),
      slot({ startAt: LATER, seatsLeft: 2 }),
      slot({ startAt: '2026-10-01T10:00:00.000Z' }),
    ]);
    expect(joinableAhead(byStart, Date.parse('2026-10-01T12:00:00.000Z'))).toBe(2);
    expect(joinableAhead(byStart, AT_MS)).toBe(1);
  });
});

describe('entryLabelOf', () => {
  it('asks a signed-out guest to sign in', () => {
    expect(entryLabelOf({ signedIn: false, joinable: 3 }, en, 'en')).toBe('Open matches · Sign in');
    expect(entryLabelOf({ signedIn: false, joinable: 0 }, ar, 'ar')).toBe(
      'المباريات المفتوحة · تسجيل الدخول',
    );
  });

  it('counts what is coming up, or names the list', () => {
    expect(entryLabelOf({ signedIn: true, joinable: 0 }, en, 'en')).toBe('Open matches');
    expect(entryLabelOf({ signedIn: true, joinable: 3 }, en, 'en')).toBe(
      `${n(3)} open matches coming up · Join`,
    );
    expect(entryLabelOf({ signedIn: true, joinable: 1 }, ar, 'ar')).toBe(
      'مباراة مفتوحة قادمة · انضمام',
    );
  });
});

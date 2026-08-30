import { describe, expect, it } from 'vitest';
import type { DayKey } from '../availability/slotGrid';
import {
  displayWindows,
  gridLabel,
  isOvernightTail,
  readOpeningHours,
  runsToMidnight,
  splitOvernight,
  tradingSpan,
  writeOpeningHours,
  type Window,
} from './openingHours';

/** Sunday-first, matching `DAY_KEYS` in slotGrid and Postgres `dow`. */
const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Touch's real configuration: 09:00 → 02:00, every day (intake pack 2026-08-29). */
const TOUCH_DAY: Window[] = [
  ['00:00', '02:00'],
  ['09:00', '24:00'],
];
const TOUCH_HOURS = Object.fromEntries(DAY_KEYS.map((k) => [k, TOUCH_DAY])) as Record<
  DayKey,
  Window[]
>;

describe('splitOvernight', () => {
  it('leaves a same-day window alone', () => {
    expect(splitOvernight('09:00', '23:00')).toEqual({
      sameDay: [['09:00', '23:00']],
      nextDay: [],
    });
  });

  it('splits 09:00-02:00 across the day boundary', () => {
    expect(splitOvernight('09:00', '02:00')).toEqual({
      sameDay: [['09:00', '24:00']],
      nextDay: [['00:00', '02:00']],
    });
  });

  it("treats a '00:00' close as midnight, not a zero-length day", () => {
    expect(splitOvernight('09:00', '00:00')).toEqual({
      sameDay: [['09:00', '24:00']],
      nextDay: [],
    });
  });

  it('refuses an identical open and close rather than guessing', () => {
    expect(() => splitOvernight('09:00', '09:00')).toThrow(/identical/);
  });
});

describe('window predicates', () => {
  it('identifies the inherited tail and the window that runs into it', () => {
    expect(isOvernightTail(['00:00', '02:00'])).toBe(true);
    expect(isOvernightTail(['00:00', '24:00'])).toBe(false); // a full day is not a tail
    expect(isOvernightTail(['09:00', '24:00'])).toBe(false);
    expect(runsToMidnight(['09:00', '24:00'])).toBe(true);
    expect(runsToMidnight(['09:00', '23:00'])).toBe(false);
  });
});

describe('readOpeningHours', () => {
  it("recovers '09:00 to 02:00' from the two stored windows", () => {
    const read = readOpeningHours(TOUCH_HOURS, DAY_KEYS);
    for (const key of DAY_KEYS) {
      expect(read[key]).toEqual({
        open: '09:00',
        close: '02:00',
        overnight: true,
        split: false,
        closed: false,
      });
    }
  });

  it('reads an ordinary same-day venue unchanged', () => {
    const hours = Object.fromEntries(
      DAY_KEYS.map((k) => [k, [['09:00', '23:00']] as Window[]]),
    ) as Record<DayKey, Window[]>;
    expect(readOpeningHours(hours, DAY_KEYS).mon).toEqual({
      open: '09:00',
      close: '23:00',
      overnight: false,
      split: false,
      closed: false,
    });
  });

  it('marks a day with no windows of its own as closed', () => {
    const hours = { ...TOUCH_HOURS, fri: [['00:00', '02:00']] as Window[] };
    expect(readOpeningHours(hours, DAY_KEYS).fri?.closed).toBe(true);
  });

  it("reports a midnight close as '00:00', which write turns straight back into '24:00'", () => {
    // An evening window with no tail on the next day: the venue shuts AT midnight.
    const hours = Object.fromEntries(
      DAY_KEYS.map((k) => [k, [['09:00', '24:00']] as Window[]]),
    ) as Record<DayKey, Window[]>;
    const read = readOpeningHours(hours, DAY_KEYS);
    expect(read.mon).toEqual({
      open: '09:00',
      close: '00:00',
      overnight: true,
      split: false,
      closed: false,
    });
    expect(writeOpeningHours(read, DAY_KEYS)).toEqual(hours);
  });

  it('flags a genuine split (siesta) day so callers refuse to flatten it', () => {
    const hours = {
      ...TOUCH_HOURS,
      mon: [
        ['09:00', '13:00'],
        ['17:00', '23:00'],
      ] as Window[],
    };
    expect(readOpeningHours(hours, DAY_KEYS).mon?.split).toBe(true);
  });
});

describe('writeOpeningHours', () => {
  it('round-trips Touch: read -> write is the identity', () => {
    const read = readOpeningHours(TOUCH_HOURS, DAY_KEYS);
    expect(writeOpeningHours(read, DAY_KEYS)).toEqual(TOUCH_HOURS);
  });

  it("puts Saturday night's tail on Sunday, not on Saturday", () => {
    const pairs = Object.fromEntries(
      DAY_KEYS.map((k) => [k, { open: '09:00', close: '23:00', closed: true }]),
    ) as Record<DayKey, { open: string; close: string; closed: boolean }>;
    pairs.sat = { open: '09:00', close: '02:00', closed: false };

    const out = writeOpeningHours(pairs, DAY_KEYS);
    expect(out.sat).toEqual([['09:00', '24:00']]);
    expect(out.sun).toEqual([['00:00', '02:00']]);
  });

  it('wraps the last day of the week onto the first', () => {
    const pairs = Object.fromEntries(
      DAY_KEYS.map((k) => [k, { open: '09:00', close: '02:00', closed: k !== 'sat' }]),
    ) as Record<DayKey, { open: string; close: string; closed: boolean }>;
    // sat is the last key, so its tail must land on sun (the first).
    expect(writeOpeningHours(pairs, DAY_KEYS).sun).toEqual([['00:00', '02:00']]);
  });

  it('a closed day contributes nothing but can still inherit a tail', () => {
    const pairs = Object.fromEntries(
      DAY_KEYS.map((k) => [k, { open: '09:00', close: '02:00', closed: k === 'mon' }]),
    ) as Record<DayKey, { open: string; close: string; closed: boolean }>;
    const out = writeOpeningHours(pairs, DAY_KEYS);
    // Monday is shut, but Sunday night still runs into Monday's small hours.
    expect(out.mon).toEqual([['00:00', '02:00']]);
  });
});

describe('displayWindows', () => {
  it('prints Touch as one 09:00-02:00 row, not two', () => {
    expect(displayWindows(TOUCH_DAY, TOUCH_DAY)).toEqual([['09:00', '02:00']]);
  });

  it('falls back to 24:00 when the next day is unknown', () => {
    expect(displayWindows(TOUCH_DAY)).toEqual([['09:00', '24:00']]);
  });

  it('leaves an ordinary day untouched', () => {
    expect(displayWindows([['09:00', '23:00']])).toEqual([['09:00', '23:00']]);
  });

  it('is empty for a closed day that only carries an inherited tail', () => {
    expect(displayWindows([['00:00', '02:00']])).toEqual([]);
  });
});

describe('tradingSpan', () => {
  it('spans past midnight rather than 00:00-24:00', () => {
    // 09:00 = 540, 02:00 next day = 1440 + 120 = 1560.
    expect(tradingSpan(TOUCH_DAY, TOUCH_DAY)).toEqual({ startMin: 540, endMin: 1560 });
  });

  it('spans an ordinary day normally', () => {
    expect(tradingSpan([['09:00', '23:00']])).toEqual({ startMin: 540, endMin: 1380 });
  });

  it('is empty for a closed day', () => {
    expect(tradingSpan([])).toEqual({ startMin: 0, endMin: 0 });
  });
});

describe('gridLabel', () => {
  it('wraps past midnight so a row reads 01:30, not 25:30', () => {
    expect(gridLabel(540)).toBe('09:00');
    expect(gridLabel(1440)).toBe('00:00');
    expect(gridLabel(1530)).toBe('01:30');
  });
});

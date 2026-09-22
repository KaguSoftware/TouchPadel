/**
 * The re-check diff (plan §3.5, DECIDE 10; _shared/assistant/recheck.ts):
 * which figures an answer printed are no longer in the data its tools return
 * today, and what likely replaced them. Pure arithmetic, no stack.
 */
import { describe, expect, it } from 'vitest';
import { diffNumbers, nearestOf } from '../supabase/functions/_shared/assistant/recheck.ts';

describe('diffNumbers', () => {
  it('counts every shown-and-given figure that is still in the live set', () => {
    const then = [228_000, 300, 43.2, 12];
    const shown = [228_000, 300, 43.2];
    expect(diffNumbers(then, then, shown)).toEqual({ changed: [], unchanged: 3 });
  });

  it('reports a figure that left the live set with the nearest new value', () => {
    const then = [228_000, 300, 43.2];
    const now = [231_500, 300, 43.2];
    const d = diffNumbers(then, now, [228_000, 300, 43.2]);
    expect(d.unchanged).toBe(2);
    expect(d.changed).toEqual([{ value_then: 228_000, value_now: 231_500 }]);
  });

  it('offers no replacement when nothing new sits close enough', () => {
    const d = diffNumbers([228_000, 300], [300, 5], [228_000, 300]);
    expect(d.changed).toEqual([{ value_then: 228_000 }]);
    expect(d.unchanged).toBe(1);
  });

  it('never offers an unchanged figure as another figure\'s replacement', () => {
    // 300 holds; it must not be named as what replaced 310 even though it is nearest.
    const d = diffNumbers([310, 300], [300, 900], [310, 300]);
    expect(d.changed).toEqual([{ value_then: 310 }]);
  });

  it('ignores shown numbers that no tool gave then (owner-typed, small counts, unverified)', () => {
    const d = diffNumbers([1_000], [1_400], [1_000, 7, 999_999]);
    expect(d.changed).toEqual([{ value_then: 1_000, value_now: 1_400 }]);
    expect(d.unchanged).toBe(0);
  });

  it('dedupes: a figure printed twice is one comparison', () => {
    const d = diffNumbers([50, 60], [50, 61], [50, 50, 60, 60]);
    expect(d.unchanged).toBe(1);
    expect(d.changed).toEqual([{ value_then: 60, value_now: 61 }]);
  });

  it('is empty without a baseline', () => {
    expect(diffNumbers([], [1, 2, 3], [1, 2])).toEqual({ changed: [], unchanged: 0 });
  });

  it('treats decimals within the epsilon as the same figure', () => {
    expect(diffNumbers([43.2], [43.2000000001], [43.2]).unchanged).toBe(1);
  });
});

describe('nearestOf', () => {
  it('picks the closest value within half the old value', () => {
    expect(nearestOf([100, 140, 900], 120)).toBe(100);
    expect(nearestOf([100, 140, 900], 130)).toBe(140);
    expect(nearestOf([900], 120)).toBeNull();
    expect(nearestOf([], 120)).toBeNull();
  });

  it('always allows one unit for small figures', () => {
    expect(nearestOf([2], 1)).toBe(2);
    expect(nearestOf([3], 1)).toBeNull();
  });
});

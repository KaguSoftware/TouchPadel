import { describe, expect, it } from 'vitest';
import { clashesFor, saveBlock, windowParts } from './genderHoursLogic';

describe('windowParts', () => {
  it('shows a same-day window plainly and marks an overnight one', () => {
    expect(windowParts({ start_time: '09:00:00', end_time: '12:00:00' })).toEqual({ from: '09:00', to: '12:00', overnight: false });
    expect(windowParts({ start_time: '22:00:00', end_time: '02:00:00' })).toEqual({ from: '22:00', to: '02:00', overnight: true });
    // An end at midnight runs past midnight too (the SQL's "end <= start").
    expect(windowParts({ start_time: '18:00', end_time: '00:00' }).overnight).toBe(true);
  });
});

describe('clashesFor', () => {
  const rules = [
    { id: 'a', name: 'Ladies mornings' },
    { id: 'b', name: 'Men league' },
    { id: 'c', name: 'Other' },
  ];
  const clashes = [{ ruleId: 'a', otherId: 'b', weekday: 5 }];

  it('names the other rule from either side', () => {
    expect(clashesFor(clashes, rules, 'a')).toEqual([{ otherId: 'b', otherName: 'Men league', weekday: 5 }]);
    expect(clashesFor(clashes, rules, 'b')).toEqual([{ otherId: 'a', otherName: 'Ladies mornings', weekday: 5 }]);
    expect(clashesFor(clashes, rules, 'c')).toEqual([]);
  });
});

describe('saveBlock', () => {
  const ok = { name: 'Ladies mornings', gender: 'female' as const, days: [5], startTime: '09:00', endTime: '12:00' };

  it('lets a complete rule save', () => {
    expect(saveBlock(ok)).toBeNull();
    // Overnight is allowed.
    expect(saveBlock({ ...ok, startTime: '22:00', endTime: '02:00' })).toBeNull();
    expect(saveBlock({ ...ok, days: new Set([0, 1]) })).toBeNull();
  });

  it('names the first thing missing', () => {
    expect(saveBlock({ ...ok, name: '   ' })).toBe('name');
    // No default gender: who the time is kept for is always chosen.
    expect(saveBlock({ ...ok, gender: '' })).toBe('who');
    expect(saveBlock({ ...ok, days: [] })).toBe('days');
    expect(saveBlock({ ...ok, days: new Set() })).toBe('days');
    expect(saveBlock({ ...ok, endTime: '09:00' })).toBe('sameTime');
    expect(saveBlock({ ...ok, endTime: '' })).toBe('sameTime');
  });
});

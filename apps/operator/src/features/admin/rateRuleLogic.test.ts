import { describe, it, expect } from 'vitest';
import { clockIntervals, coversEveryDay, findOverlaps, overlapsFor, rulesOverlap, validityMeets, type RateRuleLike } from './rateRuleLogic';

// Overlap is a WARNING for the manager; app.price_slot decides. The helper must
// find every pair that competes for a slot and stay quiet for pairs that
// cannot meet (different courts, disjoint days, disjoint hours, disjoint
// validity, inactive).

function rule(over: Partial<RateRuleLike> & { id: string }): RateRuleLike {
  return {
    name: over.id,
    court_id: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '09:00:00',
    end_time: '23:00:00',
    priority: 0,
    valid_from: null,
    valid_to: null,
    is_active: true,
    ...over,
  };
}

describe('clockIntervals', () => {
  it('keeps a same-day window whole and splits an overnight one', () => {
    expect(clockIntervals('09:00:00', '23:00:00')).toEqual([['09:00', '23:00']]);
    expect(clockIntervals('22:00', '02:00')).toEqual([
      ['22:00', '24:00'],
      ['00:00', '02:00'],
    ]);
    expect(clockIntervals('10:00', '10:00')).toEqual([]);
  });
});

describe('rulesOverlap', () => {
  const base = rule({ id: 'base' });
  it('flags a peak rule that sits inside the base rule (the normal, intended overlap)', () => {
    const peak = rule({ id: 'peak', start_time: '18:00', end_time: '22:00', priority: 10 });
    expect(rulesOverlap(base, peak)).toBe(0);
    expect(rulesOverlap(peak, base)).toBe(0);
  });
  it('reports the first shared weekday', () => {
    const fri = rule({ id: 'fri', days_of_week: [5, 6] });
    expect(rulesOverlap(base, fri)).toBe(5);
  });
  it('ignores rules on different courts, but an all-courts rule meets every court', () => {
    const c1 = rule({ id: 'c1', court_id: 'court-1' });
    const c2 = rule({ id: 'c2', court_id: 'court-2' });
    expect(rulesOverlap(c1, c2)).toBeNull();
    expect(rulesOverlap(base, c1)).toBe(0);
  });
  it('ignores disjoint hours, touching windows included', () => {
    const morning = rule({ id: 'm', start_time: '09:00', end_time: '14:00' });
    const evening = rule({ id: 'e', start_time: '14:00', end_time: '23:00' });
    expect(rulesOverlap(morning, evening)).toBeNull();
  });
  it('catches an overnight window crossing a morning one', () => {
    const night = rule({ id: 'n', start_time: '22:00', end_time: '02:00' });
    const early = rule({ id: 'x', start_time: '01:00', end_time: '03:00' });
    expect(rulesOverlap(night, early)).toBe(0);
  });
  it('ignores disjoint weekdays, inactive rules and disjoint validity', () => {
    expect(rulesOverlap(rule({ id: 'a', days_of_week: [1] }), rule({ id: 'b', days_of_week: [2] }))).toBeNull();
    expect(rulesOverlap(base, rule({ id: 'off', is_active: false }))).toBeNull();
    const summer = rule({ id: 's', valid_from: '2026-06-01', valid_to: '2026-08-31' });
    const winter = rule({ id: 'w', valid_from: '2026-12-01', valid_to: null });
    expect(rulesOverlap(summer, winter)).toBeNull();
    expect(validityMeets(summer, rule({ id: 'open' }))).toBe(true);
  });
  it('never pairs a rule with itself', () => {
    expect(rulesOverlap(base, base)).toBeNull();
  });
});

describe('findOverlaps / overlapsFor', () => {
  it('lists both directions so each row can show its own warning', () => {
    const rules = [rule({ id: 'base' }), rule({ id: 'peak', start_time: '18:00', end_time: '22:00' }), rule({ id: 'sat', days_of_week: [6], start_time: '06:00', end_time: '10:00' })];
    const all = findOverlaps(rules);
    expect(all.map((o) => `${o.ruleId}>${o.otherId}`).sort()).toEqual(['base>peak', 'base>sat', 'peak>base', 'sat>base']);
    expect(overlapsFor(all, 'peak')).toEqual([{ ruleId: 'peak', otherId: 'base', otherName: 'base', weekday: 0 }]);
  });
});

describe('coversEveryDay', () => {
  it('is true only for all seven days', () => {
    expect(coversEveryDay([0, 1, 2, 3, 4, 5, 6])).toBe(true);
    expect(coversEveryDay([1, 2, 3, 4, 5])).toBe(false);
  });
});

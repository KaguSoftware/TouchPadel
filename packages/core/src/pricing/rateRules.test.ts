import { describe, expect, it } from 'vitest';
import { iqd } from '../money/iqd';
import { resolveRateRule, type RateRule, type RateRulePrice } from './rateRules';

const TZ = 'Asia/Baghdad'; // UTC+3, no DST
const COURT_A = 'court-a';
const COURT_B = 'court-b';

function rule(overrides: Partial<RateRule> & { id: string }): RateRule {
  return {
    name: overrides.id,
    courtId: null,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    endTime: '23:00',
    priority: 0,
    validFrom: null,
    validTo: null,
    isActive: true,
    ...overrides,
  };
}

function price(ruleId: string, durationMin: number, priceIqd: number): RateRulePrice {
  return { ruleId, durationMin, priceIqd: iqd(priceIqd) };
}

// 2026-09-06 is a Sunday. 18:00 Baghdad = 15:00 UTC.
const SUN_18_LOCAL = new Date('2026-09-06T15:00:00Z');

describe('resolveRateRule', () => {
  it('returns the matching rule and price', () => {
    const rules = [rule({ id: 'base' })];
    const prices = [price('base', 60, 40000), price('base', 90, 55000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)).toEqual({
      ruleId: 'base',
      priceIqd: 40000,
    });
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 90, TZ)).toEqual({
      ruleId: 'base',
      priceIqd: 55000,
    });
  });

  it('court-specific beats null-court even with lower priority', () => {
    const rules = [
      rule({ id: 'all-courts', courtId: null, priority: 100 }),
      rule({ id: 'court-a-only', courtId: COURT_A, priority: 0 }),
    ];
    const prices = [price('all-courts', 60, 50000), price('court-a-only', 60, 45000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe(
      'court-a-only',
    );
    // other court falls back to the all-courts rule
    expect(resolveRateRule(rules, prices, COURT_B, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe(
      'all-courts',
    );
  });

  it('higher priority wins within the same specificity tier', () => {
    const rules = [
      rule({ id: 'off-peak', priority: 0 }),
      rule({ id: 'peak', priority: 10, startTime: '17:00', endTime: '23:00' }),
    ];
    const prices = [price('off-peak', 60, 40000), price('peak', 60, 60000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe('peak');
    // 10:00 local = 07:00Z — outside the peak window, off-peak wins
    const sunMorning = new Date('2026-09-06T07:00:00Z');
    expect(resolveRateRule(rules, prices, COURT_A, sunMorning, 60, TZ)?.ruleId).toBe('off-peak');
  });

  it('evaluates day-of-week in VENUE-LOCAL time (0=Sun..6=Sat)', () => {
    const rules = [
      rule({ id: 'sunday-only', daysOfWeek: [0] }),
      rule({ id: 'saturday-only', daysOfWeek: [6] }),
    ];
    const prices = [price('sunday-only', 60, 40000), price('saturday-only', 60, 70000)];
    // 22:30 UTC Saturday = 01:30 local SUNDAY in Baghdad — but the venue is closed then;
    // use a rule window that covers it to isolate the DOW logic.
    const rulesLate = rules.map((r) => ({ ...r, startTime: '00:00', endTime: '23:00' }));
    const lateNight = new Date('2026-09-05T22:30:00Z');
    expect(resolveRateRule(rulesLate, prices, COURT_A, lateNight, 60, TZ)?.ruleId).toBe(
      'sunday-only',
    );
  });

  it('time window is half-open [start, end)', () => {
    const rules = [rule({ id: 'evening', startTime: '17:00', endTime: '18:00' })];
    const prices = [price('evening', 60, 60000)];
    const at1700 = new Date('2026-09-06T14:00:00Z'); // 17:00 local
    const at1800 = SUN_18_LOCAL; // 18:00 local — excluded
    expect(resolveRateRule(rules, prices, COURT_A, at1700, 60, TZ)).not.toBeNull();
    expect(resolveRateRule(rules, prices, COURT_A, at1800, 60, TZ)).toBeNull();
  });

  it('respects valid_from / valid_to (inclusive, venue-local dates)', () => {
    const rules = [
      rule({ id: 'ramadan', validFrom: '2026-09-06', validTo: '2026-09-06', priority: 5 }),
      rule({ id: 'base' }),
    ];
    const prices = [price('ramadan', 60, 30000), price('base', 60, 40000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe('ramadan');
    const nextDay = new Date('2026-09-07T15:00:00Z');
    expect(resolveRateRule(rules, prices, COURT_A, nextDay, 60, TZ)?.ruleId).toBe('base');
  });

  it('skips inactive rules', () => {
    const rules = [rule({ id: 'retired', isActive: false }), rule({ id: 'base' })];
    const prices = [price('retired', 60, 10000), price('base', 60, 40000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe('base');
  });

  it('a winning-tier rule without a price for the duration falls through', () => {
    const rules = [
      rule({ id: 'court-a-specials', courtId: COURT_A, priority: 10 }),
      rule({ id: 'base' }),
    ];
    // court-a-specials only prices 90 min
    const prices = [price('court-a-specials', 90, 50000), price('base', 60, 40000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)).toEqual({
      ruleId: 'base',
      priceIqd: 40000,
    });
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 90, TZ)?.ruleId).toBe(
      'court-a-specials',
    );
  });

  it('deterministic tie-break by rule id', () => {
    const rules = [rule({ id: 'b-rule' }), rule({ id: 'a-rule' })];
    const prices = [price('b-rule', 60, 1000), price('a-rule', 60, 2000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)?.ruleId).toBe('a-rule');
  });

  it('returns null when nothing matches', () => {
    const rules = [rule({ id: 'weekday', daysOfWeek: [1, 2, 3, 4] })];
    const prices = [price('weekday', 60, 40000)];
    expect(resolveRateRule(rules, prices, COURT_A, SUN_18_LOCAL, 60, TZ)).toBeNull();
    expect(resolveRateRule([], [], COURT_A, SUN_18_LOCAL, 60, TZ)).toBeNull();
  });

  it('never matches midnight-crossing rule windows (documented unsupported)', () => {
    const rules = [rule({ id: 'overnight', startTime: '22:00', endTime: '02:00' })];
    const prices = [price('overnight', 60, 40000)];
    const at2300 = new Date('2026-09-06T20:00:00Z'); // 23:00 local
    expect(resolveRateRule(rules, prices, COURT_A, at2300, 60, TZ)).toBeNull();
  });
});

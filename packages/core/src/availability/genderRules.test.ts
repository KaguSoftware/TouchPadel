import { describe, expect, it } from 'vitest';
import {
  findGenderClashes,
  genderVerdict,
  keptFor,
  matchCategoryFor,
  slotGenderRules,
  type GenderRuleLike,
} from './genderRules';

const TZ = 'Asia/Baghdad';
/** Baghdad wall time (UTC+3, no DST). */
const at = (s: string) => new Date(`${s}:00+03:00`);

const rule = (over: Partial<GenderRuleLike> & Pick<GenderRuleLike, 'id'>): GenderRuleLike => ({
  gender: 'female',
  court_id: null,
  days_of_week: [1],
  start_time: '16:00:00',
  end_time: '18:00:00',
  valid_from: null,
  valid_to: null,
  is_active: true,
  ...over,
});

// The cases of packages/db/tests/court-gender-rules.test.ts ("slot_gender_rules"),
// so the phone and the server agree. 2030-01-07 is a Monday.
const RULES: GenderRuleLike[] = [
  rule({ id: 'all' }),
  rule({ id: 'late', gender: 'male', court_id: 'c1', days_of_week: [5], start_time: '22:00', end_time: '02:00' }),
  rule({ id: 'off', gender: 'male', start_time: '08:00', end_time: '09:00', is_active: false }),
  rule({ id: 'later', gender: 'male', start_time: '06:00', end_time: '07:00', valid_from: '2031-01-01' }),
];
const kept = (court: string | null, from: string, to: string) => slotGenderRules(RULES, court, at(from), at(to), TZ);

describe('slotGenderRules mirrors app.slot_gender_rules', () => {
  it('counts any overlap, half-open', () => {
    expect(kept(null, '2030-01-07T15:00', '2030-01-07T16:00')).toEqual([]);
    expect(kept(null, '2030-01-07T15:30', '2030-01-07T17:00')).toEqual(['female']);
    expect(kept('c2', '2030-01-07T16:00', '2030-01-07T17:00')).toEqual(['female']);
    expect(kept(null, '2030-01-07T18:00', '2030-01-07T19:00')).toEqual([]);
    expect(kept(null, '2030-01-08T16:00', '2030-01-08T17:00')).toEqual([]);
  });
  it('runs a late window past midnight, on its own court only', () => {
    expect(kept('c1', '2030-01-12T01:00', '2030-01-12T02:00')).toEqual(['male']);
    expect(kept('c2', '2030-01-12T01:00', '2030-01-12T02:00')).toEqual([]);
    expect(kept(null, '2030-01-11T23:00', '2030-01-12T00:00')).toEqual(['male']);
    expect(kept('c1', '2030-01-12T22:00', '2030-01-12T23:00')).toEqual([]);
  });
  it('ignores off rules and days outside the dates', () => {
    expect(kept(null, '2030-01-07T08:00', '2030-01-07T09:00')).toEqual([]);
    expect(kept(null, '2030-01-07T06:00', '2030-01-07T07:00')).toEqual([]);
  });
  it('lists both genders when two rules disagree', () => {
    const both = [...RULES, rule({ id: 'm', gender: 'male', court_id: 'c1', start_time: '17:00', end_time: '19:00' })];
    expect(slotGenderRules(both, 'c1', at('2030-01-07T17:00'), at('2030-01-07T18:00'), TZ)).toEqual(['female', 'male']);
  });
});

describe('verdicts', () => {
  it('says what the server will say', () => {
    expect(genderVerdict([], null)).toBe('open');
    expect(genderVerdict(['female'], null)).toBe('gender_required');
    expect(genderVerdict(['female'], 'female')).toBe('kept_ok');
    expect(genderVerdict(['female'], 'male')).toBe('restricted');
    expect(genderVerdict(['female', 'male'], 'female')).toBe('restricted');
    expect(keptFor([])).toBeNull();
    expect(keptFor(['male'])).toBe('male');
    expect(keptFor(['female', 'male'])).toBe('both');
    expect(matchCategoryFor(['female'])).toBe('women');
    expect(matchCategoryFor(['female', 'male'])).toBeNull();
  });
});

describe('findGenderClashes', () => {
  it('finds a women and a men rule on the same court at the same time', () => {
    const rules = [
      rule({ id: 'w' }),
      rule({ id: 'm', gender: 'male', court_id: 'c1', start_time: '17:00', end_time: '19:00' }),
      rule({ id: 'w2', court_id: 'c1', start_time: '17:00', end_time: '19:00' }),
      rule({ id: 'mOther', gender: 'male', days_of_week: [2] }),
    ];
    expect(findGenderClashes(rules)).toEqual([
      { ruleId: 'w', otherId: 'm', weekday: 1 },
      { ruleId: 'm', otherId: 'w2', weekday: 1 },
    ]);
  });
  it('catches a Saturday-night window running into Sunday morning', () => {
    const rules = [
      rule({ id: 'sat', days_of_week: [6], start_time: '23:00', end_time: '02:00' }),
      rule({ id: 'sun', gender: 'male', days_of_week: [0], start_time: '01:00', end_time: '03:00' }),
    ];
    expect(findGenderClashes(rules)).toHaveLength(1);
  });
  it('ignores off rules and dates that never meet', () => {
    const rules = [
      rule({ id: 'w', valid_to: '2030-01-31' }),
      rule({ id: 'm', gender: 'male', valid_from: '2030-02-01' }),
      rule({ id: 'mOff', gender: 'male', is_active: false }),
    ];
    expect(findGenderClashes(rules)).toEqual([]);
  });
});

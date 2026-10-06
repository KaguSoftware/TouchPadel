import { describe, expect, it } from 'vitest';
import { memberToken } from '@touch/core/loyalty';
import {
  LEDGER_KIND_KEYS,
  decodeCachedCard,
  encodeCachedCard,
  loyaltyOn,
  msToNextTick,
  parseMemberCard,
  parseMyLoyalty,
  signedPoints,
  stepFraction,
  tierName,
  tierProgress,
} from '../logic';

/**
 * The phone's loyalty arithmetic and parsing (loyalty plan §5.1): the reads parsed into the core
 * shapes, the cached card scoped to its account, the refresh clock, tier progress.
 */

const CARD_RAW = {
  member_code: '8F3K2QXM',
  secret_b32: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  step: 30,
};

describe('parseMemberCard', () => {
  it('keeps a well-formed card and uppercases it', () => {
    expect(parseMemberCard({ ...CARD_RAW, member_code: '8f3k2qxm' })).toEqual(CARD_RAW);
  });

  it('refuses a card without a valid member code or secret', () => {
    expect(parseMemberCard(null)).toBeNull();
    expect(parseMemberCard({ ...CARD_RAW, member_code: 'ILOU1234' })).toBeNull();
    expect(parseMemberCard({ ...CARD_RAW, secret_b32: 'not base32!' })).toBeNull();
    expect(parseMemberCard({ ...CARD_RAW, secret_b32: '' })).toBeNull();
  });

  it('falls back to a 30 s step outside the settings range (15..120)', () => {
    expect(parseMemberCard({ ...CARD_RAW, step: 5 })?.step).toBe(30);
    expect(parseMemberCard({ ...CARD_RAW, step: 60 })?.step).toBe(60);
    expect(parseMemberCard({ ...CARD_RAW, step: null })?.step).toBe(30);
  });

  it('yields a card memberToken draws (RFC 6238 vector at T=59 s, 6 digits)', () => {
    const card = parseMemberCard(CARD_RAW)!;
    expect(memberToken(card, 59_000)).toEqual({ token: 'TP-8F3K2QXM-287082', secondsLeft: 1 });
  });
});

describe('parseMyLoyalty', () => {
  it('reads the contract shape', () => {
    const l = parseMyLoyalty({
      enabled: true,
      balance: 10,
      lifetime: 20,
      points_12m: 15,
      tier: { id: 't0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 },
      next_tier: {
        id: 't1',
        name_en: 'Gold',
        name_ar: 'ذهبي',
        multiplier: '1.5',
        min_points_12m: 100,
      },
      point_value_iqd: 50,
      min_redeem_points: 100,
      history: [
        { id: 'a', kind: 'earn', delta: 5, venue_id: null, created_at: 'x', note: null },
        { id: 'b', kind: 'mystery', delta: 1 },
        null,
      ],
      rewards: [
        {
          id: 'r',
          name_en: 'Coffee',
          name_ar: 'قهوة',
          cost_points: 30,
          kind: 'item',
          iqd_off: null,
        },
      ],
    });
    expect(l.enabled).toBe(true);
    expect(l.next_tier).toMatchObject({ id: 't1', multiplier: 1.5, min_points_12m: 100 });
    expect(l.history.map((r) => r.id)).toEqual(['a']);
    expect(l.rewards).toHaveLength(1);
  });

  it('reads anything unreadable as off and empty, never a crash', () => {
    const l = parseMyLoyalty(null);
    expect(l).toMatchObject({
      enabled: false,
      balance: 0,
      tier: null,
      next_tier: null,
      history: [],
      rewards: [],
    });
    expect(loyaltyOn(l)).toBe(false);
    expect(loyaltyOn(undefined)).toBe(false);
    expect(loyaltyOn({ enabled: true })).toBe(true);
  });
});

describe('the cached card', () => {
  const card = parseMemberCard(CARD_RAW)!;

  it('reads back only for the account that stored it', () => {
    const raw = encodeCachedCard('user-a', card);
    expect(decodeCachedCard(raw, 'user-a')).toEqual(card);
    expect(decodeCachedCard(raw, 'user-b')).toBeNull();
    expect(decodeCachedCard(raw, null)).toBeNull();
  });

  it('treats a missing or torn value as no card', () => {
    expect(decodeCachedCard(null, 'user-a')).toBeNull();
    expect(decodeCachedCard('{not json', 'user-a')).toBeNull();
    expect(
      decodeCachedCard(JSON.stringify({ uid: 'user-a', card: { member_code: 'x' } }), 'user-a'),
    ).toBeNull();
  });
});

describe('the refresh clock', () => {
  it('ticks on the next whole second', () => {
    expect(msToNextTick(10_000)).toBe(1000);
    expect(msToNextTick(10_250)).toBe(750);
    expect(msToNextTick(10_999)).toBe(1);
  });

  it('empties the bar as the step runs out', () => {
    expect(stepFraction(30, 30)).toBe(1);
    expect(stepFraction(15, 30)).toBe(0.5);
    expect(stepFraction(0, 30)).toBe(0);
    expect(stepFraction(40, 30)).toBe(1);
    expect(stepFraction(5, 0)).toBe(0);
  });

  it('the token changes exactly when secondsLeft wraps', () => {
    const card = parseMemberCard(CARD_RAW)!;
    const a = memberToken(card, 89_999);
    const b = memberToken(card, 90_000);
    expect(a.secondsLeft).toBe(1);
    expect(b.secondsLeft).toBe(30);
    expect(a.token).not.toBe(b.token);
    expect(memberToken(card, 60_000).token).toBe(a.token);
  });
});

describe('tierProgress', () => {
  const tier = { id: 't0', name_en: 'Member', name_ar: 'عضو', multiplier: 1 };
  const next = {
    id: 't1',
    name_en: 'Silver',
    name_ar: 'فضي',
    multiplier: 1.25,
    min_points_12m: 1500,
  };

  it('measures from the base tier when the current threshold is not sent', () => {
    expect(tierProgress({ points_12m: 900, tier, next_tier: next })).toEqual({
      fraction: 0.6,
      remaining: 600,
    });
  });

  it('measures from the current tier threshold when it is sent', () => {
    expect(
      tierProgress({ points_12m: 1000, tier: { ...tier, min_points_12m: 500 }, next_tier: next }),
    ).toEqual({ fraction: 0.5, remaining: 500 });
  });

  it('clamps past the target and below the floor', () => {
    expect(tierProgress({ points_12m: 2000, tier, next_tier: next })).toEqual({
      fraction: 1,
      remaining: 0,
    });
    expect(tierProgress({ points_12m: -50, tier, next_tier: next })?.fraction).toBe(0);
  });

  it('is null at the top tier', () => {
    expect(tierProgress({ points_12m: 2000, tier, next_tier: null })).toBeNull();
  });
});

describe('labels', () => {
  it('names a tier in the guest language, the other when empty', () => {
    expect(tierName({ name_en: 'Gold', name_ar: 'ذهبي' }, 'ar')).toBe('ذهبي');
    expect(tierName({ name_en: 'Gold', name_ar: '' }, 'ar')).toBe('Gold');
    expect(tierName({ name_en: '', name_ar: 'ذهبي' }, 'en')).toBe('ذهبي');
  });

  it('signs a delta with a true minus', () => {
    const f = (n: number) => String(n);
    expect(signedPoints(120, f)).toBe('+120');
    expect(signedPoints(-40, f)).toBe('−40');
    expect(signedPoints(0, f)).toBe('0');
  });

  it('has a history line for every ledger kind', () => {
    expect(Object.keys(LEDGER_KIND_KEYS).sort()).toEqual([
      'adjust',
      'clawback',
      'earn',
      'expire',
      'merge_in',
      'redeem',
      'redeem_void',
      'reward',
    ]);
  });
});

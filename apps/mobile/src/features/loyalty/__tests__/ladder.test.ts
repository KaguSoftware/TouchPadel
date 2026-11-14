import { describe, expect, it } from 'vitest';
import type { MyLoyalty } from '@touch/core/loyalty';
import {
  cardHolds,
  givesAnything,
  ladderPosition,
  parseLadder,
  parseMyLoyalty,
  rungGives,
  tierProgress,
} from '../logic';

/**
 * The tier ladder on the phone (0410, `my_loyalty.tiers`): the rungs parsed, where the member
 * stands on them, and what a card gives of its own and holds in all.
 */

const RAW_TIERS = [
  {
    id: 't0',
    name_en: 'Member',
    name_ar: 'عضو',
    multiplier: 1,
    min_points_12m: 0,
    color: 'classic',
    perks: [],
    deals: [],
  },
  {
    id: 't1',
    name_en: 'Silver',
    name_ar: 'فضي',
    multiplier: '1.25',
    min_points_12m: 500,
    color: 'silver',
    perks: [{ id: 'p-syrup', kind: 'free_addons', name_en: 'Free syrup', name_ar: 'نكهة مجانية' }],
    deals: [{ id: 'd-silver', name_en: 'Silver hour', name_ar: 'ساعة الفضي' }],
  },
  {
    id: 't2',
    name_en: 'Gold',
    name_ar: 'ذهبي',
    multiplier: 1.5,
    min_points_12m: 1500,
    color: 'gold',
    perks: [
      { id: 'p-addons', kind: 'free_addons', name_en: 'Every add-on free', name_ar: 'كل الإضافات مجانًا' },
      { id: 'p-racket', kind: 'custom', name_en: 'A racket to borrow', name_ar: 'مضرب للإعارة' },
    ],
    deals: [{ id: 'd-gold', name_en: 'Gold breakfast', name_ar: 'فطور الذهبي' }],
  },
];

const loyalty = (over: Record<string, unknown> = {}): MyLoyalty =>
  parseMyLoyalty({
    enabled: true,
    points_12m: 900,
    tier: RAW_TIERS[1],
    next_tier: RAW_TIERS[2],
    tiers: RAW_TIERS,
    ...over,
  });

describe('parseLadder', () => {
  it('reads every rung with its privileges and deals', () => {
    const tiers = parseLadder(RAW_TIERS);
    expect(tiers.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
    expect(tiers[1]).toMatchObject({
      multiplier: 1.25,
      min_points_12m: 500,
      color: 'silver',
      perks: [{ id: 'p-syrup', kind: 'free_addons', name_en: 'Free syrup' }],
      deals: [{ id: 'd-silver', name_en: 'Silver hour' }],
    });
  });

  it('absent or malformed is no ladder, never a crash', () => {
    expect(parseLadder(undefined)).toEqual([]);
    expect(parseLadder(null)).toEqual([]);
    expect(parseLadder('tiers')).toEqual([]);
    expect(parseLadder({ id: 't0' })).toEqual([]);
    expect(parseMyLoyalty({ enabled: true }).tiers).toEqual([]);
    expect(parseMyLoyalty({ enabled: true, tiers: 7 }).tiers).toEqual([]);
  });

  it('leaves out what it cannot show and keeps the rest', () => {
    const tiers = parseLadder([
      null,
      { name_en: 'No id' },
      {
        id: 't9',
        name_en: 'Odd',
        name_ar: '',
        multiplier: 0,
        min_points_12m: -5,
        color: 'neon',
        perks: [
          { id: 'p1', kind: 'vip_lounge', name_en: 'Lounge', name_ar: '' },
          { id: 'p2', kind: 'custom', name_en: ' ', name_ar: '' },
          { kind: 'custom', name_en: 'No id', name_ar: '' },
          'x',
        ],
        deals: [{ id: 'd1', name_en: '', name_ar: '' }, { id: 'd2', name_en: 'Kept', name_ar: '' }],
      },
      { id: 't9', name_en: 'Twice', name_ar: '' },
    ]);
    expect(tiers).toHaveLength(1);
    // A rate that would print "0×" is the plain rate; an unknown colour the classic card; a
    // kind this build does not know still reads, as a line.
    expect(tiers[0]).toMatchObject({ multiplier: 1, min_points_12m: 0, color: 'classic' });
    expect(tiers[0]?.perks).toEqual([{ id: 'p1', kind: 'custom', name_en: 'Lounge', name_ar: '' }]);
    expect(tiers[0]?.deals).toEqual([{ id: 'd2', name_en: 'Kept', name_ar: '' }]);
  });

  it('climbs by threshold whatever order the rungs came in', () => {
    const tiers = parseLadder([RAW_TIERS[2], RAW_TIERS[0], RAW_TIERS[1]]);
    expect(tiers.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
  });
});

describe('ladderPosition', () => {
  it('marks the held rungs, the current one and the points each higher rung still needs', () => {
    const p = ladderPosition(loyalty());
    expect(p.rungs.map((r) => [r.tier.id, r.state, r.remaining])).toEqual([
      ['t0', 'held', 0],
      ['t1', 'current', 0],
      ['t2', 'ahead', 600],
    ]);
    expect(p.current?.id).toBe('t1');
    expect(p.next?.id).toBe('t2');
  });

  it('takes the tier the server names, even above what the points alone give', () => {
    // A card granted by the venue: 100 points, yet Gold.
    const p = ladderPosition(loyalty({ points_12m: 100, tier: RAW_TIERS[2], next_tier: null }));
    expect(p.rungs.map((r) => r.state)).toEqual(['held', 'held', 'current']);
    expect(p.next).toBeNull();
  });

  it('falls back to the points when the answer names no tier the ladder has', () => {
    const none = ladderPosition(loyalty({ tier: null }));
    expect(none.current?.id).toBe('t1');
    const stranger = ladderPosition(
      loyalty({ tier: { id: 'gone', name_en: 'Old', name_ar: '', multiplier: 1 }, points_12m: 20 }),
    );
    expect(stranger.current?.id).toBe('t0');
    expect(stranger.rungs.map((r) => r.remaining)).toEqual([0, 480, 1480]);
  });

  it('never asks for negative points, and is empty without a ladder', () => {
    const over = ladderPosition(loyalty({ points_12m: 5000, tier: RAW_TIERS[0] }));
    expect(over.rungs.map((r) => r.remaining)).toEqual([0, 0, 0]);
    expect(ladderPosition(loyalty({ tiers: undefined }))).toEqual({
      rungs: [],
      current: null,
      next: null,
    });
  });
});

describe('what a card gives', () => {
  const tiers = parseLadder(RAW_TIERS);

  it('a rung gives its own privileges and deals, and its rate only when above the one compared', () => {
    const gold = tiers[2]!;
    expect(rungGives(gold, 1.25)).toEqual({ multiplier: 1.5, perks: gold.perks, deals: gold.deals });
    expect(rungGives(gold, 1.5).multiplier).toBeNull();
    expect(rungGives(tiers[0]!).multiplier).toBeNull();
    expect(givesAnything(rungGives(tiers[0]!))).toBe(false);
    expect(givesAnything(rungGives(tiers[1]!))).toBe(true);
  });

  it('a card holds its own tier and every tier below, the highest first, nothing twice', () => {
    const gold = cardHolds(
      ladderPosition(loyalty({ tier: RAW_TIERS[2], next_tier: null, points_12m: 2000 })),
    );
    expect(gold.perks.map((p) => p.id)).toEqual(['p-addons', 'p-racket', 'p-syrup']);
    expect(gold.deals.map((d) => d.id)).toEqual(['d-gold', 'd-silver']);
    expect(gold.multiplier).toBe(1.5);

    const silver = cardHolds(ladderPosition(loyalty()));
    expect(silver.perks.map((p) => p.id)).toEqual(['p-syrup']);
    expect(silver.deals.map((d) => d.id)).toEqual(['d-silver']);

    const base = cardHolds(ladderPosition(loyalty({ tier: RAW_TIERS[0], points_12m: 0 })));
    expect(base).toEqual({ multiplier: null, perks: [], deals: [] });
    expect(givesAnything(base)).toBe(false);
  });

  it('a privilege the same row gives on two rungs is listed once', () => {
    const twice = parseLadder([
      { ...RAW_TIERS[1], perks: RAW_TIERS[2]!.perks },
      RAW_TIERS[2],
    ]);
    const held = cardHolds(
      ladderPosition({ points_12m: 2000, tier: twice[1]!, tiers: twice }),
    );
    expect(held.perks.map((p) => p.id)).toEqual(['p-addons', 'p-racket']);
  });
});

describe('tierProgress with the threshold the server now sends (0410)', () => {
  it('runs from the current card to the next, not from zero', () => {
    // 900 of the way from Silver (500) to Gold (1500): 400 / 1000.
    expect(tierProgress(loyalty())).toEqual({ fraction: 0.4, remaining: 600 });
  });
});

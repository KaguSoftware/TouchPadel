import { describe, expect, it } from 'vitest';
import type { MyLoyalty } from '@touch/core/loyalty';
import {
  cardHolds,
  givesAnything,
  ladderHasBirthdayGift,
  ladderPosition,
  parseLadder,
  perkDetail,
  perkMark,
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

// ── what the Green and Blue cards give (0445) ─────────────────────────────────

const CARD_TIERS = [
  { id: 'white', name_en: 'White', name_ar: 'الأبيض', multiplier: 1, min_points_12m: 0, color: 'white', perks: [], deals: [] },
  {
    id: 'green',
    name_en: 'Touch Padel green',
    name_ar: 'تتش بادل الأخضر',
    multiplier: 1,
    min_points_12m: 250,
    color: 'green',
    perks: [
      { id: 'g-drink', kind: 'gift', name_en: 'A drink on your birthday', name_ar: 'مشروب في عيد ميلادك', config: { when: 'birthday', categoryIds: ['c1'], itemIds: [], days: 7 } },
      { id: 'g-ring', kind: 'frame', name_en: 'The green ring', name_ar: 'الإطار الأخضر', config: { frameId: 'card-green' } },
      { id: 'g-stamps', kind: 'stamp_size', name_en: 'Drink card at 7', name_ar: 'بطاقة المشروبات عند 7', config: { size: 7 } },
    ],
    deals: [],
  },
  {
    id: 'blue',
    name_en: 'Touch Padel blue',
    name_ar: 'تتش بادل الأزرق',
    multiplier: 1,
    min_points_12m: 1000,
    color: 'blue',
    perks: [
      { id: 'b-addons', kind: 'free_addons', name_en: 'Free add-ons', name_ar: 'إضافات مجانية' },
      { id: 'b-stamps', kind: 'stamp_size', name_en: 'Drink card full at 6', name_ar: 'بطاقة المشروبات تمتلئ عند 6', config: { size: 6 } },
      { id: 'b-tea', kind: 'free_with', name_en: 'Tea or water with any dessert', name_ar: 'شاي أو ماء مع أي حلى', config: { triggerCategoryIds: ['desserts'], triggerItemIds: [], freeCategoryIds: [], freeItemIds: ['tea', 'water'] } },
      { id: 'b-cake', kind: 'gift', name_en: 'A dessert on your birthday', name_ar: 'حلى في عيد ميلادك', config: { when: 'birthday', categoryIds: ['desserts'], itemIds: [] } },
    ],
    deals: [],
  },
];

describe('the card privileges (0445)', () => {
  const tiers = parseLadder(CARD_TIERS);
  const perk = (id: string) => tiers.flatMap((t) => t.perks).find((p) => p.id === id);

  it('reads every new kind with its config', () => {
    expect(perk('g-drink')).toMatchObject({ kind: 'gift', config: { days: 7, categoryIds: ['c1'] } });
    expect(perk('g-ring')).toMatchObject({ kind: 'frame', config: { frameId: 'card-green' } });
    expect(perk('b-stamps')).toMatchObject({ kind: 'stamp_size', config: { size: 6 } });
    expect(perk('b-tea')).toMatchObject({ kind: 'free_with', config: { freeItemIds: ['tea', 'water'] } });
    // A gift without days lasts the server's default week.
    expect(perk('b-cake')?.config).toMatchObject({ days: 7 });
  });

  it('a config that does not read leaves the line as its name alone', () => {
    const [t] = parseLadder([
      {
        ...CARD_TIERS[1],
        perks: [
          { id: 'x1', kind: 'frame', name_en: 'Ring', name_ar: '', config: { frameId: 'gold-racket' } },
          { id: 'x2', kind: 'stamp_size', name_en: 'Stamps', name_ar: '', config: { size: 40 } },
        ],
      },
    ]);
    expect(t?.perks.map((p) => p.config)).toEqual([undefined, undefined]);
    expect(t?.perks.map(perkDetail)).toEqual([null, null]);
  });

  it('a kind-specific line under each name, none for add-ons and custom lines', () => {
    expect(perkDetail(perk('g-drink')!)).toEqual({ key: 'loyalty.guest.gives.giftBirthday', days: 7 });
    expect(perkDetail(perk('b-tea')!)).toEqual({ key: 'loyalty.guest.gives.freeWithDetail' });
    expect(perkDetail(perk('b-stamps')!)).toEqual({ key: 'loyalty.guest.gives.stampSizeDetail', size: 6 });
    expect(perkDetail(perk('g-ring')!)).toEqual({ key: 'loyalty.guest.gives.frameDetail', frameId: 'card-green' });
    expect(perkDetail(perk('b-addons')!)).toBeNull();
  });

  it('Blue holds Green gifts too, and the drink card line is only the smaller size', () => {
    const blue = cardHolds(
      ladderPosition({ points_12m: 1200, tier: CARD_TIERS[2] as never, tiers }),
    );
    const ids = blue.perks.map((p) => p.id);
    expect(ids).toEqual(['b-addons', 'b-stamps', 'b-tea', 'b-cake', 'g-drink', 'g-ring']);
    expect(ids).not.toContain('g-stamps');
    const green = cardHolds(ladderPosition({ points_12m: 300, tier: CARD_TIERS[1] as never, tiers }));
    expect(green.perks.map((p) => p.id)).toEqual(['g-drink', 'g-ring', 'g-stamps']);
  });

  it('Edit profile notes the 30 days only when some card carries a birthday gift', () => {
    expect(ladderHasBirthdayGift({ enabled: true, tiers })).toBe(true);
    expect(ladderHasBirthdayGift({ enabled: false, tiers })).toBe(false);
    expect(ladderHasBirthdayGift({ enabled: true, tiers: parseLadder(RAW_TIERS) })).toBe(false);
    expect(ladderHasBirthdayGift(null)).toBe(false);
  });
});

describe('monthly, card-up and court-hour gifts, and the free size up (0445)', () => {
  const gift = (id: string, config: Record<string, unknown>) => ({ id, kind: 'gift', name_en: id, name_ar: id, config });
  const RUNGS = [
    { ...CARD_TIERS[0] },
    {
      ...CARD_TIERS[1],
      perks: [
        gift('green-welcome', { when: 'card_up', target: 'items', categoryIds: ['c'], itemIds: [] }),
        gift('green-month', { when: 'monthly', target: 'items', categoryIds: ['c'], itemIds: [], days: 9 }),
      ],
    },
    {
      ...CARD_TIERS[2],
      perks: [
        gift('blue-welcome', { when: 'card_up', target: 'court_hour', categoryIds: [], itemIds: [], days: 14 }),
        gift('blue-bday-court', { when: 'birthday', target: 'court_hour', categoryIds: [], itemIds: [] }),
        { id: 'blue-size', kind: 'size_upgrade', name_en: 'Size up', name_ar: 'حجم أكبر', config: { categoryIds: ['coffee'], itemIds: [] } },
      ],
    },
  ];
  const tiers = parseLadder(RUNGS);
  const perk = (id: string) => tiers.flatMap((t) => t.perks).find((p) => p.id === id)!;

  it('reads when, target and days with the server defaults', () => {
    expect(perk('green-welcome').config).toMatchObject({ when: 'card_up', target: 'items', days: 30 });
    // Monthly takes no days, whatever was sent.
    expect(perk('green-month').config).not.toHaveProperty('days');
    expect(perk('blue-welcome').config).toMatchObject({ when: 'card_up', target: 'court_hour', days: 14 });
    expect(perk('blue-bday-court').config).toMatchObject({ when: 'birthday', target: 'court_hour', days: 7 });
    expect(perk('blue-size')).toMatchObject({ kind: 'size_upgrade', config: { categoryIds: ['coffee'] } });
    // An unknown when or target reads as the defaults.
    const [odd] = parseLadder([{ ...RUNGS[1], perks: [gift('odd', { when: 'weekly', target: 'spa' })] }]);
    expect(odd?.perks[0]?.config).toMatchObject({ when: 'birthday', target: 'items', days: 7 });
  });

  it('says when each gift opens, and that a court hour is one', () => {
    expect(perkDetail(perk('green-month'))).toEqual({ key: 'loyalty.guest.gives.giftMonthly', days: null });
    expect(perkDetail(perk('green-welcome'))).toEqual({ key: 'loyalty.guest.gives.giftCardUp', days: 30 });
    expect(perkDetail(perk('blue-welcome'))).toEqual({ key: 'loyalty.guest.gives.giftCardUpCourt', days: 14 });
    expect(perkDetail(perk('blue-bday-court'))).toEqual({ key: 'loyalty.guest.gives.giftBirthdayCourt', days: 7 });
    expect(perkDetail(perk('blue-size'))).toEqual({ key: 'loyalty.guest.gives.sizeUpgradeDetail' });
  });

  it('marks each line: court hours with the court, item gifts by when they open', () => {
    expect(perkMark(perk('green-month'))).toBe('monthly');
    expect(perkMark(perk('green-welcome'))).toBe('cardUp');
    expect(perkMark(perk('blue-welcome'))).toBe('court');
    expect(perkMark(perk('blue-bday-court'))).toBe('court');
    expect(perkMark(perk('blue-size'))).toBe('sizeUp');
    expect(perkMark(parseLadder(CARD_TIERS)[1]!.perks[0]!)).toBe('birthday');
  });

  it('a card above does not hold a lower card\'s card-up welcome; its own it does', () => {
    const blue = cardHolds(ladderPosition({ points_12m: 1200, tier: RUNGS[2] as never, tiers }));
    expect(blue.perks.map((p) => p.id)).toEqual(['blue-welcome', 'blue-bday-court', 'blue-size', 'green-month']);
  });

  it('only a birthday gift brings the 30-day note', () => {
    const noBirthday = parseLadder([RUNGS[0], RUNGS[1]]);
    expect(ladderHasBirthdayGift({ enabled: true, tiers: noBirthday })).toBe(false);
    expect(ladderHasBirthdayGift({ enabled: true, tiers })).toBe(true);
  });
});

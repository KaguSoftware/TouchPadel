import { describe, expect, it } from 'vitest';
import type { ItemRef } from './compare';
import { tallyBaskets } from './basket';
import { CO_MOVE_MAX_CANDIDATES, CO_MOVE_MAX_ITEMS, DEFAULT_PATTERNS_COPY_EN, MAX_PATTERN_LEVEL, minePatterns, type PatternsInput, pearson } from './patterns';
import { buildPriceBands } from './priceBands';

const names = new Map<string, ItemRef>(
  [
    ['x', 'Waffle', 'وافل'],
    ['y', 'Burger', 'برغر'],
    ['z', 'Cola', 'كولا'],
    ['f', 'Friday Special', 'طبق الجمعة'],
    ['g', 'Everyday Tea', 'شاي'],
    ['p', 'Kahi', 'كاهي'],
    ['q', 'Geymar', 'قيمر'],
    ['r', 'Water', 'ماء'],
    ['h', 'High Margin', 'هامش عالٍ'],
    ['l', 'Low Margin', 'هامش منخفض'],
  ].map(([id, en, ar]) => [id!, { id: id!, nameEn: en!, nameAr: ar! }]),
);

/** 2026-09-01 (Tue) .. 2026-09-12 (Sat): 12 days, Fridays on 09-04 and 09-11. */
const DAYS = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
/** 2026-09-01 .. 2026-09-14: the 14 recorded days a level-0 daily correlation needs. */
const DAYS14 = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);

const emptyInput: PatternsInput = { soldByDay: [], recordedDays: [], names };

describe('pearson', () => {
  it('matches known values', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
    expect(pearson([1, 2], [1, 2])).toBe(0);
    // Floating-point-noise "constants" (t·0.3/t) must read as constant, not as a ±1 correlation.
    const totals = [50, 80, 60, 100, 70, 90, 40, 110, 60, 120, 70, 30];
    const shares = (f: number) => totals.map((t) => (t * f) / t);
    expect(pearson(shares(0.3), shares(0.2))).toBe(0);
    expect(pearson(shares(0.3), totals)).toBe(0);
  });
});

describe('co-move family', () => {
  it('kills a pure-volume pair: constant shares of a varying day total', () => {
    // Multiples of 10 so the 30/20/50 % shares stay whole units.
    const totals = [50, 80, 60, 100, 70, 90, 40, 110, 60, 120, 70, 30, 90, 50];
    const soldByDay = DAYS14.flatMap((date, i) => {
      const t = totals[i]!;
      return [
        { id: 'x', date, qty: t * 0.3, revenueIqd: t * 0.3 * 5000 },
        { id: 'y', date, qty: t * 0.2, revenueIqd: t * 0.2 * 5000 },
        { id: 'z', date, qty: t * 0.5, revenueIqd: t * 0.5 * 2000 },
      ];
    });
    // Raw quantities are perfectly correlated…
    expect(pearson(totals.map((t) => t * 0.3), totals.map((t) => t * 0.2))).toBeCloseTo(1);
    // …but nothing survives the share control.
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS14 }, 0);
    expect(out.filter((c) => c.kind === 'co-move')).toEqual([]);
  });

  it('keeps a pair whose shares genuinely move together', () => {
    const totals = [50, 80, 60, 100, 70, 90, 55, 85, 65, 95, 75, 60, 70, 80];
    const share = [0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4, 0.1, 0.3];
    const soldByDay = DAYS14.flatMap((date, i) => {
      const xy = Math.round(totals[i]! * share[i]!);
      return [
        { id: 'x', date, qty: xy, revenueIqd: xy * 5000 },
        { id: 'y', date, qty: xy, revenueIqd: xy * 7000 },
        { id: 'z', date, qty: totals[i]! - 2 * xy, revenueIqd: (totals[i]! - 2 * xy) * 2000 },
      ];
    });
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS14 }, 0);
    const xy = out.find((c) => c.kind === 'co-move' && c.subjectIds.includes('x') && c.subjectIds.includes('y'));
    expect(xy).toBeDefined();
    expect(xy!.metrics.direction).toBe('together');
    expect(xy!.metrics.shareCorrelation).toBe(1);
    expect(xy!.subjects).toEqual(['Waffle', 'Burger']);
    expect(xy!.confidence).toBe('medium'); // 14 days: ≥10, <21
    expect(xy!.sampleLabel).toBe('14 days');
    expect(xy!.fallbackText).toContain('Waffle and Burger move together');
    expect(xy!.id).toBe('co-move:x|y');
    // Under 14 recorded days the strict level mines no daily correlation at all.
    expect(minePatterns({ ...emptyInput, soldByDay: soldByDay.filter((r) => r.date <= DAYS[11]!), recordedDays: DAYS }, 0).filter((c) => c.kind === 'co-move')).toEqual([]);
  });

  it('calls a pair inverse only when the quantities themselves anti-correlate', () => {
    // x and y both grow day over day (raw correlation positive) while z is flat, so
    // z's SHARE falls as theirs rise: a share artifact, never an "inverse" pair.
    const soldByDay = DAYS14.flatMap((date, i) => [
      { id: 'x', date, qty: 10 + i * 2, revenueIqd: (10 + i * 2) * 1000 },
      { id: 'y', date, qty: 12 + i * 3, revenueIqd: (12 + i * 3) * 1000 },
      { id: 'z', date, qty: 20, revenueIqd: 20000 },
    ]);
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS14 }, 0).filter((c) => c.kind === 'co-move');
    expect(out.filter((c) => c.metrics.direction === 'inverse')).toEqual([]);
    // x up, y down by the same steps: quantities anti-correlate, and so do the shares.
    const swap = DAYS14.flatMap((date, i) => [
      { id: 'x', date, qty: 10 + i * 2, revenueIqd: (10 + i * 2) * 1000 },
      { id: 'y', date, qty: 40 - i * 2, revenueIqd: (40 - i * 2) * 1000 },
      { id: 'z', date, qty: 20 + (i % 2) * 5, revenueIqd: (20 + (i % 2) * 5) * 1000 },
    ]);
    const inverse = minePatterns({ ...emptyInput, soldByDay: swap, recordedDays: DAYS14 }, 0).find((c) => c.id === 'co-move:x|y');
    expect(inverse).toBeDefined();
    expect(inverse!.metrics.direction).toBe('inverse');
    expect(inverse!.metrics.rawCorrelation).toBe(-1);
    expect(inverse!.fallbackText).toContain('slips on the days');
  });

  it('reads only the top items by quantity and keeps at most the strongest candidates', () => {
    expect([CO_MOVE_MAX_ITEMS, CO_MOVE_MAX_CANDIDATES]).toEqual([25, 8]);
    // 30 items that all move in lockstep: the 26th..30th by quantity never enter, and of
    // the 300 perfect pairs among the top 25 only eight survive.
    const share = [0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4, 0.1, 0.3];
    const ids = Array.from({ length: 30 }, (_, k) => `i${String(k).padStart(2, '0')}`);
    const manyNames = new Map(ids.map((id, k) => [id, { id, nameEn: `Item ${k}`, nameAr: `صنف ${k}` }]));
    const soldByDay = DAYS14.flatMap((date, i) => [
      // Item k sells (30 - k) × the day's share step, so i00 is the biggest seller and i29 the smallest.
      ...ids.map((id, k) => ({ id, date, qty: Math.round((30 - k) * 10 * share[i]!), revenueIqd: Math.round((30 - k) * 10 * share[i]!) * 1000 })),
      { id: 'flat', date, qty: 400, revenueIqd: 400000 },
    ]);
    const out = minePatterns({ ...emptyInput, names: new Map([...manyNames, ...names, ['flat', { id: 'flat', nameEn: 'Flat', nameAr: 'ثابت' }]]), soldByDay, recordedDays: DAYS14 }, 0).filter((c) => c.kind === 'co-move');
    expect(out).toHaveLength(CO_MOVE_MAX_CANDIDATES);
    expect(out.every((c) => c.subjectIds.every((id) => Number(id.slice(1)) < CO_MOVE_MAX_ITEMS))).toBe(true);
  });
});

describe('time family — sample disclosure', () => {
  // Friday Special sells 5 on each of the 2 Fridays and nothing else; tea sells 20 every day.
  const window = DAYS.slice(2); // 09-03 (Thu) .. 09-12 (Sat) = 10 days, Fridays 09-04, 09-11
  const soldByDay = window.flatMap((date) => [
    { id: 'g', date, qty: 20, revenueIqd: 20000 },
    ...(date === '2026-09-04' || date === '2026-09-11' ? [{ id: 'f', date, qty: 5, revenueIqd: 40000 }] : []),
  ]);

  it('is not computed at all at the strict level (needs 5 Fridays)', () => {
    expect(minePatterns({ ...emptyInput, soldByDay, recordedDays: window }, 0).filter((c) => c.kind === 'time')).toEqual([]);
  });

  it('surfaces at the loosest level, labelled low rather than dropped', () => {
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: window }, 2);
    const fri = out.filter((c) => c.kind === 'time');
    expect(fri).toHaveLength(1);
    expect(fri[0]).toMatchObject({
      id: 'time:f|wd:5',
      subjects: ['Friday Special', 'Friday'],
      subjectIds: ['f'],
      confidence: 'low',
      sampleSize: 2,
      sampleLabel: '2 Fridays',
    });
    expect(fri[0]!.metrics).toMatchObject({ weekday: 5, itemDayPct: 100, houseDayPct: 24 });
    expect(fri[0]!.metrics.index).toBeGreaterThan(4);
    expect(fri[0]!.fallbackText).toMatch(/^Friday Special skews to Friday/);
  });

  it('clamps the level to the last threshold set', () => {
    expect(MAX_PATTERN_LEVEL).toBe(3);
    const a = minePatterns({ ...emptyInput, soldByDay, recordedDays: window }, 2);
    const b = minePatterns({ ...emptyInput, soldByDay, recordedDays: window }, 99 as 2);
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id));
  });
});

describe('basket family', () => {
  it('flags a pair bought together far more than chance, from the rarer side', () => {
    const baskets = [
      ...Array.from({ length: 6 }, () => ['p', 'q']),
      ...Array.from({ length: 2 }, () => ['q', 'r']),
      ...Array.from({ length: 12 }, () => ['r']),
    ];
    const out = minePatterns({ ...emptyInput, pairTally: tallyBaskets(baskets) }, 0);
    const pq = out.find((c) => c.kind === 'basket');
    expect(pq).toBeDefined();
    expect(pq).toMatchObject({
      id: 'basket:p|q',
      subjects: ['Kahi', 'Geymar'],
      subjectIds: ['p', 'q'],
      metrics: { lift: 2.5, support: 6, confidencePct: 100, orders: 20 },
      confidence: 'medium',
      sampleLabel: '6 / 20 orders',
    });
    expect(pq!.fallbackText).toBe('100% of orders with Kahi also include Geymar (2.5× chance, 6 orders) — a combo / cross-sell opportunity.');
  });

  it('drops the obvious "everyone adds water" pair (lift ≈ 1)', () => {
    const baskets = [
      ...Array.from({ length: 10 }, () => ['p', 'r']),
      ...Array.from({ length: 10 }, () => ['q', 'r']),
      ...Array.from({ length: 10 }, () => ['p', 'q', 'r']),
    ];
    const out = minePatterns({ ...emptyInput, pairTally: tallyBaskets(baskets) }, 0);
    expect(out.filter((c) => c.kind === 'basket' && c.subjectIds.includes('r'))).toEqual([]);
  });

  it('reads a tally folded from the SQL bought-together rows, applying keep', () => {
    const pairTally = { orders: 300, solo: new Map([['p', 9], ['q', 12]]), pairs: [{ a: 'p', b: 'q', count: 9, aCount: 9, bCount: 12, orders: 300 }] };
    const out = minePatterns({ ...emptyInput, pairTally }, 0);
    expect(out.map((c) => c.id)).toEqual(['basket:p|q']);
    expect(out[0]!.metrics).toMatchObject({ lift: 25, support: 9, confidencePct: 100, orders: 300 });
    expect(minePatterns({ ...emptyInput, pairTally, keep: (id) => id !== 'q' }, 0)).toEqual([]);
  });
});

describe('segment family', () => {
  it('reports a price cliff as an index, never a percentage', () => {
    const prices = new Map([
      ['x', 2000],
      ['y', 15000],
    ]);
    const bands = buildPriceBands(
      [
        { id: 'x', priceIqd: null, views: 100 },
        { id: 'y', priceIqd: null, views: 100 },
      ],
      [
        { id: 'x', qty: 150, revenueIqd: 300000 },
        { id: 'y', qty: 20, revenueIqd: 300000 },
      ],
      prices,
    );
    const out = minePatterns({ ...emptyInput, priceBands: bands }, 0);
    const cliff = out.find((c) => c.kind === 'segment');
    expect(cliff).toMatchObject({
      id: 'segment:band:0|band:3|price',
      subjects: ['0–2,999 IQD', '10,000+ IQD'],
      subjectIds: [],
      metrics: { bestSalesPerView: '1.5×', worstSalesPerView: '0.2×' },
      confidence: 'high',
      sampleLabel: '200 views',
    });
    expect(cliff!.desc).toContain('NEVER a percentage');
  });

  it('names the band that sells and the band that is only browsed from the numbers, whichever is pricier', () => {
    // The 10,000+ band converts far better than the cheapest band here.
    const prices = new Map([
      ['x', 2000],
      ['y', 15000],
    ]);
    const bands = buildPriceBands(
      [
        { id: 'x', priceIqd: null, views: 100 },
        { id: 'y', priceIqd: null, views: 100 },
      ],
      [
        { id: 'x', qty: 20, revenueIqd: 40000 },
        { id: 'y', qty: 150, revenueIqd: 2250000 },
      ],
      prices,
    );
    const cliff = minePatterns({ ...emptyInput, priceBands: bands }, 0).find((c) => c.kind === 'segment');
    expect(cliff!.subjects).toEqual(['10,000+ IQD', '0–2,999 IQD']);
    expect(cliff!.fallbackText).toBe(
      '10,000+ IQD items sell 1.5 units per view while 0–2,999 IQD items sell 0.2 — the 0–2,999 IQD band is browsed far more than it is bought; look at what those pages promise.',
    );
    expect(cliff!.fallbackText).not.toMatch(/cheap band|pricey band/);
    expect(cliff!.desc).toContain('do not assume the cheaper band');
  });

  it('judges locales on penetration', () => {
    const out = minePatterns(
      {
        ...emptyInput,
        locales: [
          { locale: 'ar', sessions: 300, topItems: [{ id: 'p', rate: 0.4 }, { id: 'r', rate: 0.3 }] },
          { locale: 'en', sessions: 20, topItems: [{ id: 'y', rate: 0.5 }, { id: 'r', rate: 0.2 }] },
        ],
      },
      0,
    );
    const loc = out.find((c) => c.id.startsWith('segment:locale'));
    expect(loc).toMatchObject({ subjects: ['Kahi', 'Burger'], subjectIds: ['p', 'y'], confidence: 'low' });
    expect(loc!.sampleLabel).toBe('300 Arabic / 20 English sessions');
  });
});

describe('margin family', () => {
  it('detects mix drift between the two halves of the period and names the driver', () => {
    const costs = new Map([
      ['h', { priceIqd: 10000, costIqd: 2000 }],
      ['l', { priceIqd: 10000, costIqd: 8000 }],
    ]);
    const soldByDay = DAYS14.flatMap((date, i) => {
      const early = i < 7;
      return [
        { id: 'h', date, qty: early ? 20 : 5, revenueIqd: (early ? 20 : 5) * 10000 },
        { id: 'l', date, qty: early ? 5 : 20, revenueIqd: (early ? 5 : 20) * 10000 },
      ];
    });
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS14, costs }, 0);
    const mix = out.find((c) => c.kind === 'margin' && c.id.startsWith('margin:h|mix'));
    expect(mix).toBeDefined();
    expect(mix!.metrics).toMatchObject({ earlyMarginPct: 68, lateMarginPct: 32, shiftPoints: -36, days: 14, driver: 'High Margin' });
    expect(mix!.subjects).toEqual(['High Margin']);
    expect(mix!.confidence).toBe('medium');
    expect(mix!.fallbackText).toMatch(/^Gross margin fell from 68% .* to 32%/);
  });

  it('mines nothing without costs', () => {
    const soldByDay = DAYS14.map((date) => ({ id: 'h', date, qty: 20, revenueIqd: 200000 }));
    expect(minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS14 }, 0).filter((c) => c.kind === 'margin')).toEqual([]);
  });
});

describe('ranking, dedupe, copy, validation', () => {
  it('ranks by tier first, then score, and dedupes ids', () => {
    // A strong-but-thin weekday skew (low) plus a solid basket (medium): basket must come first.
    const window = DAYS.slice(2);
    const soldByDay = window.flatMap((date) => [
      { id: 'g', date, qty: 20, revenueIqd: 20000 },
      ...(date === '2026-09-04' || date === '2026-09-11' ? [{ id: 'f', date, qty: 5, revenueIqd: 40000 }] : []),
    ]);
    const baskets = [...Array.from({ length: 6 }, () => ['p', 'q']), ...Array.from({ length: 14 }, () => ['r'])];
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: window, pairTally: tallyBaskets(baskets) }, 2);
    expect(out.map((c) => [c.kind, c.confidence])).toEqual([
      ['basket', 'medium'],
      ['time', 'low'],
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
  });

  it('renders subjects and fallback text in Arabic with an ar copy', () => {
    const baskets = [...Array.from({ length: 6 }, () => ['p', 'q']), ...Array.from({ length: 14 }, () => ['r'])];
    const out = minePatterns({ ...emptyInput, pairTally: tallyBaskets(baskets) }, 0, { ...DEFAULT_PATTERNS_COPY_EN, locale: 'ar' });
    expect(out[0]!.subjects).toEqual(['كاهي', 'قيمر']);
    expect(out[0]!.fallbackText).toContain('كاهي');
  });

  it('applies the keep filter and validates money', () => {
    const baskets = [...Array.from({ length: 6 }, () => ['p', 'q']), ...Array.from({ length: 14 }, () => ['r'])];
    expect(minePatterns({ ...emptyInput, pairTally: tallyBaskets(baskets), keep: (id) => id !== 'p' }, 0)).toEqual([]);
    expect(() => minePatterns({ ...emptyInput, soldByDay: [{ id: 'x', date: DAYS[0]!, qty: 1, revenueIqd: 0.5 }], recordedDays: DAYS }, 0)).toThrow();
  });
});

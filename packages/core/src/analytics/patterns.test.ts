import { describe, expect, it } from 'vitest';
import type { ItemRef } from './compare';
import { DEFAULT_PATTERNS_COPY_EN, MAX_PATTERN_LEVEL, minePatterns, type PatternsInput, pearson } from './patterns';
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
    const totals = [50, 80, 60, 100, 70, 90, 40, 110, 60, 120, 70, 30];
    const soldByDay = DAYS.flatMap((date, i) => {
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
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS }, 0);
    expect(out.filter((c) => c.kind === 'co-move')).toEqual([]);
  });

  it('keeps a pair whose shares genuinely move together', () => {
    const totals = [50, 80, 60, 100, 70, 90, 55, 85, 65, 95, 75, 60];
    const share = [0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4, 0.1, 0.3, 0.2, 0.4];
    const soldByDay = DAYS.flatMap((date, i) => {
      const xy = Math.round(totals[i]! * share[i]!);
      return [
        { id: 'x', date, qty: xy, revenueIqd: xy * 5000 },
        { id: 'y', date, qty: xy, revenueIqd: xy * 7000 },
        { id: 'z', date, qty: totals[i]! - 2 * xy, revenueIqd: (totals[i]! - 2 * xy) * 2000 },
      ];
    });
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS }, 0);
    const xy = out.find((c) => c.kind === 'co-move' && c.subjectIds.includes('x') && c.subjectIds.includes('y'));
    expect(xy).toBeDefined();
    expect(xy!.metrics.direction).toBe('together');
    expect(xy!.metrics.shareCorrelation).toBe(1);
    expect(xy!.subjects).toEqual(['Waffle', 'Burger']);
    expect(xy!.confidence).toBe('medium'); // 12 days: ≥10, <21
    expect(xy!.sampleLabel).toBe('12 days');
    expect(xy!.fallbackText).toContain('Waffle and Burger move together');
    expect(xy!.id).toBe('co-move:x|y');
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
    const out = minePatterns({ ...emptyInput, baskets }, 0);
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
    const out = minePatterns({ ...emptyInput, baskets }, 0);
    expect(out.filter((c) => c.kind === 'basket' && c.subjectIds.includes('r'))).toEqual([]);
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

  it('judges discounts on sales per view and locales on penetration', () => {
    const out = minePatterns(
      {
        ...emptyInput,
        discount: { discounted: { views: 100, sold: 40 }, regular: { views: 100, sold: 20 } },
        locales: [
          { locale: 'ar', sessions: 300, topItems: [{ id: 'p', rate: 0.4 }, { id: 'r', rate: 0.3 }] },
          { locale: 'en', sessions: 20, topItems: [{ id: 'y', rate: 0.5 }, { id: 'r', rate: 0.2 }] },
        ],
      },
      0,
    );
    const disc = out.find((c) => c.id === 'segment:discount');
    expect(disc).toMatchObject({ subjects: ['Discounts'], metrics: { ratio: 2 } });
    expect(disc!.fallbackText).toMatch(/^Discounted items turn 40 of every 100 views/);
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
    const soldByDay = DAYS.flatMap((date, i) => {
      const early = i < 6;
      return [
        { id: 'h', date, qty: early ? 20 : 5, revenueIqd: (early ? 20 : 5) * 10000 },
        { id: 'l', date, qty: early ? 5 : 20, revenueIqd: (early ? 5 : 20) * 10000 },
      ];
    });
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS, costs }, 0);
    const mix = out.find((c) => c.kind === 'margin' && c.id.startsWith('margin:h|mix'));
    expect(mix).toBeDefined();
    expect(mix!.metrics).toMatchObject({ earlyMarginPct: 68, lateMarginPct: 32, shiftPoints: -36, days: 12, driver: 'High Margin' });
    expect(mix!.subjects).toEqual(['High Margin']);
    expect(mix!.confidence).toBe('medium');
    expect(mix!.fallbackText).toMatch(/^Gross margin fell from 68% .* to 32%/);
  });

  it('mines nothing without costs', () => {
    const soldByDay = DAYS.map((date) => ({ id: 'h', date, qty: 20, revenueIqd: 200000 }));
    expect(minePatterns({ ...emptyInput, soldByDay, recordedDays: DAYS }, 0).filter((c) => c.kind === 'margin')).toEqual([]);
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
    const out = minePatterns({ ...emptyInput, soldByDay, recordedDays: window, baskets }, 2);
    expect(out.map((c) => [c.kind, c.confidence])).toEqual([
      ['basket', 'medium'],
      ['time', 'low'],
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
  });

  it('renders subjects and fallback text in Arabic with an ar copy', () => {
    const baskets = [...Array.from({ length: 6 }, () => ['p', 'q']), ...Array.from({ length: 14 }, () => ['r'])];
    const out = minePatterns({ ...emptyInput, baskets }, 0, { ...DEFAULT_PATTERNS_COPY_EN, locale: 'ar' });
    expect(out[0]!.subjects).toEqual(['كاهي', 'قيمر']);
    expect(out[0]!.fallbackText).toContain('كاهي');
  });

  it('applies the keep filter and validates money', () => {
    const baskets = [...Array.from({ length: 6 }, () => ['p', 'q']), ...Array.from({ length: 14 }, () => ['r'])];
    expect(minePatterns({ ...emptyInput, baskets, keep: (id) => id !== 'p' }, 0)).toEqual([]);
    expect(() => minePatterns({ ...emptyInput, soldByDay: [{ id: 'x', date: DAYS[0]!, qty: 1, revenueIqd: 0.5 }], recordedDays: DAYS }, 0)).toThrow();
  });
});

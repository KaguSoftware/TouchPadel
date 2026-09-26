/**
 * The post-model gate of `analytics-insights` (functions/_shared/insightsGate.ts),
 * pure and run here without Deno: dedupe → strong → rejected → low-confidence →
 * excluded → uncited amounts → rank → cap. What survives is what the owner sees.
 */
import { describe, expect, it } from 'vitest';
import type { InsightWire } from '../supabase/functions/_shared/insightsContract.ts';
import { collectAmounts, gateInsights, WEEKDAYS } from '../supabase/functions/_shared/insightsGate.ts';
import { MAX_FINDINGS } from '../supabase/functions/_shared/insightsText.ts';

const f = (text: string, over: Partial<InsightWire> = {}): InsightWire => ({
  text,
  kind: 'summary',
  subjects: [],
  metrics: {},
  confidence: 'medium',
  sample: null,
  ...over,
});

const basis = {
  salesDays: 5,
  weekdayCounts: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, days: day === 5 ? 4 : 1 })),
};

describe('collectAmounts', () => {
  it('collects every finite number anywhere in the payload, rounded to the dinar', () => {
    const amounts = collectAmounts({
      kpis: { total_sales_iqd: 12500.4, tabs: 7 },
      daily: [{ revenue_iqd: 900000, orders: 12 }],
      margins: { items: [{ margin_iqd: -300, name: 'Kahi' }] },
      nothing: null,
      text: 'not 42',
      inf: Number.POSITIVE_INFINITY,
    });
    expect([...amounts].sort((a, b) => a - b)).toEqual([-300, 7, 12, 12500, 900000]);
  });
});

describe('gateInsights', () => {
  it('runs the steps in order and keeps only what every one of them allows', () => {
    const items = [
      f('Kahi brought 12,500 IQD from 40 units', { confidence: 'high', sample: 40 }),
      f('KAHI brought 12,500 IQD from 40 units!'), // duplicate after normalisation
      f('Kahi is doing well lately'), // not strong: no digit
      f('Latte sells 9,000 IQD a week', { confidence: 'high', sample: 90 }), // rejected by the owner
      f('Sundays are quiet: 3 orders', { confidence: 'high' }), // one Sunday in the basis
      f('Sales rose 20% to 900,000 IQD', { confidence: 'high' }), // trend on 5 days
      f('Meal Upgrade drives 30% of revenue', { confidence: 'high' }), // excluded item
      f('Kahi is worth approximately 375,000 IQD per month', { confidence: 'high', sample: 40 }), // amount not in the data
      f('Fridays bring 40% of Kahi sales: 900,000 IQD', { confidence: 'medium', sample: 4 }),
      f('Water sold 30 units', { confidence: 'medium', sample: 30 }),
    ];
    const kept = gateInsights(items, {
      rejections: ['Latte sells 9,000 IQD a week.'],
      basis,
      excludedNames: ['meal upgrade'],
      amounts: new Set([12500, 900000, 40, 30]),
    });
    expect(kept.map((i) => i.text)).toEqual([
      'Kahi brought 12,500 IQD from 40 units',
      'Water sold 30 units',
      'Fridays bring 40% of Kahi sales: 900,000 IQD',
    ]);
  });

  it('skips the confidence and amount gates when their context is null, and caps', () => {
    const items = Array.from({ length: 12 }, (_, i) => f(`finding ${i} rose to ${1000 + i} IQD on Sunday`, { sample: i }));
    const kept = gateInsights(items, { rejections: [], basis: null, excludedNames: [], amounts: null });
    expect(kept).toHaveLength(MAX_FINDINGS);
    // Same confidence: the larger sample first.
    expect(kept[0]!.text).toBe('finding 11 rose to 1011 IQD on Sunday');
    expect(gateInsights(items, { rejections: [], basis: null, excludedNames: [], amounts: null }, 3)).toHaveLength(3);
  });

  it('ranks by confidence before sample, never by the money cited', () => {
    const items = [
      f('low confidence but rich: 9,000,000 IQD', { confidence: 'low', sample: 500 }),
      f('medium confidence: 5 units sold', { confidence: 'medium', sample: 5 }),
      f('high confidence: 1 IQD in play', { confidence: 'high', sample: 1 }),
    ];
    const kept = gateInsights(items, { rejections: [], basis: null, excludedNames: [], amounts: null });
    expect(kept.map((i) => i.confidence)).toEqual(['high', 'medium', 'low']);
  });

  it('reads Arabic weekday spellings from the shared table', () => {
    expect(WEEKDAYS.ar[5]).toBe('الجمعة');
    const kept = gateInsights(
      [f('يوم الأحد هادئ: 3 طلبات'), f('مبيعات الكاهي ترتفع يوم الجمعة إلى 40%')],
      { rejections: [], basis, excludedNames: [], amounts: null },
    );
    expect(kept.map((i) => i.text)).toEqual(['مبيعات الكاهي ترتفع يوم الجمعة إلى 40%']);
  });
});

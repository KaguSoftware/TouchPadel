import { describe, expect, it } from 'vitest';
import { tabSettlePayloadSchema } from '@touch/core/schemas/mutations';
import type { OfflineAdjustment, OfflineTabLine } from '../../lib/offlineTabs';
import { discountAmountIqd, offlineSettlePayload, offlineTabTotals } from './offlineTotals';
import { taxContextFrom, type TaxContext } from './tabTotals';

/**
 * F-06: the offline estimate must be what the server charges at replay. The
 * server side is written out here on its own, from app.compute_tab_totals
 * (0299) and app.apply_discount (0244), in SQL's order and rounding — not by
 * calling the till's mirror — so the two are compared, not one with itself.
 */
function pgRound(x: number): number {
  // Postgres numeric round(): half away from zero.
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5);
}

interface ServerGroup {
  id: string;
  rate_bp: number;
  is_active: boolean;
}

function serverApplyDiscount(kind: OfflineAdjustment['kind'], value: number, subtotal: number): number {
  return kind === 'discount_percent' ? pgRound((subtotal * value) / 10000.0) : Math.min(value, subtotal);
}

/** compute_tab_totals for a tab with no court, no lesson, no tournament, whole-tab discounts only. */
function serverTotal(
  lines: { line_total_iqd: number; category_id: string | null }[],
  discounts: number[],
  groupOfCategory: Map<string, ServerGroup>,
  inclusive: boolean,
): number {
  const subtotal = lines.reduce((s, l) => s + l.line_total_iqd, 0);
  const discLine = 0;
  const discTab = discounts.reduce((s, d) => s + d, 0);
  const discount = Math.min(discLine + discTab, subtotal);
  const tabAlloc = Math.max(Math.min(discTab, discount - Math.min(discLine, discount)), 0);
  const grp = new Map<string | null, number>();
  for (const l of lines) {
    const g = l.category_id ? (groupOfCategory.get(l.category_id)?.id ?? null) : null;
    grp.set(g, (grp.get(g) ?? 0) + l.line_total_iqd);
  }
  const base = [...grp].map(([g, sub]) => ({ g, afterLine: Math.max(sub, 0) }));
  const sum = base.reduce((s, b) => s + b.afterLine, 0);
  let tax = 0;
  for (const b of base) {
    const group = [...groupOfCategory.values()].find((x) => x.id === b.g);
    if (!group || !group.is_active) continue;
    const taxable = Math.max(b.afterLine - (sum === 0 ? 0 : pgRound((tabAlloc * b.afterLine) / sum)), 0);
    tax += inclusive ? pgRound((taxable * group.rate_bp) / (10000.0 + group.rate_bp)) : pgRound((taxable * group.rate_bp) / 10000.0);
  }
  return Math.max(subtotal - discount + (inclusive ? 0 : tax), 0);
}

const groups = (rateBp: number) => [
  { id: 'cat-drinks', tax_group: { id: 'g-std', rate_bp: rateBp, is_active: true } },
  { id: 'cat-food', tax_group: { id: 'g-food', rate_bp: rateBp, is_active: true } },
  { id: 'cat-free', tax_group: null },
];

function serverGroups(rateBp: number): Map<string, ServerGroup> {
  return new Map([
    ['cat-drinks', { id: 'g-std', rate_bp: rateBp, is_active: true }],
    ['cat-food', { id: 'g-food', rate_bp: rateBp, is_active: true }],
  ]);
}

/** A small deterministic generator, so a failure names its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomTab(seed: number) {
  const r = rng(seed);
  const cats = ['cat-drinks', 'cat-food', 'cat-free'];
  const lines: OfflineTabLine[] = Array.from({ length: 1 + Math.floor(r() * 6) }, (_, i) => ({
    name: `item ${i}`,
    qty: 1 + Math.floor(r() * 4),
    priceIqd: 250 * (1 + Math.floor(r() * 60)),
    categoryId: cats[Math.floor(r() * cats.length)]!,
  }));
  const adjustments: OfflineAdjustment[] = [];
  const subtotal = lines.reduce((s, l) => s + l.priceIqd * l.qty, 0);
  const n = Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const kind: OfflineAdjustment['kind'] = r() < 0.5 ? 'discount_percent' : 'discount_amount';
    const value = kind === 'discount_percent' ? 100 * (1 + Math.floor(r() * 50)) : 500 * (1 + Math.floor(r() * 40));
    adjustments.push({ kind, value, amountIqd: discountAmountIqd(kind, value, subtotal), idemKey: `K${i}` });
  }
  return { lines, adjustments };
}

function compare(rateBp: number, inclusive: boolean, seed: number) {
  const { lines, adjustments } = randomTab(seed);
  const tax: TaxContext = taxContextFrom(groups(rateBp), inclusive);
  const estimate = offlineTabTotals({ lines, adjustments }, tax).total;
  const subtotal = lines.reduce((s, l) => s + l.priceIqd * l.qty, 0);
  const server = serverTotal(
    lines.map((l) => ({ line_total_iqd: l.priceIqd * l.qty, category_id: l.categoryId ?? null })),
    adjustments.map((a) => serverApplyDiscount(a.kind, a.value, subtotal)),
    serverGroups(rateBp),
    inclusive,
  );
  return { estimate, server };
}

describe('offline tab estimate equals the server total (F-06)', () => {
  it('tax 0 (every group, LANE DB F-06), no discount: the lines, nothing else', () => {
    const lines: OfflineTabLine[] = [
      { name: 'Latte', qty: 2, priceIqd: 4500, categoryId: 'cat-drinks' },
      { name: 'Croissant', qty: 1, priceIqd: 3250, categoryId: 'cat-food' },
    ];
    const totals = offlineTabTotals({ lines }, taxContextFrom(groups(0), false));
    expect(totals).toMatchObject({ subtotal: 12_250, discount: 0, tax: 0, total: 12_250 });
  });

  it('tax 0 with discounts: percent and amount, as apply_discount writes them', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { estimate, server } = compare(0, false, seed);
      expect(estimate, `seed ${seed}`).toBe(server);
    }
  });

  it('a non-zero rate, exclusive and inclusive, still agrees step for step', () => {
    for (const rate of [500, 1000, 1500]) {
      for (const inclusive of [false, true]) {
        for (let seed = 1; seed <= 150; seed++) {
          const { estimate, server } = compare(rate, inclusive, seed * 7 + rate);
          expect(estimate, `rate ${rate} inclusive ${inclusive} seed ${seed}`).toBe(server);
        }
      }
    }
  });

  it('no promotion is added: none can reach an offline tab before its settle (apply_best_promotion is online-only)', () => {
    const lines: OfflineTabLine[] = [{ name: 'Water', qty: 3, priceIqd: 1000, categoryId: 'cat-drinks' }];
    expect(offlineTabTotals({ lines, adjustments: [] }, taxContextFrom(groups(0), false)).total).toBe(3000);
  });

  it('a discount larger than the bill floors it at zero, as the server caps it', () => {
    const lines: OfflineTabLine[] = [{ name: 'Water', qty: 1, priceIqd: 1000, categoryId: 'cat-drinks' }];
    const adjustments: OfflineAdjustment[] = [{ kind: 'discount_amount', value: 5000, amountIqd: discountAmountIqd('discount_amount', 5000, 1000), idemKey: 'K' }];
    expect(offlineTabTotals({ lines, adjustments }, taxContextFrom(groups(0), false)).total).toBe(0);
  });

  it('an entry from an older build (no category) is untaxed, and no tax context means no tax', () => {
    const lines: OfflineTabLine[] = [{ name: 'Water', qty: 1, priceIqd: 1000 }];
    expect(offlineTabTotals({ lines }, taxContextFrom(groups(1000), false)).total).toBe(1000);
    expect(offlineTabTotals({ lines: [{ ...lines[0]!, categoryId: 'cat-drinks' }] }, null).total).toBe(1000);
  });
});

describe('discountAmountIqd mirrors app.apply_discount', () => {
  it('percent is basis points of the goods subtotal, rounded half up; an amount is capped at it', () => {
    expect(discountAmountIqd('discount_percent', 1000, 12_250)).toBe(1225);
    expect(discountAmountIqd('discount_percent', 3333, 1000)).toBe(333);
    expect(discountAmountIqd('discount_percent', 2500, 2)).toBe(1); // 0.5 rounds up
    expect(discountAmountIqd('discount_amount', 5000, 3000)).toBe(3000);
    expect(discountAmountIqd('discount_amount', 500, 3000)).toBe(500);
  });
});

describe('offlineSettlePayload', () => {
  it('carries the amount the cashier showed as both the amount and the expectation, and the tender for cash', () => {
    const cash = offlineSettlePayload({ tabIdemKey: 'TILL-01:tab.open:01J0000000000000000000000A', method: 'cash', totalIqd: 12_250, tenderedIqd: 15_000 });
    expect(cash).toEqual({ tabIdemKey: 'TILL-01:tab.open:01J0000000000000000000000A', method: 'cash', amountIqd: 12_250, expectedTotalIqd: 12_250, tenderedIqd: 15_000 });
    expect(tabSettlePayloadSchema.safeParse(cash).success).toBe(true);
    const card = offlineSettlePayload({ tabIdemKey: 'TILL-01:tab.open:01J0000000000000000000000A', method: 'card', totalIqd: 9000, tenderedIqd: 9000 });
    expect(card).not.toHaveProperty('tenderedIqd');
    expect(tabSettlePayloadSchema.safeParse(card).success).toBe(true);
  });
});

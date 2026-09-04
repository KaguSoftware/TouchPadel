import { describe, it, expect } from 'vitest';
import { computeTabTotals, discountBreakdown, liveLines, type TaxContext, type TotalsInput } from './tabTotals';

// This arithmetic used to live inside a useMemo in the middle of a 1,162-line
// component, which is why the till's money display had no tests at all. The
// rules it mirrors are 0036's, and each one below is a defect that migration
// actually fixed.

const NO_TAX: TaxContext = { rateByCategory: new Map(), taxInclusive: false };
const TEN_PCT: TaxContext = { rateByCategory: new Map([['food', 1000]]), taxInclusive: false };

function line(total: number, over: Partial<TotalsInput['orders'][0]['order_items'][0]> = {}) {
  return {
    line_total_iqd: total,
    voided: false,
    menu_item: { category_id: 'food' },
    ...over,
  };
}

function tab(over: Partial<TotalsInput> = {}): TotalsInput {
  return {
    orders: [{ status: 'sent', order_items: [line(10_000)] }],
    tab_adjustments: [],
    payments: [],
    ...over,
  };
}

describe('liveLines', () => {
  it('drops voided lines', () => {
    const orders = [{ status: 'sent', order_items: [line(1000), line(2000, { voided: true })] }];
    expect(liveLines(orders)).toHaveLength(1);
  });

  it('drops every line of a voided order', () => {
    // A voided ORDER takes its lines with it even though none of them is
    // individually flagged — 0036 fix #3.
    const orders = [{ status: 'voided', order_items: [line(1000), line(2000)] }];
    expect(liveLines(orders)).toHaveLength(0);
  });
});

describe('computeTabTotals', () => {
  it('is all zeroes for no tab', () => {
    expect(computeTabTotals(null, NO_TAX)).toEqual({
      subtotal: 0,
      discount: 0,
      tax: 0,
      total: 0,
      paid: 0,
      due: 0,
    });
  });

  it('sums the live lines', () => {
    const t = computeTabTotals(
      tab({ orders: [{ status: 'sent', order_items: [line(4000), line(6000)] }] }),
      NO_TAX,
    );
    expect(t.subtotal).toBe(10_000);
    expect(t.total).toBe(10_000);
  });

  it('applies tax per group on the subtotal', () => {
    const t = computeTabTotals(tab(), TEN_PCT);
    expect(t.tax).toBe(1000);
    expect(t.total).toBe(11_000);
  });

  it('charges nothing for an untaxed category', () => {
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(10_000, { menu_item: { category_id: 'drink' } })] }],
      }),
      TEN_PCT,
    );
    expect(t.tax).toBe(0);
  });

  it('treats tax_inclusive as display-only', () => {
    // 0036: the figure is shown on the bill and NOT added again.
    const t = computeTabTotals(tab(), { ...TEN_PCT, taxInclusive: true });
    expect(t.tax).toBe(1000);
    expect(t.total).toBe(10_000);
  });

  it('subtracts discounts', () => {
    const t = computeTabTotals(
      tab({ tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 2500 }] }),
      NO_TAX,
    );
    expect(t.discount).toBe(2500);
    expect(t.total).toBe(7500);
  });

  it('caps the discount at the subtotal', () => {
    // Two managers each granting 100% must not make the tab owe less than zero.
    const t = computeTabTotals(
      tab({
        tab_adjustments: [
          { kind: 'discount_amount', amount_iqd: 10_000 },
          { kind: 'discount_amount', amount_iqd: 10_000 },
        ],
      }),
      NO_TAX,
    );
    expect(t.discount).toBe(10_000);
    expect(t.total).toBe(0);
  });

  it('ignores adjustments that are not discounts', () => {
    // price_override already moved the line total; counting it again would
    // subtract the same money twice.
    const t = computeTabTotals(
      tab({ tab_adjustments: [{ kind: 'price_override', amount_iqd: 5000 }] }),
      NO_TAX,
    );
    expect(t.discount).toBe(0);
    expect(t.total).toBe(10_000);
  });

  it('tracks what has been paid and what is still due', () => {
    const t = computeTabTotals(tab({ payments: [{ amount_iqd: 4000 }] }), NO_TAX);
    expect(t.paid).toBe(4000);
    expect(t.due).toBe(6000);
  });

  it('never reports a negative amount due', () => {
    // An overpayment is a refund, not a credit the till should offer to spend.
    const t = computeTabTotals(tab({ payments: [{ amount_iqd: 25_000 }] }), NO_TAX);
    expect(t.due).toBe(0);
  });

  it('rounds tax half-up per group, as the server does', () => {
    // 3,333 at 10% is 333.3 -> 333; the server uses round() on the same base.
    const t = computeTabTotals(
      tab({ orders: [{ status: 'sent', order_items: [line(3333)] }] }),
      TEN_PCT,
    );
    expect(t.tax).toBe(333);
  });

  it('groups by RATE, so two categories at the same rate round once', () => {
    // Rounding each category separately would drift against the server, which
    // rounds per tax group.
    const two: TaxContext = {
      rateByCategory: new Map([
        ['food', 1000],
        ['snack', 1000],
      ]),
      taxInclusive: false,
    };
    const t = computeTabTotals(
      tab({
        orders: [
          {
            status: 'sent',
            order_items: [line(1005), line(1005, { menu_item: { category_id: 'snack' } })],
          },
        ],
      }),
      two,
    );
    // 2,010 at 10% = 201, not 101 + 101 = 202.
    expect(t.tax).toBe(201);
  });

  it('survives a missing tax context', () => {
    const t = computeTabTotals(tab(), null);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(10_000);
  });
});

describe('discountBreakdown', () => {
  it('separates promotion rows from manager discounts and ignores overrides', () => {
    const out = discountBreakdown([
      { kind: 'discount_percent', amount_iqd: 1000, reason_code: 'comp' },
      { kind: 'discount_amount', amount_iqd: 500, reason_code: 'promotion' },
      { kind: 'discount_amount', amount_iqd: 250, reason_code: 'promotion' },
      { kind: 'price_override', amount_iqd: 9999, reason_code: 'other' },
    ]);
    expect(out).toEqual({ manager: 1000, promotion: 750 });
  });

  it('treats a missing reason as a manager discount', () => {
    expect(discountBreakdown([{ kind: 'discount_amount', amount_iqd: 300 }])).toEqual({ manager: 300, promotion: 0 });
  });

  it('is zero for no adjustments', () => {
    expect(discountBreakdown([])).toEqual({ manager: 0, promotion: 0 });
  });
});

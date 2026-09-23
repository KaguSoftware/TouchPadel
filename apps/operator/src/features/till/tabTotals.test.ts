import { describe, it, expect } from 'vitest';
import {
  computeTabTotals,
  discountBreakdown,
  liveLines,
  taxContextFrom,
  type TaxContext,
  type TotalsInput,
  type TotalsLine,
} from './tabTotals';

// This arithmetic used to live inside a useMemo in the middle of a 1,162-line
// component, which is why the till's money display had no tests at all. The
// rules it mirrors are 0036's, and each one below is a defect that migration
// actually fixed.

const NO_TAX: TaxContext = taxContextFrom([], false);
const TEN_PCT: TaxContext = taxContextFrom([{ id: 'food', tax_group: { id: 'vat', rate_bp: 1000 } }], false);

function line(total: number, over: Partial<TotalsLine> = {}) {
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
      court: 0,
      total: 0,
      paid: 0,
      due: 0,
    });
  });

  it('reports no court fee when none is passed — a plain table tab is unchanged', () => {
    const t = computeTabTotals(tab(), TEN_PCT);
    expect(t.court).toBe(0);
    expect(t.total).toBe(11_000);
    expect(computeTabTotals(tab(), TEN_PCT, null)).toEqual(t);
    expect(computeTabTotals(tab(), TEN_PCT, 0)).toEqual(t);
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

  it('carves an inclusive tax out of the price and does not add it', () => {
    // 0106: rate/(10000+rate). 10,000 already containing 10% holds 909, not 1,000.
    const t = computeTabTotals(tab(), { ...TEN_PCT, taxInclusive: true });
    expect(t.tax).toBe(909);
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

  it('groups by TAX GROUP, so two categories in one group round once', () => {
    // Rounding each category separately would drift against the server, which
    // rounds per tax group.
    const two = taxContextFrom(
      [
        { id: 'food', tax_group: { id: 'vat', rate_bp: 1000 } },
        { id: 'snack', tax_group: { id: 'vat', rate_bp: 1000 } },
      ],
      false,
    );
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

describe('computeTabTotals — tax on the discounted base, as 0106 computes it', () => {
  // food is taxed at 10%; drink is in no tax group at all.
  const ctx = (active = true) =>
    taxContextFrom(
      [
        { id: 'food', tax_group: { id: 'vat', rate_bp: 1000, is_active: active } },
        { id: 'drink', tax_group: null },
      ],
      false,
    );
  const drink = { menu_item: { category_id: 'drink' } };

  it('taxes what is left after a whole-tab discount, not the full lines', () => {
    // 100,000 less 20,000 -> 8,000 tax and 88,000 due. The old mirror said 10,000 / 90,000.
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(100_000)] }],
        tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 20_000, order_item_id: null }],
      }),
      ctx(),
    );
    expect(t.tax).toBe(8000);
    expect(t.total).toBe(88_000);
  });

  it('spreads a whole-tab discount pro rata, untaxed groups included', () => {
    // 10,000 off 100,000: food carries 60% of it (6,000), so 54,000 is taxed.
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(60_000, { id: 'a' }), line(40_000, { id: 'b', ...drink })] }],
        tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 10_000, order_item_id: null }],
      }),
      ctx(),
    );
    expect(t.tax).toBe(5400);
    expect(t.total).toBe(95_400);
  });

  it('takes a line discount off its own group only', () => {
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(60_000, { id: 'a' }), line(40_000, { id: 'b', ...drink })] }],
        tab_adjustments: [{ kind: 'discount_percent', amount_iqd: 6000, order_item_id: 'a' }],
      }),
      ctx(),
    );
    expect(t.discount).toBe(6000);
    expect(t.tax).toBe(5400);
    expect(t.total).toBe(99_400);
  });

  it('drops a line discount whose line was voided', () => {
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(10_000, { id: 'a' }), line(5000, { id: 'v', voided: true })] }],
        tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 5000, order_item_id: 'v' }],
      }),
      ctx(),
    );
    expect(t.discount).toBe(0);
    expect(t.total).toBe(11_000);
  });

  it('charges no tax for an inactive group, which still takes its share of the discount', () => {
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(50_000, { id: 'a' }), line(50_000, { id: 'b', menu_item: { category_id: 'bev' } })] }],
        tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 10_000, order_item_id: null }],
      }),
      taxContextFrom(
        [
          { id: 'food', tax_group: { id: 'old', rate_bp: 1000, is_active: false } },
          { id: 'bev', tax_group: { id: 'vat', rate_bp: 1000 } },
        ],
        false,
      ),
    );
    // bev: 50,000 less half the 10,000 -> 45,000 taxed -> 4,500.
    expect(t.tax).toBe(4500);
  });

  it('lets only the whole-tab discount that survives the cap reduce the base', () => {
    // 8,000 line + 5,000 tab on 10,000: the cap leaves 2,000 of the tab discount.
    const t = computeTabTotals(
      tab({
        orders: [{ status: 'sent', order_items: [line(10_000, { id: 'a' })] }],
        tab_adjustments: [
          { kind: 'discount_amount', amount_iqd: 8000, order_item_id: 'a' },
          { kind: 'discount_amount', amount_iqd: 5000, order_item_id: null },
        ],
      }),
      ctx(),
    );
    expect(t.discount).toBe(10_000);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(0);
  });

  it('keys a group cached before its id was selected by its rate', () => {
    const t = computeTabTotals(tab(), taxContextFrom([{ id: 'food', tax_group: { rate_bp: 1000 } }], false));
    expect(t.tax).toBe(1000);
  });
});

describe('computeTabTotals — the court fee is a server figure', () => {
  // D4: the till's due and printed bill used to leave the court out, so the
  // "one payment" bill read short by the court while the server charged it.

  it('adds the court fee it is given to the total and the amount due', () => {
    const t = computeTabTotals(tab(), TEN_PCT, 30_000);
    expect(t.court).toBe(30_000);
    expect(t.subtotal).toBe(10_000);
    expect(t.total).toBe(41_000);
    expect(t.due).toBe(41_000);
  });

  it('charges a court-only booking tab with nothing ordered', () => {
    const t = computeTabTotals(tab({ orders: [] }), NO_TAX, 30_000);
    expect(t).toMatchObject({ subtotal: 0, court: 30_000, total: 30_000, due: 30_000 });
  });

  it('never lets a discount eat into the court fee — goods are floored first', () => {
    // 0106: greatest(subtotal - discount + tax, 0) + court.
    const t = computeTabTotals(
      tab({ tab_adjustments: [{ kind: 'discount_amount', amount_iqd: 10_000 }] }),
      NO_TAX,
      30_000,
    );
    expect(t.discount).toBe(10_000);
    expect(t.total).toBe(30_000);
  });

  it('keeps tax off the court fee', () => {
    const t = computeTabTotals(tab(), TEN_PCT, 30_000);
    expect(t.tax).toBe(1000);
  });

  it('counts payments against goods and court together', () => {
    const t = computeTabTotals(tab({ payments: [{ amount_iqd: 35_000 }] }), NO_TAX, 30_000);
    expect(t.paid).toBe(35_000);
    expect(t.due).toBe(5000);
  });

  it('a court already paid on another tab arrives as 0 and charges nothing', () => {
    expect(computeTabTotals(tab(), NO_TAX, 0)).toMatchObject({ court: 0, total: 10_000 });
  });

  it('ignores a nonsense court figure rather than charging it', () => {
    expect(computeTabTotals(tab(), NO_TAX, -5000).court).toBe(0);
    expect(computeTabTotals(tab(), NO_TAX, Number.NaN).total).toBe(10_000);
  });

  it('is all zeroes for no tab, even with a court figure', () => {
    expect(computeTabTotals(null, NO_TAX, 30_000)).toMatchObject({ court: 0, total: 0, due: 0 });
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

describe('a payload that predates an embed', () => {
  // The regression: lib/persist.ts warm-starts ['tabs'] out of localStorage,
  // and its buster is a constant in dev — so a station that had cached the
  // pre-c1b98ef shape hydrated rows with NO `orders` key and OpenTabs read
  // `undefined.filter`, killing /till/tabs behind the crash card. The buster
  // now carries a shape version; this is the belt under that brace.

  it('treats a missing orders embed as no lines rather than throwing', () => {
    expect(() => computeTabTotals({} as TotalsInput, NO_TAX)).not.toThrow();
    expect(computeTabTotals({} as TotalsInput, NO_TAX).total).toBe(0);
  });

  it('survives a missing order_items, tab_adjustments and payments', () => {
    const stale = { orders: [{ status: 'sent' }] } as unknown as TotalsInput;
    expect(computeTabTotals(stale, NO_TAX)).toMatchObject({ subtotal: 0, paid: 0, due: 0 });
  });

  it('liveLines tolerates an absent orders array', () => {
    expect(liveLines(undefined)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  billPrefill,
  billSections,
  billSteps,
  bpFromPercent,
  cafeApplyArgs,
  checkDraft,
  clearDiscountArgs,
  courtApplyArgs,
  draftOf,
  formatPart,
  isCustomerDiscountAdjustment,
  parsePart,
  percentFromBp,
  readBillState,
  readCustomerDiscount,
  refreshSignature,
  setDiscountArgs,
  type BillDiscountState,
  type CustomerDiscount,
  type DiscountDraft,
} from './discountLogic';

// Standing customer discounts (0342): percents travel as basis points, the
// editor's rules, and the calls a bill's dialog makes for keep, this bill
// only and remove.

const strip = (s: string) => s.replace(/[‎‏⁦-⁩]/g, '');

const standing: CustomerDiscount = {
  cafe: { kind: 'percent', value: 2000 },
  court: { kind: 'amount', value: 5000 },
  reason: 'coach',
  note: 'Club coach',
  set_by: { id: 's9', name: 'Ali' },
  set_at: '2026-10-12T09:00:00Z',
};

function state(over: Partial<BillDiscountState> = {}): BillDiscountState {
  return {
    customer: { id: 'c1', name: 'Sara Karim' },
    standing,
    cafe: null,
    court: null,
    cafe_needs_refresh: false,
    court_needs_refresh: false,
    court_allowed: true,
    cafe_waived: false,
    court_waived: false,
    ...over,
  };
}

function draft(over: Partial<DiscountDraft> = {}): DiscountDraft {
  return { cafe: { mode: 'percent', text: '20' }, court: { mode: 'none', text: '' }, reason: 'coach', note: '', ...over };
}

describe('basis points and formatting', () => {
  it('20% is 2000 basis points and back; 12.5% is 1250', () => {
    expect(bpFromPercent(20)).toBe(2000);
    expect(percentFromBp(2000)).toBe(20);
    expect(bpFromPercent(12.5)).toBe(1250);
  });

  it('formats a percent with the catalog sign and an amount as IQD', () => {
    expect(formatPart({ kind: 'percent', value: 1250 }, 'en', '%')).toBe('12.5%');
    expect(strip(formatPart({ kind: 'amount', value: 5000 }, 'en', '%'))).toBe('5,000 IQD');
  });

  it('knows the two customer reason codes on a tab', () => {
    expect(isCustomerDiscountAdjustment({ reason_code: 'customer_discount' })).toBe(true);
    expect(isCustomerDiscountAdjustment({ reason_code: 'customer_discount_once' })).toBe(true);
    expect(isCustomerDiscountAdjustment({ reason_code: 'promotion' })).toBe(false);
    expect(isCustomerDiscountAdjustment({})).toBe(false);
  });
});

describe('reading the server', () => {
  it('a discount with neither part, or none at all, is no discount', () => {
    expect(readCustomerDiscount(null)).toBeNull();
    expect(readCustomerDiscount({ cafe: null, court: null, reason: 'coach' })).toBeNull();
    expect(readCustomerDiscount(standing)).toEqual(standing);
  });

  it('a bill state from an empty answer reads as no customer and nothing to refresh', () => {
    expect(readBillState({})).toEqual({
      customer: null,
      standing: null,
      cafe: null,
      court: null,
      cafe_needs_refresh: false,
      court_needs_refresh: false,
      court_allowed: false,
      cafe_waived: false,
      court_waived: false,
    });
  });
});

describe('parsePart', () => {
  it('a percent from 0.01 to 100, two decimals at most, Arabic digits folded', () => {
    expect(parsePart({ mode: 'percent', text: '20' })).toEqual({ part: { kind: 'percent', value: 2000 }, error: null });
    expect(parsePart({ mode: 'percent', text: '٢٥' }).part).toEqual({ kind: 'percent', value: 2500 });
    expect(parsePart({ mode: 'percent', text: '100' }).part?.value).toBe(10000);
    expect(parsePart({ mode: 'percent', text: '101' }).error).toBe('percentRange');
    expect(parsePart({ mode: 'percent', text: '0' }).error).toBe('percentRange');
    expect(parsePart({ mode: 'percent', text: '12.345' }).error).toBe('percentRange');
  });

  it('an amount of at least 1 IQD, whole, commas allowed', () => {
    expect(parsePart({ mode: 'amount', text: '5,000' }).part).toEqual({ kind: 'amount', value: 5000 });
    expect(parsePart({ mode: 'amount', text: '0' }).error).toBe('amountRange');
    expect(parsePart({ mode: 'amount', text: '12.5' }).error).toBe('amountRange');
  });

  it('none is no part and no error; an empty value is "empty"', () => {
    expect(parsePart({ mode: 'none', text: '9' })).toEqual({ part: null, error: null });
    expect(parsePart({ mode: 'amount', text: ' ' }).error).toBe('empty');
  });
});

describe('checkDraft', () => {
  const both = { cafe: true, court: true };

  it('needs at least one part', () => {
    const c = checkDraft(draft({ cafe: { mode: 'none', text: '' } }), both);
    expect(c.ok).toBe(false);
    expect(c.errors.parts).toBe(true);
    // No part, so no reason is asked for yet.
    expect(c.errors.reason).toBeUndefined();
  });

  it('needs a reason when a part is set', () => {
    expect(checkDraft(draft({ reason: null }), both).errors.reason).toBe(true);
  });

  it('a part hidden by the bill is not checked', () => {
    const c = checkDraft(draft({ cafe: { mode: 'percent', text: '500' }, court: { mode: 'amount', text: '1000' } }), { cafe: false, court: true });
    expect(c.ok).toBe(true);
    expect(c.cafe).toBeNull();
    expect(c.court).toEqual({ kind: 'amount', value: 1000 });
  });

  it('a note over 120 characters is refused', () => {
    expect(checkDraft(draft({ note: 'x'.repeat(121) }), both).errors.note).toBe(true);
  });

  it('opens the record editor on the standing discount', () => {
    expect(draftOf(standing)).toEqual({ cafe: { mode: 'percent', text: '20' }, court: { mode: 'amount', text: '5000' }, reason: 'coach', note: 'Club coach' });
    expect(draftOf(null)).toEqual({ cafe: { mode: 'none', text: '' }, court: { mode: 'none', text: '' }, reason: null, note: '' });
  });
});

describe('RPC arguments', () => {
  it('set_customer_discount takes both parts, the reason and a trimmed note', () => {
    expect(setDiscountArgs('c1', { kind: 'percent', value: 2000 }, null, 'family', '  cousin ')).toEqual({
      p_customer_id: 'c1',
      p_cafe_kind: 'percent',
      p_cafe_value: 2000,
      p_court_kind: null,
      p_court_value: null,
      p_reason: 'family',
      p_note: 'cousin',
    });
  });

  it('removing sends both kinds null and no reason', () => {
    expect(clearDiscountArgs('c1')).toEqual({ p_customer_id: 'c1', p_cafe_kind: null, p_cafe_value: null, p_court_kind: null, p_court_value: null, p_reason: null, p_note: null });
  });

  it('apply_*: refresh sends no kind, none sends "none", a part sends kind, value and reason', () => {
    expect(cafeApplyArgs('t1', { kind: 'refresh' }, 'TILL-1')).toEqual({ p_tab_id: 't1', p_device_id: 'TILL-1' });
    expect(cafeApplyArgs('t1', { kind: 'none' }, null)).toEqual({ p_tab_id: 't1', p_kind: 'none', p_device_id: null });
    expect(courtApplyArgs('r1', { kind: 'part', part: { kind: 'percent', value: 1000 }, reason: 'staff' }, 'DESK-1')).toEqual({
      p_reservation_id: 'r1',
      p_kind: 'percent',
      p_value: 1000,
      p_reason: 'staff',
      p_device_id: 'DESK-1',
    });
  });
});

describe('the bill dialog', () => {
  const tabOnly = { tabId: 't1', reservationId: null };
  const both = { tabId: 't1', reservationId: 'r1' };

  it('shows café goods with a tab and the court when the booking takes one, never a closed one', () => {
    expect(billSections(state(), tabOnly)).toEqual({ cafe: true, court: false });
    expect(billSections(state(), both)).toEqual({ cafe: true, court: true });
    expect(billSections(state({ court_allowed: false }), both).court).toBe(false);
    expect(billSections(state({ court: { kind: 'percent', value: 1000, amount_iqd: 3000, standing: true, reason: 'coach', closed: true } }), both).court).toBe(false);
  });

  it('opens on what the bill carries, else the standing discount', () => {
    expect(billPrefill(state()).cafe).toEqual({ mode: 'percent', text: '20' });
    const once = state({ cafe: { kind: 'amount', value: 2000, amount_iqd: 2000, standing: false, adjustment_id: 'a1' } });
    expect(billPrefill(once).cafe).toEqual({ mode: 'amount', text: '2000' });
    expect(billPrefill(state({ standing: null })).reason).toBeNull();
  });

  it("keep: saves the standing discount (the court part it cannot show kept), then puts it on the tab with 'standing'", () => {
    const c = checkDraft(draft({ cafe: { mode: 'percent', text: '15' } }), billSections(state(), tabOnly));
    const steps = billSteps(state(), tabOnly, { kind: 'keep', check: c, reason: 'coach', note: 'n' });
    expect(steps).toEqual([
      { rpc: 'set_customer_discount', args: setDiscountArgs('c1', { kind: 'percent', value: 1500 }, { kind: 'amount', value: 5000 }, 'coach', 'n') },
      { rpc: 'apply_customer_discount', target: 'cafe', mode: { kind: 'standing' } },
    ]);
  });

  it("keep: 'standing' on each part shown replaces a one-off and lifts a waiver, nothing removed first", () => {
    const s = state({
      cafe: { kind: 'amount', value: 2000, amount_iqd: 2000, standing: false, adjustment_id: 'a1' },
      court_waived: true,
    });
    const c = checkDraft(draft({ court: { mode: 'percent', text: '10' } }), billSections(s, both));
    expect(billSteps(s, both, { kind: 'keep', check: c, reason: 'coach', note: '' }).map((x) => [x.rpc, 'mode' in x ? x.mode.kind : null])).toEqual([
      ['set_customer_discount', null],
      ['apply_customer_discount', 'standing'],
      ['apply_customer_court_discount', 'standing'],
    ]);
  });

  it('this bill only: each part shown goes on this bill; None takes off (and waives) what the bill carries', () => {
    const s = state({ court: { kind: 'amount', value: 5000, amount_iqd: 5000, standing: true, reason: 'coach', closed: false } });
    const c = checkDraft(draft(), billSections(s, both));
    expect(billSteps(s, both, { kind: 'once', check: c, reason: 'family' })).toEqual([
      { rpc: 'apply_customer_discount', target: 'cafe', mode: { kind: 'part', part: { kind: 'percent', value: 2000 }, reason: 'family' } },
      { rpc: 'apply_customer_court_discount', target: 'court', mode: { kind: 'none' } },
    ]);
  });

  it('remove: "none" on each part the bill carries, a closed court part left alone', () => {
    const s = state({
      cafe: { kind: 'percent', value: 2000, amount_iqd: 1000, standing: true, adjustment_id: 'a1' },
      court: { kind: 'amount', value: 5000, amount_iqd: 5000, standing: true, reason: 'coach', closed: true },
    });
    expect(billSteps(s, both, { kind: 'remove' })).toEqual([{ rpc: 'apply_customer_discount', target: 'cafe', mode: { kind: 'none' } }]);
  });

  it("this bill only: None on a part the standing discount is about to fill waives it; an already waived one is left", () => {
    const c = checkDraft(draft(), billSections(state(), both));
    expect(billSteps(state(), both, { kind: 'once', check: c, reason: 'coach' }).map((x) => ('mode' in x ? [x.rpc, x.mode.kind] : [x.rpc]))).toEqual([
      ['apply_customer_discount', 'part'],
      ['apply_customer_court_discount', 'none'],
    ]);
    expect(billSteps(state({ court_waived: true }), both, { kind: 'once', check: c, reason: 'coach' })).toHaveLength(1);
  });

  it('the refresh signature changes with the bill or the host figures, not otherwise', () => {
    const s = state({ cafe_needs_refresh: true });
    expect(refreshSignature(s, 'v1')).toBe(refreshSignature({ ...s }, 'v1'));
    expect(refreshSignature(s, 'v1')).not.toBe(refreshSignature(s, 'v2'));
    expect(refreshSignature(s, 'v1')).not.toBe(refreshSignature({ ...s, cafe_needs_refresh: false }, 'v1'));
  });
});

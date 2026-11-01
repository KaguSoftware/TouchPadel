import { describe, expect, it } from 'vitest';
import { confirmPriceMove, heldPriceMove, parseIqd } from '../priceCheck';

/** F-21: a court booking's price is checked before the guest confirms. */
describe('heldPriceMove (grid vs hold)', () => {
  it('says nothing when the hold carries the price the grid showed', () => {
    expect(heldPriceMove('30000', '30000')).toBeNull();
    expect(heldPriceMove(30000, '30000')).toBeNull();
  });

  it('names both prices when the hold carries another', () => {
    expect(heldPriceMove('30000', '35000')).toEqual({ fromIqd: 30000, toIqd: 35000 });
    expect(heldPriceMove('35000', '30000')).toEqual({ fromIqd: 35000, toIqd: 30000 });
  });

  it('says nothing when either side is unknown (a resumed hold carries no grid price)', () => {
    expect(heldPriceMove(undefined, '30000')).toBeNull();
    expect(heldPriceMove('', '30000')).toBeNull();
    expect(heldPriceMove('30000', '')).toBeNull();
    expect(heldPriceMove('abc', '30000')).toBeNull();
  });
});

describe('parseIqd', () => {
  it('takes whole non-negative amounts only', () => {
    expect(parseIqd('0')).toBe(0);
    expect(parseIqd(1500)).toBe(1500);
    expect(parseIqd('1.5')).toBeNull();
    expect(parseIqd('-1')).toBeNull();
    expect(parseIqd(null)).toBeNull();
  });
});

describe('confirmPriceMove (confirm_booking PRICE_CHANGED)', () => {
  const refusal = (details: string | null) => ({ message: 'PRICE_CHANGED', code: 'P0001', details });

  it('reads the new price from the refusal', () => {
    const err = refusal(JSON.stringify({ quoted_iqd: 30000, current_iqd: 36000, rate_rule_id: 'r' }));
    expect(confirmPriceMove(err, 30000)).toEqual({ fromIqd: 30000, toIqd: 36000 });
  });

  it('still counts as a move without a readable figure', () => {
    expect(confirmPriceMove(refusal(null), 30000)).toEqual({ fromIqd: 30000, toIqd: null });
    expect(confirmPriceMove(refusal('not json'), null)).toEqual({ fromIqd: null, toIqd: null });
  });

  it('is null for any other failure', () => {
    expect(confirmPriceMove({ message: 'SLOT_TAKEN', code: 'P0001' }, 30000)).toBeNull();
    expect(confirmPriceMove(new Error('Network request failed'), 30000)).toBeNull();
  });
});

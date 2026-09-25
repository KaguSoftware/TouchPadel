import { describe, expect, it } from 'vitest';
import { PRICE_CHANGE_KINDS, validateProtocolsSearch } from './search';

const ID = '5f0c2a9e-1b3d-4c6e-8f7a-9b0c1d2e3f40';

describe('validateProtocolsSearch', () => {
  it('lands a bare or mangled link on the plain page', () => {
    expect(validateProtocolsSearch({})).toEqual({});
    expect(validateProtocolsSearch({ run: 'R-12', step: 42, item: null, junk: 'x' })).toEqual({});
    expect(validateProtocolsSearch({ start: 'refund', variant: 'type4', change: 'discount', filter: 'all' })).toEqual({});
    // Enum values are exact: a case slip is a different word.
    expect(validateProtocolsSearch({ start: 'Tournament', filter: ['waiting'] })).toEqual({});
  });

  it('keeps a run and a step, lower-cased', () => {
    expect(validateProtocolsSearch({ run: ID.toUpperCase(), step: ID })).toEqual({ run: ID, step: ID });
  });

  it('keeps every start kind, tournament type and list filter', () => {
    for (const start of ['product_release', 'tournament', 'hiring', 'price_promo'] as const) {
      expect(validateProtocolsSearch({ start })).toEqual({ start });
    }
    expect(validateProtocolsSearch({ start: 'tournament', variant: 'type2' })).toEqual({ start: 'tournament', variant: 'type2' });
    for (const filter of ['waiting', 'active', 'finished'] as const) {
      expect(validateProtocolsSearch({ filter })).toEqual({ filter });
    }
  });

  it('keeps the eight price or promo change kinds and their targets (§5.5 links)', () => {
    expect(PRICE_CHANGE_KINDS).toHaveLength(8);
    for (const change of PRICE_CHANGE_KINDS) {
      expect(validateProtocolsSearch({ start: 'price_promo', change })).toEqual({ start: 'price_promo', change });
    }
    expect(validateProtocolsSearch({ start: 'price_promo', change: 'price', item: ID })).toEqual({
      start: 'price_promo',
      change: 'price',
      item: ID,
    });
    expect(validateProtocolsSearch({ change: 'addon_price', addon: ID })).toEqual({ change: 'addon_price', addon: ID });
    expect(validateProtocolsSearch({ change: 'promotion_edit', promotion: ID })).toEqual({ change: 'promotion_edit', promotion: ID });
    expect(validateProtocolsSearch({ change: 'rate', rule: ID, item: 'not-a-uuid' })).toEqual({ change: 'rate', rule: ID });
  });
});

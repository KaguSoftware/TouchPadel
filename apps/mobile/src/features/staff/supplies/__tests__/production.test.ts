import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_ROLES,
  batchArgs,
  batchIntent,
  parseQty,
  sortProduction,
  validateBatch,
  type ProductionItem,
} from '../production';

describe('parseQty', () => {
  it('reads amounts in either digit set and either decimal mark', () => {
    expect(parseQty('250')).toBe(250);
    expect(parseQty(' 1.5 ')).toBe(1.5);
    expect(parseQty('٢٥٠')).toBe(250);
    expect(parseQty('١٫٥')).toBe(1.5);
    expect(parseQty('.5')).toBe(0.5);
    expect(parseQty('2,500')).toBe(2500);
    expect(parseQty('٢٬٥٠٠')).toBe(2500);
  });

  it('rounds to three places, as the stock tables keep it', () => {
    expect(parseQty('0.12345')).toBe(0.123);
  });

  it('refuses nothing, zero, negatives, words and an ambiguous comma', () => {
    for (const bad of ['', '0', '0.0004', '-3', 'abc', '1,5', '1,50', '12,34,56', '1e3', '1000000000']) {
      expect(parseQty(bad), bad).toBeNull();
    }
  });
});

describe('a batch', () => {
  const today = '2026-09-25';

  it('needs an item and an amount; the use-by is optional but not in the past', () => {
    expect(validateBatch({ ingredientId: null, qty: '', expiry: '' }, today)).toEqual([
      { field: 'item', code: 'required' },
      { field: 'qty', code: 'required' },
    ]);
    expect(validateBatch({ ingredientId: 'ing', qty: 'x', expiry: '2026-13-01' }, today)).toEqual([
      { field: 'qty', code: 'invalid' },
      { field: 'expiry', code: 'invalid' },
    ]);
    expect(validateBatch({ ingredientId: 'ing', qty: '2', expiry: '2026-09-24' }, today)).toEqual([
      { field: 'expiry', code: 'past' },
    ]);
    expect(validateBatch({ ingredientId: 'ing', qty: '2', expiry: '2026/9/25' }, today)).toEqual([]);
  });

  it('sends the venue, and a use-by only when one was typed', () => {
    expect(batchArgs({ ingredientId: 'ing', qty: '1.5', expiry: '' }, 'v1')).toEqual({
      p_ingredient_id: 'ing',
      p_qty: 1.5,
      p_venue_id: 'v1',
    });
    expect(batchArgs({ ingredientId: 'ing', qty: '2', expiry: '٢٠٢٦-١٠-٠١' }, 'v1')).toEqual({
      p_ingredient_id: 'ing',
      p_qty: 2,
      p_expiry_date: '2026-10-01',
      p_venue_id: 'v1',
    });
  });

  it('keeps one key per batch: the same batch retried shares it, a corrected one does not', () => {
    const a = batchArgs({ ingredientId: 'ing', qty: '2', expiry: '' }, 'v1');
    const again = batchArgs({ ingredientId: 'ing', qty: '2.000', expiry: '' }, 'v1');
    const corrected = batchArgs({ ingredientId: 'ing', qty: '3', expiry: '' }, 'v1');
    expect(batchIntent(a)).toBe(batchIntent(again));
    expect(batchIntent(a)).not.toBe(batchIntent(corrected));
  });
});

describe('what to make today', () => {
  const row = (id: string, below: boolean): ProductionItem => ({
    ingredient_id: id,
    name_en: id,
    name_ar: id,
    unit: 'pc',
    on_hand: 0,
    par_level: 4,
    below_par: below,
    made_today: 0,
    shelf_life_days: 2,
  });

  it('lists below-par items first and keeps the server’s order within each group', () => {
    const sorted = sortProduction([row('a', false), row('b', true), row('c', false), row('d', true)]);
    expect(sorted.map((r) => r.ingredient_id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is for the chef tiers and management only', () => {
    expect([...PRODUCTION_ROLES].sort()).toEqual(['chef', 'head_chef', 'manager', 'owner']);
  });
});

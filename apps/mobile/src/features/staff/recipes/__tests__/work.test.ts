import { describe, expect, it } from 'vitest';
import { waitingCount } from '../../workCount';
import { recipeWorkOf, type MyRecipeChange, type RecipeChangeRow } from '../logic';

const NOW = new Date('2026-11-06T12:00:00Z');
const mine = (id: string, status: MyRecipeChange['status'], decided_at: string | null): MyRecipeChange => ({
  id, status, decided_at, target: 'variant', item_name_en: 'Latte', item_name_ar: null,
  size_name_en: 'M', size_name_ar: null, ops: [], note: null, requested_at: '2026-11-01T00:00:00Z',
  decided_by_name: null, decline_reason: null,
});

describe('recipeWorkOf', () => {
  it('splits a head’s own requests and drops decisions older than a week', () => {
    const w = recipeWorkOf(
      [mine('a', 'waiting', null), mine('b', 'approved', '2026-11-05T00:00:00Z'),
       mine('c', 'declined', '2026-10-01T00:00:00Z'), mine('d', 'withdrawn', null)],
      undefined, NOW,
    );
    expect(w.waiting.map((r) => r.id)).toEqual(['a']);
    expect(w.decided.map((r) => r.id)).toEqual(['b']);
  });
  it('keeps only waiting requests for the owner to decide', () => {
    const rows = [{ id: 'x', status: 'waiting' }, { id: 'y', status: 'approved' }] as RecipeChangeRow[];
    expect(recipeWorkOf(undefined, rows, NOW).toDecide.map((r) => r.id)).toEqual(['x']);
  });
  it('counts what the owner decides in the badge, not a head’s own', () => {
    expect(waitingCount(null, null, NOW, 3)).toBe(3);
    expect(waitingCount(null, null, NOW)).toBe(0);
  });
});

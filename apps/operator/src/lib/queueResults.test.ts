import { describe, expect, it } from 'vitest';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';
import { RESULT_INVALIDATIONS, awaitResult } from './queueResults';

describe('RESULT_INVALIDATIONS', () => {
  it('covers every registered mutation type — a result must always land somewhere', () => {
    expect(Object.keys(RESULT_INVALIDATIONS).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('money paths invalidate both the tab detail and the rail', () => {
    for (const type of ['order.add_items', 'tab.settle', 'adjustment.apply']) {
      const keys = RESULT_INVALIDATIONS[type]!.map((k) => k[0]);
      expect(keys, type).toContain('tab');
      expect(keys, type).toContain('tabs');
    }
  });
});

describe('awaitResult', () => {
  it('resolves null after the timeout — the write is queued, not lost', async () => {
    const result = await awaitResult('TILL1-01J5XAAAAAAAAAAAAAAAAAAAAA', 10);
    expect(result).toBeNull();
  });
});

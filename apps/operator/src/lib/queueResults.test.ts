import { describe, expect, it } from 'vitest';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';
import { RESULT_INVALIDATIONS, awaitResult } from './queueResults';
import { QK, RESERVATION_LIST_KEYS } from './queryKeys';

const serialize = (key: readonly unknown[]) => JSON.stringify(key);

/** Plain registry keys and every family's `all` root — what a fan-out may name. */
function registryRoots(): string[] {
  // `'all' in` rather than Array.isArray: TS does not narrow a union of readonly
  // tuples through Array.isArray, so the family branch would not type.
  return Object.values(QK).map((entry) => serialize('all' in entry ? entry.all : entry));
}

describe('RESULT_INVALIDATIONS', () => {
  it('covers every registered mutation type — a result must always land somewhere', () => {
    expect(Object.keys(RESULT_INVALIDATIONS).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('names only registry keys and roots — no literal can drift from the screens', () => {
    const allowed = new Set(registryRoots());
    for (const [type, keys] of Object.entries(RESULT_INVALIDATIONS)) {
      for (const key of keys) {
        expect(allowed.has(serialize(key)), `${type} invalidates unregistered ${serialize(key)}`).toBe(true);
      }
    }
  });

  it('money paths invalidate both the tab detail root and the rail', () => {
    for (const type of ['order.add_items', 'tab.settle', 'adjustment.apply']) {
      const keys = RESULT_INVALIDATIONS[type]!.map(serialize);
      expect(keys, type).toContain(serialize(QK.tab.all));
      expect(keys, type).toContain(serialize(QK.tabs));
    }
  });

  it('reservation writes refresh both reservation lists through the shared pair', () => {
    for (const type of ['reservation.create', 'reservation.update']) {
      const keys = RESULT_INVALIDATIONS[type]!.map(serialize);
      for (const key of RESERVATION_LIST_KEYS) expect(keys, type).toContain(serialize(key));
    }
  });
});

describe('awaitResult', () => {
  it('resolves null after the timeout — the write is queued, not lost', async () => {
    const result = await awaitResult('TILL1-01J5XAAAAAAAAAAAAAAAAAAAAA', 10);
    expect(result).toBeNull();
  });
});

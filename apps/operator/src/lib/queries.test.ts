import { describe, it, expect } from 'vitest';
import { QK } from './queries';
import { TABLE_QR_QUERY_KEY, TABLES_QUERY_KEY } from '../features/admin/qr/queries';

// Three keys were shared by two features each with different filters and column
// sets, against one global QueryClient with a 10 s staleTime — so whichever
// screen loaded first decided what the other one saw. The worst of them put
// switched-off tables into the till's new-tab picker. These tests are the guard
// against that class of bug coming back.

const serialize = (key: readonly unknown[]) => JSON.stringify(key);

describe('shared query keys', () => {
  it('are pairwise distinct', () => {
    const entries = Object.entries(QK);
    const seen = new Map<string, string>();
    for (const [name, key] of entries) {
      const s = serialize(key);
      const previous = seen.get(s);
      expect(previous, `${name} collides with ${previous}`).toBeUndefined();
      seen.set(s, name);
    }
    expect(seen.size).toBe(entries.length);
  });

  it('keeps the two cafe-table lists apart', () => {
    // The till wants active tables; the QR admin wants every row including
    // inactive. Same table, different questions — they must not share a key.
    expect(serialize(QK.activeCafeTables)).not.toBe(serialize(QK.allCafeTables));
    expect(serialize(TABLES_QUERY_KEY as readonly unknown[])).toBe(serialize(QK.allCafeTables));
  });

  it('does not let one cafe-table key prefix-match the other', () => {
    // React Query invalidates by prefix: a bare ['cafeTables'] key would match
    // BOTH lists, so the narrower one must not be a prefix of the wider one.
    expect(QK.activeCafeTables[0]).toBe(QK.allCafeTables[0]);
    expect(QK.activeCafeTables.length).toBe(QK.allCafeTables.length);
    expect(QK.activeCafeTables[1]).not.toBe(QK.allCafeTables[1]);
  });

  it('does not collide with the feature-owned QR token key', () => {
    const all = Object.values(QK).map(serialize);
    expect(all).not.toContain(serialize(TABLE_QR_QUERY_KEY as readonly unknown[]));
  });
});

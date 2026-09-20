import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { QK, compareTableNumbers } from './queries';
import { RESERVATION_LIST_KEYS, invalidateReservations } from './queryKeys';
import { TABLE_QR_QUERY_KEY, TABLES_QUERY_KEY } from '../features/admin/qr/queries';
import { OPEN_TABS_QUERY, tabDetailQuery } from '../features/till/tillData';

// Three keys were shared by two features each with different filters and column
// sets, against one global QueryClient with a 10 s staleTime — so whichever
// screen loaded first decided what the other one saw. The worst of them put
// switched-off tables into the till's new-tab picker. These tests are the guard
// against that class of bug coming back.

const serialize = (key: readonly unknown[]) => JSON.stringify(key);

type Builder = (arg: string) => readonly unknown[];

/**
 * Every concrete key the registry can produce: plain keys as they are, and for
 * a family its `all` root plus each builder called with one sample id. A
 * builder that takes an id list gets a string too — the shape check only needs
 * the prefix.
 */
function registryKeys(): { name: string; key: readonly unknown[]; family?: string }[] {
  const out: { name: string; key: readonly unknown[]; family?: string }[] = [];
  for (const [name, entry] of Object.entries(QK)) {
    if (Array.isArray(entry)) {
      out.push({ name, key: entry });
      continue;
    }
    for (const [member, value] of Object.entries(entry)) {
      const key = typeof value === 'function' ? (value as Builder)('sample-id') : (value as readonly unknown[]);
      out.push({ name: `${name}.${member}`, key, family: name });
    }
  }
  return out;
}

const isPrefix = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length < b.length && serialize(a) === serialize(b.slice(0, a.length));

describe('shared query keys', () => {
  it('are pairwise distinct', () => {
    const keys = registryKeys();
    const seen = new Map<string, string>();
    for (const { name, key } of keys) {
      const s = serialize(key);
      const previous = seen.get(s);
      expect(previous, `${name} collides with ${previous}`).toBeUndefined();
      seen.set(s, name);
    }
    expect(seen.size).toBe(keys.length);
  });

  it('nests every family member under its own root, and under no other key', () => {
    // React Query invalidates by prefix. A family's `all` MUST be a prefix of
    // its members (that is what a root is for), and nothing else may be — a
    // stray prefix would make one screen's invalidation refetch another's rows.
    const keys = registryKeys();
    for (const a of keys) {
      for (const b of keys) {
        if (a === b) continue;
        const sameFamily = a.family !== undefined && a.family === b.family;
        if (sameFamily && a.name.endsWith('.all')) {
          expect(isPrefix(a.key, b.key), `${a.name} must be a prefix of ${b.name}`).toBe(true);
        } else {
          expect(isPrefix(a.key, b.key), `${a.name} prefix-matches ${b.name}`).toBe(false);
        }
      }
    }
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
    const all = registryKeys().map((k) => serialize(k.key));
    expect(all).not.toContain(serialize(TABLE_QR_QUERY_KEY as readonly unknown[]));
  });

  it('matches the keys the till still spells for itself', () => {
    // tillData.ts writes ['tabs'] and ['tab', id] as literals (its header says
    // "do not rename them"). Until it reads QK, this pins the two spellings to
    // each other so the queue's invalidation cannot drift from the screen.
    expect(serialize(OPEN_TABS_QUERY.queryKey)).toBe(serialize(QK.tabs));
    expect(serialize(tabDetailQuery('t1').queryKey)).toBe(serialize(QK.tab.one('t1')));
  });
});

describe('invalidateReservations', () => {
  it('refreshes the day grid and the month counts, nothing else', () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    invalidateReservations(queryClient);
    const hit = spy.mock.calls.map(([filters]) => serialize(filters!.queryKey!));
    expect(hit).toEqual(RESERVATION_LIST_KEYS.map(serialize));
    expect(hit).toEqual([serialize(QK.reservations.all), serialize(QK.reservationsMonth.all)]);
  });
});

describe('compareTableNumbers', () => {
  it('counts, so the till picker is not ordered 1, 10, 11, 12, 2', () => {
    const sorted = ['2', '10', '1', '12', '11', '3'].sort(compareTableNumbers);
    expect(sorted).toEqual(['1', '2', '3', '10', '11', '12']);
  });

  it('keeps prefixed numbers in numeric order too', () => {
    expect(['T10', 'T2', 'T1'].sort(compareTableNumbers)).toEqual(['T1', 'T2', 'T10']);
  });

  it('is a total order — case-only differences never compare equal', () => {
    // A 'base' collator calls 'a' and 'A' equal, which would make the sort
    // unstable across engines; the localeCompare fallback breaks that tie.
    expect(compareTableNumbers('a1', 'A1')).not.toBe(0);
  });
});

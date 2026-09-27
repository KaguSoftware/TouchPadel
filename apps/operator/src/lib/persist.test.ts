// @vitest-environment jsdom
// jsdom: the flush is wired to the window's `pagehide` event.
import { describe, expect, it } from 'vitest';
import { makePersister, shouldPersistQuery } from './persist';

function fakeQuery(key: unknown[], status: 'success' | 'error' = 'success') {
  return { queryKey: key, state: { status } };
}

describe('shouldPersistQuery', () => {
  it('persists the warm-start keys', () => {
    for (const key of [['menu'], ['tabs'], ['day'], ['courts'], ['activeCafeTables']]) {
      expect(shouldPersistQuery(fakeQuery(key)), key.join()).toBe(true);
    }
  });

  it('never persists money detail, tickets, analytics or audit', () => {
    for (const key of [['tab', 'uuid-1'], ['tickets'], ['analytics', 'overview'], ['auditLog'], ['waiterCalls']]) {
      expect(shouldPersistQuery(fakeQuery(key)), key.join()).toBe(false);
    }
  });

  it('never persists a failed query — an error snapshot is not a warm start', () => {
    expect(shouldPersistQuery(fakeQuery(['menu'], 'error'))).toBe(false);
  });
});

describe('makePersister', () => {
  // The library's throttle only writes when its timer fires. A reload inside
  // that window used to restore the list from before the change.
  it('writes the newest snapshot as soon as the page is hidden, not 2 s later', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as unknown as Storage;
    const persister = makePersister(storage);
    const snapshot = { timestamp: 1, buster: 'b', clientState: { mutations: [], queries: [] } };
    void persister.persistClient(snapshot);
    expect(store.size).toBe(0); // still waiting on the throttle
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(store.get('touch-operator-query-cache')!)).toEqual(snapshot);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLearned, guideStorageKey, loadLearned, saveLearned, toggleLearned } from './guideProgress';

/** A Map-backed localStorage, since node has none. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
}

let storage: Storage;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guide progress', () => {
  it('round-trips the ticked steps per staff member', () => {
    saveLearned('staff-a', new Set(['cashier.pay.cash', 'cashier.start.shift']));
    saveLearned('staff-b', new Set(['prep.work.start']));
    expect([...loadLearned('staff-a')].sort()).toEqual(['cashier.pay.cash', 'cashier.start.shift']);
    expect([...loadLearned('staff-b')]).toEqual(['prep.work.start']);
    expect(storage.getItem(guideStorageKey('staff-a'))).toContain('cashier.pay.cash');
    expect(loadLearned('staff-c').size).toBe(0);
  });

  it('reads bad JSON, a non-array and non-string entries as nothing ticked', () => {
    storage.setItem(guideStorageKey('s'), '{not json');
    expect(loadLearned('s').size).toBe(0);
    storage.setItem(guideStorageKey('s'), JSON.stringify({ a: 1 }));
    expect(loadLearned('s').size).toBe(0);
    storage.setItem(guideStorageKey('s'), JSON.stringify(['cashier.pay.cash', 7, null]));
    expect([...loadLearned('s')]).toEqual(['cashier.pay.cash']);
  });

  it('drops ids that are not a known step', () => {
    saveLearned('s', new Set(['cashier.pay.cash', 'cashier.gone.step']));
    expect([...loadLearned('s', new Set(['cashier.pay.cash']))]).toEqual(['cashier.pay.cash']);
  });

  it('survives a storage that throws on every call', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    expect(loadLearned('s').size).toBe(0);
    expect(() => saveLearned('s', new Set(['cashier.pay.cash']))).not.toThrow();
    expect(clearLearned('s', 'cashier.').size).toBe(0);
  });

  it('survives no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadLearned('s').size).toBe(0);
    expect(() => saveLearned('s', new Set(['x']))).not.toThrow();
  });

  it('clearLearned clears one workspace and keeps the others', () => {
    saveLearned('s', new Set(['cashier.pay.cash', 'cashier.start.shift', 'courtDesk.start.shift']));
    saveLearned('t', new Set(['cashier.pay.cash']));
    const left = clearLearned('s', 'cashier.');
    expect([...left]).toEqual(['courtDesk.start.shift']);
    expect([...loadLearned('s')]).toEqual(['courtDesk.start.shift']);
    // Another person's ticks are theirs.
    expect([...loadLearned('t')]).toEqual(['cashier.pay.cash']);
    clearLearned('s', 'courtDesk.');
    expect(storage.getItem(guideStorageKey('s'))).toBeNull();
  });

  it('toggleLearned returns a new set', () => {
    const a = new Set(['x']);
    const b = toggleLearned(a, 'y', true);
    expect([...b].sort()).toEqual(['x', 'y']);
    expect([...a]).toEqual(['x']);
    expect([...toggleLearned(b, 'x', false)]).toEqual(['y']);
  });
});

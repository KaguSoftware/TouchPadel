import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_STORAGE_KEY, loadMode, parseStoredMode, resetModeMemory, resolveMode, saveMode, subscribeMode } from './mode';

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

describe('resolveMode', () => {
  it('gives staff the free AI whatever is stored', () => {
    expect(resolveMode(false, null)).toBe('free');
    expect(resolveMode(false, 'paid')).toBe('free');
  });

  it('gives the owner the paid assistant by default, else the stored pick', () => {
    expect(resolveMode(true, null)).toBe('paid');
    expect(resolveMode(true, 'free')).toBe('free');
    expect(resolveMode(true, 'paid')).toBe('paid');
  });
});

describe('parseStoredMode', () => {
  it("reads this owner's pick only", () => {
    const raw = JSON.stringify({ owner: 'o1', mode: 'free' });
    expect(parseStoredMode(raw, 'o1')).toBe('free');
    expect(parseStoredMode(raw, 'o2')).toBeNull();
  });

  it('ignores junk', () => {
    expect(parseStoredMode(null, 'o1')).toBeNull();
    expect(parseStoredMode('{', 'o1')).toBeNull();
    expect(parseStoredMode(JSON.stringify({ owner: 'o1', mode: 'everything' }), 'o1')).toBeNull();
    expect(parseStoredMode(JSON.stringify({ owner: 'o1', mode: 'free' }), '')).toBeNull();
  });
});

describe('the mode store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
    resetModeMemory();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('saves per owner and tells subscribers', () => {
    const seen = vi.fn();
    const off = subscribeMode(seen);
    saveMode('o1', 'free');
    expect(seen).toHaveBeenCalledOnce();
    expect(JSON.parse(localStorage.getItem(MODE_STORAGE_KEY)!)).toEqual({ owner: 'o1', mode: 'free' });
    expect(loadMode('o1')).toBe('free');
    expect(loadMode('o2')).toBeNull();
    off();
    saveMode('o1', 'paid');
    expect(seen).toHaveBeenCalledOnce();
  });

  it('keeps the pick in memory when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadMode('o1')).toBeNull();
    saveMode('o1', 'free');
    expect(loadMode('o1')).toBe('free');
  });
});

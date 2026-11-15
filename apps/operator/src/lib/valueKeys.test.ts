import { describe, expect, it } from 'vitest';
import { keyForValues } from './valueKeys';

describe('keyForValues (F-13: the idempotency key follows the values sent)', () => {
  const mint = (() => {
    let n = 0;
    return () => `k${++n}`;
  })();
  it('keeps the key for an unchanged retry, mints one for changed values, and reuses it when they come back', () => {
    const keys = new Map<string, string>();
    const a = keyForValues(keys, ['s1', '2026-10-01', 100000, 'safe', null], mint);
    expect(keyForValues(keys, ['s1', '2026-10-01', 100000, 'safe', null], mint)).toBe(a);
    const b = keyForValues(keys, ['s1', '2026-10-01', 120000, 'safe', null], mint);
    expect(b).not.toBe(a);
    const c = keyForValues(keys, ['s1', '2026-10-01', 100000, 'bank', null], mint);
    expect(c).not.toBe(a);
    expect(c).not.toBe(b);
    expect(keyForValues(keys, ['s1', '2026-10-01', 100000, 'safe', null], mint)).toBe(a);
  });
});


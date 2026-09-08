import { describe, expect, it } from 'vitest';
import { shouldPersistQuery } from './persist';

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

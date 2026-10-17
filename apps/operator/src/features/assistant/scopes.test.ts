import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCOPES_STORAGE_KEY, initialScopes, saveRememberedScopes } from './scopes';

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

describe('initialScopes (owner call 2026-10-16: select only what is needed)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('starts a chat on a page with no scope of its own with Pages and how-to only', () => {
    expect(initialScopes('/assistant', 'owner-1')).toEqual(['howto']);
  });

  it("adds the page's own scope", () => {
    expect(initialScopes('/analytics/cafe', 'owner-1')).toEqual(['cafe', 'howto']);
  });

  it('adds what this owner last ticked, and only for that owner', () => {
    saveRememberedScopes('owner-1', ['money']);
    expect(initialScopes('/assistant', 'owner-1')).toEqual(['money', 'howto']);
    expect(initialScopes('/assistant', 'owner-2')).toEqual(['howto']);
  });

  it('drops the every-scope set remembered under the v2 key', () => {
    localStorage.setItem('touch-assistant-scopes-v2', JSON.stringify({ owner: 'owner-1', scopes: ['cafe', 'courts', 'money', 'stock', 'staff', 'system', 'howto'] }));
    expect(SCOPES_STORAGE_KEY).toBe('touch-assistant-scopes-v3');
    expect(initialScopes('/assistant', 'owner-1')).toEqual(['howto']);
  });
});

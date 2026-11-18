import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ router: {} }));

import { createDedupe } from '../dedupeNavigation';

describe('createDedupe', () => {
  it('drops the same target inside the window and lets it through after', () => {
    let t = 0;
    const allow = createDedupe(() => t);
    expect(allow('push:"/a"', 700)).toBe(true);
    t = 300;
    expect(allow('push:"/a"', 700)).toBe(false);
    t = 1000;
    expect(allow('push:"/a"', 700)).toBe(true);
  });

  it('lets a different target through straight away', () => {
    let t = 0;
    const allow = createDedupe(() => t);
    expect(allow('push:"/a"', 700)).toBe(true);
    t = 50;
    expect(allow('push:"/b"', 700)).toBe(true);
  });
});

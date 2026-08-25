import { describe, expect, it } from 'vitest';
import { backdropOpacity, dragOffset, resolveIntent, shouldClose } from './drag';

describe('sheet drag intent', () => {
  it('stays pending until the 8 px intent threshold', () => {
    expect(resolveIntent(0, 0)).toBe('pending');
    expect(resolveIntent(5, 7)).toBe('pending');
  });

  it('commits to the dominant axis', () => {
    expect(resolveIntent(2, 12)).toBe('vertical');
    expect(resolveIntent(-14, 3)).toBe('horizontal');
    expect(resolveIntent(10, 10)).toBe('horizontal'); // ties go to the rail, not the sheet
  });

  it('honours a custom intent threshold', () => {
    expect(resolveIntent(0, 9, 20)).toBe('pending');
    expect(resolveIntent(0, 21, 20)).toBe('vertical');
  });
});

describe('sheet drag offset + close', () => {
  it('follows the finger downward and rubber-bands upward', () => {
    expect(dragOffset(40)).toBe(40);
    expect(dragOffset(-40)).toBe(-10);
  });

  it('closes past 80 px only', () => {
    expect(shouldClose(79)).toBe(false);
    expect(shouldClose(80)).toBe(true);
    expect(shouldClose(-200)).toBe(false);
    expect(shouldClose(50, 40)).toBe(true);
  });

  it('fades the backdrop with the drag, with a floor', () => {
    expect(backdropOpacity(0)).toBe(1);
    expect(backdropOpacity(-30)).toBe(1);
    expect(backdropOpacity(160, 320)).toBeCloseTo(0.5);
    expect(backdropOpacity(10_000)).toBe(0.2);
  });
});

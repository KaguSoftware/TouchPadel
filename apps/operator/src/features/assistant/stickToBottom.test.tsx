import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { BOTTOM_SLACK, isNearBottom, useStickToBottom } from './stickToBottom';

/** A scroller jsdom can measure: it lays nothing out, so the sizes are set by hand. */
function scroller(contentHeight: number, viewHeight: number, top: number) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => contentHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => viewHeight });
  el.scrollTop = top;
  return el;
}

describe('isNearBottom', () => {
  it('counts the last few pixels as the bottom', () => {
    expect(isNearBottom({ offsetY: 600, viewHeight: 400, contentHeight: 1000 })).toBe(true);
    expect(isNearBottom({ offsetY: 600 - BOTTOM_SLACK, viewHeight: 400, contentHeight: 1000 })).toBe(true);
    expect(isNearBottom({ offsetY: 500, viewHeight: 400, contentHeight: 1000 })).toBe(false);
  });
});

describe('useStickToBottom', () => {
  it('follows new text while the reader is at the foot, and lets go once they scroll up', () => {
    const { result } = renderHook(() => useStickToBottom<HTMLDivElement>());
    const el = scroller(1000, 400, 600);
    (result.current.ref as { current: HTMLDivElement | null }).current = el;

    // At the foot: a token arrives, the content grows, the view follows.
    result.current.onScroll();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1200 });
    result.current.stick();
    expect(el.scrollTop).toBe(1200);

    // The owner scrolls up to reread: the next token leaves them there.
    el.scrollTop = 100;
    result.current.onScroll();
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1400 });
    result.current.stick();
    expect(el.scrollTop).toBe(100);

    // A new question follows again.
    result.current.follow();
    expect(el.scrollTop).toBe(1400);
  });
});

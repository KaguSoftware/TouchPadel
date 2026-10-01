import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useClock } from '../../lib/clock';
import { TILL_CLOCK_TICK_MS, useTillClock } from './useTillClock';

/**
 * The till computed "today" once at mount, so a kiosk left running overnight
 * kept yesterday's date for the "unavailable today" tiles. The clock now
 * moves on by itself and catches up when the station wakes.
 */
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useTillClock', () => {
  it('turns the business date at venue midnight without a remount', () => {
    // 23:59:00 in Baghdad (UTC+3).
    vi.setSystemTime(new Date('2026-10-01T20:59:00Z'));
    const { result } = renderHook(() => useTillClock(0));
    expect(result.current.today).toBe('2026-10-01');

    act(() => {
      vi.advanceTimersByTime(TILL_CLOCK_TICK_MS);
    });
    expect(result.current.today).toBe('2026-10-01'); // 23:59:30

    act(() => {
      vi.advanceTimersByTime(TILL_CLOCK_TICK_MS);
    });
    expect(result.current.today).toBe('2026-10-02'); // 00:00:00
    expect(result.current.now).toBe(Date.parse('2026-10-01T21:00:00Z'));
  });

  it('follows the business-day start hour', () => {
    // 01:30 at the venue: still the 1st's business day with a 04:00 start.
    vi.setSystemTime(new Date('2026-10-01T22:30:00Z'));
    const { result } = renderHook(() => useTillClock(4));
    expect(result.current.today).toBe('2026-10-01');
    act(() => {
      vi.advanceTimersByTime(2.5 * 60 * 60 * 1000); // to 04:00
    });
    expect(result.current.today).toBe('2026-10-02');
  });

  it('catches up at once when a station that slept comes back', () => {
    vi.setSystemTime(new Date('2026-10-01T20:00:00Z'));
    const { result } = renderHook(() => useTillClock(0));
    expect(result.current.today).toBe('2026-10-01');
    // The machine slept through midnight: its timers did not run, the wall clock did.
    vi.setSystemTime(new Date('2026-10-02T06:00:00Z'));
    act(() => setVisibility('visible'));
    expect(result.current.today).toBe('2026-10-02');
  });
});

describe('useClock', () => {
  it('ticks, refreshes on focus, and stops when unmounted', () => {
    vi.setSystemTime(new Date('2026-10-01T10:00:00Z'));
    const { result, unmount } = renderHook(() => useClock(60_000));
    const start = result.current;
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(start + 60_000);

    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe(Date.parse('2026-10-01T12:00:00Z'));

    act(() => setVisibility('hidden'));
    expect(result.current).toBe(Date.parse('2026-10-01T12:00:00Z'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

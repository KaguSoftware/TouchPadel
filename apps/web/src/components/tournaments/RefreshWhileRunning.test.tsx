import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RefreshWhileRunning, TOURNAMENT_REFRESH_MS } from './RefreshWhileRunning';

/**
 * The tournament page's refresh island: `router.refresh()` every 30 s while the tab is visible,
 * nothing while it is hidden, and nothing after it unmounts.
 */
const refresh = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockClear();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RefreshWhileRunning', () => {
  it('refreshes every 30 seconds and renders nothing', () => {
    const { container } = render(<RefreshWhileRunning />);
    expect(container.innerHTML).toBe('');
    expect(TOURNAMENT_REFRESH_MS).toBe(30_000);
    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('asks nothing while the tab is hidden', () => {
    render(<RefreshWhileRunning />);
    visibility = 'hidden';
    vi.advanceTimersByTime(90_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('stops when it unmounts', () => {
    const { unmount } = render(<RefreshWhileRunning />);
    unmount();
    vi.advanceTimersByTime(90_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});

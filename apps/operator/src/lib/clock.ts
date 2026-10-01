/**
 * The station's clock as React state.
 *
 * A screen that computes something from "now" once at mount goes stale on a
 * till that runs for days: the till decided which items were paused "for
 * today" from the date it mounted on, and after midnight it kept using
 * yesterday's. `useClock` moves on by itself — every `tickMs`, and at once
 * when the window comes back (the tab or window visible or focused again),
 * because a machine that slept resumes its timers late.
 */
import { useEffect, useState } from 'react';

export function useClock(tickMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, tickMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', tick);
    };
  }, [tickMs]);
  return now;
}

/**
 * The till's clock: `now` for the court boards (bookings start and end while
 * the plan is on screen) and `today`, the venue's business date the menu
 * tiles compare `unavailable_on` with (tileState.ts tillToday).
 *
 * `today` used to be computed once when the till mounted. A till runs for
 * days, so after midnight an item staff paused yesterday still showed as
 * "unavailable today", and one paused today showed as out of stock. Both now
 * follow the clock, which ticks every `tickMs` and catches up at once when the
 * station wakes or the window comes back (lib/clock.ts).
 */
import { useMemo } from 'react';
import { useClock } from '../../lib/clock';
import { tillToday } from './tileState';

export const TILL_CLOCK_TICK_MS = 30_000;

export function useTillClock(startHour: number, tickMs: number = TILL_CLOCK_TICK_MS): { now: number; today: string } {
  const now = useClock(tickMs);
  const today = useMemo(() => tillToday(now, startHour), [now, startHour]);
  return { now, today };
}

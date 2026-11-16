/**
 * Starting and finishing work (0442): the two phone RPCs. Both are on
 * STAFF_RPCS (../api.ts) and are never blocked pages (contract §3). A refusal
 * is data, never an error: only FORBIDDEN and INVALID_ARGUMENT are thrown,
 * and they go through the app's error mapping like any staff call.
 */
import type { ClockPunchResult, MyClock } from '@touch/core/staff/clock';
import { staffRpc } from '../api';
import { readMyClock, readPunchResult } from './logic';

export class ClockReadError extends Error {
  constructor() {
    super('CLOCK_UNREADABLE');
  }
}

/** The caller's day at the branch. A payload that is not one throws, so the card shows its retry. */
export async function fetchMyClock(venueId: string): Promise<MyClock> {
  const clock = readMyClock(await staffRpc<unknown>('my_clock', { p_venue_id: venueId }));
  if (!clock) throw new ClockReadError();
  return clock;
}

/** One scan. `args` is logic.ts `punchArgs`, every argument sent. */
export async function sendPunch(args: Record<string, unknown>): Promise<ClockPunchResult> {
  const result = readPunchResult(await staffRpc<unknown>('clock_punch', args));
  if (!result) throw new ClockReadError();
  return result;
}

/**
 * /ops "Needs you now" and Observe home's "Waiting on you" (wave5-addendum
 * §5.2, §8 Q27): today's till shifts that closed short or over, any non-zero
 * difference, sent to Day close. One read, the day-close step's own
 * (app.till_shift_list with no dates: the open day, else the latest), so the
 * three places share a cache. MGMT only: pass whether the viewer may open Day
 * close, and a viewer who may not makes no read and counts none.
 */
import { useQuery } from '@tanstack/react-query';
import { fetchShiftList, tillShiftListKey } from './api';
import { shiftsWithDifference } from './tillShiftLogic';

export function useShiftDifferences(enabled: boolean) {
  const q = useQuery({ queryKey: tillShiftListKey({}), queryFn: () => fetchShiftList(), enabled, refetchInterval: 60_000 });
  return {
    /** The read, for a screen that says when one of its checks failed; null when it was never made. */
    read: enabled ? q : null,
    count: enabled && q.data ? shiftsWithDifference(q.data) : 0,
  };
}

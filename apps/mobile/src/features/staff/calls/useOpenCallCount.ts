/**
 * The open-call count on the waiter's Today row (wave5-addendum-2026-09-25
 * §2.1.8): the same query and the same live `floor` channel as the calls page,
 * so a call raised while Today is open moves the number, and a push that lands
 * on Today shows it at once.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { staffKeys } from '../keys';
import { fetchOpenCalls } from './api';
import { openCallCount } from './logic';
import { useFloorLive } from './useFloorLive';

export function useOpenCallCount(venueId: string | null, enabled: boolean): number {
  const on = enabled && !!venueId;
  useFloorLive(on);
  const calls = useQuery({
    queryKey: staffKeys.calls(venueId ?? ''),
    queryFn: () => fetchOpenCalls(venueId ?? ''),
    enabled: on,
    refetchInterval: 30_000,
  });
  // A call crossing the two-hour line leaves the count without a new read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [on]);
  return on ? openCallCount(calls.data, now) : 0;
}

/**
 * Pull-to-refresh state that follows the GUEST'S pull, not the query.
 *
 * `RefreshControl`'s `refreshing` used to be bound to the query's
 * `isRefetching`, which is true for every refetch the query does — a cancel's
 * `invalidateQueries`, the realtime `slot_changed` broadcast, a refocus. On
 * iOS a `refreshing` that flips true on its own is honoured literally: the
 * control expands, pushes the whole list down ~60 pt, and snaps it back when
 * the refetch settles — twice, when the mutation and the broadcast both
 * invalidate (owner, 2026-09-11: a "twitch" after cancelling a reservation).
 * The spinner is the pull's feedback and nothing else's; a background refetch
 * has the row updates themselves to show for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function usePullRefresh(refetch: () => Promise<unknown>): {
  refreshing: boolean;
  onRefresh: () => void;
} {
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [refetch]);
  return { refreshing, onRefresh };
}

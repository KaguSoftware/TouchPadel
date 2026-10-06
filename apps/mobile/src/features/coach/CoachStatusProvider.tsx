/**
 * The coach status for the whole app (docs/design/coaching/guest.md §4.13.1),
 * mounted once inside StaffStatusProvider (app/_layout.tsx). It owns the
 * `coach_me` read under `coachKeys.me(uid)` and classifies it (status.ts).
 *
 * A COACH IS A GUEST. StaffStatusProvider keeps answering `guest` or `staff`;
 * this provider answers whether the same account coaches, whatever the staff
 * status and the coaching switches say (R45). Without it (every existing
 * smoke case) the context answers `guest`, so every screen renders as before.
 *
 * READ ON DEMAND. The query runs while the session is signed in (not
 * anonymous) and at least one reader is mounted: Profile, the staff hub and
 * every RequireCoach call `useCoachStatus({read: true})`. A guest who never
 * opens Profile never calls it. Five minutes stale, refetched on foreground
 * while a reader is mounted (the app's focus manager), and whenever a
 * coach-mode screen mounts (`refreshIfOlder`).
 *
 * No device hint: `pending` only delays one menu row and a coach-mode screen.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/context';
import { supabase } from '../../lib/supabase';
import { fetchCoachMe } from './api';
import { coachKeys } from './keys';
import type { CoachMe, CoachMeRead, CoachMeRetired } from './logic';
import {
  NOT_A_COACH,
  NO_SESSION,
  coachOf,
  nextCoachStatus,
  type CoachRead,
  type CoachStatus,
} from './status';

/** guest.md §4.13.1: `coach_me` is fresh for five minutes. */
export const COACH_ME_STALE_MS = 5 * 60_000;

export interface CoachStatusValue {
  status: CoachStatus;
  /** The coach (active, paused or retired), or null for anyone else. */
  coach: CoachMe | CoachMeRetired | null;
  /** The server's clock at the last read, when there was one. */
  serverNow: string | null;
  /** Read coach_me again now (the error state's Try again, a NOT_A_COACH refusal). */
  retry: () => void;
  /** Read coach_me again when the answer is older than `maxAgeMs` (a coach-mode screen mounting). */
  refreshIfOlder: (maxAgeMs: number) => void;
  /** Mount a reader; returns its unmount. `useCoachStatus({read: true})` calls it. */
  addReader: () => () => void;
}

const noop = () => {};

const DEFAULT_VALUE: CoachStatusValue = {
  status: NOT_A_COACH,
  coach: null,
  serverNow: null,
  retry: noop,
  refreshIfOlder: noop,
  addReader: () => noop,
};

const CoachStatusContext = createContext<CoachStatusValue>(DEFAULT_VALUE);

/**
 * The coach status. With `read: true` the caller is a reader: while it is
 * mounted the provider keeps `coach_me` read (Profile, the staff hub, every
 * coach-mode screen). Answers `{coach: null, status: guest}` without the provider.
 */
export function useCoachStatus(opts: { read?: boolean } = {}): CoachStatusValue {
  const value = useContext(CoachStatusContext);
  const { addReader } = value;
  const read = opts.read === true;
  useEffect(() => (read ? addReader() : undefined), [read, addReader]);
  return value;
}

function readOf(query: {
  data: CoachMeRead | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
}): CoachRead {
  if (query.data) return { state: 'success', data: query.data };
  if (query.status === 'error') return { state: 'error' };
  if (query.fetchStatus === 'idle') return { state: 'idle' };
  return { state: 'pending' };
}

export function CoachStatusProvider({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  const user = session?.user ?? null;
  // An anonymous session (a cafe table) is nobody's coach account.
  const uid = user && !user.is_anonymous ? user.id : null;

  const [readers, setReaders] = useState(0);
  const addReader = useCallback(() => {
    setReaders((n) => n + 1);
    return () => setReaders((n) => Math.max(0, n - 1));
  }, []);

  const query = useQuery({
    queryKey: coachKeys.me(uid ?? ''),
    queryFn: () => fetchCoachMe(supabase),
    enabled: uid !== null && readers > 0,
    staleTime: COACH_ME_STALE_MS,
  });

  // Derived from the previous status (an errored read keeps the last answer),
  // so it is state updated DURING render when its inputs change, never one
  // render late in an effect: the StaffStatusProvider pattern.
  const read = readOf(query);
  const inputKey = [uid, initializing, read.state, query.dataUpdatedAt, query.errorUpdatedAt].join(
    '|',
  );
  const [memo, setMemo] = useState(() => ({
    key: inputKey,
    uid,
    status: nextCoachStatus({
      uid,
      restoring: initializing,
      read,
      previous: NO_SESSION,
      previousUid: null,
    }),
  }));
  let status = memo.status;
  if (memo.key !== inputKey) {
    status = nextCoachStatus({
      uid,
      restoring: initializing,
      read,
      previous: memo.status,
      previousUid: memo.uid,
    });
    setMemo({ key: inputKey, uid, status });
  }

  // Handlers read the live query through a ref, so their identity is stable
  // and a reader's effect never re-subscribes on a refetch. A layout effect,
  // so it is current before any reader's (passive) mount effect calls them.
  const live = useRef({ query, uid });
  useLayoutEffect(() => {
    live.current = { query, uid };
  });
  const retry = useCallback(() => {
    if (live.current.uid) void live.current.query.refetch();
  }, []);
  const refreshIfOlder = useCallback((maxAgeMs: number) => {
    const { query: q, uid: id } = live.current;
    if (!id || !q.data || q.isFetching) return;
    if (Date.now() - q.dataUpdatedAt > maxAgeMs) void q.refetch();
  }, []);

  const serverNow = query.data?.serverNow ?? null;
  const value = useMemo<CoachStatusValue>(
    () => ({ status, coach: coachOf(status), serverNow, retry, refreshIfOlder, addReader }),
    [status, serverNow, retry, refreshIfOlder, addReader],
  );

  return <CoachStatusContext.Provider value={value}>{children}</CoachStatusContext.Provider>;
}

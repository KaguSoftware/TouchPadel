/**
 * The staff status for the whole app (build-contracts-2026-09-23 §6.5), mounted
 * once inside AuthProvider (app/_layout.tsx). It reads the signed-in account's
 * own staff row, classifies it (status.ts), and holds the venue the phone works
 * at. Without it, as in every guest smoke case, the context answers `guest`
 * and every screen renders exactly as it always has.
 *
 * Re-checked every ROLE_RECHECK_MS and on every foreground while the account is
 * staff, so a switched-off account reaches the full-screen notice within a
 * minute (0081 ends its sessions, but an access token lives up to an hour). A
 * guest's row is read once per session: an existing guest account never
 * becomes staff (staff-admin refuses an email that is already in use).
 *
 * It also holds the one rule the sign-in check cannot hold alone (§6.6): a
 * Google or Apple session on an active staff row is signed out, with the
 * reason, whenever its row read answers. Mounted inside ToastProvider for that.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, type Query } from '@tanstack/react-query';
import { ROLE_RECHECK_MS } from '@touch/core';
import { signOut } from '../auth/api';
import { useAuth } from '../auth/context';
import { signedInWithProvider } from '../auth/social';
import { useToast } from '../../components/overlays';
import { useLocale } from '../../i18n/LocaleProvider';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { fetchStaffStatusRead, fetchStaffVenues, type StaffVenue } from './api';
import { clearStaffHint, useStaffHintUid, writeStaffHint } from './hint';
import { staffKeys } from './keys';
import {
  GUEST_STATUS,
  NO_SESSION,
  nextStaffStatus,
  type StaffRead,
  type StaffStatus,
  type StaffStatusInput,
  type StaffStatusKind,
  type StaffStatusRead,
} from './status';
import { pickVenueId, staffVenueKey } from './venue';

export interface StaffStatusValue {
  status: StaffStatus;
  /**
   * The signed-in account's row has been read (or failed to be), so `guest`
   * is an answer and not "not asked yet". True with no session. A screen that
   * would send a signed-in account somewhere guest-only (complete-profile, the
   * terms) waits on it; the tabs do not, so a guest's cold start is unchanged.
   */
  answered: boolean;
  /** The venue every staff call passes as `p_venue_id`; null unless staff with a venue. */
  venueId: string | null;
  /** Names for the picker, in `status.venues` order ([] until read). */
  venues: StaffVenue[];
  setVenueId: (id: string) => void;
  /** Read the row again now (the pending screen's Try again). */
  retry: () => void;
}

const DEFAULT_VALUE: StaffStatusValue = {
  status: GUEST_STATUS,
  answered: true,
  venueId: null,
  venues: [],
  setVenueId: () => {},
  retry: () => {},
};

const StaffStatusContext = createContext<StaffStatusValue>(DEFAULT_VALUE);

export function useStaffStatus(): StaffStatusValue {
  return useContext(StaffStatusContext);
}

// ── The social sign-in hold (useSocialSignIn) ───────────────────────────────

let holding = false;
const holdListeners = new Set<() => void>();

/**
 * While a Google or Apple sign-in is checked for a staff row, an active row
 * stays `guest`: the check signs a staff account straight out (§6.6), and
 * nothing should route to Today, or write the hint, on the way.
 */
export function holdStaffStatus(on: boolean): void {
  if (holding === on) return;
  holding = on;
  for (const listener of holdListeners) listener();
}

const subscribeHold = (listener: () => void) => {
  holdListeners.add(listener);
  return () => holdListeners.delete(listener);
};
const readHold = () => holding;

let refusedUid: string | null = null;

/**
 * One refusal per account per app life: the sign-in hook claims it when its own
 * check refuses, so the provider's refusal of the same session (below) does not
 * sign out and toast a second time. False when it was already claimed.
 */
export function claimSocialRefusal(uid: string): boolean {
  if (refusedUid === uid) return false;
  refusedUid = uid;
  return true;
}

// ── The settled status, for a notification tapped on a cold start ───────────

let settled: StaffStatusKind | null = null;
const settleWaiters = new Set<(kind: StaffStatusKind) => void>();

function publishSettled(kind: StaffStatusKind | null): void {
  settled = kind;
  if (kind === null) return;
  for (const waiter of settleWaiters) waiter(kind);
  settleWaiters.clear();
}

/**
 * The status once it is known: the session restored and the row read (or
 * `pending` given up on after `timeoutMs`). A staff tap that launched the app
 * arrives before either, and opening it against the default `guest` would drop
 * it; the notification handler waits on this instead.
 */
export function settledStaffStatus(timeoutMs = 15_000): Promise<StaffStatusKind> {
  if (settled !== null) return Promise.resolve(settled);
  return new Promise((resolve) => {
    const done = (kind: StaffStatusKind) => {
      clearTimeout(timer);
      settleWaiters.delete(done);
      resolve(kind);
    };
    const timer = setTimeout(() => done(settled ?? 'pending'), timeoutMs);
    settleWaiters.add(done);
  });
}

// ── The provider ────────────────────────────────────────────────────────────

const NO_VENUES: string[] = [];

function readOf(query: {
  status: 'pending' | 'error' | 'success';
  data: StaffStatusRead | undefined;
}): StaffRead {
  if (query.status === 'success' && query.data) return { state: 'success', data: query.data };
  if (query.status === 'error') return { state: 'error' };
  return { state: 'pending' };
}

/** An active row is re-checked on a timer and on every foreground; anything else once. */
const whileActive =
  <T,>(yes: T, no: T) =>
  (query: Query<StaffStatusRead>) =>
    query.state.data?.row?.is_active === true ? yes : no;

export function StaffStatusProvider({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  const { t } = useLocale();
  const toast = useToast();
  const user = session?.user ?? null;
  // An anonymous session (a cafe table) has no staff row to read.
  const uid = user && !user.is_anonymous ? user.id : null;
  const hintUid = useStaffHintUid();
  const signingIn = useSyncExternalStore(subscribeHold, readHold, readHold);
  // A Google or Apple session never enters the staff area (§6.6), whether or
  // not the sign-in's own check answered.
  const socialSession = uid !== null && signedInWithProvider(session?.access_token);
  const holdStaff = signingIn || socialSession;

  const read = useQuery({
    queryKey: staffKeys.status(uid ?? ''),
    queryFn: () => fetchStaffStatusRead(uid as string),
    enabled: uid !== null,
    staleTime: ROLE_RECHECK_MS,
    refetchInterval: whileActive<number | false>(ROLE_RECHECK_MS, false),
    refetchOnWindowFocus: whileActive<'always' | false>('always', false),
  });

  // The status is derived from the previous one (an errored read keeps it), so
  // it is state updated DURING render when its inputs change — React's pattern
  // for state that follows props — never one render late in an effect, which
  // would flash the guest tabs at a staff cold start for a frame.
  const input: StaffStatusInput = { uid, restoring: initializing, hintUid, holdStaff, read: readOf(read) };
  const inputKey = [
    uid,
    initializing,
    hintUid,
    holdStaff,
    read.status,
    read.dataUpdatedAt,
    read.errorUpdatedAt,
  ].join('|');
  const [memo, setMemo] = useState(() => ({
    key: inputKey,
    uid,
    status: nextStaffStatus(NO_SESSION, null, input),
  }));
  let status = memo.status;
  if (memo.key !== inputKey) {
    status = nextStaffStatus(memo.status, memo.uid, input);
    setMemo({ key: inputKey, uid, status });
  }

  // The hint follows the answer: written for staff, cleared once revoked.
  const staffId = status.kind === 'staff' ? status.staff.id : null;
  const revoked = status.kind === 'revoked';
  useEffect(() => {
    if (staffId && hintUid !== staffId) void writeStaffHint(staffId);
    if (revoked && hintUid !== null) void clearStaffHint();
  }, [staffId, revoked, hintUid]);

  useEffect(() => {
    publishSettled(initializing || status.kind === 'pending' ? null : status.kind);
  }, [initializing, status.kind]);

  // An active row held at `guest` is not an answer either: it is about to be
  // signed out, and must not be sent to complete-profile or the terms first.
  const activeRow = read.data?.row?.is_active === true;
  const answered = uid === null || (read.status !== 'pending' && !(holdStaff && activeRow));

  // The refusal for a provider session whose sign-in check did not answer (a
  // failed read) or that was restored at a cold start. The sign-in hook
  // refuses its own, and claims it, while it holds.
  const refuseUid = socialSession && !signingIn && activeRow ? uid : null;
  useEffect(() => {
    if (!refuseUid || !claimSocialRefusal(refuseUid)) return;
    addBreadcrumb('auth.social.staffRefused', { from: 'status' });
    toast(t('staff.shell.socialRefused'), 'error');
    signOut(supabase).catch((error) => captureException(error, { scope: 'staff.socialRefused.signOut' }));
  }, [refuseUid, t, toast]);

  // ── The venue ────────────────────────────────────────────────────────────
  const venueIds = status.kind === 'staff' ? status.venues : NO_VENUES;
  const [chosen, setChosen] = useState<{ uid: string; id: string | null } | null>(null);
  useEffect(() => {
    if (!staffId) return;
    let cancelled = false;
    AsyncStorage.getItem(staffVenueKey(staffId))
      .then((id) => {
        if (!cancelled) setChosen((prev) => (prev?.uid === staffId && prev.id ? prev : { uid: staffId, id }));
      })
      .catch((error) => {
        captureException(error, { scope: 'staff.venue.read' });
        if (!cancelled) setChosen({ uid: staffId, id: null });
      });
    return () => {
      cancelled = true;
    };
  }, [staffId]);
  // With more than one venue, no venue until the remembered one is read: a
  // page would otherwise fetch the first venue's lists and then switch.
  const choiceKnown = chosen !== null && chosen.uid === staffId;
  const venueId =
    venueIds.length > 1 && !choiceKnown ? null : pickVenueId(venueIds, choiceKnown ? chosen.id : null);

  const setVenueId = useCallback(
    (id: string) => {
      if (!staffId) return;
      setChosen({ uid: staffId, id });
      AsyncStorage.setItem(staffVenueKey(staffId), id).catch((error) =>
        captureException(error, { scope: 'staff.venue.write' }),
      );
    },
    [staffId],
  );

  // Keyed by the account (§6.4), not by the ids: a venue added to it shows
  // its name within ROLE_RECHECK_MS, and the picker falls back to "…" until then.
  const names = useQuery({
    queryKey: staffKeys.venues(staffId ?? ''),
    queryFn: () => fetchStaffVenues(venueIds),
    enabled: venueIds.length > 0,
    staleTime: ROLE_RECHECK_MS,
  });

  const { refetch } = read;
  const retry = useCallback(() => void refetch(), [refetch]);

  const value = useMemo<StaffStatusValue>(
    () => ({
      status,
      answered,
      venueId,
      venues: names.data ?? [],
      setVenueId,
      retry,
    }),
    [status, answered, venueId, names.data, setVenueId, retry],
  );

  return <StaffStatusContext.Provider value={value}>{children}</StaffStatusContext.Provider>;
}

/**
 * The open-match React bindings (docs/design/open-matches/guest.md §4.23):
 * every read as a query, every write as a mutation, all under `matchKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by
 * the key prefixes: nothing under `['match']` is written to disk, every write
 * runs now or fails now (DF-11), and the Book tab's chips fail fast. A screen
 * never overrides them.
 *
 * After every write the phone refetches `match_detail`, `my_matches` and
 * `my_tickets` (§4.3): one invalidation of the `['match']` root does all three
 * (the wallet lives under it). A write that can book or free a court (a join
 * or an approval that seats the fourth player) also refreshes the grid.
 */
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { clearMatchIntentKey, matchIntentKey } from '../../lib/idempotency';
import { useAuth } from '../auth/context';
import { profileKeys } from '../profile/hooks';
import {
  fetchMatchDetail,
  fetchMatchInvite,
  fetchMatchQuote,
  fetchMatchSlots,
  fetchMyMatchBlocks,
  fetchMyMatches,
  fetchMyTickets,
  fetchOpenMatches,
  matchBlock,
  matchCancel,
  matchDecide,
  matchJoin,
  matchLeave,
  matchPostMessage,
  matchRemovePlayer,
  matchReport,
  matchRequest,
  matchStart,
  matchUnblock,
  matchWithdraw,
  setMyGender,
  type JoinArgs,
  type QuoteArgs,
  type ReportArgs,
  type StartArgs,
} from './api';
import { keepsStartKey } from './errors';
import { matchKeys, type MatchScope } from './keys';
import {
  guestWindow,
  matchStartIntent,
  minuteWindow,
  slotMatchesByStart,
  type Gender,
  type MatchView,
  type MessageCode,
  type OpenMatch,
  type OrganiserCancelReason,
} from './logic';

export { matchKeys };

const DEFAULT_TZ = 'Asia/Baghdad';

/** Refresh every match read (detail, lists, wallet) after a write or a push. */
function useInvalidateMatches(): (alsoGrid?: boolean) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (alsoGrid = false) => {
      void queryClient.invalidateQueries({ queryKey: matchKeys.all });
      if (alsoGrid) void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
    [queryClient],
  );
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The guest read window (start of today, venue-local, + 16 days; R27). The
 * strings change once a day, so a query keyed on them stays stable.
 */
export function useGuestWindow(timezone: string | null | undefined): { from: string; to: string } {
  const tz = timezone ?? DEFAULT_TZ;
  // Recomputed at most once a minute: the Book tab shares its JS thread with
  // the rally (§4.11), and a render must not pay for a time-zone lookup.
  const minute = Math.floor(new Date().getTime() / 60_000);
  return useMemo(() => guestWindow(new Date(minute * 60_000), tz), [minute, tz]);
}

/**
 * The Book tab's chips (§4.11 rule 3): `match_slots`, signed in or out, over
 * the guest window. `enabled` is the branch's switch AND the sheet being open:
 * switch off means no work at all. Polled every 60 s while enabled; `data` is
 * the `Map<epochMs, SlotMatch[]>` (`slotMatchesByStart`), rebuilt only when
 * the answer changes.
 */
export function useMatchSlots(
  venueId: string | null,
  opts: { enabled: boolean; timezone?: string | null },
) {
  const { from, to } = useGuestWindow(opts.timezone);
  return useQuery({
    queryKey: matchKeys.slots(venueId ?? '', from, to),
    queryFn: () => fetchMatchSlots(supabase, { venueId: venueId!, from, to }),
    enabled: opts.enabled && !!venueId,
    staleTime: 15_000,
    refetchInterval: opts.enabled ? 60_000 : false,
    select: slotMatchesByStart,
  });
}

/** The Open matches list (§4.12): the branch's listable matches over the guest window. */
export function useOpenMatches(venueId: string | null, timezone?: string | null) {
  const { session } = useAuth();
  const { from, to } = useGuestWindow(timezone);
  return useQuery({
    queryKey: matchKeys.open(venueId ?? '', from, to),
    queryFn: () => fetchOpenMatches(supabase, { venueId: venueId!, from, to }),
    enabled: !!session && !!venueId,
    staleTime: 15_000,
  });
}

/**
 * The matches at one start minute, read once when a signed-in guest taps a
 * chip (`match_slots` has no ids, §4.11): join or view goes to the one match,
 * or to the list at that time when there are several.
 */
export function useFindMatchesAt(): (venueId: string, startAt: string | Date) => Promise<OpenMatch[]> {
  const queryClient = useQueryClient();
  return useCallback(
    async (venueId, startAt) => {
      const { from, to } = minuteWindow(startAt);
      const answer = await queryClient.fetchQuery({
        queryKey: matchKeys.open(venueId, from, to),
        queryFn: () => fetchOpenMatches(supabase, { venueId, from, to }),
        staleTime: 5_000,
      });
      return answer.matches;
    },
    [queryClient],
  );
}

const LIVE_POLL: ReadonlySet<string> = new Set(['filling', 'awaiting_court']);

/** Polled every 20 s while the match is filling or waiting for a court (§4.14). */
function detailPoll(data: MatchView | undefined): number | false {
  return data && !data.restricted && data.status && LIVE_POLL.has(data.status) ? 20_000 : false;
}

/**
 * One match (§4.14), by id, with the link's token when the guest came from
 * one (a link-only match is visible through it). A restricted viewer gets the
 * `restricted: true` card (R32); a match the guest may not see is
 * MATCH_NOT_FOUND, a refusal the query client never retries.
 */
export function useMatch(id: string | null | undefined, token?: string | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.one(id ?? '', token ?? ''),
    queryFn: () => fetchMatchDetail(supabase, { matchId: id, token }),
    enabled: !!session && !!id,
    staleTime: 5_000,
    refetchInterval: (query) => detailPoll(query.state.data),
  });
}

/** `m/[token]` signed in (§4.18): the full shape (then the match screen) or the restricted card. */
export function useMatchByToken(token: string | null | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.byToken(token ?? ''),
    queryFn: () => fetchMatchDetail(supabase, { token }),
    enabled: !!session && !!token,
    staleTime: 5_000,
  });
}

/** `m/[token]` signed out, and the restricted card's day and branch (§4.18): no names. */
export function useMatchInvite(token: string | null | undefined) {
  return useQuery({
    queryKey: matchKeys.invite(token ?? ''),
    queryFn: () => fetchMatchInvite(supabase, token!),
    enabled: !!token,
    staleTime: 15_000,
  });
}

/** The guest's matches (§4.16): `upcoming` beside My reservations, `past` beside the history. */
export function useMyMatches(scope: MatchScope) {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.mine(scope),
    queryFn: () => fetchMyMatches(supabase, scope),
    enabled: !!session,
    staleTime: 30_000,
  });
}

/** The ticket wallet (§4.10). Re-read on every screen that shows it: a ticket moves with every seat. */
export function useMyTickets(enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.tickets,
    queryFn: () => fetchMyTickets(supabase),
    enabled: enabled && !!session,
    staleTime: 10_000,
  });
}

/** The players the guest blocked (§4.17). */
export function useMyMatchBlocks() {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.blocks,
    queryFn: () => fetchMyMatchBlocks(supabase),
    enabled: !!session,
    staleTime: 30_000,
  });
}

/** What starting on this court and time would mean (§4.13). Re-read on every visit: the owner can change the knobs. */
export function useMatchQuote(args: QuoteArgs | null) {
  const { session } = useAuth();
  return useQuery({
    queryKey: matchKeys.quote(
      args?.venueId ?? '',
      args?.courtId ?? '',
      args?.startAt ?? '',
      args?.durationMin ?? 0,
    ),
    queryFn: () => fetchMatchQuote(supabase, args!),
    enabled: !!session && !!args,
    staleTime: 0,
  });
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type StartVars = Omit<StartArgs, 'idempotencyKey'> & {
  /** A continuation replays its own recorded key; otherwise the intent's memoised one. */
  idempotencyKey?: string;
};

/**
 * Start an open match (§4.13). The key is `matchIntentKey` of the start's
 * intent, minted once and reused by every retry of that intent; it survives
 * the refusals the guest fixes (NEED_TICKETS, GENDER_REQUIRED, PHONE_REQUIRED,
 * TERMS_REQUIRED, PRICE_CHANGED) and a dropped connection, and is cleared on
 * success (also `duplicate: true`, R24) and on any other refusal (§4.23).
 */
export function useStartMatch() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('start'),
    mutationFn: (vars: StartVars) =>
      matchStart(supabase, {
        ...vars,
        idempotencyKey: vars.idempotencyKey ?? matchIntentKey(matchStartIntent(vars)),
      }),
    onSuccess: (_data, vars) => clearMatchIntentKey(matchStartIntent(vars)),
    onError: (error, vars) => {
      if (!keepsStartKey(error)) clearMatchIntentKey(matchStartIntent(vars));
    },
    onSettled: () => invalidate(),
  });
}

/** Join an open-join match (§4.14): seats at once, and the fourth seat books the court. */
export function useJoinMatch() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('join'),
    mutationFn: (vars: JoinArgs) => matchJoin(supabase, vars),
    onSettled: () => invalidate(true),
  });
}

/** Ask to join an approve-mode match: holds the tickets until the organiser answers. */
export function useRequestMatch() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('request'),
    mutationFn: (vars: JoinArgs) => matchRequest(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useWithdrawRequest() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('withdraw'),
    mutationFn: (requestId: string) => matchWithdraw(supabase, requestId),
    onSettled: () => invalidate(),
  });
}

/** The organiser's answer to a request; an approval can seat the fourth player and book. */
export function useDecideRequest() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('decide'),
    mutationFn: (vars: { requestId: string; approve: boolean }) => matchDecide(supabase, vars),
    onSettled: () => invalidate(true),
  });
}

/** Leave (all the guest's seats), or give up named seats (a friend's). */
export function useLeaveMatch() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('leave'),
    mutationFn: (vars: { matchId: string; seatIds?: string[] | null }) => matchLeave(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useRemovePlayer() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('remove'),
    mutationFn: (vars: { matchId: string; seatId: string }) => matchRemovePlayer(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useCancelMatch() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('cancel'),
    mutationFn: (vars: { matchId: string; reason: OrganiserCancelReason }) => matchCancel(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function usePostMatchMessage() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('message'),
    mutationFn: (vars: { matchId: string; code: MessageCode }) => matchPostMessage(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useReportPlayer() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('report'),
    mutationFn: (vars: ReportArgs) => matchReport(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useBlockPlayer() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('block'),
    mutationFn: (vars: { matchId: string; seatId?: string | null; requestId?: string | null }) =>
      matchBlock(supabase, vars),
    onSettled: () => invalidate(),
  });
}

export function useUnblockPlayer() {
  const invalidate = useInvalidateMatches();
  return useMutation({
    mutationKey: matchKeys.mutation('unblock'),
    mutationFn: (blockId: string) => matchUnblock(supabase, blockId),
    onSettled: () => invalidate(),
  });
}

/**
 * The one-time gender answer (§4.9, OM-28). On success, and on
 * GENDER_ALREADY_SET (another device answered first), the profile is re-read
 * so the stored value shows, and every match read with it (the categories and
 * `me.refusal` depend on it).
 */
export function useSetMyGender() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: matchKeys.mutation('gender'),
    mutationFn: (gender: Gender) => setMyGender(supabase, gender),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
      void queryClient.invalidateQueries({ queryKey: matchKeys.all });
    },
  });
}

/** For the root layout's foreground push listener: refresh every match read now. */
export function useRefreshMatches(): () => void {
  const invalidate = useInvalidateMatches();
  return useCallback(() => invalidate(), [invalidate]);
}

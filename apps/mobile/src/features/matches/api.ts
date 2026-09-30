/**
 * The open-match calls (docs/design/open-matches/guest.md §4.3; build
 * contracts §1.6). Each takes the typed client, as booking/api.ts and
 * deposit/api.ts do, so the call shapes are tested with a stub under plain
 * node; hooks.ts binds the app singleton.
 *
 * Reads return the PARSED shapes of logic.ts (every enum defensive); writes
 * return the few fields §4.3 lets the phone read, and the screen refetches
 * the rest (`match_detail`, `my_matches`, `my_tickets`). A refusal is thrown
 * as it came (a PostgREST error whose message is the code and whose `details`
 * is the detail), so `mapErrorToKey`, `matchErrorText` and the query client's
 * retry policy all read it the same way.
 *
 * Every match write is online-only (DF-11): nothing here is queued.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@touch/db';
import type { Locale } from '@touch/i18n';
import { invokeDepositEdge } from '../deposit/api';
import type { TicketContinuation } from './continuation';
import {
  parseDuplicate,
  parseJoinResult,
  parseMatchBlocks,
  parseMatchInvite,
  parseMatchQuote,
  parseMatchSlots,
  parseMatchView,
  parseMyMatches,
  parseOpenMatches,
  parseRequestResult,
  parseStartResult,
  parseTicketBegin,
  parseTicketWallet,
  type FriendSeat,
  type Gender,
  type JoinPolicy,
  type JoinResult,
  type MatchBlock,
  type MatchCategory,
  type MatchInvite,
  type MatchQuote,
  type MatchView,
  type MessageCode,
  type MyMatchRow,
  type OpenMatches,
  type OrganiserCancelReason,
  type ReportReason,
  type RequestResult,
  type SlotMatch,
  type StartResult,
  type TicketBegin,
  type TicketWallet,
  type Visibility,
} from './logic';
import type { MatchScope } from './keys';

type Client = SupabaseClient<Database>;

const friendsJson = (friends: readonly FriendSeat[]): Json =>
  friends.map((f) => ({ gender: f.gender })) as Json;

// ── Reads ───────────────────────────────────────────────────────────────────

/** app.match_slots (anon and authenticated): the Book tab's chips. */
export async function fetchMatchSlots(
  client: Client,
  args: { venueId: string; from: string; to: string },
): Promise<SlotMatch[]> {
  const { data, error } = await client
    .schema('app')
    .rpc('match_slots', { p_venue_id: args.venueId, p_from: args.from, p_to: args.to });
  if (error) throw error;
  return parseMatchSlots(data);
}

/** app.open_matches: the list, and the Book tab's one-minute lookup. */
export async function fetchOpenMatches(
  client: Client,
  args: { venueId: string; from: string; to: string },
): Promise<OpenMatches> {
  const { data, error } = await client
    .schema('app')
    .rpc('open_matches', { p_venue_id: args.venueId, p_from: args.from, p_to: args.to });
  if (error) throw error;
  return parseOpenMatches(data);
}

/** app.match_detail by id (with the link's token, when there is one) or by token alone. */
export async function fetchMatchDetail(
  client: Client,
  args: { matchId?: string | null; token?: string | null },
): Promise<MatchView> {
  const { data, error } = await client.schema('app').rpc('match_detail', {
    ...(args.matchId ? { p_match_id: args.matchId } : {}),
    ...(args.token ? { p_token: args.token } : {}),
  });
  if (error) throw error;
  return parseMatchView(data);
}

/** app.match_invite (anon and authenticated): every miss is `closed`. */
export async function fetchMatchInvite(client: Client, token: string): Promise<MatchInvite> {
  const { data, error } = await client.schema('app').rpc('match_invite', { p_token: token });
  if (error) throw error;
  return parseMatchInvite(data);
}

/** app.my_matches. */
export async function fetchMyMatches(client: Client, scope: MatchScope): Promise<MyMatchRow[]> {
  const { data, error } = await client.schema('app').rpc('my_matches', { p_scope: scope });
  if (error) throw error;
  return parseMyMatches(data);
}

/** app.my_tickets: the wallet. */
export async function fetchMyTickets(client: Client): Promise<TicketWallet> {
  const { data, error } = await client.schema('app').rpc('my_tickets');
  if (error) throw error;
  return parseTicketWallet(data);
}

/** app.my_match_blocks. */
export async function fetchMyMatchBlocks(client: Client): Promise<MatchBlock[]> {
  const { data, error } = await client.schema('app').rpc('my_match_blocks');
  if (error) throw error;
  return parseMatchBlocks(data);
}

export interface QuoteArgs {
  venueId: string;
  courtId: string;
  /** ISO instant. */
  startAt: string;
  durationMin: number;
}

/** app.match_quote: what starting on this court and time would mean. */
export async function fetchMatchQuote(client: Client, args: QuoteArgs): Promise<MatchQuote> {
  const { data, error } = await client.schema('app').rpc('match_quote', {
    p_venue_id: args.venueId,
    p_court_id: args.courtId,
    p_start_at: args.startAt,
    p_duration_min: args.durationMin,
  });
  if (error) throw error;
  return parseMatchQuote(data);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface StartArgs {
  venueId: string;
  courtId: string;
  startAt: string;
  durationMin: number;
  category: MatchCategory;
  visibility: Visibility;
  joinPolicy: JoinPolicy;
  friends: FriendSeat[];
  /** The quote's `price_iqd`: PRICE_CHANGED when the server's has moved. */
  quotedPriceIqd: number;
  /** `matchIntentKey(matchStartIntent(...))`: required (a NULL key is INVALID_ARGUMENT). */
  idempotencyKey: string;
}

/** app.match_start: `duplicate: true` answers a replay of the same key with the first match (R24). */
export async function matchStart(client: Client, args: StartArgs): Promise<StartResult> {
  const { data, error } = await client.schema('app').rpc('match_start', {
    p_venue_id: args.venueId,
    p_court_id: args.courtId,
    p_start_at: args.startAt,
    p_duration_min: args.durationMin,
    p_category: args.category,
    p_visibility: args.visibility,
    p_join_policy: args.joinPolicy,
    p_friends: friendsJson(args.friends),
    p_quoted_price_iqd: args.quotedPriceIqd,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return parseStartResult(data);
}

export interface JoinArgs {
  matchId: string;
  friends: FriendSeat[];
  /** The link's token when the guest came from one (a link-only match). */
  token?: string | null;
}

/** app.match_join (an open-join match). */
export async function matchJoin(client: Client, args: JoinArgs): Promise<JoinResult> {
  const { data, error } = await client.schema('app').rpc('match_join', {
    p_match_id: args.matchId,
    p_friends: friendsJson(args.friends),
    ...(args.token ? { p_token: args.token } : {}),
  });
  if (error) throw error;
  return parseJoinResult(data, args.matchId);
}

/** app.match_request (an approve-mode match): holds the tickets until the organiser answers. */
export async function matchRequest(client: Client, args: JoinArgs): Promise<RequestResult> {
  const { data, error } = await client.schema('app').rpc('match_request', {
    p_match_id: args.matchId,
    p_friends: friendsJson(args.friends),
    ...(args.token ? { p_token: args.token } : {}),
  });
  if (error) throw error;
  return parseRequestResult(data);
}

export async function matchWithdraw(client: Client, requestId: string): Promise<{ duplicate: boolean }> {
  const { data, error } = await client.schema('app').rpc('match_withdraw', { p_request_id: requestId });
  if (error) throw error;
  return parseDuplicate(data);
}

/** app.match_decide: the organiser approves or declines a request. */
export async function matchDecide(
  client: Client,
  args: { requestId: string; approve: boolean },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client
    .schema('app')
    .rpc('match_decide', { p_request_id: args.requestId, p_approve: args.approve });
  if (error) throw error;
  return parseDuplicate(data);
}

/** app.match_leave: all the guest's seats, or only the named ones (a friend's seat given up). */
export async function matchLeave(
  client: Client,
  args: { matchId: string; seatIds?: string[] | null },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client.schema('app').rpc('match_leave', {
    p_match_id: args.matchId,
    ...(args.seatIds && args.seatIds.length > 0 ? { p_seat_ids: args.seatIds } : {}),
  });
  if (error) throw error;
  return parseDuplicate(data);
}

/** app.match_remove_player: the organiser removes a seat before the booking (OM-44). */
export async function matchRemovePlayer(
  client: Client,
  args: { matchId: string; seatId: string },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client
    .schema('app')
    .rpc('match_remove_player', { p_match_id: args.matchId, p_seat_id: args.seatId });
  if (error) throw error;
  return parseDuplicate(data);
}

/** app.match_cancel: the organiser, while filling or waiting for a court. */
export async function matchCancel(
  client: Client,
  args: { matchId: string; reason: OrganiserCancelReason },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client
    .schema('app')
    .rpc('match_cancel', { p_match_id: args.matchId, p_reason: args.reason });
  if (error) throw error;
  return parseDuplicate(data);
}

/** app.match_post_message: one preset message (no free text, OM-17). */
export async function matchPostMessage(
  client: Client,
  args: { matchId: string; code: MessageCode },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client
    .schema('app')
    .rpc('match_post_message', { p_match_id: args.matchId, p_code: args.code });
  if (error) throw error;
  return parseDuplicate(data);
}

export interface ReportArgs {
  matchId: string;
  reason: ReportReason;
  /** Exactly one of a seat or a request. */
  seatId?: string | null;
  requestId?: string | null;
  /** "Also block this player". */
  block?: boolean;
}

export async function matchReport(client: Client, args: ReportArgs): Promise<{ duplicate: boolean }> {
  const { data, error } = await client.schema('app').rpc('match_report', {
    p_match_id: args.matchId,
    p_reason: args.reason,
    ...(args.seatId ? { p_seat_id: args.seatId } : {}),
    ...(args.requestId ? { p_request_id: args.requestId } : {}),
    p_block: args.block === true,
  });
  if (error) throw error;
  return parseDuplicate(data);
}

export async function matchBlock(
  client: Client,
  args: { matchId: string; seatId?: string | null; requestId?: string | null },
): Promise<{ duplicate: boolean }> {
  const { data, error } = await client.schema('app').rpc('match_block', {
    p_match_id: args.matchId,
    ...(args.seatId ? { p_seat_id: args.seatId } : {}),
    ...(args.requestId ? { p_request_id: args.requestId } : {}),
  });
  if (error) throw error;
  return parseDuplicate(data);
}

export async function matchUnblock(client: Client, blockId: string): Promise<{ unblocked: boolean }> {
  const { data, error } = await client.schema('app').rpc('match_unblock', { p_block_id: blockId });
  if (error) throw error;
  const o = data && typeof data === 'object' ? (data as { unblocked?: unknown }) : {};
  return { unblocked: o.unblocked === true };
}

/** app.set_my_gender (0256): once; GENDER_ALREADY_SET when another value is stored. */
export async function setMyGender(
  client: Client,
  gender: Gender,
): Promise<{ gender: Gender | null; duplicate: boolean }> {
  const { data, error } = await client.schema('app').rpc('set_my_gender', { p_gender: gender });
  if (error) throw error;
  const o = data && typeof data === 'object' ? (data as { gender?: unknown; duplicate?: unknown }) : {};
  return {
    gender: o.gender === 'female' || o.gender === 'male' ? o.gender : null,
    duplicate: o.duplicate === true,
  };
}

// ── The edge `ticket-begin` ─────────────────────────────────────────────────

/**
 * Buy 1..3 tickets (Money's edge `ticket-begin`, `verify_jwt = true`): the
 * attempt's ref and Qi's page. A live attempt is answered again with the same
 * ref (`reused`), so a double tap or a retry opens one page, not two. It goes
 * through the deposit's edge caller: a refusal is a DepositEdgeError carrying
 * the body's `detail`; a request that never came back rethrows the fetch's
 * own error (a connection problem).
 */
export async function ticketBegin(
  client: Client,
  args: { count: number; locale: Locale },
): Promise<TicketBegin> {
  const data = await invokeDepositEdge(client, 'ticket-begin', {
    count: args.count,
    locale: args.locale,
  });
  return parseTicketBegin(data);
}

// ── The ticket continuation's call (§4.10.3) ────────────────────────────────

export type ContinuationResult =
  | { kind: 'join'; matchId: string }
  | { kind: 'request'; matchId: string; requestId: string | null }
  | { kind: 'start'; matchId: string };

/** Run a continuation's RPC with the arguments it recorded: the same call, the same key. */
export async function runContinuation(client: Client, c: TicketContinuation): Promise<ContinuationResult> {
  switch (c.kind) {
    case 'join': {
      const r = await matchJoin(client, { matchId: c.matchId, friends: c.friends, token: c.token });
      return { kind: 'join', matchId: r.matchId };
    }
    case 'request': {
      const r = await matchRequest(client, { matchId: c.matchId, friends: c.friends, token: c.token });
      return { kind: 'request', matchId: c.matchId, requestId: r.requestId };
    }
    case 'start': {
      const r = await matchStart(client, {
        venueId: c.venueId,
        courtId: c.courtId,
        startAt: c.startAt,
        durationMin: c.durationMin,
        category: c.category,
        visibility: c.visibility,
        joinPolicy: c.joinPolicy,
        friends: c.friends,
        quotedPriceIqd: c.quotedPriceIqd,
        idempotencyKey: c.idempotencyKey,
      });
      return { kind: 'start', matchId: r.matchId };
    }
  }
}

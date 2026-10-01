import { describe, expect, it, vi } from 'vitest';
import {
  fetchMatchDetail,
  fetchMatchInvite,
  fetchMatchSlots,
  fetchMyTickets,
  matchCancel,
  matchJoin,
  matchLeave,
  matchReport,
  matchStart,
  runContinuation,
  setMyGender,
  ticketBegin,
} from '../api';
import { DepositEdgeError } from '../../deposit/logic';
import { mapErrorToKey } from '../../booking/errors';

/**
 * The open-match call shapes (docs/design/open-matches/guest.md §4.3; build
 * contracts §1.6) on a stub client: the argument names the SQL declares, the
 * app schema, and `ticket-begin`'s refusals with their detail.
 */
function rpcClient(result: { data: unknown; error: unknown } = { data: {}, error: null }) {
  const rpc = vi.fn(function (this: unknown) {
    // PostgREST's rpc reads its own `this`: it must not be detached.
    expect(this).toBe(client.app);
    return Promise.resolve(result);
  });
  const app = { rpc };
  const client = { schema: vi.fn(() => app), app };
  return client;
}

function edgeClient(invoke: ReturnType<typeof vi.fn>) {
  return { functions: { invoke } } as never;
}

describe('reads', () => {
  it('match_slots takes the branch and the window', async () => {
    const client = rpcClient({ data: [], error: null });
    await fetchMatchSlots(client as never, { venueId: 'v', from: 'f', to: 't' });
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('match_slots', { p_venue_id: 'v', p_from: 'f', p_to: 't' });
  });

  it('match_detail sends the id, the token, or both, and nothing it does not have', async () => {
    const data = { id: 'm', start_at: 's', me: {} };
    const client = rpcClient({ data, error: null });
    await fetchMatchDetail(client as never, { matchId: 'm' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_detail', { p_match_id: 'm' });
    await fetchMatchDetail(client as never, { matchId: 'm', token: 't' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_detail', { p_match_id: 'm', p_token: 't' });
    await fetchMatchDetail(client as never, { token: 't' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_detail', { p_token: 't' });
  });

  it('my_tickets takes no argument; match_invite the token', async () => {
    const client = rpcClient({ data: { status: 'closed' }, error: null });
    await fetchMyTickets(client as never);
    expect(client.app.rpc).toHaveBeenLastCalledWith('my_tickets');
    expect(await fetchMatchInvite(client as never, 't')).toEqual({ status: 'closed' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_invite', { p_token: 't' });
  });

  it('throws the refusal as it came, so the error catalogue and the details read it', async () => {
    const err = { message: 'MATCH_NOT_FOUND', details: null };
    const client = rpcClient({ data: null, error: err });
    await expect(fetchMatchDetail(client as never, { matchId: 'm' })).rejects.toBe(err);
  });
});

describe('writes', () => {
  it('match_start sends every argument, the friends as jsonb and the key', async () => {
    const client = rpcClient({ data: { match_id: 'm', duplicate: true, share_token: 't' }, error: null });
    const r = await matchStart(client as never, {
      venueId: 'v',
      courtId: 'c',
      startAt: 's',
      durationMin: 90,
      category: 'women',
      visibility: 'link',
      joinPolicy: 'approve',
      friends: [{ gender: 'female' }],
      quotedPriceIqd: 40000,
      idempotencyKey: 'MOBILE:match.start:X',
    });
    expect(client.app.rpc).toHaveBeenCalledWith('match_start', {
      p_venue_id: 'v',
      p_court_id: 'c',
      p_start_at: 's',
      p_duration_min: 90,
      p_category: 'women',
      p_visibility: 'link',
      p_join_policy: 'approve',
      p_friends: [{ gender: 'female' }],
      p_quoted_price_iqd: 40000,
      p_idempotency_key: 'MOBILE:match.start:X',
    });
    expect(r).toEqual({ matchId: 'm', duplicate: true, shareToken: 't' });
  });

  it('match_join sends the token only when there is one', async () => {
    const client = rpcClient({ data: { match_id: 'm', match_status: 'booked' }, error: null });
    const r = await matchJoin(client as never, { matchId: 'm', friends: [] });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_join', { p_match_id: 'm', p_friends: [] });
    expect(r.matchStatus).toBe('booked');
    await matchJoin(client as never, { matchId: 'm', friends: [], token: 't' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_join', { p_match_id: 'm', p_friends: [], p_token: 't' });
  });

  it('match_leave names seats only when giving some up', async () => {
    const client = rpcClient();
    await matchLeave(client as never, { matchId: 'm' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_leave', { p_match_id: 'm' });
    await matchLeave(client as never, { matchId: 'm', seatIds: ['s-2'] });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_leave', { p_match_id: 'm', p_seat_ids: ['s-2'] });
  });

  it('match_report sends one target and the block switch; match_cancel its reason', async () => {
    const client = rpcClient();
    await matchReport(client as never, { matchId: 'm', reason: 'harassment', seatId: 's', block: true });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_report', {
      p_match_id: 'm',
      p_reason: 'harassment',
      p_seat_id: 's',
      p_block: true,
    });
    await matchCancel(client as never, { matchId: 'm', reason: 'plans_changed' });
    expect(client.app.rpc).toHaveBeenLastCalledWith('match_cancel', { p_match_id: 'm', p_reason: 'plans_changed' });
  });

  it('set_my_gender answers the stored value', async () => {
    const client = rpcClient({ data: { gender: 'female', gender_set_at: 'x', duplicate: false }, error: null });
    expect(await setMyGender(client as never, 'female')).toEqual({ gender: 'female', duplicate: false });
    expect(client.app.rpc).toHaveBeenCalledWith('set_my_gender', { p_gender: 'female' });
  });
});

describe('ticketBegin', () => {
  it('posts the count and the locale to ticket-begin', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { request_id: 'r-1', form_url: 'https://pay', amount_iqd: 20000, ticket_count: 2, reused: false },
      error: null,
    });
    const r = await ticketBegin(edgeClient(invoke), { count: 2, locale: 'ar' });
    expect(invoke).toHaveBeenCalledWith('ticket-begin', { body: { count: 2, locale: 'ar' } });
    expect(r).toMatchObject({ ref: 'r-1', formUrl: 'https://pay', ticketCount: 2 });
  });

  it('turns a refusal into an edge error with its code and detail', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: {
        name: 'FunctionsHttpError',
        context: { status: 409, json: async () => ({ error: 'TICKET_COUNT_INVALID', detail: 'wallet_limit' }) },
      },
    });
    const err = await ticketBegin(edgeClient(invoke), { count: 3, locale: 'en' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DepositEdgeError);
    expect((err as DepositEdgeError).message).toBe('TICKET_COUNT_INVALID');
    expect((err as DepositEdgeError).detail).toBe('wallet_limit');
    expect(mapErrorToKey(err)).toBe('matches.errors.ticketCountInvalid');
  });

  it('rethrows the fetch error of a request that never came back', async () => {
    const fetchErr = new TypeError('Network request failed');
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError', context: fetchErr } });
    await expect(ticketBegin(edgeClient(invoke), { count: 1, locale: 'en' })).rejects.toBe(fetchErr);
  });
});

describe('runContinuation (§4.10.3)', () => {
  it('replays a start with its recorded key', async () => {
    const client = rpcClient({ data: { match_id: 'm-new' }, error: null });
    const r = await runContinuation(client as never, {
      kind: 'start',
      savedAt: 'x',
      venueId: 'v',
      courtId: 'c',
      startAt: 's',
      durationMin: 90,
      category: 'open',
      visibility: 'public',
      joinPolicy: 'open',
      friends: [],
      quotedPriceIqd: 40000,
      idempotencyKey: 'MOBILE:match.start:K',
    });
    expect(r).toEqual({ kind: 'start', matchId: 'm-new' });
    expect(client.app.rpc).toHaveBeenCalledWith(
      'match_start',
      expect.objectContaining({ p_idempotency_key: 'MOBILE:match.start:K', p_quoted_price_iqd: 40000 }),
    );
  });

  it('replays a request with its token', async () => {
    const client = rpcClient({ data: { request_id: 'q-1' }, error: null });
    const r = await runContinuation(client as never, {
      kind: 'request',
      savedAt: 'x',
      matchId: 'm',
      token: 't',
      friends: [{ gender: null }],
    });
    expect(r).toEqual({ kind: 'request', matchId: 'm', requestId: 'q-1' });
    expect(client.app.rpc).toHaveBeenCalledWith('match_request', {
      p_match_id: 'm',
      p_friends: [{ gender: null }],
      p_token: 't',
    });
  });
});

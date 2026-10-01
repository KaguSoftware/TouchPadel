import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTINUATION_TTL_MS,
  bindTicketContinuation,
  claimContinuation,
  clearTicketContinuation,
  continuationBackHref,
  continuationFor,
  continuationPlan,
  getTicketContinuation,
  isContinuationFresh,
  parseTicketContinuation,
  resetContinuations,
  setTicketContinuation,
  settleContinuationKey,
  ticketsHref,
  type TicketContinuation,
} from '../continuation';
import { clearAllMatchIntentKeys, clearMatchIntentKey, matchIntentKey } from '../../../lib/idempotency';
import { matchStartIntent } from '../logic';

/**
 * NEED_TICKETS → buy → continue the same action (docs/design/open-matches/guest.md
 * §4.10.3, GD-1): once per ref per app life, within 30 minutes, the same
 * arguments (for a start, the same idempotency key), also after a cold start
 * (the pointer's `after`).
 */
afterEach(() => resetContinuations());

const NOW = Date.parse('2026-10-01T12:00:00Z');
const savedAt = new Date(NOW - 5 * 60_000).toISOString();

const join: TicketContinuation = {
  kind: 'join',
  savedAt,
  matchId: 'm-1',
  token: null,
  friends: [{ gender: null }],
};

const start: TicketContinuation = {
  kind: 'start',
  savedAt,
  venueId: 'v',
  courtId: 'c',
  startAt: '2026-10-02T17:00:00.000Z',
  durationMin: 90,
  category: 'women',
  visibility: 'link',
  joinPolicy: 'approve',
  friends: [{ gender: 'female' }],
  quotedPriceIqd: 40000,
  idempotencyKey: 'MOBILE:match.start:01J00000000000000000000000',
};

/** PostgREST's error object: the code is the message. */
const pg = (message: string) => ({ message, details: null, hint: null, code: 'P0001' });

describe('the in-memory continuation', () => {
  it('is set by the screen that met the shortage and bound to the purchase', () => {
    setTicketContinuation(join);
    expect(getTicketContinuation()).toBe(join);
    // Before ticket-begin answers, no ref owns it.
    expect(continuationFor('r-1', null)).toBeNull();
    bindTicketContinuation('r-1');
    expect(continuationFor('r-1', null)).toBe(join);
    expect(continuationFor('r-2', null)).toBeNull();
  });

  it('is not handed to a later purchase once it is bound to one (no join the buyer never picked)', () => {
    setTicketContinuation(join);
    bindTicketContinuation('r-1');
    // The next buy (a Profile top-up, another account) reads the unbound one only.
    expect(getTicketContinuation()).toBeNull();
    // The purchase it belongs to still finds it.
    expect(continuationFor('r-1', null)).toBe(join);
  });

  it('wins over the pointer for the same ref, and the pointer’s is used otherwise (a cold start)', () => {
    setTicketContinuation(join);
    bindTicketContinuation('r-1');
    expect(continuationFor('r-1', start)).toBe(join);
    clearTicketContinuation();
    expect(continuationFor('r-1', start)).toBe(start);
  });
});

describe('continuationPlan', () => {
  it('runs by itself once per ref, then offers the tap', () => {
    expect(continuationPlan('r-1', join, NOW)).toBe('auto');
    expect(continuationPlan('r-1', join, NOW)).toBe('tap');
    expect(continuationPlan('r-2', join, NOW)).toBe('auto');
  });

  it('never runs a stale one by itself (over 30 minutes)', () => {
    const old = { ...join, savedAt: new Date(NOW - CONTINUATION_TTL_MS - 1).toISOString() };
    expect(isContinuationFresh(old, NOW)).toBe(false);
    expect(continuationPlan('r-3', old, NOW)).toBe('tap');
    // A stale plan does not spend the claim.
    expect(claimContinuation('r-3')).toBe(true);
    expect(isContinuationFresh({ ...join, savedAt: 'garbage' }, NOW)).toBe(false);
  });

  it('has nothing to do without a continuation', () => {
    expect(continuationPlan('r-4', null, NOW)).toBe('none');
  });
});

describe('parseTicketContinuation (the pointer’s `after`)', () => {
  it('round-trips every kind through JSON', () => {
    for (const c of [join, { ...join, kind: 'request' as const, token: 'AbCdEfGhIjKlMnOpQrSt_-' }, start]) {
      expect(parseTicketContinuation(JSON.parse(JSON.stringify(c)))).toEqual(c);
    }
  });

  it('keeps the start’s idempotency key, so the replay is the same start (D34)', () => {
    const intent = matchStartIntent(start);
    const key = matchIntentKey(intent);
    const c = parseTicketContinuation(JSON.parse(JSON.stringify({ ...start, idempotencyKey: key })));
    expect(c?.kind === 'start' && c.idempotencyKey).toBe(key);
    // The memo still answers the same key for the same intent until it is cleared.
    expect(matchIntentKey(intent)).toBe(key);
    clearMatchIntentKey(intent);
    expect(matchIntentKey(intent)).not.toBe(key);
    clearMatchIntentKey(intent);
  });

  it('spends a replayed start’s key as a direct start does (§4.23)', () => {
    const intent = matchStartIntent(start);
    const settled = (err: unknown) => {
      const key = matchIntentKey(intent);
      settleContinuationKey(start, err);
      const kept = matchIntentKey(intent) === key;
      clearMatchIntentKey(intent);
      return kept;
    };
    // Success (also `duplicate: true`): a new start of the same slot mints a new key.
    expect(settled(null)).toBe(false);
    // A refusal that ends the intent spends it too.
    expect(settled(pg('SLOT_TAKEN'))).toBe(false);
    expect(settled(pg('MATCH_TOO_LATE'))).toBe(false);
    // The refusals the guest fixes, and a request that never came back, keep it.
    expect(settled(pg('NEED_TICKETS'))).toBe(true);
    expect(settled(pg('PRICE_CHANGED'))).toBe(true);
    expect(settled(new TypeError('Network request failed'))).toBe(true);
  });

  it('leaves the start keys alone for a join or a request, which carry none', () => {
    const intent = matchStartIntent(start);
    const key = matchIntentKey(intent);
    settleContinuationKey(join, null);
    settleContinuationKey({ ...join, kind: 'request' }, pg('SLOT_TAKEN'));
    expect(matchIntentKey(intent)).toBe(key);
    clearMatchIntentKey(intent);
  });

  it('forgets every start key on sign-out', () => {
    const a = matchIntentKey('start:v|c|s|60');
    const b = matchIntentKey('start:v|c|s|90');
    clearAllMatchIntentKeys();
    expect(matchIntentKey('start:v|c|s|60')).not.toBe(a);
    expect(matchIntentKey('start:v|c|s|90')).not.toBe(b);
    clearAllMatchIntentKeys();
  });

  it('mints `MOBILE:match.start:<ulid>`, one per intent (§4.23)', () => {
    const a = matchIntentKey('start:v|c|s|60');
    const b = matchIntentKey('start:v|c|s|90');
    expect(a).toMatch(/^MOBILE:match\.start:[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a).not.toBe(b);
    clearMatchIntentKey('start:v|c|s|60');
    clearMatchIntentKey('start:v|c|s|90');
  });

  it.each([
    ['not an object', 'join'],
    ['no savedAt', { ...join, savedAt: undefined }],
    ['a bad savedAt', { ...join, savedAt: 'yesterday' }],
    ['too many friends', { ...join, friends: [{ gender: null }, { gender: null }, { gender: null }] }],
    ['a bad friend', { ...join, friends: [{ gender: 'other' }] }],
    ['no match', { ...join, matchId: '' }],
    ['a bad token', { ...join, token: 42 }],
    ['an unknown kind', { ...join, kind: 'teleport' }],
    ['a start with no key', { ...start, idempotencyKey: undefined }],
    ['a start with a fractional duration', { ...start, durationMin: 90.5 }],
    ['a start with an unknown category', { ...start, category: 'mixed' }],
    ['a start with a negative price', { ...start, quotedPriceIqd: -1 }],
  ])('drops %s', (_why, raw) => {
    expect(parseTicketContinuation(raw)).toBeNull();
  });
});

describe('where it goes', () => {
  it('goes back to the match (with its token), or to the form re-quoting a start', () => {
    expect(continuationBackHref(join)).toEqual({ pathname: '/match/[id]', params: { id: 'm-1' } });
    expect(continuationBackHref({ ...join, token: 't' })).toEqual({
      pathname: '/match/[id]',
      params: { id: 'm-1', t: 't' },
    });
    expect(continuationBackHref(start)).toEqual({
      pathname: '/match-new',
      params: { venueId: 'v', courtId: 'c', startAt: start.startAt, durationMin: '90', priceIqd: '40000' },
    });
  });

  it('opens the tickets screen with the missing count clamped to one purchase', () => {
    expect(ticketsHref(2, 'join')).toEqual({ pathname: '/tickets', params: { buy: '2', for: 'join' } });
    expect(ticketsHref(0, 'start').params.buy).toBe('1');
    expect(ticketsHref(7, 'request').params.buy).toBe('3');
  });
});

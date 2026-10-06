import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUR_RUNNING, tournamentAnswer, tournamentsAnswer } from '@/test/tournamentsFixtures';

/**
 * The website's tournament reads (tournaments.server.ts; build contracts §1.11): the cache keys,
 * tags and windows; every argument sent, null included; a failed or unreadable read becomes the
 * `error` state OUTSIDE the cache (the cached function throws), so it is never served for the
 * whole window. `unstable_cache` is a pass-through here that records its options, and the client
 * is a stub: no live Supabase.
 */
const cacheCalls = vi.hoisted(
  () => [] as { keys: string[]; options: { tags?: string[]; revalidate?: number } }[],
);
const rpc = vi.hoisted(() => ({
  calls: [] as { fn: string; args: unknown }[],
  answer: { data: null as unknown, error: null as unknown },
}));

vi.mock('server-only', () => ({}));

vi.mock('next/cache', () => ({
  unstable_cache: <A extends unknown[], R>(
    fn: (...args: A) => Promise<R>,
    keys: string[],
    options: { tags?: string[]; revalidate?: number },
  ) => {
    cacheCalls.push({ keys, options });
    return fn;
  },
}));

vi.mock('./supabase/static', () => ({
  createStaticSupabase: () => ({
    schema: () => ({
      rpc: (fn: string, args: unknown) => {
        rpc.calls.push({ fn, args });
        return Promise.resolve(rpc.answer);
      },
    }),
  }),
}));

const { getCachedTournament, getCachedTournaments } = await import('./tournaments.server');

beforeEach(() => {
  rpc.calls = [];
  rpc.answer = { data: null, error: null };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the caches', () => {
  it('keys the list and the page apart, both tagged tournaments, 60 s and 30 s', () => {
    expect(cacheCalls).toEqual([
      { keys: ['tournaments-public'], options: { tags: ['tournaments'], revalidate: 60 } },
      { keys: ['tournament-public'], options: { tags: ['tournaments'], revalidate: 30 } },
    ]);
  });
});

describe('getCachedTournaments', () => {
  it('sends p_venue_id as null for every live branch, and reads ok', async () => {
    rpc.answer = { data: tournamentsAnswer(), error: null };
    const read = await getCachedTournaments(null);
    expect(rpc.calls).toEqual([{ fn: 'tournaments_public', args: { p_venue_id: null } }]);
    expect(read.status).toBe('ok');
    expect(read.tournaments?.tournaments.length).toBe(5);
  });

  it('reads {off: true} as off with nothing in it, and an empty list as empty', async () => {
    rpc.answer = { data: { off: true }, error: null };
    expect(await getCachedTournaments()).toEqual({ status: 'off', tournaments: null });
    rpc.answer = { data: tournamentsAnswer({ only: [] }), error: null };
    expect((await getCachedTournaments()).status).toBe('empty');
  });

  it('turns a failed or unreadable read into error, never a throw', async () => {
    rpc.answer = { data: null, error: { message: 'boom' } };
    expect(await getCachedTournaments()).toEqual({ status: 'error', tournaments: null });
    rpc.answer = { data: 'not json', error: null };
    expect(await getCachedTournaments()).toEqual({ status: 'error', tournaments: null });
  });
});

describe('getCachedTournament', () => {
  it('asks for the one id, and reads the page', async () => {
    rpc.answer = { data: tournamentAnswer(), error: null };
    const read = await getCachedTournament(TOUR_RUNNING);
    expect(rpc.calls).toEqual([{ fn: 'tournament_public', args: { p_id: TOUR_RUNNING } }]);
    expect(read.status).toBe('ok');
    expect(read.tournament?.id).toBe(TOUR_RUNNING);
  });

  it('reads {missing: true} as missing, and a failure as error', async () => {
    rpc.answer = { data: { missing: true }, error: null };
    expect(await getCachedTournament(TOUR_RUNNING)).toEqual({
      status: 'missing',
      tournament: null,
    });
    rpc.answer = { data: null, error: { message: 'boom' } };
    expect(await getCachedTournament(TOUR_RUNNING)).toEqual({ status: 'error', tournament: null });
    rpc.answer = { data: [], error: null };
    expect(await getCachedTournament(TOUR_RUNNING)).toEqual({ status: 'error', tournament: null });
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  fetchTournamentPublic,
  fetchTournamentsPublic,
  registerTournament,
  withdrawTournament,
} from '../api';

/**
 * The tournament call shapes (build contracts §1.6) on a stub client: the argument names the SQL
 * declares, every one sent (nulls included; no tournament RPC has a default), the app schema.
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

describe('reads', () => {
  it('tournaments_public sends p_venue_id null: every live branch', async () => {
    const client = rpcClient({ data: { off: true }, error: null });
    const pub = await fetchTournamentsPublic(client as never);
    expect(client.schema).toHaveBeenCalledWith('app');
    expect(client.app.rpc).toHaveBeenCalledWith('tournaments_public', { p_venue_id: null });
    expect(pub.off).toBe(true);
  });

  it('tournament_public sends the id', async () => {
    const client = rpcClient({ data: { missing: true }, error: null });
    const d = await fetchTournamentPublic(client as never, 't-1');
    expect(client.app.rpc).toHaveBeenCalledWith('tournament_public', { p_id: 't-1' });
    expect(d).toMatchObject({ missing: true, id: 't-1' });
  });
});

describe('writes', () => {
  it('register and withdraw send the tournament id, and nothing else', async () => {
    const client = rpcClient({
      data: { entry_id: 'e', status: 'registered', waitlist_position: null, duplicate: false },
      error: null,
    });
    await registerTournament(client as never, 't-1');
    expect(client.app.rpc).toHaveBeenCalledWith('tournament_register', { p_tournament_id: 't-1' });
    await withdrawTournament(client as never, 't-1');
    expect(client.app.rpc).toHaveBeenCalledWith('tournament_withdraw', { p_tournament_id: 't-1' });
  });

  it('throws a refusal as it came', async () => {
    const refusal = { message: 'TOURNAMENT_NOT_OPEN', details: 'cutoff' };
    const client = rpcClient({ data: null, error: refusal });
    await expect(registerTournament(client as never, 't-1')).rejects.toBe(refusal);
  });
});

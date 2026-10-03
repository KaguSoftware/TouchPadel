/**
 * The guest's tournament calls (plan §5.2; build contracts §1.6). Each takes the typed client, as
 * coaching/api.ts does, so the call shapes are tested with a stub under plain node; hooks.ts binds
 * the app singleton.
 *
 * Clients send every argument, nulls included (plan §3.6, the coaching `f5c61e4d` lesson): no
 * tournament RPC has a default. Reads return the PARSED shapes of logic.ts; a refusal is thrown as
 * it came (a PostgREST error whose message is the code and whose `details` is the detail), so
 * `tournamentErrorText` and the query client's retry policy read it the same way.
 *
 * Both writes are state-idempotent (a repeat answers `duplicate: true`) and take no idempotency
 * key; nothing here is queued.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import {
  parseRegisterResult,
  parseTournamentPublic,
  parseTournamentsPublic,
  parseWithdrawResult,
  type RegisterResult,
  type TournamentPublic,
  type TournamentsPublic,
  type WithdrawResult,
} from './logic';

type Client = SupabaseClient<Database>;

/**
 * app.tournaments_public for every live branch: `p_venue_id` null (the `coaching_public(null)`
 * pattern, §1.6). The generated types call the argument a string, as they call every argument;
 * null is the documented "every branch".
 */
export async function fetchTournamentsPublic(client: Client): Promise<TournamentsPublic> {
  const { data, error } = await client
    .schema('app')
    .rpc('tournaments_public', { p_venue_id: null as unknown as string });
  if (error) throw error;
  return parseTournamentsPublic(data);
}

/** app.tournament_public: `{missing: true}` parses to the one "not available" state. */
export async function fetchTournamentPublic(client: Client, id: string): Promise<TournamentPublic> {
  const { data, error } = await client.schema('app').rpc('tournament_public', { p_id: id });
  if (error) throw error;
  return parseTournamentPublic(data, id);
}

/** app.tournament_register: registered while places are left, then waitlisted (§1.6). */
export async function registerTournament(
  client: Client,
  tournamentId: string,
): Promise<RegisterResult> {
  const { data, error } = await client
    .schema('app')
    .rpc('tournament_register', { p_tournament_id: tournamentId });
  if (error) throw error;
  return parseRegisterResult(data);
}

/** app.tournament_withdraw: free while open and before the cut-off. */
export async function withdrawTournament(
  client: Client,
  tournamentId: string,
): Promise<WithdrawResult> {
  const { data, error } = await client
    .schema('app')
    .rpc('tournament_withdraw', { p_tournament_id: tournamentId });
  if (error) throw error;
  return parseWithdrawResult(data);
}

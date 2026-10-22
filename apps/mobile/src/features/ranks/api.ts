/**
 * The leaderboard calls (migration 0364). Each takes the typed client, as loyalty/api.ts does, so
 * the call shapes are tested with a stub under plain node; hooks.ts binds the app singleton.
 *
 * Reads return the PARSED shapes of logic.ts; a refusal is thrown as it came, so `mapErrorToKey`
 * reads it. Every write is online only: nothing here is queued, and neither write takes a key
 * (a second report of one booking is RANKS_ALREADY_REPORTED, a second answer RANKS_RESULT_CLOSED).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { normaliseUsername, parseBoard, parseMyRanks, type Board, type MyRanks } from './logic';

type Client = SupabaseClient<Database>;

/** app.ranks_board(): anon or signed in, the top of the board only. */
export async function fetchBoard(client: Client): Promise<Board> {
  const { data, error } = await client.schema('app').rpc('ranks_board');
  if (error) throw error;
  return parseBoard(data);
}

/** app.my_ranks(): the guest's own page. */
export async function fetchMyRanks(client: Client): Promise<MyRanks> {
  const { data, error } = await client.schema('app').rpc('my_ranks');
  if (error) throw error;
  return parseMyRanks(data);
}

export interface FoundPlayer {
  username: string;
  name: string | null;
  me: boolean;
}

/** app.ranks_find_player(username): exactly that username, or null. */
export async function findPlayer(client: Client, username: string): Promise<FoundPlayer | null> {
  const { data, error } = await client
    .schema('app')
    .rpc('ranks_find_player', { p_username: normaliseUsername(username) });
  if (error) throw error;
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  return typeof o.username === 'string'
    ? { username: o.username, name: typeof o.name === 'string' ? o.name : null, me: o.me === true }
    : null;
}

export interface ReportInput {
  reservationId: string;
  partner: string;
  opponent1: string;
  opponent2: string;
  won: boolean;
  /** "6-4, 7-5" (logic.buildScore), or null. */
  score: string | null;
}

/** app.ranks_report: every argument sent, the score as null when there is none. */
export async function reportGame(client: Client, input: ReportInput): Promise<void> {
  const { error } = await client.schema('app').rpc('ranks_report', {
    p_reservation_id: input.reservationId,
    p_partner: normaliseUsername(input.partner),
    p_opponent1: normaliseUsername(input.opponent1),
    p_opponent2: normaliseUsername(input.opponent2),
    p_won: input.won,
    p_score: input.score as string,
  });
  if (error) throw error;
}

/** app.ranks_confirm: an opponent says yes (it counts) or no (it is turned down). */
export async function answerResult(client: Client, resultId: string, accept: boolean): Promise<void> {
  const { error } = await client
    .schema('app')
    .rpc('ranks_confirm', { p_result_id: resultId, p_accept: accept });
  if (error) throw error;
}

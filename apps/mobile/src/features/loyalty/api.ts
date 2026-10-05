/**
 * The guest's loyalty calls (build contracts §1.3). Each takes the typed client, as
 * tournaments/api.ts does, so the call shapes are tested with a stub under plain node; hooks.ts
 * binds the app singleton.
 *
 * None of the three takes an argument. Reads return the PARSED shapes of logic.ts; a refusal is
 * thrown as it came, so `mapErrorToKey` and the query client's retry policy read it the same
 * way. Every loyalty write is online-only (L-6): nothing here is queued.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { MemberCard, MyLoyalty } from '@touch/core/loyalty';
import { parseMemberCard, parseMyLoyalty } from './logic';

type Client = SupabaseClient<Database>;

/** A card answer that does not parse is a server fault, not "no card": the screen says so. */
function cardOrThrow(raw: unknown): MemberCard {
  const card = parseMemberCard(raw);
  if (!card) throw new Error('MEMBER_CARD_MALFORMED');
  return card;
}

/** app.my_loyalty: balance, tier and next tier, the 50 newest ledger rows, active rewards. */
export async function fetchMyLoyalty(client: Client): Promise<MyLoyalty> {
  const { data, error } = await client.schema('app').rpc('my_loyalty');
  if (error) throw error;
  return parseMyLoyalty(data);
}

/** app.my_member_card: `{member_code, secret_b32, step}`; the server creates the card lazily. */
export async function fetchMyMemberCard(client: Client): Promise<MemberCard> {
  const { data, error } = await client.schema('app').rpc('my_member_card');
  if (error) throw error;
  return cardOrThrow(data);
}

/** app.rotate_member_card: a new secret ("my code was shared"); the same shape back. */
export async function rotateMemberCard(client: Client): Promise<MemberCard> {
  const { data, error } = await client.schema('app').rpc('rotate_member_card');
  if (error) throw error;
  return cardOrThrow(data);
}

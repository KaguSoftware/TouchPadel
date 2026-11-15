/**
 * The guest's loyalty calls (build contracts §1.3). Each takes the typed client, as
 * tournaments/api.ts does, so the call shapes are tested with a stub under plain node; hooks.ts
 * binds the app singleton.
 *
 * The card and balance calls take no argument. Reads return the PARSED shapes of logic.ts and
 * deals.ts; a refusal is thrown as it came, so `mapErrorToKey` and the query client's retry
 * policy read it the same way. Every loyalty write is online-only (L-6): nothing here is queued.
 *
 * Deals (0410): `my_deals` on a server that does not have it yet answers PGRST202, which reads
 * as "no deals", never as an error (the screens then show nothing new).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { MemberCard, MyDeals, MyLoyalty, MyRewardVouchers, RedeemRewardResult } from '@touch/core/loyalty';
import { NO_DEALS, isMissingRpc, parseMyDeals } from './deals';
import { parseMemberCard, parseMyLoyalty } from './logic';
import { NO_VOUCHERS, parseMyRewardVouchers, parseRedeemResult } from './vouchers';

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

/**
 * app.my_deals (0410): the listed deals, the picked one first, then open, locked, used. A server
 * without the function reads as no deals.
 */
export async function fetchMyDeals(client: Client): Promise<MyDeals> {
  const { data, error } = await client.schema('app').rpc('my_deals');
  if (error) {
    if (isMissingRpc(error)) return NO_DEALS;
    throw error;
  }
  return parseMyDeals(data);
}

/**
 * app.pick_deal (0410): the deal to use next at the cashier; null clears the pick. Answers the
 * deals again. Refusals DEAL_UNAVAILABLE, DEAL_LOCKED and DEAL_USED are thrown as they came.
 */
export async function pickDeal(client: Client, promotionId: string | null): Promise<MyDeals> {
  // The generated types call the argument a string, as they call every argument; null is the
  // documented "clear the pick", and it is still sent (PostgREST matches by argument names).
  const { data, error } = await client
    .schema('app')
    .rpc('pick_deal', { p_promotion_id: promotionId as unknown as string });
  if (error) throw error;
  return parseMyDeals(data);
}

/**
 * app.redeem_reward (0415): the points leave at once and a voucher for that one reward comes back
 * with its fixed code, for the till to scan within 15 minutes. One key per press: a retry of the
 * same press replays the same voucher. Refusals (POINTS_INSUFFICIENT, VOUCHER_LIMIT,
 * REWARD_NOT_FOUND, LOYALTY_OFF) are thrown as they came.
 */
export async function redeemReward(client: Client, rewardId: string, key: string): Promise<RedeemRewardResult> {
  const { data, error } = await client
    .schema('app')
    .rpc('redeem_reward', { p_reward_id: rewardId, p_idempotency_key: key });
  if (error) throw error;
  return parseRedeemResult(data);
}

/** app.cancel_reward_voucher (0415): the guest's own active voucher ends and its points come back. */
export async function cancelRewardVoucher(client: Client, voucherId: string): Promise<{ balance: number }> {
  const { data, error } = await client.schema('app').rpc('cancel_reward_voucher', { p_voucher_id: voucherId });
  if (error) throw error;
  return { balance: Number((data as { balance?: unknown } | null)?.balance) || 0 };
}

/**
 * app.my_reward_vouchers (0415): the active ones and those ended in the last 30 minutes, with the
 * server clock. A server without 0415 reads as no vouchers.
 */
export async function fetchMyRewardVouchers(client: Client): Promise<MyRewardVouchers> {
  const { data, error } = await client.schema('app').rpc('my_reward_vouchers');
  if (error) {
    if (isMissingRpc(error)) return NO_VOUCHERS;
    throw error;
  }
  return parseMyRewardVouchers(data);
}

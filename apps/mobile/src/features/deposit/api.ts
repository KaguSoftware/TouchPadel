/**
 * The deposit's three calls (build-contracts-2026-09-27 §2.2, §3). Each takes
 * the typed client, as booking/api.ts does, so the call shapes are tested with
 * a stub under plain node; hooks.ts binds the app singleton.
 *
 *   depositQuote(holdId)          app.deposit_quote           Review's terms
 *   depositBegin({holdId, locale}) edge `deposit-begin`       start (or rejoin) an attempt
 *   depositStatus(ref)            edge `deposit-status`       what the payment screen renders
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';
import {
  DepositEdgeError,
  bodyErrorCode,
  bodyErrorDetail,
  parseDepositBegin,
  parseDepositQuote,
  parseDepositStatus,
  type DepositBegin,
  type DepositQuote,
  type DepositStatus,
} from './logic';

type Client = SupabaseClient<Database>;

/** app.deposit_quote (0242). Returns jsonb; `parseDepositQuote` reads it defensively. */
export async function depositQuote(client: Client, holdId: string): Promise<DepositQuote> {
  const { data, error } = await client.schema('app').rpc('deposit_quote', { p_hold_id: holdId });
  if (error) throw error;
  return parseDepositQuote(data);
}

export type DepositEdgeFunction = 'deposit-begin' | 'deposit-status' | 'ticket-begin';

/**
 * Call a deposit edge function as the signed-in guest.
 *
 * A refusal (`{error: 'CODE', detail?}` with a 4xx/5xx) becomes a
 * DepositEdgeError whose message is the code, so it maps through CODE_TO_KEY
 * like an RPC refusal and the query client never retries a decision. The
 * open-match `ticket-begin` (features/matches/api.ts `ticketBegin`) is called
 * through here too, so its `detail` (`TICKET_COUNT_INVALID` `wallet_limit`)
 * rides on the same error. A request that never came back
 * rethrows the fetch's own error, so lib/network.ts classifies it as a
 * connection problem (the same split staff/api.ts callStaffEdge makes).
 */
export async function invokeDepositEdge(
  client: Client,
  name: DepositEdgeFunction,
  body: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (!error) return data;
  const failure = error as { name?: string; context?: unknown };
  if (failure.name === 'FunctionsHttpError') {
    const response = failure.context as
      | { status?: unknown; json?: () => Promise<unknown> }
      | undefined;
    let payload: unknown = null;
    try {
      payload = await response?.json?.();
    } catch {
      // A body that is not JSON carries no code.
    }
    throw new DepositEdgeError(
      bodyErrorCode(payload),
      typeof response?.status === 'number' ? response.status : null,
      bodyErrorDetail(payload),
    );
  }
  if (failure.name === 'FunctionsFetchError' && failure.context) throw failure.context;
  throw error;
}

/**
 * Start a payment on a hold, or rejoin the one already running on it (the
 * edge function answers a live attempt with the same ref and form_url, so a
 * double tap or a retry opens one page, not two).
 */
export async function depositBegin(
  client: Client,
  args: { holdId: string; locale: Locale },
): Promise<DepositBegin> {
  const data = await invokeDepositEdge(client, 'deposit-begin', {
    hold_id: args.holdId,
    locale: args.locale,
  });
  return parseDepositBegin(data);
}

/** The attempt as the server knows it, after asking Qi when it is still open. */
export async function depositStatus(client: Client, ref: string): Promise<DepositStatus> {
  const data = await invokeDepositEdge(client, 'deposit-status', { ref });
  return parseDepositStatus(data);
}

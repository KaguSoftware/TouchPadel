/**
 * reads.ts — assistant-chat's reads (moved out of assistant-chat/index.ts on
 * 2026-11-09; history in docs/design/assistant/chat-changelog.md).
 *
 * Which client reads what (plan §7.1): the conversation, its latest answer,
 * the timezone and the re-check's rows go through `asOwner`, the client bound
 * to the caller's JWT (RLS, 0108/0234, admits only an owner; the caller still
 * compares owner_id). The service client reads only bookkeeping: the price
 * list in platform_settings, the stored history of a chat the caller was
 * already proven to own, and the answer reuse's candidates (filtered on
 * owner_id in the query).
 *
 * Deno-only (npm:@supabase/supabase-js types).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logError } from '../http.ts';
import { parseRates, TAIL_MESSAGES, TAIL_STEP, tailStartSeq, type ModelRates } from './turnPolicy.ts';
import { errorText } from './turn.ts';
import { aborting } from './runners.ts';
import type { RecheckIo, RerunCtx } from './recheck.ts';
import type { ReuseReads } from './reuse.ts';

const DEFAULT_TZ = 'Asia/Baghdad';


export interface VenueModels {
  default_model: string | null;
  priced: string[];
  /** The per-kind rates per model (USD micros per million tokens), for the running cost estimate (F1). */
  rates: Record<string, Partial<ModelRates>>;
  /** 0079's blended rate, what app.llm_price_calc charges a kind the list does not name. */
  fallback_per_mtok: number;
}

/**
 * 0114: the chain default model and the models the pricing table can bill
 * (service read; platform_settings since 0207), plus the rates themselves so a
 * model call is estimated without a round trip (F1).
 */
export async function venueModels(service: SupabaseClient): Promise<VenueModels> {
  const { data, error } = await service.from('platform_settings').select('llm_default_model, llm_pricing, llm_cost_micros_per_mtok').eq('id', true).maybeSingle();
  // Not fatal (the chain default and the request's model check fall back as
  // before), but said: with no rates the running estimate uses turnPolicy's
  // FLOOR_RATES, so the USD 1.50 ceiling still holds (review 2026-10-08).
  if (error) logError('assistant-chat', error, 'platform_settings price list unread; estimating at the floor rates');
  const row = data as { llm_default_model?: string | null; llm_pricing?: Record<string, unknown> | null; llm_cost_micros_per_mtok?: unknown } | null;
  const fallback = Number(row?.llm_cost_micros_per_mtok);
  return {
    default_model: row?.llm_default_model ?? null,
    priced: Object.keys(row?.llm_pricing ?? {}),
    rates: parseRates(row?.llm_pricing),
    fallback_per_mtok: Number.isFinite(fallback) && fallback >= 0 ? fallback : 0,
  };
}

export type ConvRow = {
  id: string;
  owner_id?: string;
  scopes: string[];
  range: unknown;
  handles: unknown;
  tokens: Record<string, number> | null;
  title: string | null;
  model: string | null;
  /** 0325: the frozen first turn, or null. */
  context: unknown;
};

/**
 * The conversation as the owner (F1, item 7): RLS (0108, re-issued 0234)
 * lets only an owner read assistant_conversations, and the caller compares
 * owner_id itself, because the policy admits every owner.
 */
export async function readConversation(asOwner: SupabaseClient, id: string) {
  return await asOwner
    .from('assistant_conversations')
    .select('id, owner_id, scopes, range, handles, tokens, title, archived_at, model, context')
    .eq('id', id)
    .maybeSingle();
}

/**
 * The chat's latest stored answer: its `tokens` (model, effort/route) and when
 * it was stored, for the warm-cache route (turnPolicy keepWarmRoute). Any
 * failure is null: the router decides alone. Read as the owner; a planted row
 * can only pick between the two allowed models (keepWarmRoute checks the
 * priced list, provider.ts assistantModel clamps).
 */
export async function latestAnswer(asOwner: SupabaseClient, conversationId: string): Promise<{ tokens: unknown; created_at: unknown } | null> {
  try {
    const { data, error } = await asOwner
      .from('assistant_messages')
      .select('tokens, created_at')
      .eq('conversation_id', conversationId)
      .eq('role', 'assistant')
      .order('seq', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logError('assistant-chat', error, 'latest answer unread; routing without it');
      return null;
    }
    return (data as { tokens: unknown; created_at: unknown } | null) ?? null;
  } catch (e) {
    logError('assistant-chat', errorText(e), 'latest answer unread; routing without it');
    return null;
  }
}

export async function venueTimezone(asOwner: SupabaseClient): Promise<string> {
  const { data, error } = await asOwner.from('platform_settings').select('timezone').eq('id', true).maybeSingle();
  // Not fatal (DEFAULT_TZ, as before), but said: every time the model reads shifts with it.
  if (error) logError('assistant-chat', error, `platform_settings timezone unread; using ${DEFAULT_TZ}`);
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === 'string' && tz ? tz : DEFAULT_TZ;
}

/**
 * The stored history (F1 item 3): every message from a seq aligned to
 * TAIL_STEP up to the one just inserted, so the bytes after messages[0] stay
 * the same for TAIL_STEP messages. `id` and `gate` come along for the
 * previous answer's signed figures (item 10, review 2026-10-08). Service
 * client: the caller's ownership of the chat was checked before the stream.
 */
export async function readTail(service: SupabaseClient, conversationId: string, userSeq: number, signal: AbortSignal): Promise<{ id: string; role: string; content: unknown; seq: number; gate: unknown }[]> {
  const { data, error } = await aborting(
    service
      .from('assistant_messages')
      .select('id, role, content, seq, gate')
      .eq('conversation_id', conversationId)
      .gte('seq', tailStartSeq(userSeq))
      .lt('seq', userSeq)
      .order('seq', { ascending: true })
      .limit(TAIL_MESSAGES + TAIL_STEP),
    signal,
  );
  // As before: a failed read answers without history rather than failing the turn.
  if (error) logError('assistant-chat', error, 'history not read');
  return (data ?? []) as { id: string; role: string; content: unknown; seq: number; gate: unknown }[];
}

/** The re-check's two reads (recheck.ts RecheckIo), as the owner. */
export function recheckReads(asOwner: SupabaseClient): Pick<RecheckIo<RerunCtx>, 'readMessage' | 'readConversation'> {
  return {
    readMessage: (id) => asOwner.from('assistant_messages').select('id, conversation_id, role, content, sources, gate').eq('id', id).maybeSingle(),
    readConversation: (id) => asOwner.from('assistant_conversations').select('id, owner_id, scopes, handles').eq('id', id).maybeSingle(),
  };
}

/** The answer reuse's reads (reuse.ts ReuseReads), on the service client, owner_id in the query. */
export function reuseReads(service: SupabaseClient): ReuseReads {
  return {
    recentChats: ({ ownerId, since, excludeId }) =>
      service
        .from('assistant_conversations')
        .select('id, scopes, handles, context')
        .eq('owner_id', ownerId)
        .is('archived_at', null)
        .gte('updated_at', since)
        .neq('id', excludeId)
        .order('updated_at', { ascending: false })
        .limit(60),
    firstMessages: (conversationIds) =>
      service
        .from('assistant_messages')
        .select('conversation_id, content, created_at')
        .in('conversation_id', conversationIds)
        .eq('seq', 1)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(60),
    reply: (conversationId) =>
      service
        .from('assistant_messages')
        .select('id, role, content, sources, gate, tokens, created_at')
        .eq('conversation_id', conversationId)
        .eq('seq', 2)
        .maybeSingle(),
  };
}

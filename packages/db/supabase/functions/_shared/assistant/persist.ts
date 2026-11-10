/**
 * persist.ts — the end of an assistant-chat turn, and the writes it shares
 * with the start (moved out of assistant-chat/index.ts on 2026-11-09; history
 * in docs/design/assistant/chat-changelog.md).
 *
 * Persisted per message, on the service client (bookkeeping only, plan §7.1):
 * the assistant row (final text blocks, sources, gate with its signed
 * figures, tokens), one assistant_calls row per model call priced by
 * `app.llm_price_micros`, one `llm_record_usage` and `llm_record_web_search`,
 * the conversation's handles / spend / title / frozen context through
 * `app.assistant_conversation_persist` (0405), and a proposed job's row.
 * Intermediate tool_use blocks are NOT stored (the sources panel has them),
 * so a stored turn is always API-valid on replay. It runs even after the loop
 * threw: a turn that failed still stores what it spent.
 *
 * Deno-only (Deno.env, crypto.subtle, npm:@supabase/supabase-js types).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { logError } from '../http.ts';
import { insertAtNextSeq } from './seq.ts';
import { contextStorable, gateSignatureInput, type FrozenContext } from './turnPolicy.ts';
import { errorText, hasCitations, type TurnState } from './turn.ts';
import { toJson, type HandleTable } from './handles.ts';
import { titleFrom } from './prompt.ts';
import { textOf, withoutThinking, type ContentBlock, type ProviderUsage } from './provider.ts';
import type { TurnRoute } from './route.ts';
import type { AssistantEvent } from './sse.ts';
import type { AssistantScope } from './tools.ts';

const SURFACE = 'assistant';

/**
 * USD micros per web search when platform_settings cannot be read: Anthropic's
 * $10 per 1,000 searches, the same default migration 0324 gives
 * `llm_web_search_micros`. Only the per-call meter falls back to it; the spend
 * cap is recorded by `app.llm_record_web_search` from the column itself.
 */
const WEB_SEARCH_MICROS_FALLBACK = 10_000;

/** The highest seq of a conversation, 0 when it has none (assistant/seq.ts ports). */
async function maxSeq(service: SupabaseClient, conversationId: string): Promise<number> {
  const { data, error } = await service
    .from('assistant_messages')
    .select('seq')
    .eq('conversation_id', conversationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as { seq?: number } | null)?.seq ?? 0;
}

/** Insert one assistant_messages row at the conversation's next seq, race-free (assistant/seq.ts). */
export function insertMessage(service: SupabaseClient, conversationId: string, row: Record<string, unknown>) {
  return insertAtNextSeq({
    maxSeq: () => maxSeq(service, conversationId),
    insert: async (seq) => (await service.from('assistant_messages').insert({ ...row, conversation_id: conversationId, seq })).error,
  });
}

/**
 * HMAC-SHA256 (hex) over turnPolicy.gateSignatureInput, keyed from the
 * function's own SUPABASE_SERVICE_ROLE_KEY (a client never holds it). It signs
 * the `gate.numbers` an answer stores, and the next turn trusts the previous
 * answer's figures only with a matching `gate.sig`: any owner session could
 * INSERT an assistant_messages row (0108) until 0329 revoked it, so the column
 * alone proved nothing (review 2026-10-08); the signature stays as defence in
 * depth. Null without the key: nothing is signed or trusted.
 */
let gateKey: Promise<CryptoKey> | null = null;
export function gateSigner(): ((input: string) => Promise<string>) | null {
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) return null;
  const enc = new TextEncoder();
  gateKey ??= crypto.subtle.importKey('raw', enc.encode(`assistant-gate-numbers:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const key = gateKey;
  return async (input: string) => {
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, enc.encode(input)));
    return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  };
}

/**
 * The database's exact price for one call's tokens, at persist (F1: no
 * longer between rounds). Null when the RPC fails; the call keeps its estimate.
 */
export async function priceOf(service: SupabaseClient, model: string, u: ProviderUsage): Promise<number | null> {
  const { data, error } = await service.schema('app').rpc('llm_price_micros', {
    p_model: model,
    p_input: u.input,
    p_cache_write: u.cache_write,
    p_cache_read: u.cache_read,
    p_output: u.output,
  });
  if (error) {
    logError('assistant-chat', error, 'llm_price_micros');
    return null;
  }
  const n = Number(data ?? 0);
  return Number.isFinite(n) ? n : null;
}

/** The per-search price from platform_settings, read once per turn (one pricer per turn) and only when a search ran. */
export function webSearchPricer(service: SupabaseClient): () => Promise<number> {
  let searchMicros: number | null = null;
  return async (): Promise<number> => {
    if (searchMicros !== null) return searchMicros;
    const { data, error } = await service.from('platform_settings').select('llm_web_search_micros').eq('id', true).maybeSingle();
    const v = Number((data as { llm_web_search_micros?: unknown } | null)?.llm_web_search_micros);
    if (error || !Number.isFinite(v)) {
      logError('assistant-chat', error ?? 'no row', 'llm_web_search_micros unread; using the default');
      searchMicros = WEB_SEARCH_MICROS_FALLBACK;
    } else searchMicros = v;
    return searchMicros;
  };
}

/** What the end of a turn reads; every field is final once the loop has ended or thrown. */
export interface PersistInput {
  service: SupabaseClient;
  /** The model the turn ran on (provider.model). */
  model: string;
  route: Pick<TurnRoute, 'kind' | 'reason' | 'effort'>;
  turn: TurnState<ContentBlock>;
  convId: string;
  /** The chat's title when the turn started; an untitled chat gets one from `ownerText`. */
  convTitle: string | null;
  assistantMessageId: string;
  handles: HandleTable;
  scopes: readonly AssistantScope[];
  /** The owner's words this turn. */
  ownerText: string;
  /** A first turn built (not replayed) this turn, or null. */
  freshContext: FrozenContext | null;
  /** The turn's signal, read when the context is written: a Stop or the wall during persist keeps it out, as before. */
  signal: AbortSignal;
  errorOut: { code: string; message: string } | null;
  /** The message a reused answer came from; null for a normal turn. */
  reusedFrom: string | null;
  gateSign: ((input: string) => Promise<string>) | null;
  emit: (event: AssistantEvent, data: unknown) => void;
}


export async function persistTurn(d: PersistInput): Promise<void> {
  const { service, model, route, turn, convId, convTitle, assistantMessageId, handles, scopes, ownerText, freshContext, signal, errorOut, reusedFrom, gateSign, emit } = d;
  const { calls, sources, allowed } = turn;
  // The loop has ended (or thrown): its state is final from here on.
  const { webSearches, costCapped, finalContent, finalText, gate, gateRetried, jobEstimate } = turn;
  // The exact prices, every call at once (F1 item 9): the token price from
  // app.llm_price_micros plus the call's searches (0324); a call whose price
  // could not be read keeps its estimate.
  const exact = await Promise.all(calls.map((c) => priceOf(service, model, c.usage)));
  calls.forEach((c, i) => {
    const price = exact[i];
    if (price !== null && price !== undefined) c.cost_micros = price + c.search_micros;
  });
  const usage = calls.reduce<ProviderUsage>(
    (acc, c) => ({ input: acc.input + c.usage.input, cache_write: acc.cache_write + c.usage.cache_write, cache_read: acc.cache_read + c.usage.cache_read, output: acc.output + c.usage.output }),
    { input: 0, cache_write: 0, cache_read: 0, output: 0 },
  );
  const cost_micros = calls.reduce((n, c) => n + c.cost_micros, 0);
  // F1: the router's verdict beside the spend, and whether the cost ceiling cut the message short.
  const tokens = {
    ...usage,
    cost_micros,
    calls: calls.length,
    model: model,
    web_searches: webSearches,
    route: route.kind,
    route_reason: route.reason,
    // The next turn's warm-cache route reads model + effort back (turnPolicy previousTurnOf).
    effort: route.effort,
    ...(costCapped ? { cost_capped: true } : {}),
    ...(reusedFrom ? { reused_from: reusedFrom } : {}),
  };
  // A web answer's text blocks carry citations that only make sense beside
  // that turn's search results; the stored turn keeps the text as one block.
  const content = hasCitations(finalContent) ? [{ type: 'text', text: textOf(finalContent) }] : withoutThinking(finalContent).filter((b) => b.type === 'text');
  const stored = content.length ? content : [{ type: 'text', text: finalText || (errorOut ? `[${errorOut.code}] ${errorOut.message}` : '') }];
  // The re-check baseline: every number the tools and the pre-search gave this turn,
  // deduped, beside the gate verdict (cited web figures and the previous
  // answer's figures are accepted by the gate but not repeated here).
  const numbers = [...new Set(allowed)].sort((a, b) => a - b);
  // `sig`: this function's HMAC over the chat, this message and the figures,
  // which the next turn needs before the gate trusts them (gateSigner).
  let sig: string | null = null;
  if (gate && gateSign && numbers.length) {
    try {
      sig = await gateSign(gateSignatureInput(convId, assistantMessageId, numbers));
    } catch (e) {
      logError('assistant-chat', errorText(e), 'gate figures not signed');
    }
  }
  const storedGate = gate ? { ...gate, numbers, ...(sig ? { sig } : {}) } : null;

  // At the next seq, not userSeq + 1: a concurrent send into this chat may
  // have taken that number meanwhile (assistant/seq.ts re-reads and retries).
  const msg = await insertMessage(service, convId, {
    id: assistantMessageId,
    role: 'assistant',
    content: stored,
    sources,
    gate: storedGate,
    tokens,
  });
  if (msg.error) logError('assistant-chat', msg.error, `assistant message ${assistantMessageId} not stored in ${convId}`);
  else if (calls.length) {
    const rows = calls.map((c) => ({
      message_id: assistantMessageId,
      call_no: c.call_no,
      model: c.model,
      input_tokens: c.usage.input,
      cache_write_tokens: c.usage.cache_write,
      cache_read_tokens: c.usage.cache_read,
      output_tokens: c.usage.output,
      cost_micros: c.cost_micros,
      web_searches: c.web_searches,
      ms: c.ms,
      stop_reason: c.stop_reason,
    }));
    const ins = await service.from('assistant_calls').insert(rows);
    if (ins.error) logError('assistant-chat', ins.error, 'calls not stored');
  }
  if (calls.length) {
    // In every path, like analytics-insights: a timed-out turn still spent the money.
    const rec = await service.schema('app').rpc('llm_record_usage', {
      p_model: model,
      p_input: usage.input,
      p_cache_write: usage.cache_write,
      p_cache_read: usage.cache_read,
      p_output: usage.output,
      p_model_calls: calls.length,
      p_surface: SURFACE,
    });
    if (rec.error) logError('assistant-chat', rec.error, 'usage not recorded');
  }
  if (webSearches) {
    // Searches are billed apart from tokens; the cap must see them too (0324).
    const rec = await service.schema('app').rpc('llm_record_web_search', { p_searches: webSearches });
    if (rec.error) logError('assistant-chat', rec.error, 'web searches not recorded');
  }
  // 0405: THIS turn's delta, added to the stored tokens in SQL on the locked
  // row. Until 2026-11-09 the edge wrote conv.tokens (read at turn start) +
  // delta, so two turns of one chat running together (seq.ts allows it) lost
  // one turn's spend (review 2026-11-09). handles stay last-writer-wins; the
  // SQL sets title only while the row has none, context only when given.
  const upd = await service.schema('app').rpc('assistant_conversation_persist', {
    p_conversation_id: convId,
    p_handles: toJson(handles),
    p_usage: { input: usage.input, cache_write: usage.cache_write, cache_read: usage.cache_read, output: usage.output, cost_micros, calls: calls.length, web_searches: webSearches },
    p_title: convTitle ? null : titleFrom(ownerText),
    // 0325: the first turn built this turn, replayed by the next ones
    // (header) — only a whole one from a turn that finished (review 2026-10-08).
    p_context: freshContext && contextStorable({ aborted: signal.aborted, turnFailed: errorOut !== null }) ? freshContext : null,
  });
  if (upd.error) logError('assistant-chat', upd.error, 'conversation not updated');

  if (jobEstimate) {
    const { plan, ...estimate } = jobEstimate;
    const ins = await service
      .from('assistant_jobs')
      .insert({ conversation_id: convId, message_id: assistantMessageId, status: 'estimated', plan, estimate, chunks_total: estimate.chunks, chunks_done: 0, tokens: {} })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      logError('assistant-chat', ins.error ?? 'no row', 'job not stored');
      emit('error', { code: 'UPSTREAM', message: 'the job estimate could not be stored' });
    } else {
      const job_id = (ins.data as { id: string }).id;
      const est = await service.from('assistant_jobs').update({ estimate: { ...estimate, job_id } }).eq('id', job_id);
      // The job row stands; only its estimate lacks the self-reference.
      if (est.error) logError('assistant-chat', est.error, `job ${job_id} estimate not stamped`);
      emit('job_estimate', { ...estimate, job_id });
    }
  }
  emit('sources', { items: sources, scopes });
  if (gate && !jobEstimate) emit('gate', { ...gate, retried: gateRetried });
  emit('usage', { ...usage, cost_micros, calls: calls.length, model: model, web_searches: webSearches });
}

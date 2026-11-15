/**
 * The owner assistant's data layer (contracts §Lane D).
 *
 *  - Reads go straight through `supabase.from('assistant_*')` under RLS.
 *  - Scope changes and archiving are `app.*` RPCs.
 *  - Job accept/cancel are unary edge calls (`callEdge`, never cached).
 *  - A question is `streamEdge('assistant-chat')`; pack sizes are the same
 *    function with `dry_run: true`, which answers JSON and calls no model.
 *
 * TYPING NOTE: Lane A regenerates `packages/db/src/types.gen.ts` concurrently
 * and the assistant tables and RPCs are not in it yet, so `appRpc` and the
 * typed `supabase.from` refuse these names at compile time. `assistantRpc`
 * and `table()` below use the same loose cast `appRpc` uses internally; the
 * SQL migrations (0108–0112) remain the source of truth for names and args.
 * Once `db:types` lands they can be swapped for `appRpc`/`supabase.from`
 * with no other change.
 */
import type { AssistantScope } from '@touch/core/assistant/tools';
import {
  asModelsPayload,
  sourcesOf as readSources,
  type ConversationRow,
  type DateRange,
  type JobEstimate,
  type MessageRow,
  type ModelsPayload,
  type StoredSources,
} from '@touch/core/assistant/client';
import { appRpc, toAppRpcError } from '../../lib/appRpc';
import { callEdge, streamEdge, type StreamEdgeOptions } from '../../lib/edge';
import { supabase } from '../../lib/supabase';
import { currentBranchId } from '../../lib/venueScope';

/**
 * Multi-venue audit (0228): the branch the rail shows. The assistant's tools
 * then read that branch, as every other screen does; the edge function
 * forwards it server to server as x-venue-scope.
 */
function scopeField(): { venue_scope?: string } {
  const branch = currentBranchId();
  return branch ? { venue_scope: branch } : {};
}
import type { PricingMap, TokenKinds } from '../../lib/assistantPricing';

// ---------------------------------------------------------------------------
// Rows (0108) and payloads (assistant-chat SSE, estimate.ts): one copy, in
// @touch/core/assistant/client, shared with the phone.
// ---------------------------------------------------------------------------

export type {
  AssistantErrorCode,
  ConversationRow,
  DateRange,
  EstimateTokens,
  GatePayload,
  JobEstimate,
  JobEstimateModes,
  JobEstimateStep,
  MessageRow,
  ModelsPayload,
  SourceItem,
  UsagePayload,
} from '@touch/core/assistant/client';
export { textOfContent } from '@touch/core/assistant/client';

export type JobStatus = 'estimated' | 'accepted' | 'running' | 'reducing' | 'done' | 'failed' | 'cancelled' | 'over_estimate';
export type JobMode = 'live' | 'batch';

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

export interface JobRow {
  id: string;
  conversation_id: string | null;
  message_id: string | null;
  status: JobStatus;
  plan: { question?: string } & Record<string, unknown>;
  estimate: Omit<JobEstimate, 'job_id'> & Partial<Pick<JobEstimate, 'job_id'>>;
  mode: JobMode | null;
  chunks_total: number | null;
  chunks_done: number | null;
  tokens: Partial<TokenKinds> & { total?: number; cost_micros?: number; model?: string };
  result: unknown;
  error: string | null;
  batch_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** 0423: when the job entered its status; not in the generated types until db:types regenerates. */
  status_at?: string | null;
}

/** 0423: a token figure by kind, as estimate.ts writes it into result.pause.rest. */
export interface JobTokenBreakdown {
  input: number;
  cache_read: number;
  output: number;
  total: number;
}

/** 0423: why a live job paused with parts unread (jobRunner.ts PauseReason). */
export type JobPauseReason = 'over_estimate' | 'time' | 'cap' | 'stopped';

/**
 * 0423: `result.pause` on a paused job ('over_estimate'): the reason, the chunk
 * numbers still unread and what they and the answer should cost
 * (estimate.ts restEstimate). Read defensively: `result` is untyped jsonb.
 */
export interface JobPause {
  reason: JobPauseReason;
  at: string;
  chunks_left: number[];
  rest: { chunks: number; extract: JobTokenBreakdown; extract_high: JobTokenBreakdown; reduce: JobTokenBreakdown; reduce_high: JobTokenBreakdown };
}

/** 0423: what `POST {action:'resume'}` answers (batch, or the live run's end). */
export interface ResumeResponse {
  job_id: string;
  status: JobStatus;
  mode?: JobMode;
  batch_id?: string;
  chunks_total?: number;
  chunks_done?: number;
  reason?: JobPauseReason;
  message_id?: string;
}

/** `assistant_usage(p_from, p_to)` (0111). */
export interface UsageDay {
  usage_date: string;
  requests: number;
  model_calls: number;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  /** 0324: web searches that day; their price is already inside cost_micros. Absent before 0324. */
  web_searches?: number;
  cost_micros: number;
}

export interface UsageReport {
  days: UsageDay[];
  month: Omit<UsageDay, 'usage_date'>;
  cap: { daily_limit: number | null; monthly_cap_micros: number | null; month_cost_micros: number };
  pricing: PricingMap;
  fallback_micros_per_mtok: number;
  /** 0324: USD micros one web search costs. */
  web_search_micros?: number;
}

// ---------------------------------------------------------------------------
// Query keys (contracts §Lane D)
// ---------------------------------------------------------------------------

export const QK = {
  conversations: ['assistant', 'conversations'] as const,
  archivedConversations: ['assistant', 'conversations', 'archived'] as const,
  conversation: (id: string) => ['assistant', 'conversation', id] as const,
  /** Pack sizes for every scope over one range (the dry-run call). */
  start: (scopes: string, model: string) => ['assistant', 'start', scopes, model] as const,
  messages: (id: string) => ['assistant', 'messages', id] as const,
  job: (id: string) => ['assistant', 'job', id] as const,
  /** Every job of one conversation — the thread needs the running ones. */
  jobs: (conversationId: string) => ['assistant', 'jobs', conversationId] as const,
  usage: (from: string, to: string) => ['assistant', 'usage', from, to] as const,
  /** The venue default model and every model the pricing table can bill (0114). */
  models: ['assistant', 'models'] as const,
};

// ---------------------------------------------------------------------------
// Loose access (see the header note)
// ---------------------------------------------------------------------------

interface PgError {
  message?: string;
  hint?: string | null;
  details?: string | null;
  code?: string | null;
}

type Result<T> = PromiseLike<{ data: T; error: PgError | null }>;

/** The slice of the PostgREST builder these fetchers use. */
interface Rows<T> extends Result<T[] | null> {
  select(columns: string): Rows<T>;
  eq(column: string, value: unknown): Rows<T>;
  in(column: string, values: readonly unknown[]): Rows<T>;
  is(column: string, value: null): Rows<T>;
  not(column: string, operator: 'is', value: null): Rows<T>;
  order(column: string, opts?: { ascending?: boolean }): Rows<T>;
  limit(n: number): Rows<T>;
  maybeSingle(): Result<T | null>;
}

function table<T>(name: 'assistant_conversations' | 'assistant_messages' | 'assistant_jobs'): Rows<T> {
  return (supabase.from as unknown as (t: string) => Rows<T>)(name);
}

async function rows<T>(q: Result<T>): Promise<T> {
  const { data, error } = await q;
  if (error) throw toAppRpcError(error);
  return data;
}

export type AssistantRpcName =
  | 'assistant_usage'
  | 'assistant_set_scopes'
  | 'assistant_archive_conversation'
  | 'assistant_models'
  | 'assistant_set_model'
  | 'assistant_set_default_model'
  | 'assistant_set_monthly_cap';

/** `appRpc` for the assistant RPCs until `types.gen.ts` carries them. */
export async function assistantRpc<T>(fn: AssistantRpcName, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (
    supabase.schema('app').rpc as unknown as (fn: string, args: Record<string, unknown>) => Result<unknown>
  )(fn, args);
  if (error) throw toAppRpcError(error);
  return data as T;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchConversations(): Promise<ConversationRow[]> {
  const data = await rows(
    table<ConversationRow>('assistant_conversations')
      .select('id, owner_id, title, scopes, range, model, tokens, created_at, updated_at, archived_at')
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(200),
  );
  return data ?? [];
}

/** The owner's archived chats, newest first (the chat list's "Archived", 2026-10-20). Read-only: nothing restores one yet. */
export async function fetchArchivedConversations(): Promise<ConversationRow[]> {
  const data = await rows(
    table<ConversationRow>('assistant_conversations')
      .select('id, owner_id, title, scopes, range, model, tokens, created_at, updated_at, archived_at')
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(200),
  );
  return data ?? [];
}

export async function fetchConversation(id: string): Promise<ConversationRow | null> {
  return rows(
    table<ConversationRow>('assistant_conversations')
      .select('id, owner_id, title, scopes, range, model, tokens, created_at, updated_at, archived_at')
      .eq('id', id)
      .maybeSingle(),
  );
}

export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const data = await rows(
    table<MessageRow>('assistant_messages')
      // `feedback` (0422): the owner's thumb on an answer, null when not rated.
      .select('id, conversation_id, seq, role, content, sources, gate, tokens, created_at, feedback:assistant_feedback(rating,note)')
      .eq('conversation_id', conversationId)
      .order('seq', { ascending: true }),
  );
  return data ?? [];
}

export async function fetchJob(id: string): Promise<JobRow | null> {
  return rows(table<JobRow>('assistant_jobs').select('*').eq('id', id).maybeSingle());
}

export async function fetchConversationJobs(conversationId: string): Promise<JobRow[]> {
  const data = await rows(
    table<JobRow>('assistant_jobs').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(20),
  );
  return data ?? [];
}

export function fetchUsage(from: string, to: string): Promise<UsageReport> {
  return assistantRpc<UsageReport>('assistant_usage', { p_from: from, p_to: to });
}

export function setScopes(conversationId: string, scopes: readonly AssistantScope[], range: DateRange | null): Promise<ConversationRow> {
  return assistantRpc<ConversationRow>('assistant_set_scopes', { p_id: conversationId, p_scopes: [...scopes], p_range: range });
}

export function archiveConversation(conversationId: string): Promise<void> {
  return assistantRpc<void>('assistant_archive_conversation', { p_id: conversationId });
}

/** `assistant_models()` (0114): the venue default and every model with rates, sorted. */
export async function fetchModels(): Promise<ModelsPayload> {
  return asModelsPayload(await assistantRpc<unknown>('assistant_models'));
}

/** This chat's model; `null` follows the venue default. Refused with ASSISTANT_MODEL_NOT_PRICED when unpriced. */
export function setModel(conversationId: string, model: string | null): Promise<ConversationRow> {
  return assistantRpc<ConversationRow>('assistant_set_model', { p_id: conversationId, p_model: model });
}

/** The model a new chat uses when it names none. Refused with ASSISTANT_MODEL_NOT_PRICED when unpriced. */
export function setDefaultModel(model: string): Promise<void> {
  return assistantRpc<void>('assistant_set_default_model', { p_model: model });
}

/** The monthly spend cap in USD micros (0149). Refused with INVALID_ARGUMENT outside (0, USD 10,000]. */
export function setMonthlyCap(capMicros: number): Promise<{ monthly_cap_micros: number; previous_cap_micros: number }> {
  return assistantRpc('assistant_set_monthly_cap', { p_cap_micros: capMicros });
}

/** What `assistant_rate_message` answers: the stored thumb (0 = cleared) and the note it kept. */
export interface RateResult {
  messageId: string;
  rating: -1 | 0 | 1;
  note: string | null;
}

/**
 * The owner's thumb on a stored answer (0422). `rating` 0 clears it; a note is
 * kept only with -1. Refused as FORBIDDEN, ASSISTANT_MESSAGE_NOT_FOUND,
 * ASSISTANT_NOT_RATEABLE or INVALID_ARGUMENT. Typed: the generated types carry it.
 */
export async function rateMessage(messageId: string, rating: -1 | 0 | 1, note: string | null = null): Promise<RateResult> {
  const raw = await appRpc<Partial<RateResult> | null>('assistant_rate_message', {
    p_message_id: messageId,
    p_rating: rating,
    ...(note !== null ? { p_note: note } : {}),
  });
  const r = raw?.rating;
  return {
    messageId: typeof raw?.messageId === 'string' ? raw.messageId : messageId,
    rating: r === 1 || r === -1 ? r : 0,
    note: typeof raw?.note === 'string' && raw.note !== '' ? raw.note : null,
  };
}

export function acceptJob(jobId: string, mode: JobMode): Promise<unknown> {
  return callEdge('assistant-job', { action: 'accept', job_id: jobId, mode }, { ttlMs: 0 });
}

export function cancelJob(jobId: string): Promise<unknown> {
  return callEdge('assistant-job', { action: 'cancel', job_id: jobId }, { ttlMs: 0 });
}

/**
 * 0423: a paused job continues from the parts it already paid for. No mode:
 * the server runs the rest in the background when the vendor has batch (cost
 * first), live otherwise. 409 INVALID_TRANSITION when it is no longer paused
 * (another press won), 409 JOB_DATA_CHANGED when its records moved.
 */
export function resumeJob(jobId: string): Promise<ResumeResponse> {
  return callEdge<{ action: 'resume'; job_id: string }, ResumeResponse>('assistant-job', { action: 'resume', job_id: jobId }, { ttlMs: 0 });
}

// ---------------------------------------------------------------------------
// Re-check (plan §3.5, DECIDE 10): the message's tool calls again, no model
// ---------------------------------------------------------------------------

export interface RecheckTool {
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number;
  error?: string;
}

export interface RecheckChange {
  /** The figure as the answer printed it. */
  value_then: number;
  /** The nearest new live value, when one is close enough to have replaced it. */
  value_now?: number;
}

export interface RecheckResult {
  message_id: string;
  checked_at: string;
  tools: RecheckTool[];
  changed: RecheckChange[];
  unchanged: number;
  /** False for an answer saved before figures were recorded; the tools still ran. */
  baseline: boolean;
}

/**
 * Re-run a saved answer's tool calls against live data and diff the figures
 * it printed. A unary call that answers JSON (no stream), never cached, never
 * billed: the function calls no model.
 */
export function recheckMessage(messageId: string): Promise<RecheckResult> {
  return callEdge<{ recheck: { message_id: string }; venue_scope?: string }, RecheckResult>(
    'assistant-chat',
    { recheck: { message_id: messageId }, ...scopeField() },
    { ttlMs: 0 },
  );
}

export interface ChatRequest {
  conversation_id: string | null;
  text: string;
  lang: 'en' | 'ar';
  scopes?: readonly AssistantScope[];
  range?: DateRange;
  /** 0114: sets the conversation's model on create or update, like `scopes`. */
  model?: string;
}

/** One question. Events arrive through `opts.onEvent`; resolves when the stream ends. */
export function sendMessage(req: ChatRequest, opts: StreamEdgeOptions): Promise<void> {
  return streamEdge('assistant-chat', { ...req, ...scopeField() }, opts);
}

export interface PackSize {
  scope: AssistantScope;
  tokens_est: number;
}

/**
 * What any question in the chat sends before a tool runs: system prompt, tool
 * list and the first turn with the checked scopes' packs. `exact` is false
 * where the vendor has no count endpoint (Groq), so the figure is bytes/4.
 */
export interface StartSize {
  tokens: number;
  exact: boolean;
  model: string;
}

/**
 * The start size of a question for these scopes and model (null = the venue
 * default), without a model call. Null `start` when the model's vendor has no
 * key. The default 30 s edge cache is right here: toggling a box back and
 * forth must not re-run the pack tools.
 */
export async function startSize(
  scopes: readonly AssistantScope[],
  model: string | null,
  range: DateRange | undefined,
  signal?: AbortSignal,
): Promise<{ start: StartSize | null; packs: PackSize[] }> {
  const res = await callEdge<Record<string, unknown>, { start?: StartSize | null; packs?: PackSize[] }>(
    'assistant-chat',
    { conversation_id: null, text: '', scopes: [...scopes], range, dry_run: true, ...(model ? { model } : {}), ...scopeField() },
    { signal },
  );
  return { start: res.start ?? null, packs: res.packs ?? [] };
}

// ---------------------------------------------------------------------------
// Content helpers (the readers are @touch/core/assistant/client's)
// ---------------------------------------------------------------------------

/** The tool rows, scopes and jobs of a stored assistant message, whichever of the two shapes it was saved in. */
export function sourcesOf(m: MessageRow): StoredSources {
  return readSources(m.sources);
}

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
import { toAppRpcError } from '../../lib/appRpc';
import { callEdge, streamEdge, type StreamEdgeOptions } from '../../lib/edge';
import { supabase } from '../../lib/supabase';
import type { PricingMap, TokenKinds } from '../../lib/assistantPricing';

// ---------------------------------------------------------------------------
// Rows (0108) and payloads (assistant-chat SSE, estimate.ts)
// ---------------------------------------------------------------------------

export interface DateRange {
  from: string;
  to: string;
}

export interface ConversationRow {
  id: string;
  owner_id: string;
  title: string | null;
  scopes: string[];
  range: DateRange | null;
  /** 0114: this chat's model, or null to follow the venue default. */
  model: string | null;
  tokens: Partial<TokenKinds> & { cost_micros?: number; calls?: number; model?: string };
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}

export type JobStatus = 'estimated' | 'accepted' | 'running' | 'reducing' | 'done' | 'failed' | 'cancelled' | 'over_estimate';
export type JobMode = 'live' | 'batch';

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];

export interface SourceItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number | null;
  route: string | null;
  error?: string;
  stats?: Record<string, unknown>;
}

export interface GatePayload {
  status: 'ok' | 'unverified';
  unverified: { raw: string; value: number }[];
  checked: number;
  retried?: boolean;
  /** Every number the tools gave that turn — the re-check baseline (stored messages only). */
  numbers?: number[];
}

export interface UsagePayload extends TokenKinds {
  cost_micros: number;
  calls: number;
  model: string;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  seq: number;
  role: 'user' | 'assistant';
  /** Stored content blocks verbatim, or a bare string for a user turn. */
  content: unknown;
  sources: (SourceItem | { job_id: string })[] | { items?: SourceItem[]; scopes?: string[] } | null;
  gate: GatePayload | null;
  tokens: Partial<UsagePayload> | null;
  created_at: string;
}

export interface JobEstimateModes {
  aggregate: { calls: { tool: string; args: Record<string, unknown> }[]; tokens_est: number } | null;
  live: { allowed: boolean; reason?: string };
  batch: { allowed: true };
}

export interface JobEstimate {
  job_id: string;
  rows: number;
  chunks: number;
  per_tool: { tool: string; rows: number; chunk_rows: number; tokens_per_row: number; measured: boolean }[];
  tokens: { input: number; cache_read: number; output: number; total: number };
  tokens_high: { input: number; cache_read: number; output: number; total: number };
  modes: JobEstimateModes;
  assumptions: string[];
  first_chunk_exact: number | null;
}

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
}

export type AssistantErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_CONFIGURED'
  | 'LLM_DAILY_QUOTA'
  | 'LLM_MONTHLY_CAP'
  | 'RATE_LIMITED'
  | 'UPSTREAM'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'ASSISTANT_MODEL_NOT_PRICED'
  | 'UNKNOWN';

export const ASSISTANT_ERROR_CODES: readonly AssistantErrorCode[] = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_CONFIGURED',
  'LLM_DAILY_QUOTA',
  'LLM_MONTHLY_CAP',
  'RATE_LIMITED',
  'UPSTREAM',
  'TIMEOUT',
  'INVALID_REQUEST',
  'ASSISTANT_MODEL_NOT_PRICED',
  'UNKNOWN',
];

export function asAssistantErrorCode(code: unknown): AssistantErrorCode {
  return typeof code === 'string' && (ASSISTANT_ERROR_CODES as readonly string[]).includes(code) ? (code as AssistantErrorCode) : 'UNKNOWN';
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
  cost_micros: number;
}

export interface UsageReport {
  days: UsageDay[];
  month: Omit<UsageDay, 'usage_date'>;
  cap: { daily_limit: number | null; monthly_cap_micros: number | null; month_cost_micros: number };
  pricing: PricingMap;
  fallback_micros_per_mtok: number;
}

// ---------------------------------------------------------------------------
// Query keys (contracts §Lane D)
// ---------------------------------------------------------------------------

export const QK = {
  conversations: ['assistant', 'conversations'] as const,
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
      .select('id, conversation_id, seq, role, content, sources, gate, tokens, created_at')
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
export interface ModelsPayload {
  default_model: string | null;
  models: string[];
}

export async function fetchModels(): Promise<ModelsPayload> {
  const raw = await assistantRpc<Partial<ModelsPayload> | null>('assistant_models');
  return {
    default_model: typeof raw?.default_model === 'string' ? raw.default_model : null,
    models: Array.isArray(raw?.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [],
  };
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

export function acceptJob(jobId: string, mode: JobMode): Promise<unknown> {
  return callEdge('assistant-job', { action: 'accept', job_id: jobId, mode }, { ttlMs: 0 });
}

export function cancelJob(jobId: string): Promise<unknown> {
  return callEdge('assistant-job', { action: 'cancel', job_id: jobId }, { ttlMs: 0 });
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
  return callEdge<{ recheck: { message_id: string } }, RecheckResult>('assistant-chat', { recheck: { message_id: messageId } }, { ttlMs: 0 });
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
  return streamEdge('assistant-chat', req, opts);
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
    { conversation_id: null, text: '', scopes: [...scopes], range, dry_run: true, ...(model ? { model } : {}) },
    { signal },
  );
  return { start: res.start ?? null, packs: res.packs ?? [] };
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

/** The plain text of a stored message: a string, or the `text` blocks joined. */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')
      .map((b) => b.text)
      .join('\n\n')
      .trim();
  }
  if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

/** The tool rows of a stored assistant message, whichever of the two shapes it was saved in. */
export function sourcesOf(m: MessageRow): { items: SourceItem[]; scopes: string[]; jobIds: string[] } {
  const out = { items: [] as SourceItem[], scopes: [] as string[], jobIds: [] as string[] };
  const s = m.sources;
  if (!s) return out;
  if (Array.isArray(s)) {
    for (const item of s) {
      if ('job_id' in item) out.jobIds.push(item.job_id);
      else out.items.push(item);
    }
    return out;
  }
  out.items = s.items ?? [];
  out.scopes = s.scopes ?? [];
  return out;
}

/**
 * assistant-chat — one owner message, streamed (plan §4.1, contracts
 * "assistant-chat/index.ts").
 *
 * Request  POST { conversation_id: uuid|null, text, lang: 'en'|'ar', scopes?, range?: {from,to}, model?, dry_run?: true }
 * Response text/event-stream; events `message_start, delta, tool_start, tool_end,
 *          sources, gate, usage, job_estimate, done, error` (see the contracts table).
 *          Before the stream opens, refusals are plain JSON exactly like
 *          analytics-insights: 400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN ·
 *          404 NOT_FOUND · 429 LLM_DAILY_QUOTA / LLM_MONTHLY_CAP · 503 NOT_CONFIGURED.
 *          `dry_run: true` answers JSON `{ packs, start }`: the pack size per scope and
 *          `start` = { tokens, exact, model } | null, what any question in this chat
 *          sends before a tool runs (system prompt + tool list + first turn with the
 *          packs that fit), counted by the vendor where it can. No model call, no
 *          llm_begin_request, no rows written; null when the model's vendor has no key.
 *
 * Re-check (plan §3.5, DECIDE 10; manual only, never automatic)
 * Request  POST { recheck: { message_id } } (owner session)
 * Response JSON { message_id, checked_at, tools: [{ name, args, row_count, ms, error? }],
 *          changed: [{ value_then, value_now? }], unchanged, baseline }
 *          The stored assistant message's tool calls (its `sources`) are re-run with
 *          the same arguments as the owner — knowledge and meta tools skipped, handles
 *          resolved from the conversation's table, nothing minted or persisted — each
 *          result cleaned, and the figures the answer printed are compared with the
 *          live number set (recheck.ts `diffNumbers`). The baseline is `gate.numbers`,
 *          persisted since this shape landed; a message saved before it answers
 *          `baseline: false`. No model, no llm_begin_request, no assistant_calls row;
 *          30 s time box. 404 for a message that is not an assistant turn of the
 *          caller's; 403 for another owner's.
 *
 * `posthog` (plan §3.1): the one aggregate with `rpc: null`. The chat function
 * POSTs to the analytics-posthog function with the caller's Authorization
 * header (so its own owner check applies), one template per call, then cleans
 * the rows like any RPC result. `configured: false` becomes an is_error result.
 *
 * The two clients (plan §7.1): every business read — tools, packs, search,
 * usage, counts — goes through `asOwner`, a client bound to the caller's JWT,
 * so the owner's own grants and `app.assistant_run_tool`'s read-only wall
 * apply. The service client touches only bookkeeping: llm_begin_request,
 * llm_record_usage, llm_price_micros, the assistant_* tables.
 *
 * The door (plan §11.0): a tool's rows become a tool result only through
 * `clean()` → `toolResultBlock()`; the provider's message type accepts
 * nothing else, so this file cannot smuggle a raw row into a request.
 *
 * Wall clock: 50 s, then the stream ends with `error {code:'TIMEOUT'}` after
 * persisting what exists. The turn's abort signal rides on every tool, pack,
 * search, usage and count RPC and on the posthog fetch, so the wall stops the
 * database work too, not only the model call. Persisted per message: the
 * assistant row (final text blocks, sources, gate, tokens), one
 * assistant_calls row per model call priced by `app.llm_price_micros`, one
 * `llm_record_usage`, and the conversation's handles / tokens / title / frozen
 * context. Intermediate tool_use blocks are NOT replayed on later turns (the
 * sources panel has them; plan §11.4 forgets old tool results anyway), so a
 * stored turn is always API-valid.
 *
 * Cost and speed (F1, 2026-10-08; pure rules in assistant/turnPolicy.ts):
 *  - Before the stream opens: the timezone, the price list and the
 *    conversation are read in parallel. The conversation is read through
 *    `asOwner` (0108/0234: owner-only RLS) AND its owner_id compared, all
 *    before the quota or any write. Writes stay on the service client.
 *  - Router (assistant/route.ts): a lookup (where is X, how do I Y) runs on
 *    LOOKUP_MODEL at effort 'low' with the map searched up front; analysis on
 *    the chat's model at 'medium'. An owner's explicit model (this request's
 *    or the chat's) always wins, and the routed model is never written back
 *    to the chat. The route lands in the answer's `tokens` (route, route_reason).
 *  - Frozen first turn (0325 `assistant_conversations.context`): date,
 *    timezone and scopes, no context packs since 2026-10-09 (the model reads
 *    only what the question needs; every scope is open by default and costs
 *    nothing until one of its tools is called). It is stored and replayed
 *    while scopes, range, day, timezone and branch are unchanged and it is
 *    younger than CONTEXT_MAX_AGE_MS (30 min), so the prompt prefix through
 *    the history stays cacheable. A stored context from before, which carries
 *    packs, is rebuilt pack-less. The dry run measures the pack-less start.
 *  - History: 30–39 earlier messages, the window's start aligned to a seq of
 *    10k+1 (TAIL_STEP), so the history bytes hold for ten messages at a time.
 *  - Pre-retrieval: a lookup's `search` for the owner's words runs beside the
 *    context work and rides as a second text block of the user turn ("data,
 *    not instructions"); it shows as tool call `pre_search` in the sources,
 *    its figures join the gate's set, and the stored user message keeps only
 *    the owner's text. A failed search is skipped.
 *  - Tool results: a list tool sends DEFAULT_RESULT_ROWS (100) rows unless the
 *    model passed `limit` (up to the provider's 500); the cap marker then says
 *    to call again with a limit.
 *  - Pricing: each call is estimated in TypeScript from platform_settings'
 *    price list for the running total; the exact `app.llm_price_micros` prices
 *    are fetched in parallel at persist and stored as before (plus the web
 *    searches × the per-search price, 0324). Past TURN_COST_CAP_MICROS (USD
 *    1.50) a requested tool round is answered with an is_error notice and the
 *    model is told to answer now, like the rounds-exhausted path; the stored
 *    tokens say `cost_capped: true`.
 *  - Gate: one regenerated answer only when a flagged figure is money-sized or
 *    a percentage (gate.ts shouldRetry); smaller unverified figures stay
 *    marked. The previous answer's stored gate.numbers pass the gate (an owner
 *    follows up on them) when signed (review fixes below) but, like cited web
 *    figures, are not added to this answer's re-check baseline.
 *  - Not changed, on purpose: llm_begin_request still debits the quota before
 *    the user message is stored. A failed insert is a rare 500 that costs one
 *    request; the other order would store user messages for refused requests.
 *
 * The round loop (F2, 2026-10-08): `runTurnLoop` in assistant/turn.ts, pure,
 * held by tests/assistant-turn.test.ts with a scripted provider. It owns the
 * tool rounds (parallel dispatch through `dispatchTool`: validation, scope,
 * handles, then `runTool` below), propose_job's `job_proposed` stop, the
 * rounds-exhausted and cost-ceiling notices, pause_turn, the web-search cap
 * line, the false-refusal retry and the money-only gate retry, all with the
 * same messages, events and stop reasons as when it was a closure here. This
 * file injects what touches the world: `provider.stream` (system, tools,
 * effort, webSearch: true, the wall's signal), the tool runners as the owner,
 * the refusal retry's search, the price list estimate and the per-search
 * price (0324). It keeps the context, the history, the pre-search, HTTP and
 * persistence, and reads the loop's `TurnState` at persist, so a turn that
 * throws still stores what it spent.
 *
 * Review fixes (2026-10-08, three lenses over F1/F2; pure rules in turnPolicy.ts
 * and turn.ts, held by tests/assistant-turn-policy.test.ts and
 * tests/assistant-turn.test.ts):
 *  - Branch: the frozen first turn is keyed on the request's venue_scope (the
 *    rail's branch, 0228) beside scopes, range, day and timezone. Its packs are
 *    read through x-venue-scope, so a chat that moves from branch A to B
 *    rebuilds instead of replaying A's takings (whose figures the gate would
 *    have accepted). A context stored before the key rebuilds once.
 *  - Partial builds: a fresh first turn is stored only when every pack RPC came
 *    back, the turn's signal was not aborted (Stop, the wall) and the turn did
 *    not fail (turnPolicy contextStorable); otherwise it serves this turn only.
 *  - Warm cache: caches are per model and a top-level effort change drops the
 *    messages cache, so a lookup within CACHE_WARM_MS (5 min) of the chat's
 *    last answer keeps that answer's model and effort (tokens.model and the
 *    new tokens.effort; keepWarmRoute) unless the owner's own model (the
 *    request's or the chat's) is another one. A
 *    lookup replays the stored packs only on the model that built them
 *    (FrozenContext.model), else it sends the pack-less first turn.
 *  - Pre-search breakpoint: in a pre-searched turn the owner's words carry an
 *    explicit cache_control (provider.ts PREFIX_CACHE_CONTROL), the boundary
 *    the next turn's history still contains (it stores the words alone).
 *  - Ceiling: also checked on pause_turn and before the false-refusal and gate
 *    retries; a tool request after the ceiling notice ends with stop reason
 *    `cost_capped`, the text so far plus TURN_NOTICES.costCeilingAnswer, gated.
 *    The estimate never falls to zero: no rate in the list and no blended rate
 *    means turnPolicy FLOOR_RATES (0312 Opus 5.5), and an unread price list is
 *    logged.
 *  - Previous figures: `assistant_messages` (gate column included) was
 *    INSERT-able by any owner session (0108 grant + is_staff('owner') policy)
 *    until 0329 revoked it, so the previous answer's gate.numbers pass the
 *    gate only with this function's HMAC (`gate.sig`, keyed from
 *    SUPABASE_SERVICE_ROLE_KEY, over chat id + message id + figures), kept as
 *    defence in depth. Rows stored before carry none: their figures are
 *    simply marked.
 *  - Lists: a list whose RPC total is at most SMALL_LIST_ROWS (150) goes whole,
 *    so a 101–150-row answer costs no second "call again with limit" round.
 *  - clean.ts escapes `<data` / `</data` inside a frame's body, so a snippet in
 *    the pre-search block (the owner's own user turn) cannot close the frame.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callerClient, createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { fetchWithTimeout, handle, isUuid, json, KB, logError, mapPgError, readJsonBody } from '../_shared/http.ts';
import { insertAtNextSeq } from '../_shared/assistant/seq.ts';
import { clean, CleanError, cleanedNotice, estimateTokens, sourceForTool } from '../_shared/assistant/clean.ts';
import { estimateJob, JOB_EXTRACT_MODEL, type JobCall, type JobPlan } from '../_shared/assistant/estimate.ts';
import { embed } from '../_shared/assistant/embed.ts';
import { numbersIn } from '../_shared/assistant/gate.ts';
import { routeTurn } from '../_shared/assistant/route.ts';
import {
  capHintFor,
  contextStorable,
  frozenContext,
  gateSignatureInput,
  keepWarmRoute,
  parseRates,
  PRE_SEARCH_CALL_ID,
  preSearchText,
  previousTurnOf,
  resultRowCap,
  reusableContext,
  signedPreviousNumbers,
  TAIL_MESSAGES,
  TAIL_STEP,
  tailStartSeq,
  TURN_COST_CAP_CHEAP_MICROS,
  TURN_COST_CAP_MICROS,
  turnEstimateMicros,
  type FrozenContext,
  type ModelRates,
} from '../_shared/assistant/turnPolicy.ts';
import { errorText, hasCitations, newTurnState, resolveArgs, runTurnLoop, type Dispatched, type SourceItem } from '../_shared/assistant/turn.ts';
import { newHandleTable, toJson, type HandleTable } from '../_shared/assistant/handles.ts';
import { diffNumbers } from '../_shared/assistant/recheck.ts';
import { normalizeQuestion, planReuse, reusableQuestion, reuseNote, type ReusePlan } from '../_shared/assistant/reuse.ts';
import { localRunner } from '../_shared/assistant/localRunner.ts';
import { compactText, describe as mapDescribe, pageLookup } from '../_shared/assistant/map.ts';
import { buildChunkExtractPrompt, buildFirstUserTurn, buildJobSystem, buildSystem, titleFrom, type PackForPrompt } from '../_shared/assistant/prompt.ts';
import {
  providerFromEnv,
  notConfiguredMessage,
  PREFIX_CACHE_CONTROL,
  ProviderError,
  textOf,
  WEB_SEARCH_MAX_USES,
  withoutThinking,
  type ContentBlock,
  type Provider,
  type ProviderCapabilities,
  type ProviderMessage,
  type ProviderUsage,
} from '../_shared/assistant/provider.ts';
import { checkScope, defaultRange, isRange, localDate, normaliseScopes, searchKindsFor, type DateRange } from '../_shared/assistant/scopes.ts';
import { SSE_HEADERS, sseFrame, sseHeartbeat, type AssistantEvent } from '../_shared/assistant/sse.ts';
import {
  ASSISTANT_TOOLS,
  LIST_ROW_CAP,
  rpcArgs,
  toolByName,
  toolsForScopes,
  validateToolInput,
  wireTools,
  type AssistantScope,
  type ToolSpec,
  type WireTool,
} from '../_shared/assistant/tools.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
/** Output ceiling per call (thinking included): answers are short by instruction, so the cheap tier gets a tight one (2026-10-09). */
const MAX_TOKENS_CHAT = 6000;
const MAX_TOKENS_CHAT_CHEAP = 3000;
const WALL_MS = 50_000;
/** The re-check's own time box: tools only, no model, so shorter. */
const RECHECK_WALL_MS = 30_000;
const POSTHOG_FN = 'analytics-posthog';
const DEFAULT_BUSINESS_DAY_START_HOUR = 4;
const HEARTBEAT_MS = 15_000;
const SEARCH_LIMIT = 12;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant';
/**
 * The message is at most 8000 characters (parseBody): 32 KB even if every one
 * were a 4-byte character, plus scopes, range and ids. 64 KB, then 413.
 */
const MAX_BODY = 64 * KB;
/** One posthog tool call through analytics-posthog (which itself retries PostHog). */
const POSTHOG_TIMEOUT_MS = 25_000;

type Lang = 'en' | 'ar';

/**
 * The sentence a failed turn shows and stores, by code. The vendor's or the
 * runtime's own text goes to the log only (it can carry request ids, model
 * internals or a database message); a code without a sentence here gets the
 * UPSTREAM one.
 */
const TURN_ERROR_TEXT: Record<string, string> = {
  UPSTREAM: 'the model call failed',
  RATE_LIMITED: 'the model is rate-limited right now; try again in a minute',
  NOT_CONFIGURED: 'the model is not configured',
  TIMEOUT: `the turn did not finish inside ${WALL_MS / 1000} s`,
};
const turnErrorText = (code: string) => TURN_ERROR_TEXT[code] ?? TURN_ERROR_TEXT.UPSTREAM!;

interface Req {
  conversation_id: string | null;
  text: string;
  lang: Lang;
  scopes: AssistantScope[] | null;
  range: DateRange | null;
  /** 0114: the chat model to set on this conversation (must be priced in platform_settings.llm_pricing, 0207). */
  model: string | null;
  dry_run: boolean;
  /** Multi-venue audit (0228): the branch the operator's rail shows; tools read it. */
  venue_scope: string | null;
}

// SourceItem, CallRow and a6's web-search helpers (webSearchSources,
// citedNumbers, pushSystem, hasCitations) live in assistant/turn.ts with the
// round loop (F2); persist reads hasCitations from there.

/**
 * USD micros per web search when platform_settings cannot be read: Anthropic's
 * $10 per 1,000 searches, the same default migration 0324 gives
 * `llm_web_search_micros`. Only the per-call meter falls back to it; the spend
 * cap is recorded by `app.llm_record_web_search` from the column itself.
 */
const WEB_SEARCH_MICROS_FALLBACK = 10_000;

function parseBody(body: unknown): Req | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const conversation_id = b.conversation_id === null || b.conversation_id === undefined ? null : String(b.conversation_id);
  if (conversation_id && !isUuid(conversation_id)) return 'conversation_id must be a uuid';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const dry_run = b.dry_run === true;
  if (!dry_run && !text) return 'text is required';
  if (text.length > 8000) return 'text is too long';
  const lang: Lang = b.lang === 'ar' ? 'ar' : 'en';
  const scopes = b.scopes === undefined || b.scopes === null ? null : normaliseScopes(b.scopes);
  const range = b.range === undefined || b.range === null ? null : isRange(b.range) ? b.range : 'range must be {from, to} as YYYY-MM-DD';
  if (typeof range === 'string') return range;
  const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : null;
  // Groq ids carry a vendor prefix (`openai/gpt-oss-120b`).
  if (model && !/^[a-z0-9./-]{3,64}$/.test(model)) return 'model must be a model id';
  const venue_scope = venueScopeOf(b);
  if (venue_scope === false) return 'venue_scope must be a uuid';
  return { conversation_id, text, lang, scopes, range, model, dry_run, venue_scope };
}

/** A body's `venue_scope`: a uuid, null when absent, false when malformed. */
function venueScopeOf(b: Record<string, unknown>): string | null | false {
  if (b.venue_scope === undefined || b.venue_scope === null) return null;
  return isUuid(b.venue_scope) ? b.venue_scope : false;
}

/**
 * The JWT-bound client: tools run as the owner, never as the service role.
 * Multi-venue audit (0228): the branch the operator's rail shows rides along as
 * x-venue-scope, so the owner's tools read that branch (RLS and the report
 * scope follow it, 0226) instead of every branch at once. Server to server, so
 * no browser CORS rule is involved.
 */
function ownerClient(req: Request, venueScope: string | null = null): SupabaseClient {
  return callerClient(req, venueScope ? { 'x-venue-scope': venueScope } : {});
}

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
function insertMessage(service: SupabaseClient, conversationId: string, row: Record<string, unknown>) {
  return insertAtNextSeq({
    maxSeq: () => maxSeq(service, conversationId),
    insert: async (seq) => (await service.from('assistant_messages').insert({ ...row, conversation_id: conversationId, seq })).error,
  });
}

interface VenueModels {
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
async function venueModels(service: SupabaseClient): Promise<VenueModels> {
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

/**
 * Bind a query to the turn's abort signal (F1): the 50 s wall then cancels the
 * database work, not only the model call. A builder without a signal is
 * returned unchanged (the dry run).
 */
function aborting<Q extends { abortSignal(signal: AbortSignal): Q }>(query: Q, signal: AbortSignal | undefined): Q {
  return signal ? query.abortSignal(signal) : query;
}

type ConvRow = {
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
async function readConversation(asOwner: SupabaseClient, id: string) {
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
async function latestAnswer(asOwner: SupabaseClient, conversationId: string): Promise<{ tokens: unknown; created_at: unknown } | null> {
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
      console.error('[assistant-chat] latest answer unread; routing without it', error.message);
      return null;
    }
    return (data as { tokens: unknown; created_at: unknown } | null) ?? null;
  } catch (e) {
    console.error('[assistant-chat] latest answer unread; routing without it', errorText(e));
    return null;
  }
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
function gateSigner(): ((input: string) => Promise<string>) | null {
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

async function venueTimezone(asOwner: SupabaseClient): Promise<string> {
  const { data } = await asOwner.from('platform_settings').select('timezone').eq('id', true).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === 'string' && tz ? tz : DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Tool dispatch (as the owner)
// ---------------------------------------------------------------------------
interface DispatchCtx {
  asOwner: SupabaseClient;
  scopes: readonly AssistantScope[];
  handles: HandleTable;
  tz: string;
  lang: Lang;
  /** The caller's `Authorization` header, forwarded to sibling functions (analytics-posthog). */
  authorization: string;
  /** The most rows one tool result may carry (the provider's capabilities.resultRows); undefined = clean.ts default. A list tool sends fewer unless asked (turnPolicy resultRowCap). */
  resultRows?: number;
  /** The branch in scope (0228), or null for the default branch's settings. */
  venueScope?: string | null;
  /** The turn's abort signal (the 50 s wall, or the re-check's time box), passed into every RPC and fetch (F1). */
  signal?: AbortSignal;
}

// Dispatched, errorText and resolveArgs live in assistant/turn.ts (F2): the
// loop's dispatchTool uses them, and so do runProposeJob and the re-check.

async function runRpcTool(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const p_args = rpcArgs(spec, input);
  const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_run_tool', { p_tool: spec.rpc, p_args }), ctx.signal);
  if (error) {
    const mapped = mapPgError(error);
    return { cleaned: cleanedNotice(`${mapped.code}: ${mapped.message}`), isError: true, row_count: null };
  }
  const wrapped = (data ?? {}) as { data?: unknown; row_count?: number | null; truncated?: boolean };
  const payload = wrapped.data;
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const total = typeof obj?.total === 'number' ? obj.total : null;

  // §6.1: a list over the cap with no explicit limit is refused — propose a job instead.
  if (spec.kind === 'list' && total !== null && total > LIST_ROW_CAP && (input.limit === undefined || input.limit === null)) {
    return {
      cleaned: cleanedNotice(`more than ${LIST_ROW_CAP} rows (${total}); call propose_job or narrow the filter`),
      isError: true,
      row_count: total,
    };
  }
  const columns = Array.isArray(obj?.columns) ? (obj.columns as string[]) : null;
  const requested = Array.isArray(input.columns) ? (input.columns as string[]) : null;
  // F1: a list result carries DEFAULT_RESULT_ROWS rows unless the model asked
  // for more with `limit` (up to the provider's cap); the marker then says so.
  // A list of at most SMALL_LIST_ROWS goes whole (review 2026-10-08).
  const max = ctx.resultRows ?? LIST_ROW_CAP;
  const cap = resultRowCap(spec, input, max, total);
  const cleaned = clean(sourceForTool(spec, columns), payload, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles, requested, total, cap, capHint: capHintFor(cap, max) });
  const row_count = typeof wrapped.row_count === 'number' ? wrapped.row_count : cleaned.stats.rows_out;
  return { cleaned, isError: false, row_count };
}

/**
 * `cafe_settings.analytics_business_day_start_hour` as the owner (0029 grants select to staff), else the
 * 0029 default. Per branch since 0209: the branch in scope (0228), else the default (oldest active) one.
 */
async function businessDayStartHour(asOwner: SupabaseClient, venueScope: string | null = null, signal?: AbortSignal): Promise<number> {
  try {
    const { data: venue } = venueScope
      ? { data: { id: venueScope } }
      : await aborting(
          asOwner
            .from('venues')
            .select('id')
            .eq('is_active', true)
            .order('created_at', { ascending: true })
            .limit(1),
          signal,
        ).maybeSingle();
    const venueId = (venue as { id?: string } | null)?.id;
    if (!venueId) return DEFAULT_BUSINESS_DAY_START_HOUR;
    const { data } = await aborting(asOwner.from('cafe_settings').select('value').eq('key', 'analytics_business_day_start_hour').eq('venue_id', venueId), signal).maybeSingle();
    const v = Number((data as { value?: unknown } | null)?.value);
    return Number.isInteger(v) && v >= 0 && v <= 12 ? v : DEFAULT_BUSINESS_DAY_START_HOUR;
  } catch {
    return DEFAULT_BUSINESS_DAY_START_HOUR;
  }
}

interface PosthogAnswer {
  configured?: boolean;
  floor?: string | null;
  results?: Record<string, { columns?: unknown; rows?: unknown; error?: unknown }>;
}

/**
 * `posthog`: one analytics template through the analytics-posthog function,
 * called as the caller (its owner check runs again there). Rows arrive as
 * arrays under `columns`; they become objects so clean() lays them out like
 * any other aggregate.
 */
async function runPosthog(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const template = String(input.template ?? '');
  const params: Record<string, unknown> = {};
  if (typeof input.limit === 'number') params.limit = input.limit;
  const body = {
    queries: [{ name: template, from: input.from, to: input.to, params }],
    business_day_start_hour: await businessDayStartHour(ctx.asOwner, ctx.venueScope ?? null, ctx.signal),
  };
  let res: Response;
  let answer: PosthogAnswer;
  try {
    res = await fetchWithTimeout(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/${POSTHOG_FN}`,
      {
        method: 'POST',
        headers: { Authorization: ctx.authorization, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // The turn's wall stops this call too (F1); fetchWithTimeout adds its own deadline beside it.
        signal: ctx.signal,
      },
      POSTHOG_TIMEOUT_MS,
    );
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return { cleaned: cleanedNotice(`${POSTHOG_FN} answered ${res.status}: ${text}`), isError: true, row_count: null };
    }
    answer = (await res.json()) as PosthogAnswer;
  } catch (e) {
    logError('assistant-chat', e, `${POSTHOG_FN} call failed`);
    return { cleaned: cleanedNotice(`${POSTHOG_FN} could not be reached`), isError: true, row_count: null };
  }
  if (answer.configured === false) return { cleaned: cleanedNotice('PostHog is not configured for this venue'), isError: true, row_count: null };
  const result = answer.results?.[template];
  if (!result) return { cleaned: cleanedNotice(`${POSTHOG_FN} returned nothing for ${template}`), isError: true, row_count: null };
  if (typeof result.error === 'string' && result.error) return { cleaned: cleanedNotice(`${template}: ${result.error}`), isError: true, row_count: null };
  const columns = Array.isArray(result.columns) ? (result.columns as unknown[]).map(String) : [];
  const rows = (Array.isArray(result.rows) ? (result.rows as unknown[]) : []).map((row) => {
    const cells = Array.isArray(row) ? (row as unknown[]) : [];
    const obj: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      obj[c] = cells[i] ?? null;
    });
    return obj;
  });
  const payload: Record<string, unknown> = { template, rows, cache: 'live minus a 30 s proxy cache' };
  if (answer.floor) payload.engagement_floor = answer.floor;
  const cleaned = clean(sourceForTool(spec), payload, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
  return { cleaned, isError: false, row_count: rows.length };
}

async function runSearch(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const kinds = searchKindsFor(ctx.scopes, Array.isArray(input.kinds) ? (input.kinds as string[]) : null);
  if (!kinds.length) return { cleaned: cleanedNotice('Nothing is searchable in this chat: the requested kinds belong to scopes that are off'), isError: true, row_count: 0 };
  const query = String(input.query ?? '');
  let embedding: number[] | null = null;
  let degraded = false;
  try {
    embedding = (await embed([query], ctx.lang, (n) => Deno.env.get(n), fetch as never, { inputType: 'query', local: localRunner() }))[0] ?? null;
  } catch (e) {
    degraded = true;
    console.error('[assistant-chat] embedding failed, full-text only', errorText(e));
  }
  const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_search', { p_query: query, p_embedding: embedding, p_kinds: kinds, p_limit: SEARCH_LIMIT }), ctx.signal);
  if (error) {
    const mapped = mapPgError(error);
    return { cleaned: cleanedNotice(`${mapped.code}: ${mapped.message}`), isError: true, row_count: null };
  }
  const rows = Array.isArray(data) ? data : [];
  const cleaned = clean(sourceForTool(spec), rows, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
  if (degraded || embedding === null) {
    // One plain sentence, not a hidden flag: the UI prints it as a note.
    return { cleaned: cleanedNotice(`${cleaned.text}\nSearch ran on text only (no embedding provider).`), isError: false, row_count: rows.length };
  }
  return { cleaned, isError: false, row_count: rows.length };
}

async function runKnowledgeOrMeta(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  switch (spec.name) {
    case 'search':
      return runSearch(ctx, spec, input);
    case 'describe': {
      const entry = mapDescribe(String(input.kind ?? ''), String(input.ref ?? ''));
      if (!entry) return { cleaned: cleanedNotice(`No map entry for ${String(input.kind)} ${String(input.ref)}; try search`), isError: true, row_count: 0 };
      const cleaned = clean(sourceForTool(spec), entry, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
      return { cleaned, isError: false, row_count: entry.entries.length };
    }
    case 'page_lookup': {
      const page = pageLookup(String(input.route ?? ''));
      if (!page) return { cleaned: cleanedNotice(`No page at ${String(input.route)}`), isError: true, row_count: 0 };
      const cleaned = clean(sourceForTool(spec), page, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
      return { cleaned, isError: false, row_count: page.page.length };
    }
    case 'usage': {
      const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_usage', { p_from: input.from, p_to: input.to }), ctx.signal);
      if (error) {
        const mapped = mapPgError(error);
        return { cleaned: cleanedNotice(`${mapped.code}: ${mapped.message}`), isError: true, row_count: null };
      }
      const cleaned = clean(sourceForTool(spec), data, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
      return { cleaned, isError: false, row_count: cleaned.stats.rows_out };
    }
    default:
      return { cleaned: cleanedNotice(`Tool ${spec.name} is not served here`), isError: true, row_count: null };
  }
}

/** propose_job: count as the owner, estimate, measure the first chunk exactly when a key is present. Nothing runs. */
async function runProposeJob(ctx: DispatchCtx, provider: Provider, input: Record<string, unknown>, lang: Lang): Promise<Dispatched> {
  const steps = (input.steps ?? {}) as { calls?: unknown; extract?: unknown; reduce?: unknown };
  const calls: JobCall[] = [];
  if (Array.isArray(steps.calls)) {
    for (const c of steps.calls) {
      const call = c as { tool?: unknown; args?: unknown };
      if (typeof call.tool !== 'string') continue;
      const spec = toolByName(call.tool);
      if (!spec || spec.kind !== 'list' || !spec.rpc) return { cleaned: cleanedNotice(`${String(call.tool)} is not a list tool a job can page`), isError: true, row_count: null };
      const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? { ...(call.args as Record<string, unknown>) } : {};
      delete args.limit;
      delete args.offset;
      const problems = validateToolInput(spec, args);
      if (problems.length) return { cleaned: cleanedNotice(`${spec.name}: ${problems.join('; ')}`), isError: true, row_count: null };
      const resolved = resolveArgs(spec, args, ctx.handles);
      if (typeof resolved === 'string') return { cleaned: cleanedNotice(resolved), isError: true, row_count: null };
      calls.push({ tool: spec.name, args: resolved });
    }
  }
  if (!calls.length) return { cleaned: cleanedNotice('steps.calls must name at least one list tool'), isError: true, row_count: null };

  const alt = input.aggregate_alternative as { calls?: unknown } | null | undefined;
  const altCalls: JobCall[] = Array.isArray(alt?.calls)
    ? (alt.calls as { tool?: unknown; args?: unknown }[])
        .filter((c) => typeof c.tool === 'string' && toolByName(c.tool))
        .map((c) => ({ tool: c.tool as string, args: (c.args as Record<string, unknown>) ?? {} }))
    : [];
  const plan: JobPlan & { lang: Lang } = {
    question: String(input.question ?? ''),
    calls,
    extract: typeof steps.extract === 'string' ? steps.extract : undefined,
    reduce: typeof steps.reduce === 'string' ? steps.reduce : undefined,
    aggregate_alternative: altCalls.length ? { calls: altCalls } : null,
    lang,
  };

  // Exact row counts, as the owner
  const counts: Record<string, number> = {};
  for (const call of calls) {
    const spec = toolByName(call.tool)!;
    const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_count', { p_tool: spec.rpc, p_args: rpcArgs(spec, call.args) }), ctx.signal);
    if (error) {
      const mapped = mapPgError(error);
      return { cleaned: cleanedNotice(`${call.tool}: ${mapped.code}: ${mapped.message}`), isError: true, row_count: null };
    }
    counts[call.tool] = (counts[call.tool] ?? 0) + Number(data ?? 0);
  }
  const body = estimateJob(plan, counts, ASSISTANT_TOOLS);
  // Batch is a vendor capability (provider.ts): on Groq the card offers aggregate and live only.
  if (!provider.capabilities.batch) body.modes.batch = { allowed: false, reason: `batch jobs are not available on ${provider.model}; run the job live` };

  // The first chunk, measured for real (plan §6.2): rows read as the owner, cleaned, counted.
  let first_chunk_exact: number | null = null;
  const first = calls[0]!;
  const firstSpec = toolByName(first.tool)!;
  const chunkRows = body.per_tool[0]?.chunk_rows ?? 250;
  if (body.chunks > 0) {
    try {
      const { data, error } = await aborting(
        ctx.asOwner.schema('app').rpc('assistant_run_tool', { p_tool: firstSpec.rpc, p_args: rpcArgs(firstSpec, { ...first.args, limit: Math.min(chunkRows, LIST_ROW_CAP), offset: 0 }) }),
        ctx.signal,
      );
      if (!error) {
        const payload = (data as { data?: unknown })?.data;
        const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
        const cleaned = clean(sourceForTool(firstSpec, Array.isArray(obj?.columns) ? (obj.columns as string[]) : null), payload, {
          tz: ctx.tz,
          lang: ctx.lang,
          handles: newHandleTable(toJson(ctx.handles)), // a scratch copy: the estimate must not mint handles
        });
        // The chunks are read by JOB_EXTRACT_MODEL (estimate.ts), not the chat's
        // model: count on that model's tokenizer, the chat's provider only when
        // it cannot be built.
        const counter = providerFromEnv((n) => Deno.env.get(n), JOB_EXTRACT_MODEL) ?? provider;
        const counted = await counter.countTokens(buildJobSystem(), [], [{ role: 'user', content: buildChunkExtractPrompt(plan, 1, body.chunks, cleaned) }]);
        first_chunk_exact = counter.capabilities.exactTokens ? counted : null; // an estimate is not "exact"; the card keeps its multiplication
      }
    } catch (e) {
      console.error('[assistant-chat] first chunk not measured', errorText(e));
    }
  }

  const summary = `Job proposed: ${body.rows} rows in ${body.chunks} chunks; the owner sees the estimate and decides. Do not call tools for this question again.`;
  return {
    cleaned: cleanedNotice(summary),
    isError: false,
    row_count: body.rows,
    estimate: { ...body, first_chunk_exact, plan },
  };
}

// ---------------------------------------------------------------------------
// Context packs
// ---------------------------------------------------------------------------
/** Keep packs while their estimated tokens fit the budget, smallest first (order of the kept packs is preserved). */
function fitPacks(packs: PackForPrompt[], budget: number): PackForPrompt[] {
  if (!Number.isFinite(budget)) return packs;
  const bySize = [...packs].sort((a, b) => a.cleaned.stats.tokens_est - b.cleaned.stats.tokens_est);
  const keep = new Set<PackForPrompt>();
  let used = 0;
  for (const p of bySize) {
    if (used + p.cleaned.stats.tokens_est > budget) continue;
    used += p.cleaned.stats.tokens_est;
    keep.add(p);
  }
  return packs.filter((p) => keep.has(p));
}

/**
 * The system prompt and tool list every turn opens with. Claude: the compact
 * map in the cached prefix and every tool deferred behind tool search. Groq:
 * no map in the prompt (the free tier's per-request token budget) and only the
 * tools this chat's scopes allow, none deferred. The dry run measures this same
 * pair, so the number beside the checkboxes is the prompt that is sent.
 */
function turnPrefix(caps: ProviderCapabilities, scopes: readonly AssistantScope[], lang: Lang): { system: string; tools: WireTool[] } {
  const system = buildSystem({ compactMap: caps.compactMap ? compactText() : '', lang });
  const tools = caps.deferTools
    ? wireTools() // the whole catalog in catalog order: one cache prefix for every chat
    : wireTools(toolsForScopes(scopes)).map((t) => {
        const { defer_loading: _drop, ...rest } = t;
        return rest as WireTool;
      });
  return { system, tools };
}

/**
 * What any question costs before the model reads a tool result: the prefix
 * plus the first user turn carrying the packs that fit. Earlier messages, the
 * question's own words, tool rounds and the answer come on top. Claude's
 * count_tokens is exact and free; Groq has none, so bytes/4 (`exact: false`).
 */
async function startSize(
  provider: Provider,
  scopes: readonly AssistantScope[],
  packs: PackForPrompt[],
  lang: Lang,
  today: string,
  tz: string,
): Promise<{ tokens: number; exact: boolean; model: string }> {
  const { system, tools } = turnPrefix(provider.capabilities, scopes, lang);
  const first = buildFirstUserTurn({ today, tz, scopes, packs: fitPacks(packs, provider.capabilities.packBudget) });
  try {
    const tokens = await provider.countTokens(system, tools, [{ role: 'user', content: first }], { webSearch: true });
    return { tokens, exact: provider.capabilities.exactTokens, model: provider.model };
  } catch (e) {
    console.error('[assistant-chat] count_tokens failed; estimating', errorText(e));
    return { tokens: estimateTokens(system) + estimateTokens(JSON.stringify(tools)) + estimateTokens(first), exact: false, model: provider.model };
  }
}

function packSizes(packs: readonly PackForPrompt[]): { scope: AssistantScope; tokens_est: number }[] {
  const by = new Map<AssistantScope, number>();
  for (const p of packs) by.set(p.scope, (by.get(p.scope) ?? 0) + p.cleaned.stats.tokens_est);
  return [...by.entries()].map(([scope, tokens_est]) => ({ scope, tokens_est }));
}

// ---------------------------------------------------------------------------
// Stored messages → provider messages (text only; see the header)
// ---------------------------------------------------------------------------
function tailToMessages(rows: { role: string; content: unknown }[]): ProviderMessage[] {
  const out: ProviderMessage[] = [];
  for (const r of rows) {
    const blocks = Array.isArray(r.content) ? (r.content as { type?: string; text?: string }[]) : [];
    const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n').trim();
    if (!text) continue;
    if (r.role === 'user') out.push({ role: 'user', content: text });
    else if (r.role === 'assistant') out.push({ role: 'assistant', content: text });
  }
  // The API wants the first entry to be a user turn and the tail to alternate sensibly; drop a leading assistant.
  while (out.length && out[0]!.role === 'assistant') out.shift();
  return out;
}

// ---------------------------------------------------------------------------
// Re-check (plan §3.5, DECIDE 10): the stored tool calls again, no model
// ---------------------------------------------------------------------------
interface RecheckTool {
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number;
  error?: string;
}

/** The tool rows of a stored `sources` column, whichever of the two shapes it was saved in. */
function storedSourceItems(sources: unknown): SourceItem[] {
  const list = Array.isArray(sources) ? sources : sources && typeof sources === 'object' && Array.isArray((sources as { items?: unknown }).items) ? (sources as { items: unknown[] }).items : [];
  return list.filter((x): x is SourceItem => !!x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string' && !('job_id' in (x as object)));
}

function storedText(content: unknown): string {
  const blocks = Array.isArray(content) ? (content as { type?: string; text?: string }[]) : [];
  return blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n');
}

/** The re-check's own time box ran out: its message is ours, safe to show. */
class RecheckDeadline extends Error {}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new RecheckDeadline(`not finished inside the ${RECHECK_WALL_MS / 1000} s time box`)), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * The stored tool calls again as the owner, no model (the re-check and the
 * answer reuse share it): each call is validated, scope-checked, handle-
 * resolved and run through the same dispatch as a live turn, inside `wallMs`
 * counted from `started`. `live` is every figure the runs returned.
 */
async function rerunStored(ctx: DispatchCtx, items: readonly { name: string; args: Record<string, unknown> }[], started: number, wallMs: number): Promise<{ tools: RecheckTool[]; live: number[] }> {
  const tools: RecheckTool[] = [];
  const live: number[] = [];
  for (const item of items) {
    const spec = toolByName(item.name);
    if (!spec) continue;
    const args = item.args;
    const out: RecheckTool = { name: spec.name, args, row_count: null, ms: 0 };
    const remaining = wallMs - (Date.now() - started);
    if (remaining <= 0) {
      out.error = `not re-run: the ${wallMs / 1000} s time box is used up`;
      tools.push(out);
      continue;
    }
    const t0 = Date.now();
    try {
      const problems = validateToolInput(spec, args);
      const scope = checkScope(spec.name, ctx.scopes);
      let r: Dispatched;
      if (problems.length) r = { cleaned: cleanedNotice(problems.join('; ')), isError: true, row_count: null };
      else if (!scope.ok) r = { cleaned: cleanedNotice(scope.message), isError: true, row_count: null };
      else {
        const resolved = resolveArgs(spec, args, ctx.handles);
        if (typeof resolved === 'string') r = { cleaned: cleanedNotice(resolved), isError: true, row_count: null };
        else r = await withDeadline(spec.name === 'posthog' ? runPosthog(ctx, spec, resolved) : runRpcTool(ctx, spec, resolved), remaining);
      }
      out.row_count = r.row_count;
      if (r.isError) out.error = r.cleaned.text.slice(0, 300);
      else live.push(...r.cleaned.numbers);
    } catch (e) {
      // Ours (a clean refusal, the time box) is shown; anything else is logged.
      if (e instanceof CleanError || e instanceof RecheckDeadline) out.error = errorText(e).slice(0, 300);
      else {
        logError('assistant-chat', e, `recheck ${spec.name} failed`);
        out.error = 'the tool failed';
      }
    }
    out.ms = Date.now() - t0;
    tools.push(out);
  }
  return { tools, live };
}

async function handleRecheck(req: Request, ownerId: string, recheck: unknown, venueScope: string | null = null): Promise<Response> {
  const started = Date.now();
  const messageId = recheck && typeof recheck === 'object' ? String((recheck as { message_id?: unknown }).message_id ?? '') : '';
  if (!isUuid(messageId)) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'recheck.message_id must be a uuid' }, 400);

  // Read as the owner (F1, item 7): RLS (0108/0234) admits only an owner, and
  // the owner_id comparison below still separates one owner from another.
  const asOwner = ownerClient(req, venueScope);
  const { data: msg, error } = await asOwner.from('assistant_messages').select('id, conversation_id, role, content, sources, gate').eq('id', messageId).maybeSingle();
  if (error) {
    logError('assistant-chat', error, 'recheck message read failed');
    return json({ error: 'INTERNAL' }, 500);
  }
  const row = msg as { id: string; conversation_id: string; role: string; content: unknown; sources: unknown; gate: { numbers?: unknown } | null } | null;
  if (!row || row.role !== 'assistant') return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'assistant message not found' }, 404);
  // The conversation and the timezone together: both are reads, and nothing
  // runs or is returned before the ownership check below.
  const [{ data: conv, error: convErr }, tz] = await Promise.all([
    asOwner.from('assistant_conversations').select('id, owner_id, scopes, handles').eq('id', row.conversation_id).maybeSingle(),
    venueTimezone(asOwner),
  ]);
  if (convErr) {
    logError('assistant-chat', convErr, 'recheck conversation read failed');
    return json({ error: 'INTERNAL' }, 500);
  }
  const c = conv as { owner_id: string; scopes: unknown; handles: unknown } | null;
  if (!c) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' }, 404);
  if (c.owner_id !== ownerId) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' }, 403);

  const scopes = normaliseScopes(c.scopes);
  // A scratch handle table: the re-check must not mint handles or write the conversation.
  const handles = newHandleTable(c.handles);
  // The time box's signal rides on every RPC, so a re-run past it is cancelled, not only abandoned.
  const ctx: DispatchCtx = { asOwner, scopes, handles, tz, lang: 'en', authorization: req.headers.get('Authorization') ?? '', venueScope, signal: AbortSignal.timeout(RECHECK_WALL_MS) };

  const items = storedSourceItems(row.sources)
    // Knowledge and meta tools carry no business figures; a call that failed then gave none either.
    .filter((item) => {
      const spec = toolByName(item.name);
      return !!spec && spec.kind !== 'knowledge' && spec.kind !== 'meta' && !item.error;
    })
    .map((item) => ({ name: item.name, args: item.args && typeof item.args === 'object' ? item.args : {} }));
  const { tools, live } = await rerunStored(ctx, items, started, RECHECK_WALL_MS);

  const baseline = Array.isArray(row.gate?.numbers);
  const then = baseline ? (row.gate!.numbers as unknown[]).filter((n): n is number => typeof n === 'number') : [];
  const diff = diffNumbers(then, live, numbersIn(storedText(row.content)));
  return json({ message_id: row.id, checked_at: new Date().toISOString(), tools, changed: diff.changed, unchanged: diff.unchanged, baseline });
}

// ---------------------------------------------------------------------------
// Answer reuse (owner call 2026-10-09, cost): the same standalone question
// again today, nothing it rested on moved -> the stored answer, no model.
// The decisions are in _shared/assistant/reuse.ts; this is the reads and the re-run.
// ---------------------------------------------------------------------------
const REUSE_LOOKBACK_MS = 26 * 3_600_000;
const REUSE_WALL_MS = 8_000;

async function findReusableAnswer(
  service: SupabaseClient,
  ownerId: string,
  o: { text: string; scopes: readonly AssistantScope[]; venueScope: string | null; today: string; tz: string; ctx: DispatchCtx; newConversationId: string },
): Promise<{ plan: ReusePlan; writtenAt: Date; messageId: string } | null> {
  const started = Date.now();
  const want = normalizeQuestion(o.text);
  const since = new Date(Date.now() - REUSE_LOOKBACK_MS).toISOString();
  const wantScopes = [...o.scopes].sort().join(',');

  // Chats of the last day with the same scopes and branch in scope.
  const { data: convs, error: convErr } = await service
    .from('assistant_conversations')
    .select('id, scopes, handles, context')
    .eq('owner_id', ownerId)
    .is('archived_at', null)
    .gte('updated_at', since)
    .neq('id', o.newConversationId)
    .order('updated_at', { ascending: false })
    .limit(60);
  if (convErr || !convs?.length) return null;
  const sameChat = (convs as { id: string; scopes: unknown; handles: unknown; context: unknown }[]).filter((c) => {
    const ctxScope = c.context && typeof c.context === 'object' ? (c.context as { venue_scope?: unknown }).venue_scope : undefined;
    return [...normaliseScopes(c.scopes)].sort().join(',') === wantScopes && (typeof ctxScope === 'string' ? ctxScope : null) === o.venueScope;
  });
  if (!sameChat.length) return null;

  // Their FIRST messages (a follow-up only means something beside its history) with the same words.
  const { data: firsts, error: firstErr } = await service
    .from('assistant_messages')
    .select('conversation_id, content, created_at')
    .in('conversation_id', sameChat.map((c) => c.id))
    .eq('seq', 1)
    .eq('role', 'user')
    .order('created_at', { ascending: false })
    .limit(60);
  if (firstErr || !firsts?.length) return null;
  const matches = (firsts as { conversation_id: string; content: unknown }[]).filter((m) => normalizeQuestion(storedText(m.content)) === want).slice(0, 3);

  for (const m of matches) {
    const chat = sameChat.find((c) => c.id === m.conversation_id)!;
    const { data: reply } = await service
      .from('assistant_messages')
      .select('id, role, content, sources, gate, tokens, created_at')
      .eq('conversation_id', m.conversation_id)
      .eq('seq', 2)
      .maybeSingle();
    const row = reply as { id: string; role: string; content: unknown; sources: unknown; gate: unknown; tokens: unknown; created_at: unknown } | null;
    if (!row || row.role !== 'assistant') continue;
    const plan = planReuse(row, {
      today: o.today,
      tz: o.tz,
      classify: (name) => {
        const spec = toolByName(name);
        if (!spec || name === 'propose_job') return null;
        return spec.kind === 'knowledge' ? 'knowledge' : spec.kind === 'meta' ? null : 'data';
      },
    });
    if (!plan) continue;
    // Still true? The stored tools again, against that chat's handles, inside a short time box.
    const rerunCtx: DispatchCtx = { ...o.ctx, handles: newHandleTable(chat.handles), signal: AbortSignal.timeout(REUSE_WALL_MS) };
    const { tools, live } = await rerunStored(rerunCtx, plan.rerun, started, REUSE_WALL_MS);
    if (tools.length !== plan.rerun.length || tools.some((t) => t.error)) continue;
    const diff = diffNumbers(plan.numbers, live, numbersIn(plan.text));
    if (diff.changed.length) continue;
    return { plan, writtenAt: new Date(String(row.created_at)), messageId: row.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
Deno.serve(handle('assistant-chat', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, ['owner']);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400),
  });
  if (!body.ok) return body.response;
  const raw: unknown = body.value;
  // Re-check: tools only, no model, no quota, no writes (header).
  if (raw && typeof raw === 'object' && 'recheck' in raw) {
    const scope = venueScopeOf(raw as Record<string, unknown>);
    return handleRecheck(req, auth.userId, (raw as { recheck: unknown }).recheck, scope === false ? null : scope);
  }

  const parsed = parseBody(raw);
  if (typeof parsed === 'string') return json({ error: 'INVALID_REQUEST', message: parsed }, 400);

  const asOwner = ownerClient(req, parsed.venue_scope);
  const env = (n: string) => Deno.env.get(n);

  // Dry run: what any question costs to start with these boxes (system prompt,
  // tool list, the pack-less first turn). No model, no quota, no writes.
  if (parsed.dry_run) {
    const [tz, models] = await Promise.all([venueTimezone(asOwner), parsed.model ? Promise.resolve(null) : venueModels(service)]);
    const today = localDate(new Date(), tz);
    const scopes = parsed.scopes ?? normaliseScopes(null);
    const range = parsed.range ?? defaultRange(today);
    const packs: PackForPrompt[] = [];
    const provider = providerFromEnv(env, parsed.model ?? models?.default_model ?? null);
    const start = provider ? await startSize(provider, scopes, packs, parsed.lang, today, tz) : null;
    return json({ packs: packSizes(packs), start, scopes, range });
  }

  // F1 item 7: the three reads before the stream opens run together. They are
  // reads only; every refusal below (unpriced model, missing or another
  // owner's conversation, no key) still answers before the quota and before
  // any write. The conversation is read as the owner (RLS, 0108/0234) and its
  // owner_id compared here as well.
  // The chat's latest answer rides along (warm-cache route); it is used only
  // after the ownership check below passes.
  const [tz, venueModel, convRead, lastAnswer] = await Promise.all([
    venueTimezone(asOwner),
    venueModels(service),
    parsed.conversation_id ? readConversation(asOwner, parsed.conversation_id) : Promise.resolve(null),
    parsed.conversation_id ? latestAnswer(asOwner, parsed.conversation_id) : Promise.resolve(null),
  ]);
  const today = localDate(new Date(), tz);

  // 0114: a model named by the request must be one the pricing table can bill.
  if (parsed.model && !venueModel.priced.includes(parsed.model)) {
    return json({ error: 'ASSISTANT_MODEL_NOT_PRICED', code: 'ASSISTANT_MODEL_NOT_PRICED', message: `${parsed.model} is not in platform_settings.llm_pricing` }, 400);
  }
  // The conversation, checked FIRST: the caller must own it before anything
  // is spent or written (W2 #13: the paid quota used to be debited before
  // this check, so another owner's conversation id cost a request).
  type Conv = ConvRow;
  let existing: Conv | null = null;
  if (convRead) {
    const { data, error } = convRead;
    if (error) {
      logError('assistant-chat', error, 'conversation read failed');
      return json({ error: 'INTERNAL' }, 500);
    }
    if (!data) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' }, 404);
    if ((data as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', message: 'not your conversation' }, 403);
    existing = data as Conv;
  }

  // The router (assistant/route.ts) on the scopes this turn will run with.
  // explicitModel is the owner's own pick (this request's, else the chat's):
  // a lookup keeps it, otherwise LOOKUP_MODEL; an analysis has none of its own.
  const turnScopes = normaliseScopes(parsed.scopes ?? existing?.scopes ?? null);
  const explicitModel = parsed.model ?? existing?.model ?? null;
  // Warm cache (review 2026-10-08): a lookup within 5 minutes of the chat's
  // last answer keeps that answer's model and effort, because switching either
  // re-writes the cached prefix instead of reading it (turnPolicy keepWarmRoute);
  // never against the owner's own model (explicitModel).
  const route = keepWarmRoute(routeTurn({ text: parsed.text, scopes: turnScopes, explicitModel }), existing ? previousTurnOf(lastAnswer) : null, {
    nowMs: Date.now(),
    ownerModel: explicitModel,
    allowed: venueModel.priced,
  });
  // 0114: the routed model, else the owner's pick, else the venue default,
  // else ANTHROPIC_MODEL; 0307: only Opus 5.5 or Sonnet 5.5 (provider.ts
  // assistantModel). The owner's pick sits before the chain default so an
  // analysis in a chat set to Sonnet stays on Sonnet. Never written back to the
  // chat: only parsed.model is (below). No ANTHROPIC_API_KEY → 503 before the
  // quota and before any write.
  const chatModel = route.model ?? explicitModel ?? venueModel.default_model;
  const provider = providerFromEnv(env, chatModel);
  if (!provider) {
    return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: notConfiguredMessage(env, chatModel) }, 503);
  }

  // The quota gate (SEC-29): our own ceiling, so 429 not 502. Debited before
  // the user message is stored, on purpose (header, "Not changed").
  const budget = await service.schema('app').rpc('llm_begin_request');
  if (budget.error) {
    const code = budget.error.message ?? 'LLM_BUDGET';
    if (code.includes('LLM_DAILY_QUOTA') || code.includes('LLM_MONTHLY_CAP')) {
      const which = code.includes('LLM_MONTHLY_CAP') ? 'LLM_MONTHLY_CAP' : 'LLM_DAILY_QUOTA';
      return json({ error: which, code: which, message: budget.error.details ?? code, hint: budget.error.hint ?? null }, 429);
    }
    logError('assistant-chat', budget.error, 'budget gate failed');
    return json({ error: 'UPSTREAM', code: 'UPSTREAM' }, 502);
  }

  // Apply the request's settings to the chat, or create it (service; owner_id is the caller).
  let conv: Conv;
  if (existing) {
    conv = existing;
    if (parsed.scopes || parsed.range || parsed.model) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.scopes) patch.scopes = parsed.scopes;
      if (parsed.range) patch.range = parsed.range;
      if (parsed.model) patch.model = parsed.model;
      const upd = await service.from('assistant_conversations').update(patch).eq('id', conv.id);
      // This turn still runs with the new settings; the next one would not see them.
      if (upd.error) logError('assistant-chat', upd.error, `conversation ${conv.id} settings not saved`);
      if (parsed.scopes) conv.scopes = parsed.scopes;
      if (parsed.range) conv.range = parsed.range;
      if (parsed.model) conv.model = parsed.model;
    }
  } else {
    const { data, error } = await service
      .from('assistant_conversations')
      .insert({ owner_id: auth.userId, title: titleFrom(parsed.text), scopes: parsed.scopes ?? normaliseScopes(null), range: parsed.range, model: parsed.model, handles: {}, tokens: {} })
      .select('id, scopes, range, handles, tokens, title, model, context')
      .single();
    if (error || !data) {
      logError('assistant-chat', error ?? 'no row', 'conversation insert failed');
      return json({ error: 'INTERNAL' }, 500);
    }
    conv = data as Conv;
  }
  const scopes = normaliseScopes(conv.scopes);
  const range: DateRange = isRange(conv.range) ? conv.range : defaultRange(today);
  const handles = newHandleTable(conv.handles);

  // The user message, at the next seq: a concurrent send into the same chat
  // takes the number first, this one re-reads and retries (assistant/seq.ts).
  // It stores the owner's text only, never a pre-retrieved search block.
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const userInsert = await insertMessage(service, conv.id, {
    id: userMessageId,
    role: 'user',
    content: [{ type: 'text', text: parsed.text }],
    sources: [],
    tokens: {},
  });
  if (userInsert.error) {
    logError('assistant-chat', userInsert.error, `user message not stored in ${conv.id}`);
    return json({ error: 'INTERNAL' }, 500);
  }
  const userSeq = userInsert.seq;
  // The history is read inside the stream (run), beside the context work: one
  // round trip fewer before the first byte.

  // ── The stream ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const abort = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
  const write = (chunk: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
    }
  };
  const emit = (event: AssistantEvent, data: unknown) => write(sseFrame(event, data));
  const heartbeat = setInterval(() => write(sseHeartbeat()), HEARTBEAT_MS);
  const wall = setTimeout(() => abort.abort(), WALL_MS);

  const ctx: DispatchCtx = {
    asOwner,
    scopes,
    handles,
    tz,
    lang: parsed.lang,
    authorization: req.headers.get('Authorization') ?? '',
    resultRows: provider.capabilities.resultRows,
    venueScope: parsed.venue_scope,
    signal: abort.signal,
  };
  // The loop's state (assistant/turn.ts TurnState): calls, sources, the gate's
  // sets, the spend, the retries and the final answer. The pre-search below
  // writes into it too, and persist reads it even when the loop threw.
  const turn = newTurnState<ContentBlock>();
  const { calls, sources, allowed } = turn;
  /** A first turn built (not replayed) this turn, stored on the conversation at persist when contextStorable; null when replayed or pack-less. */
  let freshContext: FrozenContext | null = null;
  /** Pack RPCs of that build that failed or were aborted: any one keeps it out of the store (review 2026-10-08). */
  /** Signs this answer's gate.numbers and checks the previous answer's (null without the key). */
  const gateSign = gateSigner();
  let searchMicros: number | null = null;
  const userNumbers = numbersIn(parsed.text);
  let errorOut: { code: string; message: string } | null = null;

  /**
   * The database's exact price for one call's tokens, at persist (F1: no
   * longer between rounds). Null when the RPC fails; the call keeps its estimate.
   */
  const priceOf = async (u: ProviderUsage): Promise<number | null> => {
    const { data, error } = await service.schema('app').rpc('llm_price_micros', {
      p_model: provider.model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
    });
    if (error) {
      console.error('[assistant-chat] llm_price_micros', error.message);
      return null;
    }
    const n = Number(data ?? 0);
    return Number.isFinite(n) ? n : null;
  };

  /** The per-search price from platform_settings, read once per turn and only when a search ran. */
  const perSearchMicros = async (): Promise<number> => {
    if (searchMicros !== null) return searchMicros;
    const { data, error } = await service.from('platform_settings').select('llm_web_search_micros').eq('id', true).maybeSingle();
    const v = Number((data as { llm_web_search_micros?: unknown } | null)?.llm_web_search_micros);
    if (error || !Number.isFinite(v)) {
      console.error('[assistant-chat] llm_web_search_micros unread; using the default', error?.message ?? 'no row');
      searchMicros = WEB_SEARCH_MICROS_FALLBACK;
    } else searchMicros = v;
    return searchMicros;
  };

  /**
   * One checked tool as the owner, injected into the loop's dispatchTool
   * (turn.ts), which has already validated it, checked its scope and resolved
   * its handles; a throw here becomes an is_error notice there.
   */
  const runTool = (spec: ToolSpec, resolved: Record<string, unknown>): Promise<Dispatched> => {
    if (spec.name === 'propose_job') return runProposeJob(ctx, provider, resolved, parsed.lang);
    if (spec.kind === 'knowledge' || spec.kind === 'meta') return runKnowledgeOrMeta(ctx, spec, resolved);
    if (spec.name === 'posthog') return runPosthog(ctx, spec, resolved);
    return runRpcTool(ctx, spec, resolved);
  };

  /**
   * The first user turn (F1 item 2): the stored one when it still holds, else
   * a fresh one — date, timezone and the scopes, no context packs (owner call
   * 2026-10-09: the model fetches only what the question needs through its
   * tools; the packs pre-loaded every checked scope whether the question
   * needed it or not). The fresh one is stored on the conversation at persist.
   */
  const prepareContext = (): { text: string; numbers: readonly number[]; packs: PackForPrompt[] } => {
    // Keyed on the branch in scope too (review 2026-10-08): the packs were read
    // through x-venue-scope, so another branch's first turn is never replayed.
    const want = { scopes, range, today, tz, venue_scope: parsed.venue_scope };
    const stored = reusableContext(conv.context, want, Date.now());
    // A context stored before 2026-10-09 carries packs (figures); it is rebuilt
    // pack-less rather than replayed.
    if (stored && stored.numbers.length === 0) return { text: stored.text, numbers: stored.numbers, packs: [] };
    const text = buildFirstUserTurn({ today, tz, scopes, packs: [] });
    freshContext = frozenContext({ ...want, text, numbers: [], model: provider.model, now: new Date() });
    return { text, numbers: [], packs: [] };
  };

  /**
   * The stored history (F1 item 3): every message from a seq aligned to
   * TAIL_STEP up to the one just inserted, so the bytes after messages[0] stay
   * the same for TAIL_STEP messages. `id` and `gate` come along for the
   * previous answer's signed figures (item 10, review 2026-10-08).
   */
  const readTail = async (): Promise<{ id: string; role: string; content: unknown; seq: number; gate: unknown }[]> => {
    const { data, error } = await aborting(
      service
        .from('assistant_messages')
        .select('id, role, content, seq, gate')
        .eq('conversation_id', conv.id)
        .gte('seq', tailStartSeq(userSeq))
        .lt('seq', userSeq)
        .order('seq', { ascending: true })
        .limit(TAIL_MESSAGES + TAIL_STEP),
      abort.signal,
    );
    // As before: a failed read answers without history rather than failing the turn.
    if (error) console.error('[assistant-chat] history not read', error.message);
    return (data ?? []) as { id: string; role: string; content: unknown; seq: number; gate: unknown }[];
  };

  /** A lookup's search for the owner's own words (F1 item 5), before the first model call. Never throws. */
  const preSearch = async (): Promise<{ out: Dispatched; ms: number } | null> => {
    if (!route.preRetrieve) return null;
    const started = Date.now();
    try {
      return { out: await runSearch(ctx, toolByName('search')!, { query: parsed.text }), ms: Date.now() - started };
    } catch (e) {
      console.error('[assistant-chat] pre-retrieval search failed', errorText(e));
      return { out: { cleaned: cleanedNotice('search failed'), isError: true, row_count: null }, ms: Date.now() - started };
    }
  };

  /** The message a reused answer came from (answer reuse); null for a normal turn. */
  let reusedFrom: string | null = null;

  const run = async () => {
    // Answer reuse: the same standalone question as this chat's first message,
    // answered earlier today, with the stored tools returning the same figures
    // now -> that answer again, no model call and no tokens.
    if (userSeq === 1 && reusableQuestion(parsed.text)) {
      let hit: Awaited<ReturnType<typeof findReusableAnswer>> = null;
      try {
        hit = await findReusableAnswer(service, auth.userId, { text: parsed.text, scopes, venueScope: parsed.venue_scope, today, tz, ctx, newConversationId: conv.id });
      } catch (e) {
        console.error('[assistant-chat] answer reuse skipped', errorText(e));
      }
      if (hit) {
        reusedFrom = hit.messageId;
        const text = `${hit.plan.text}${reuseNote(parsed.lang, hit.writtenAt, tz)}`;
        emit('message_start', { conversation_id: conv.id, user_message_id: userMessageId, assistant_message_id: assistantMessageId, scopes, model: provider.model, packs: [], reused: true });
        emit('delta', { text });
        turn.finalText = text;
        turn.finalContent = [{ type: 'text', text } as ContentBlock];
        turn.gate = hit.plan.gate;
        turn.stopReason = 'end_turn';
        allowed.push(...hit.plan.numbers);
        sources.push(...(hit.plan.sources as unknown as SourceItem[]));
        return;
      }
    }
    // The first turn, the history and a lookup's search, together.
    const [context, tailRows, pre] = await Promise.all([prepareContext(), readTail(), preSearch()]);
    const tail = tailToMessages(tailRows);
    /**
     * The previous answer's stored gate.numbers (F1): the gate accepts them,
     * this answer's baseline does not repeat them. Only with this function's
     * signature on them: the column was client-writable (0108, until 0329;
     * header).
     */
    const previousNumbers = await signedPreviousNumbers(tailRows, conv.id, gateSign);
    // A pack (built now or replayed) is a tool result the function ran itself:
    // its figures are as verified as any tool's, so the gate must accept them
    // (first real turn on 2026-09-20 flagged the money pack's revenue and
    // forced a retry), and they stay in the re-check baseline as before.
    allowed.push(...context.numbers);
    emit('message_start', { conversation_id: conv.id, user_message_id: userMessageId, assistant_message_id: assistantMessageId, scopes, model: provider.model, packs: packSizes(context.packs) });

    // The pre-retrieved search shows like a tool call; a failed one is listed with its error and left out of the prompt.
    let found: string | null = null;
    if (pre) {
      const item: SourceItem = { call_id: PRE_SEARCH_CALL_ID, name: 'search', args: { query: parsed.text }, row_count: pre.out.row_count, ms: pre.ms, route: null, stats: pre.out.cleaned.stats };
      emit('tool_start', { call_id: item.call_id, name: item.name, args: item.args });
      if (pre.out.isError) item.error = pre.out.cleaned.text.slice(0, 300);
      else {
        allowed.push(...pre.out.cleaned.numbers);
        found = preSearchText(pre.out.cleaned.text);
      }
      sources.push(item);
      emit('tool_end', { call_id: item.call_id, name: item.name, row_count: item.row_count, ms: item.ms, route: item.route, error: item.error, stats: item.stats });
    }

    const { system, tools } = turnPrefix(provider.capabilities, scopes, parsed.lang);
    // A pre-searched turn marks the end of the owner's own words with a cache
    // breakpoint (review 2026-10-08): the stored user message, and so the next
    // turn's history, holds those words without the search block, so the
    // automatic breakpoint after the search block is never read again; this
    // one is the boundary the next turn's prefix contains.
    const messages: ProviderMessage[] = [
      { role: 'user', content: context.text },
      ...tail,
      found
        ? { role: 'user', content: [{ type: 'text', text: parsed.text, cache_control: PREFIX_CACHE_CONTROL }, { type: 'text', text: found }] }
        : { role: 'user', content: parsed.text },
    ];

    // The rounds (assistant/turn.ts runTurnLoop, F2): everything that touches
    // the vendor, the database or the clock's wall comes in through here.
    await runTurnLoop(turn, { messages, scopes, handles, userNumbers, previousNumbers }, {
      model: provider.model,
      capMicros: route.sticky ? TURN_COST_CAP_CHEAP_MICROS : TURN_COST_CAP_MICROS,
      webSearchMaxUses: WEB_SEARCH_MAX_USES,
      stream: (msgs, onText) =>
        provider.stream({
          system,
          tools,
          messages: msgs,
          maxTokens: route.sticky ? MAX_TOKENS_CHAT_CHEAP : MAX_TOKENS_CHAT,
          effort: route.effort,
          webSearch: true,
          onText,
          onToolStart: () => {},
          signal: abort.signal,
        }),
      runTool,
      // The false-refusal retry hands the model what search returns for the owner's words, every searchable kind.
      refusalSearch: () => runSearch(ctx, toolByName('search')!, { query: parsed.text, kinds: null }),
      // Never zero: an unread or incomplete price list estimates at FLOOR_RATES (review 2026-10-08).
      estimateMicros: (usage) => turnEstimateMicros(provider.model, usage, venueModel.rates, venueModel.fallback_per_mtok),
      perSearchMicros,
      emit,
    });
  };

  const persist = async () => {
    // The loop has ended (or thrown): its state is final from here on.
    const { webSearches, costCapped, finalContent, finalText, gate, gateRetried, jobEstimate } = turn;
    // The exact prices, every call at once (F1 item 9): the token price from
    // app.llm_price_micros plus the call's searches (0324); a call whose price
    // could not be read keeps its estimate.
    const exact = await Promise.all(calls.map((c) => priceOf(c.usage)));
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
      model: provider.model,
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
    // The re-check baseline: every number the tools and packs gave this turn,
    // deduped, beside the gate verdict (cited web figures and the previous
    // answer's figures are accepted by the gate but not repeated here).
    const numbers = [...new Set(allowed)].sort((a, b) => a - b);
    // `sig`: this function's HMAC over the chat, this message and the figures,
    // which the next turn needs before the gate trusts them (gateSigner).
    let sig: string | null = null;
    if (gate && gateSign && numbers.length) {
      try {
        sig = await gateSign(gateSignatureInput(conv.id, assistantMessageId, numbers));
      } catch (e) {
        console.error('[assistant-chat] gate figures not signed', errorText(e));
      }
    }
    const storedGate = gate ? { ...gate, numbers, ...(sig ? { sig } : {}) } : null;

    // At the next seq, not userSeq + 1: a concurrent send into this chat may
    // have taken that number meanwhile (assistant/seq.ts re-reads and retries).
    const msg = await insertMessage(service, conv.id, {
      id: assistantMessageId,
      role: 'assistant',
      content: stored,
      sources,
      gate: storedGate,
      tokens,
    });
    if (msg.error) logError('assistant-chat', msg.error, `assistant message ${assistantMessageId} not stored in ${conv.id}`);
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
      if (ins.error) console.error('[assistant-chat] calls not stored', ins.error.message);
    }
    if (calls.length) {
      // In every path, like analytics-insights: a timed-out turn still spent the money.
      const rec = await service.schema('app').rpc('llm_record_usage', {
        p_model: provider.model,
        p_input: usage.input,
        p_cache_write: usage.cache_write,
        p_cache_read: usage.cache_read,
        p_output: usage.output,
        p_model_calls: calls.length,
        p_surface: SURFACE,
      });
      if (rec.error) console.error('[assistant-chat] usage not recorded', rec.error.message);
    }
    if (webSearches) {
      // Searches are billed apart from tokens; the cap must see them too (0324).
      const rec = await service.schema('app').rpc('llm_record_web_search', { p_searches: webSearches });
      if (rec.error) console.error('[assistant-chat] web searches not recorded', rec.error.message);
    }
    const prev = conv.tokens ?? {};
    const sum = (k: keyof typeof usage | 'cost_micros' | 'calls' | 'web_searches', v: number) => (Number(prev[k] ?? 0) || 0) + v;
    const upd = await service
      .from('assistant_conversations')
      .update({
        handles: toJson(handles),
        tokens: { input: sum('input', usage.input), cache_write: sum('cache_write', usage.cache_write), cache_read: sum('cache_read', usage.cache_read), output: sum('output', usage.output), cost_micros: sum('cost_micros', cost_micros), calls: sum('calls', calls.length), web_searches: sum('web_searches', webSearches) },
        updated_at: new Date().toISOString(),
        ...(conv.title ? {} : { title: titleFrom(parsed.text) }),
        // 0325: the first turn built this turn, replayed by the next ones
        // (header) — only a whole one from a turn that finished (review 2026-10-08).
        ...(freshContext && contextStorable({ packsFailed: 0, aborted: abort.signal.aborted, turnFailed: errorOut !== null }) ? { context: freshContext } : {}),
      })
      .eq('id', conv.id);
    if (upd.error) console.error('[assistant-chat] conversation not updated', upd.error.message);

    if (jobEstimate) {
      const { plan, ...estimate } = jobEstimate;
      const ins = await service
        .from('assistant_jobs')
        .insert({ conversation_id: conv.id, message_id: assistantMessageId, status: 'estimated', plan, estimate, chunks_total: estimate.chunks, chunks_done: 0, tokens: {} })
        .select('id')
        .single();
      if (ins.error || !ins.data) {
        console.error('[assistant-chat] job not stored', ins.error?.message);
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
    emit('usage', { ...usage, cost_micros, calls: calls.length, model: provider.model, web_searches: webSearches });
  };

  (async () => {
    try {
      await run();
    } catch (e) {
      // The owner sees (and the stored turn keeps) a fixed sentence per code;
      // the vendor's or the runtime's own text goes to the log only.
      const code = e instanceof ProviderError ? e.code : abort.signal.aborted ? 'TIMEOUT' : 'UPSTREAM';
      errorOut = { code, message: turnErrorText(code) };
      console.error('[assistant-chat] turn failed', code, errorText(e));
    }
    try {
      await persist();
    } catch (e) {
      console.error('[assistant-chat] persist failed', errorText(e));
    }
    if (errorOut) emit('error', errorOut);
    emit('done', { message_id: assistantMessageId, stop_reason: errorOut ? errorOut.code : turn.stopReason });
    clearInterval(heartbeat);
    clearTimeout(wall);
    closed = true;
    try {
      // Assigned inside the stream's start() callback, so TS still sees the initial null here.
      (controller as ReadableStreamDefaultController<Uint8Array> | null)?.close();
    } catch {
      // already closed by the client
    }
  })();

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
}));

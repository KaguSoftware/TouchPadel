/**
 * assistant-chat — one owner message, streamed (plan §4.1, contracts
 * "assistant-chat/index.ts"). This file is the request: parsing, the owner
 * check and every refusal before the stream, then the stream's orchestration.
 * The work lives in _shared/assistant/: runners.ts (the tools, as the owner),
 * turn.ts (the rounds), persist.ts (the end of a turn), reads.ts, recheck.ts,
 * reuse.ts, sse.ts. Why each rule is so: docs/design/assistant/chat-changelog.md;
 * plan and contracts: docs/design/assistant/owner-assistant-plan-2026-09-20.md,
 * build-contracts-2026-09-20.md.
 *
 * Request  POST { conversation_id: uuid|null, text, lang: 'en'|'ar', scopes?, range?: {from,to}, model?, venue_scope?, dry_run?: true }
 *          POST { recheck: { message_id }, venue_scope? } — the re-check (recheck.ts): tools only, no model, quota or writes
 * Response text/event-stream: message_start, delta, tool_start, tool_end, sources, gate,
 *          usage, job_estimate, done, error. Refusals before the stream are plain JSON:
 *          400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN · 404 NOT_FOUND ·
 *          429 LLM_DAILY_QUOTA / LLM_MONTHLY_CAP · 503 NOT_CONFIGURED. `dry_run` answers
 *          JSON { packs: [], start: { tokens, exact, model } | null, scopes, range }.
 *
 * The door (plan §11.0, tests/assistant-clean-door.test.ts): rows become a tool result
 * only through clean.ts; provider.ts is the only SDK importer. Two clients (§7.1):
 * every business read goes through `asOwner` (the caller's JWT: the dispatcher's owner
 * check and app.assistant_run_tool's read-only wall apply); the service client touches
 * only bookkeeping. Wall clock 50 s: the abort signal rides on every RPC and fetch,
 * then the stream ends with error TIMEOUT after persisting what exists. A client
 * that leaves (Stop, page closed) aborts the turn through the same signal but is
 * NOT a timeout (2026-11-11): the turn is stored with `stop_reason: 'stopped'`,
 * no error_code, and the text that had arrived (persist.ts header).
 *
 * The end of the turn (run, then persist) is handed to the edge runtime's
 * `EdgeRuntime.waitUntil` when it exists (feature-detected through globalThis),
 * so a client that disconnects does not let the runtime drop the promise
 * before the spend is recorded.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callerClient, createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { handle, isUuid, json, KB, logError, readJsonBody } from '../_shared/http.ts';
import { cleanedNotice, estimateTokens } from '../_shared/assistant/clean.ts';
import { numbersIn } from '../_shared/assistant/gate.ts';
import { routeTurn } from '../_shared/assistant/route.ts';
import {
  frozenContext,
  keepWarmRoute,
  PRE_SEARCH_CALL_ID,
  preSearchText,
  previousTurnOf,
  reusableContext,
  signedPreviousNumbers,
  TURN_COST_CAP_CHEAP_MICROS,
  TURN_COST_CAP_MICROS,
  turnEnding,
  turnEstimateMicros,
  webSearchOn,
  type FrozenContext,
} from '../_shared/assistant/turnPolicy.ts';
import { errorText, newTurnState, runTurnLoop, type Dispatched, type SourceItem } from '../_shared/assistant/turn.ts';
import { newHandleTable } from '../_shared/assistant/handles.ts';
import { RECHECK_WALL_MS, recheckMessage } from '../_shared/assistant/recheck.ts';
import { findReusableAnswer, reusableQuestion, reuseNote } from '../_shared/assistant/reuse.ts';
import { compactText } from '../_shared/assistant/map.ts';
import { buildFirstUserTurn, buildSystem, titleFrom, type Lang } from '../_shared/assistant/prompt.ts';
import {
  providerFromEnv,
  notConfiguredMessage,
  PREFIX_CACHE_CONTROL,
  ProviderError,
  WEB_SEARCH_MAX_USES,
  type ContentBlock,
  type Provider,
  type ProviderCapabilities,
  type ProviderMessage,
} from '../_shared/assistant/provider.ts';
import { defaultRange, isRange, localDate, normaliseScopes, type DateRange } from '../_shared/assistant/scopes.ts';
import { SSE_HEADERS, sseStream, type AssistantEvent } from '../_shared/assistant/sse.ts';
import { toolByName, toolsForScopes, wireTools, type AssistantScope, type ToolSpec, type WireTool } from '../_shared/assistant/tools.ts';
import { runFileRead, runKnowledgeOrMeta, runPosthog, runProposeJob, runRpcTool, runSearch, runStoredTool, type DispatchCtx } from '../_shared/assistant/runners.ts';
import { latestAnswer, readConversation, readTail, recheckReads, reuseReads, tailToMessages, venueModels, venueTimezone, type ConvRow } from '../_shared/assistant/reads.ts';
import { gateSigner, insertMessage, persistTurn, webSearchPricer } from '../_shared/assistant/persist.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
/** Output ceiling per call (thinking included): answers are short by instruction, so the cheap tier gets a tight one (2026-10-09). */
const MAX_TOKENS_CHAT = 6000;
const MAX_TOKENS_CHAT_CHEAP = 3000;
const WALL_MS = 50_000;
const HEARTBEAT_MS = 15_000;
/**
 * The message is at most 8000 characters (parseBody): 32 KB even if every one
 * were a 4-byte character, plus scopes, range and ids. 64 KB, then 413.
 */
const MAX_BODY = 64 * KB;

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
 * plus the first user turn (date, timezone, scopes). Earlier messages, the
 * question's own words, tool rounds and the answer come on top. Claude's
 * count_tokens is exact and free; Groq has none, so bytes/4 (`exact: false`).
 */
async function startSize(
  provider: Provider,
  scopes: readonly AssistantScope[],
  lang: Lang,
  today: string,
  tz: string,
): Promise<{ tokens: number; exact: boolean; model: string }> {
  const { system, tools } = turnPrefix(provider.capabilities, scopes, lang);
  const first = buildFirstUserTurn({ today, tz, scopes });
  try {
    const tokens = await provider.countTokens(system, tools, [{ role: 'user', content: first }], { webSearch: true });
    return { tokens, exact: provider.capabilities.exactTokens, model: provider.model };
  } catch (e) {
    logError('assistant-chat', errorText(e), 'count_tokens failed; estimating');
    return { tokens: estimateTokens(system) + estimateTokens(JSON.stringify(tools)) + estimateTokens(first), exact: false, model: provider.model };
  }
}

/**
 * The re-check (recheck.ts recheckMessage) wired to this request: the owner's
 * client and its reads (RLS, 0108/0234; recheckMessage compares owner_id), the
 * time box's signal in the context, runners.ts's runner for a stored call.
 */
function handleRecheck(req: Request, ownerId: string, recheck: unknown, venueScope: string | null = null): Promise<Response> {
  const asOwner = ownerClient(req, venueScope);
  return recheckMessage<DispatchCtx>(
    {
      ...recheckReads(asOwner),
      timezone: () => venueTimezone(asOwner),
      context: (scopes, handles, tz) => ({ asOwner, scopes, handles, tz, lang: 'en', authorization: req.headers.get('Authorization') ?? '', venueScope, signal: AbortSignal.timeout(RECHECK_WALL_MS) }),
      run: runStoredTool,
    },
    ownerId,
    recheck,
  );
}

// ---------------------------------------------------------------------------
Deno.serve(handle('assistant-chat', async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED', code: 'METHOD_NOT_ALLOWED', message: 'POST only' }, 405);

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, ['owner']);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400),
  });
  if (!body.ok) return body.response;
  const raw: unknown = body.value;
  // Re-check: tools only, no model, no quota, no writes (header).
  if (raw && typeof raw === 'object' && 'recheck' in raw) {
    // A malformed venue_scope is refused here as on the main path (parseBody),
    // not quietly read as "the default branch" (review 2026-11-09).
    const scope = venueScopeOf(raw as Record<string, unknown>);
    if (scope === false) return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'venue_scope must be a uuid' }, 400);
    return handleRecheck(req, auth.userId, (raw as { recheck: unknown }).recheck, scope);
  }

  const parsed = parseBody(raw);
  if (typeof parsed === 'string') return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: parsed }, 400);

  const asOwner = ownerClient(req, parsed.venue_scope);
  const env = (n: string) => Deno.env.get(n);

  // Dry run: what any question costs to start with these boxes (system prompt,
  // tool list, the first turn). No model, no quota, no writes.
  if (parsed.dry_run) {
    const [tz, models] = await Promise.all([venueTimezone(asOwner), parsed.model ? Promise.resolve(null) : venueModels(service)]);
    const today = localDate(new Date(), tz);
    const scopes = parsed.scopes ?? normaliseScopes(null);
    const range = parsed.range ?? defaultRange(today);
    const provider = providerFromEnv(env, parsed.model ?? models?.default_model ?? null);
    const start = provider ? await startSize(provider, scopes, parsed.lang, today, tz) : null;
    // `packs` stays on the wire, always empty since 2026-10-09 (no context
    // packs): the operator's api.ts and tests/assistant-eval.test.ts read it.
    return json({ packs: [], start, scopes, range });
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
      return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
    }
    if (!data) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' }, 404);
    if ((data as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', code: 'FORBIDDEN', message: 'not your conversation' }, 403);
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
  // the user message is stored, on purpose: a failed insert is a rare 500 that
  // costs one request; the other order would store user messages for refused
  // requests.
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
      return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
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
    return json({ error: 'INTERNAL', code: 'INTERNAL' }, 500);
  }
  const userSeq = userInsert.seq;
  // The history is read inside the stream (run), beside the context work: one
  // round trip fewer before the first byte.

  // ── The stream ────────────────────────────────────────────────────────────
  // A client that leaves (Stop) aborts the turn like the wall does; `cancelled`
  // remembers which came first, so a Stop is stored as stopped, not TIMEOUT.
  const abort = new AbortController();
  let cancelled: 'stopped' | 'wall' | null = null;
  const sse = sseStream<AssistantEvent>({
    heartbeatMs: HEARTBEAT_MS,
    onCancel: () => {
      cancelled ??= 'stopped';
      abort.abort();
    },
  });
  const emit = sse.emit;
  const wall = setTimeout(() => {
    cancelled ??= 'wall';
    abort.abort();
  }, WALL_MS);

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
  const { sources, allowed } = turn;
  /** A first turn built (not replayed) this turn, stored on the conversation at persist when contextStorable; null when replayed. */
  let freshContext: FrozenContext | null = null;
  /** Signs this answer's gate.numbers and checks the previous answer's (null without the key). */
  const gateSign = gateSigner();
  /** The per-search price (0324), read once per turn and only when a search ran. */
  const perSearchMicros = webSearchPricer(service);
  const userNumbers = numbersIn(parsed.text);
  let errorOut: { code: string; message: string } | null = null;
  /** The client left before the turn ended (Stop, page closed): stored as stopped, not as a failure. */
  let stopped = false;

  /**
   * One checked tool as the owner, injected into the loop's dispatchTool
   * (turn.ts), which has already validated it, checked its scope and resolved
   * its handles; a throw here becomes an is_error notice there.
   */
  const runTool = (spec: ToolSpec, resolved: Record<string, unknown>): Promise<Dispatched> => {
    if (spec.name === 'propose_job') return runProposeJob(ctx, provider, resolved, parsed.lang);
    if (spec.kind === 'knowledge' || spec.kind === 'meta') return runKnowledgeOrMeta(ctx, spec, resolved);
    if (spec.name === 'posthog') return runPosthog(ctx, spec, resolved);
    if (spec.name === 'file_read') return runFileRead(ctx, spec, resolved);
    return runRpcTool(ctx, spec, resolved);
  };

  /**
   * The first user turn (F1 item 2): the stored one when it still holds, else
   * a fresh one — date, timezone and the scopes, no context packs (owner call
   * 2026-10-09: the model fetches only what the question needs through its
   * tools; the packs pre-loaded every checked scope whether the question
   * needed it or not). The fresh one is stored on the conversation at persist.
   * A stored one carries no figures: only this function writes the column
   * (0325 column grant, 0405 no client UPDATE), with none since 2026-10-09,
   * and anything older is past CONTEXT_MAX_AGE_MS, so reusableContext refuses it.
   */
  const prepareContext = (): string => {
    // Keyed on the branch in scope too (review 2026-10-08): another branch's
    // first turn is never replayed.
    const want = { scopes, range, today, tz, venue_scope: parsed.venue_scope };
    const stored = reusableContext(conv.context, want, Date.now());
    if (stored) return stored.text;
    const text = buildFirstUserTurn({ today, tz, scopes });
    freshContext = frozenContext({ ...want, text, numbers: [], model: provider.model, now: new Date() });
    return text;
  };

  /** A lookup's search for the owner's own words (F1 item 5), before the first model call. Never throws. */
  const preSearch = async (): Promise<{ out: Dispatched; ms: number } | null> => {
    if (!route.preRetrieve) return null;
    const started = Date.now();
    try {
      return { out: await runSearch(ctx, toolByName('search')!, { query: parsed.text }), ms: Date.now() - started };
    } catch (e) {
      logError('assistant-chat', errorText(e), 'pre-retrieval search failed');
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
        hit = await findReusableAnswer(reuseReads(service), auth.userId, { text: parsed.text, scopes, venueScope: parsed.venue_scope, today, tz, ctx, newConversationId: conv.id }, runStoredTool);
      } catch (e) {
        logError('assistant-chat', errorText(e), 'answer reuse skipped');
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
    // The first turn, the history (reads.ts readTail) and a lookup's search, together.
    const [contextText, tailRows, pre] = await Promise.all([prepareContext(), readTail(service, conv.id, userSeq, abort.signal), preSearch()]);
    const tail = tailToMessages(tailRows);
    /**
     * The previous answer's stored gate.numbers (F1): the gate accepts them,
     * this answer's baseline does not repeat them. Only with this function's
     * signature on them: the column was client-writable (0108, until 0329;
     * chat-changelog.md, "Previous figures").
     */
    const previousNumbers = await signedPreviousNumbers(tailRows, conv.id, gateSign);
    // `packs` stays on the wire, always empty since 2026-10-09 (dry run above).
    emit('message_start', { conversation_id: conv.id, user_message_id: userMessageId, assistant_message_id: assistantMessageId, scopes, model: provider.model, packs: [] });

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
      { role: 'user', content: contextText },
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
          webSearch: webSearchOn(provider.model, route),
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

  // The end of the turn (persist.ts), read after the loop ended or threw, so
  // freshContext, errorOut and reusedFrom are final here.
  const persist = () =>
    persistTurn({
      service,
      model: provider.model,
      route,
      turn,
      convId: conv.id,
      convTitle: conv.title,
      assistantMessageId,
      handles,
      scopes,
      ownerText: parsed.text,
      freshContext,
      signal: abort.signal,
      errorOut,
      stopped,
      reusedFrom,
      gateSign,
      emit,
    });

  const finish = (async () => {
    try {
      await run();
    } catch (e) {
      const ending = turnEnding({ cancelled, providerCode: e instanceof ProviderError ? e.code : null, aborted: abort.signal.aborted });
      if (ending.stopped) {
        // The owner pressed Stop or left: not a failure (header). Nobody is
        // listening any more; the stored turn says stopped.
        stopped = true;
        console.log(`[assistant-chat] turn stopped by the client (${errorText(e)})`);
      } else {
        // The owner sees a fixed sentence per code (the stored turn keeps the
        // code); the vendor's or the runtime's own text goes to the log only.
        errorOut = { code: ending.code, message: turnErrorText(ending.code) };
        logError('assistant-chat', errorText(e), `turn failed (${ending.code})`);
      }
    }
    try {
      await persist();
    } catch (e) {
      logError('assistant-chat', errorText(e), 'persist failed');
    }
    if (errorOut) emit('error', errorOut);
    emit('done', { message_id: assistantMessageId, stop_reason: errorOut ? errorOut.code : stopped ? 'stopped' : turn.stopReason });
    clearTimeout(wall);
    sse.close();
  })();
  // After a disconnect the runtime may drop a promise nobody awaits; waitUntil
  // keeps it alive until persist has recorded the spend (header).
  const edge = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof edge?.waitUntil === 'function') {
    try {
      edge.waitUntil(finish);
    } catch (e) {
      logError('assistant-chat', errorText(e), 'EdgeRuntime.waitUntil refused the turn');
    }
  }

  return new Response(sse.stream, { status: 200, headers: { ...SSE_HEADERS } });
}));
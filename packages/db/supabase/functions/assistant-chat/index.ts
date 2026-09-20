/**
 * assistant-chat — one owner message, streamed (plan §4.1, contracts
 * "assistant-chat/index.ts").
 *
 * Request  POST { conversation_id: uuid|null, text, lang: 'en'|'ar', scopes?, range?: {from,to}, dry_run?: true }
 * Response text/event-stream; events `message_start, delta, tool_start, tool_end,
 *          sources, gate, usage, job_estimate, done, error` (see the contracts table).
 *          Before the stream opens, refusals are plain JSON exactly like
 *          analytics-insights: 400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN ·
 *          404 NOT_FOUND · 429 LLM_DAILY_QUOTA / LLM_MONTHLY_CAP · 503 NOT_CONFIGURED.
 *          `dry_run: true` answers JSON `{ packs }` (sizes for the checkboxes): no model
 *          call, no llm_begin_request, no rows written.
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
 * persisting what exists. Persisted per message: the assistant row (final
 * text blocks, sources, gate, tokens), one assistant_calls row per model call
 * priced by `app.llm_price_micros`, one `llm_record_usage`, and the
 * conversation's handles / tokens / title. Intermediate tool_use blocks are
 * NOT replayed on later turns (the sources panel has them; plan §11.4 forgets
 * old tool results anyway), so a stored turn is always API-valid.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { json, mapPgError } from '../_shared/http.ts';
import {
  clean,
  CleanError,
  cleanedNotice,
  sourceForTool,
  toolResultBlock,
  type Cleaned,
  type CleanedToolResult,
  type CleanStats,
} from '../_shared/assistant/clean.ts';
import { estimateJob, type JobCall, type JobEstimate, type JobPlan } from '../_shared/assistant/estimate.ts';
import { embed } from '../_shared/assistant/embed.ts';
import { gateAnswer, numbersIn, retryMessage, type GateResult } from '../_shared/assistant/gate.ts';
import { isUnknownHandle, newHandleTable, resolveHandle, toJson, type HandleTable } from '../_shared/assistant/handles.ts';
import { compactText, describe as mapDescribe, pageLookup } from '../_shared/assistant/map.ts';
import { buildChunkExtractPrompt, buildFirstUserTurn, buildJobSystem, buildSystem, titleFrom, type PackForPrompt } from '../_shared/assistant/prompt.ts';
import {
  providerFromEnv,
  ProviderError,
  textOf,
  toolUsesOf,
  withoutThinking,
  type ContentBlock,
  type Provider,
  type ProviderMessage,
  type ProviderUsage,
} from '../_shared/assistant/provider.ts';
import { checkScope, defaultRange, isRange, localDate, normaliseScopes, packPlan, searchKindsFor, type DateRange } from '../_shared/assistant/scopes.ts';
import { SSE_HEADERS, sseFrame, sseHeartbeat, type AssistantEvent } from '../_shared/assistant/sse.ts';
import {
  ASSISTANT_TOOLS,
  LIST_ROW_CAP,
  MAX_TOOL_ROUNDS,
  rpcArgs,
  toolByName,
  validateToolInput,
  wireTools,
  type AssistantScope,
  type ToolSpec,
} from '../_shared/assistant/tools.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MAX_TOKENS_CHAT = 8000;
const WALL_MS = 50_000;
const HEARTBEAT_MS = 15_000;
const TAIL_MESSAGES = 30;
const SEARCH_LIMIT = 12;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant';

type Lang = 'en' | 'ar';

interface Req {
  conversation_id: string | null;
  text: string;
  lang: Lang;
  scopes: AssistantScope[] | null;
  range: DateRange | null;
  dry_run: boolean;
}

interface SourceItem {
  call_id: string;
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number;
  route: string | null;
  stats: CleanStats | null;
  error?: string;
}

interface CallRow {
  call_no: number;
  model: string;
  usage: ProviderUsage;
  ms: number;
  stop_reason: string;
  cost_micros: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseBody(body: unknown): Req | string {
  if (!body || typeof body !== 'object') return 'body must be an object';
  const b = body as Record<string, unknown>;
  const conversation_id = b.conversation_id === null || b.conversation_id === undefined ? null : String(b.conversation_id);
  if (conversation_id && !UUID_RE.test(conversation_id)) return 'conversation_id must be a uuid';
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  const dry_run = b.dry_run === true;
  if (!dry_run && !text) return 'text is required';
  if (text.length > 8000) return 'text is too long';
  const lang: Lang = b.lang === 'ar' ? 'ar' : 'en';
  const scopes = b.scopes === undefined || b.scopes === null ? null : normaliseScopes(b.scopes);
  const range = b.range === undefined || b.range === null ? null : isRange(b.range) ? b.range : 'range must be {from, to} as YYYY-MM-DD';
  if (typeof range === 'string') return range;
  return { conversation_id, text, lang, scopes, range, dry_run };
}

/** The JWT-bound client: tools run as the owner, never as the service role. */
function ownerClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
}

async function venueTimezone(asOwner: SupabaseClient): Promise<string> {
  const { data } = await asOwner.from('venue_settings').select('timezone').limit(1).maybeSingle();
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
}

interface Dispatched {
  cleaned: Cleaned;
  isError: boolean;
  row_count: number | null;
  /** Filled by propose_job only. */
  estimate?: Omit<JobEstimate, 'job_id'> & { plan: JobPlan };
}

function errorText(e: unknown): string {
  if (e instanceof CleanError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/** Resolve handles in id-typed arguments; an unknown handle is refused before any RPC runs. */
function resolveArgs(spec: ToolSpec, input: Record<string, unknown>, handles: HandleTable): Record<string, unknown> | string {
  const out: Record<string, unknown> = { ...input };
  for (const [name, arg] of Object.entries(spec.args)) {
    const v = out[name];
    if (arg.type !== 'id' || typeof v !== 'string') continue;
    if (isUnknownHandle(handles, v)) return `Unknown handle ${v}; use a handle from an earlier result in this chat`;
    out[name] = resolveHandle(handles, v);
  }
  return out;
}

async function runRpcTool(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const p_args = rpcArgs(spec, input);
  const { data, error } = await ctx.asOwner.schema('app').rpc('assistant_run_tool', { p_tool: spec.rpc, p_args });
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
  const cleaned = clean(sourceForTool(spec, columns), payload, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles, requested, total });
  const row_count = typeof wrapped.row_count === 'number' ? wrapped.row_count : cleaned.stats.rows_out;
  return { cleaned, isError: false, row_count };
}

async function runSearch(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const kinds = searchKindsFor(ctx.scopes, Array.isArray(input.kinds) ? (input.kinds as string[]) : null);
  if (!kinds.length) return { cleaned: cleanedNotice('Nothing is searchable in this chat: the requested kinds belong to scopes that are off'), isError: true, row_count: 0 };
  const query = String(input.query ?? '');
  let embedding: number[] | null = null;
  let degraded = false;
  try {
    embedding = (await embed([query], ctx.lang, (n) => Deno.env.get(n), fetch as never, { inputType: 'query' }))[0] ?? null;
  } catch (e) {
    degraded = true;
    console.error('[assistant-chat] embedding failed, full-text only', errorText(e));
  }
  const { data, error } = await ctx.asOwner.schema('app').rpc('assistant_search', { p_query: query, p_embedding: embedding, p_kinds: kinds, p_limit: SEARCH_LIMIT });
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
      const { data, error } = await ctx.asOwner.schema('app').rpc('assistant_usage', { p_from: input.from, p_to: input.to });
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
    const { data, error } = await ctx.asOwner.schema('app').rpc('assistant_count', { p_tool: spec.rpc, p_args: rpcArgs(spec, call.args) });
    if (error) {
      const mapped = mapPgError(error);
      return { cleaned: cleanedNotice(`${call.tool}: ${mapped.code}: ${mapped.message}`), isError: true, row_count: null };
    }
    counts[call.tool] = (counts[call.tool] ?? 0) + Number(data ?? 0);
  }
  const body = estimateJob(plan, counts, ASSISTANT_TOOLS);

  // The first chunk, measured for real (plan §6.2): rows read as the owner, cleaned, counted.
  let first_chunk_exact: number | null = null;
  const first = calls[0]!;
  const firstSpec = toolByName(first.tool)!;
  const chunkRows = body.per_tool[0]?.chunk_rows ?? 250;
  if (body.chunks > 0) {
    try {
      const { data, error } = await ctx.asOwner
        .schema('app')
        .rpc('assistant_run_tool', { p_tool: firstSpec.rpc, p_args: rpcArgs(firstSpec, { ...first.args, limit: Math.min(chunkRows, LIST_ROW_CAP), offset: 0 }) });
      if (!error) {
        const payload = (data as { data?: unknown })?.data;
        const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
        const cleaned = clean(sourceForTool(firstSpec, Array.isArray(obj?.columns) ? (obj.columns as string[]) : null), payload, {
          tz: ctx.tz,
          lang: ctx.lang,
          handles: newHandleTable(toJson(ctx.handles)), // a scratch copy: the estimate must not mint handles
        });
        first_chunk_exact = await provider.countTokens(buildJobSystem(), [], [{ role: 'user', content: buildChunkExtractPrompt(plan, 1, body.chunks, cleaned) }]);
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
async function runPacks(ctx: DispatchCtx, range: DateRange): Promise<PackForPrompt[]> {
  const out: PackForPrompt[] = [];
  for (const scope of ctx.scopes) {
    for (const call of packPlan(scope, range)) {
      const spec = toolByName(call.tool);
      if (!spec || !spec.rpc) continue;
      try {
        const r = await runRpcTool(ctx, spec, call.args);
        if (!r.isError) out.push({ scope, cleaned: r.cleaned });
      } catch (e) {
        console.error('[assistant-chat] pack failed', scope, call.tool, errorText(e));
      }
    }
  }
  return out;
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
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, ['owner']);
  if (auth instanceof Response) return auth;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const parsed = parseBody(raw);
  if (typeof parsed === 'string') return json({ error: 'INVALID_REQUEST', message: parsed }, 400);

  const asOwner = ownerClient(req);
  const tz = await venueTimezone(asOwner);
  const today = localDate(new Date(), tz);

  // Dry run: pack sizes for the checkboxes. No model, no quota, no writes.
  if (parsed.dry_run) {
    const scopes = parsed.scopes ?? normaliseScopes(null);
    const ctx: DispatchCtx = { asOwner, scopes, handles: newHandleTable(null), tz, lang: parsed.lang };
    const packs = await runPacks(ctx, parsed.range ?? defaultRange(today));
    return json({ packs: packSizes(packs), scopes, range: parsed.range ?? defaultRange(today) });
  }

  // No key → 503 before any write (the user message is not inserted either).
  const provider = providerFromEnv((n) => Deno.env.get(n));
  if (!provider) return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' }, 503);

  // The quota gate (SEC-29): our own ceiling, so 429 not 502.
  const budget = await service.schema('app').rpc('llm_begin_request');
  if (budget.error) {
    const code = budget.error.message ?? 'LLM_BUDGET';
    if (code.includes('LLM_DAILY_QUOTA') || code.includes('LLM_MONTHLY_CAP')) {
      const which = code.includes('LLM_MONTHLY_CAP') ? 'LLM_MONTHLY_CAP' : 'LLM_DAILY_QUOTA';
      return json({ error: which, code: which, message: budget.error.details ?? code, hint: budget.error.hint ?? null }, 429);
    }
    console.error('[assistant-chat] budget gate failed', code);
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: code }, 502);
  }

  // Load or create the conversation (service; owner_id is the caller)
  let conv: { id: string; scopes: string[]; range: unknown; handles: unknown; tokens: Record<string, number> | null; title: string | null };
  if (parsed.conversation_id) {
    const { data, error } = await service
      .from('assistant_conversations')
      .select('id, owner_id, scopes, range, handles, tokens, title, archived_at')
      .eq('id', parsed.conversation_id)
      .maybeSingle();
    if (error) return json({ error: 'INTERNAL', message: error.message }, 500);
    if (!data) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'conversation not found' }, 404);
    if ((data as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', message: 'not your conversation' }, 403);
    conv = data as typeof conv;
    if (parsed.scopes || parsed.range) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (parsed.scopes) patch.scopes = parsed.scopes;
      if (parsed.range) patch.range = parsed.range;
      await service.from('assistant_conversations').update(patch).eq('id', conv.id);
      if (parsed.scopes) conv.scopes = parsed.scopes;
      if (parsed.range) conv.range = parsed.range;
    }
  } else {
    const { data, error } = await service
      .from('assistant_conversations')
      .insert({ owner_id: auth.userId, title: titleFrom(parsed.text), scopes: parsed.scopes ?? normaliseScopes(null), range: parsed.range, handles: {}, tokens: {} })
      .select('id, scopes, range, handles, tokens, title')
      .single();
    if (error || !data) return json({ error: 'INTERNAL', message: error?.message ?? 'insert failed' }, 500);
    conv = data as typeof conv;
  }
  const scopes = normaliseScopes(conv.scopes);
  const range: DateRange = isRange(conv.range) ? conv.range : defaultRange(today);
  const handles = newHandleTable(conv.handles);

  // The user message (seq = max + 1)
  const { data: last } = await service.from('assistant_messages').select('seq').eq('conversation_id', conv.id).order('seq', { ascending: false }).limit(1).maybeSingle();
  const userSeq = ((last as { seq?: number } | null)?.seq ?? 0) + 1;
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  {
    const { error } = await service.from('assistant_messages').insert({
      id: userMessageId,
      conversation_id: conv.id,
      seq: userSeq,
      role: 'user',
      content: [{ type: 'text', text: parsed.text }],
      sources: [],
      tokens: {},
    });
    if (error) return json({ error: 'INTERNAL', message: error.message }, 500);
  }

  // The tail (last 30 stored messages, excluding the one just inserted)
  const { data: tailRows } = await service
    .from('assistant_messages')
    .select('role, content, seq')
    .eq('conversation_id', conv.id)
    .lt('seq', userSeq)
    .order('seq', { ascending: false })
    .limit(TAIL_MESSAGES);
  const tail = tailToMessages(((tailRows ?? []) as { role: string; content: unknown }[]).reverse());

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

  const ctx: DispatchCtx = { asOwner, scopes, handles, tz, lang: parsed.lang };
  const calls: CallRow[] = [];
  const sources: SourceItem[] = [];
  const allowed: number[] = [];
  const userNumbers = numbersIn(parsed.text);
  let finalContent: ContentBlock[] = [];
  let finalText = '';
  let gate: GateResult | null = null;
  let gateRetried = false;
  let stopReason = 'end_turn';
  let jobEstimate: Dispatched['estimate'] | null = null;
  let errorOut: { code: string; message: string } | null = null;

  const priceOf = async (u: ProviderUsage): Promise<number> => {
    const { data, error } = await service.schema('app').rpc('llm_price_micros', {
      p_model: provider.model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
    });
    if (error) {
      console.error('[assistant-chat] llm_price_micros', error.message);
      return 0;
    }
    return Number(data ?? 0);
  };

  const dispatch = async (block: { id: string; name: string; input: unknown }): Promise<{ result: CleanedToolResult; estimate?: Dispatched['estimate'] }> => {
    const started = Date.now();
    const args = block.input && typeof block.input === 'object' && !Array.isArray(block.input) ? (block.input as Record<string, unknown>) : {};
    const spec = toolByName(block.name);
    const item: SourceItem = { call_id: block.id, name: block.name, args, row_count: null, ms: 0, route: spec?.route ?? null, stats: null };
    emit('tool_start', { call_id: block.id, name: block.name, args });

    let out: Dispatched;
    try {
      if (!spec) out = { cleaned: cleanedNotice(`Unknown tool ${block.name}`), isError: true, row_count: null };
      else {
        const problems = validateToolInput(spec, args);
        const scope = checkScope(spec.name, scopes);
        if (problems.length) out = { cleaned: cleanedNotice(problems.join('; ')), isError: true, row_count: null };
        else if (!scope.ok) out = { cleaned: cleanedNotice(scope.message), isError: true, row_count: null };
        else {
          const resolved = resolveArgs(spec, args, handles);
          if (typeof resolved === 'string') out = { cleaned: cleanedNotice(resolved), isError: true, row_count: null };
          else if (spec.name === 'propose_job') out = await runProposeJob(ctx, provider, resolved, parsed.lang);
          else if (spec.kind === 'knowledge' || spec.kind === 'meta') out = await runKnowledgeOrMeta(ctx, spec, resolved);
          else out = await runRpcTool(ctx, spec, resolved);
        }
      }
    } catch (e) {
      out = { cleaned: cleanedNotice(errorText(e)), isError: true, row_count: null };
    }
    item.ms = Date.now() - started;
    item.row_count = out.row_count;
    item.stats = out.cleaned.stats;
    if (out.isError) item.error = out.cleaned.text.slice(0, 300);
    else allowed.push(...out.cleaned.numbers);
    sources.push(item);
    emit('tool_end', { call_id: item.call_id, name: item.name, row_count: item.row_count, ms: item.ms, route: item.route, error: item.error, stats: item.stats });
    return { result: toolResultBlock(block.id, out.cleaned, out.isError), estimate: out.estimate };
  };

  const run = async () => {
    // Packs, then the request
    const packs = await runPacks(ctx, range);
    emit('message_start', { conversation_id: conv.id, user_message_id: userMessageId, assistant_message_id: assistantMessageId, scopes, packs: packSizes(packs) });

    const system = buildSystem({ compactMap: compactText(), lang: parsed.lang });
    const tools = wireTools(); // the whole catalog in catalog order: one cache prefix for every chat
    const messages: ProviderMessage[] = [
      { role: 'user', content: buildFirstUserTurn({ today, tz, scopes, packs }) },
      ...tail,
      { role: 'user', content: parsed.text },
    ];

    let rounds = 0;
    while (rounds <= MAX_TOOL_ROUNDS + 1) {
      rounds++;
      let streamed = '';
      const turn = await provider.stream({
        system,
        tools,
        messages,
        maxTokens: MAX_TOKENS_CHAT,
        effort: 'medium',
        onText: (delta) => {
          streamed += delta;
          emit('delta', { text: delta });
        },
        onToolStart: () => {},
        signal: abort.signal,
      });
      const cost = await priceOf(turn.usage);
      calls.push({ call_no: calls.length + 1, model: provider.model, usage: turn.usage, ms: turn.ms, stop_reason: turn.stop_reason, cost_micros: cost });
      stopReason = turn.stop_reason;
      finalContent = turn.content;
      finalText = textOf(turn.content) || streamed;

      const uses = toolUsesOf(turn.content);
      if (turn.stop_reason === 'tool_use' && uses.length) {
        if (rounds > MAX_TOOL_ROUNDS) {
          // Out of rounds: answer with what exists rather than loop on.
          messages.push({ role: 'assistant', content: turn.content });
          messages.push({ role: 'user', content: uses.map((u) => toolResultBlock(u.id, cleanedNotice('Tool rounds exhausted for this message; answer from what you have or propose a job'), true)) });
          messages.push({ role: 'system', content: 'No more tools this turn. Answer now from the results you have, or say what is missing.' });
          continue;
        }
        const results = await Promise.all(uses.map((u) => dispatch(u)));
        const proposed = results.find((r) => r.estimate);
        if (proposed?.estimate) {
          jobEstimate = proposed.estimate;
          stopReason = 'job_proposed';
          finalText = textOf(turn.content);
          break;
        }
        messages.push({ role: 'assistant', content: turn.content });
        messages.push({ role: 'user', content: results.map((r) => r.result) });
        continue;
      }
      if (turn.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: turn.content });
        continue;
      }

      // Final text: the gate, one retry through the operator channel
      gate = gateAnswer(finalText, allowed, userNumbers);
      if (gate.status === 'unverified' && !gateRetried) {
        gateRetried = true;
        emit('gate', { ...gate, retried: true });
        // The answer is not appended (a system message must follow a user turn); the instruction is.
        messages.push({ role: 'system', content: retryMessage(gate.unverified) });
        emit('delta', { text: '', reset: true });
        continue;
      }
      break;
    }
  };

  const persist = async () => {
    const usage = calls.reduce<ProviderUsage>(
      (acc, c) => ({ input: acc.input + c.usage.input, cache_write: acc.cache_write + c.usage.cache_write, cache_read: acc.cache_read + c.usage.cache_read, output: acc.output + c.usage.output }),
      { input: 0, cache_write: 0, cache_read: 0, output: 0 },
    );
    const cost_micros = calls.reduce((n, c) => n + c.cost_micros, 0);
    const tokens = { ...usage, cost_micros, calls: calls.length, model: provider.model };
    const content = withoutThinking(finalContent).filter((b) => b.type === 'text');
    const stored = content.length ? content : [{ type: 'text', text: finalText || (errorOut ? `[${errorOut.code}] ${errorOut.message}` : '') }];

    const msg = await service.from('assistant_messages').insert({
      id: assistantMessageId,
      conversation_id: conv.id,
      seq: userSeq + 1,
      role: 'assistant',
      content: stored,
      sources,
      gate,
      tokens,
    });
    if (msg.error) console.error('[assistant-chat] message not stored', msg.error.message);
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
    const prev = conv.tokens ?? {};
    const sum = (k: keyof typeof usage | 'cost_micros' | 'calls', v: number) => (Number(prev[k] ?? 0) || 0) + v;
    const upd = await service
      .from('assistant_conversations')
      .update({
        handles: toJson(handles),
        tokens: { input: sum('input', usage.input), cache_write: sum('cache_write', usage.cache_write), cache_read: sum('cache_read', usage.cache_read), output: sum('output', usage.output), cost_micros: sum('cost_micros', cost_micros), calls: sum('calls', calls.length) },
        updated_at: new Date().toISOString(),
        ...(conv.title ? {} : { title: titleFrom(parsed.text) }),
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
        await service.from('assistant_jobs').update({ estimate: { ...estimate, job_id } }).eq('id', job_id);
        emit('job_estimate', { ...estimate, job_id });
      }
    }
    emit('sources', { items: sources, scopes });
    if (gate && !jobEstimate) emit('gate', { ...gate, retried: gateRetried });
    emit('usage', { ...usage, cost_micros, calls: calls.length, model: provider.model });
  };

  (async () => {
    try {
      await run();
    } catch (e) {
      if (e instanceof ProviderError) errorOut = { code: e.code, message: e.message };
      else if (abort.signal.aborted) errorOut = { code: 'TIMEOUT', message: `the turn did not finish inside ${WALL_MS / 1000} s` };
      else errorOut = { code: 'UPSTREAM', message: errorText(e) };
      console.error('[assistant-chat] turn failed', errorOut.code, errorOut.message);
    }
    try {
      await persist();
    } catch (e) {
      console.error('[assistant-chat] persist failed', errorText(e));
    }
    if (errorOut) emit('error', errorOut);
    emit('done', { message_id: assistantMessageId, stop_reason: errorOut ? errorOut.code : stopReason });
    clearInterval(heartbeat);
    clearTimeout(wall);
    closed = true;
    try {
      controller?.close();
    } catch {
      // already closed by the client
    }
  })();

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
});

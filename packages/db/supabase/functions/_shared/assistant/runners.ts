/**
 * runners.ts — the chat's tool runners, as the owner (moved out of
 * assistant-chat/index.ts on 2026-11-09; history in
 * docs/design/assistant/chat-changelog.md).
 *
 * Every runner reads through `ctx.asOwner`, the client bound to the caller's
 * JWT, so the dispatcher's owner check and `app.assistant_run_tool`'s
 * read-only wall apply; the service client never reaches this file. A
 * runner's rows become a tool result only through clean.ts (`clean`,
 * `cleanedNotice`, `withNote`): the door (plan §11.0). Database and vendor
 * text goes to the log (http.ts `safePgMessage`, `logError`), never to the
 * model. The turn's abort signal rides on every RPC and fetch (`aborting`).
 *
 * Deno-only (Deno.env, npm:@supabase/supabase-js types): it is imported by
 * assistant-chat and nothing in _shared imports it except other Deno modules.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { fetchWithTimeout, logError, safePgMessage } from '../http.ts';
import { mergeWindows, type SearchRow } from './searchMerge.ts';
import { clean, cleanedNotice, sourceForTool, withNote } from './clean.ts';
import { estimateJob, JOB_EXTRACT_MODEL, type JobCall, type JobPlan } from './estimate.ts';
import { embed } from './embed.ts';
import { capHintFor, resultRowCap } from './turnPolicy.ts';
import { errorText, resolveArgs, type Dispatched } from './turn.ts';
import { newHandleTable, toJson, type HandleTable } from './handles.ts';
import { localRunner } from './localRunner.ts';
import { FILES_BUCKET, FILE_READ_DEFAULT_CHARS, FileTextTooLarge, fileWindow, gunzipText } from './files.ts';
import { describe as mapDescribe, pageLookup } from './map.ts';
import { buildChunkExtractPrompt, buildJobSystem, type Lang } from './prompt.ts';
import { providerFromEnv, type Provider } from './provider.ts';
import { checkScope, searchKindsFor } from './scopes.ts';
import { ASSISTANT_TOOLS, LIST_ROW_CAP, rpcArgs, toolByName, validateToolInput, type AssistantScope, type ToolSpec } from './tools.ts';

const POSTHOG_FN = 'analytics-posthog';
const DEFAULT_BUSINESS_DAY_START_HOUR = 4;
/** Hits shown to the model. The search is asked for SEARCH_FETCH so that merging an entry's windows (searchMerge.ts) still leaves a full page of distinct entries. */
const SEARCH_LIMIT = 12;
const SEARCH_FETCH = 16;
/** Appended to a search result that ran without an embedding (provider down or unset). */
const SEARCH_TEXT_ONLY_NOTE = 'Search ran on text only (no embedding provider).';
/** One posthog tool call through analytics-posthog (which itself retries PostHog). */
const POSTHOG_TIMEOUT_MS = 25_000;

/**
 * Bind a query to the turn's abort signal (F1): the 50 s wall then cancels the
 * database work, not only the model call. A builder without a signal is
 * returned unchanged (the dry run).
 */
export function aborting<Q extends { abortSignal(signal: AbortSignal): Q }>(query: Q, signal: AbortSignal | undefined): Q {
  return signal ? query.abortSignal(signal) : query;
}

export interface DispatchCtx {
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

export async function runRpcTool(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const p_args = rpcArgs(spec, input);
  const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_run_tool', { p_tool: spec.rpc, p_args }), ctx.signal);
  if (error) {
    // Our P0001 code as before; any other SQLSTATE a fixed sentence, the raw text to the log (http.ts safePgMessage).
    return { cleaned: cleanedNotice(safePgMessage(error, 'assistant-chat')), isError: true, row_count: null };
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
 * `file_read` (0354): the file's details through the dispatcher (owner-only,
 * read-only, and it says where the file's words are), then the gzipped text
 * object downloaded as the owner, so the venue-files storage read rule applies
 * too (an owner_only file is the owner's; this assistant is the owner's).
 * The window the model asked for goes through clean() as lines; the storage
 * path never reaches the model.
 */
export async function runFileRead(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_run_tool', { p_tool: spec.rpc, p_args: rpcArgs(spec, input) }), ctx.signal);
  if (error) {
    return { cleaned: cleanedNotice(safePgMessage(error, 'assistant-chat')), isError: true, row_count: null };
  }
  const meta = ((data ?? {}) as { data?: unknown }).data;
  const file = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
  const textPath = typeof file.text_path === 'string' ? file.text_path : null;
  delete file.text_path;
  delete file.id;

  if (!textPath) {
    const payload = { file, readable: false, why: 'no words could be read from this file (a photo or a scanned page); answer from its name and note' };
    return { cleaned: clean(sourceForTool(spec), payload, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles }), isError: false, row_count: 0 };
  }

  let text: string;
  try {
    const { data: blob, error: dlError } = await ctx.asOwner.storage.from(FILES_BUCKET).download(textPath);
    if (dlError || !blob) {
      logError('assistant-chat', dlError ?? new Error('empty download'), `file_read download failed`);
      return { cleaned: cleanedNotice('the file text could not be downloaded'), isError: true, row_count: null };
    }
    text = await gunzipText(blob);
  } catch (e) {
    if (e instanceof FileTextTooLarge) return { cleaned: cleanedNotice(e.message), isError: true, row_count: null };
    logError('assistant-chat', e, 'file_read unzip failed');
    return { cleaned: cleanedNotice('the file text could not be read'), isError: true, row_count: null };
  }

  const offset = typeof input.offset === 'number' ? input.offset : 0;
  const chars = typeof input.chars === 'number' ? input.chars : FILE_READ_DEFAULT_CHARS;
  const w = fileWindow(text, offset, chars);
  const payload = {
    file,
    total_chars: w.total_chars,
    offset: w.offset,
    next_offset: w.next_offset,
    lines: w.lines.map((line) => ({ text: line })),
  };
  // Every line goes (the window already bounds the size); no row cap marker.
  const cleaned = clean(sourceForTool(spec), payload, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles, cap: Math.max(w.lines.length, 1) });
  return { cleaned, isError: false, row_count: w.lines.length };
}

/**
 * `cafe_settings.analytics_business_day_start_hour` as the owner (0029 grants select to staff), else the
 * 0029 default. Per branch since 0209: the branch in scope (0228), else the default (oldest active) one.
 */
export async function businessDayStartHour(asOwner: SupabaseClient, venueScope: string | null = null, signal?: AbortSignal): Promise<number> {
  // Every failure falls back to the default, as before, but is logged: a wrong
  // start hour moves every posthog day bucket without a word.
  const fallback = (err: unknown, what: string) => {
    logError('assistant-chat', err, `${what}; business day starts at the default ${DEFAULT_BUSINESS_DAY_START_HOUR}:00`);
    return DEFAULT_BUSINESS_DAY_START_HOUR;
  };
  try {
    const { data: venue, error: venueErr } = venueScope
      ? { data: { id: venueScope }, error: null }
      : await aborting(
          asOwner
            .from('venues')
            .select('id')
            .eq('is_active', true)
            .order('created_at', { ascending: true })
            .limit(1),
          signal,
        ).maybeSingle();
    if (venueErr) return fallback(venueErr, 'default branch unread');
    const venueId = (venue as { id?: string } | null)?.id;
    if (!venueId) return DEFAULT_BUSINESS_DAY_START_HOUR;
    const { data, error } = await aborting(asOwner.from('cafe_settings').select('value').eq('key', 'analytics_business_day_start_hour').eq('venue_id', venueId), signal).maybeSingle();
    if (error) return fallback(error, 'analytics_business_day_start_hour unread');
    const v = Number((data as { value?: unknown } | null)?.value);
    return Number.isInteger(v) && v >= 0 && v <= 12 ? v : DEFAULT_BUSINESS_DAY_START_HOUR;
  } catch (e) {
    return fallback(e, 'business day start hour unread');
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
export async function runPosthog(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
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
      // The status only: the body is the sibling's or PostHog's own text (review
      // 2026-11-09), which goes to the log, never to the model or sources[].error.
      const text = (await res.text().catch(() => '')).slice(0, 500);
      logError('assistant-chat', text || 'empty body', `${POSTHOG_FN} answered HTTP ${res.status}`);
      return { cleaned: cleanedNotice(`${POSTHOG_FN} answered HTTP ${res.status}; the analytics query did not run`), isError: true, row_count: null };
    }
    answer = (await res.json()) as PosthogAnswer;
  } catch (e) {
    logError('assistant-chat', e, `${POSTHOG_FN} call failed`);
    return { cleaned: cleanedNotice(`${POSTHOG_FN} could not be reached`), isError: true, row_count: null };
  }
  if (answer.configured === false) return { cleaned: cleanedNotice('PostHog is not configured for this venue'), isError: true, row_count: null };
  const result = answer.results?.[template];
  if (!result) return { cleaned: cleanedNotice(`${POSTHOG_FN} returned nothing for ${template}`), isError: true, row_count: null };
  if (typeof result.error === 'string' && result.error) {
    // PostHog's own error string is vendor text: logged, a fixed sentence for the model.
    logError('assistant-chat', result.error, `${POSTHOG_FN} ${template} failed`);
    return { cleaned: cleanedNotice(`${template}: PostHog could not answer this query`), isError: true, row_count: null };
  }
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

export async function runSearch(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
  const kinds = searchKindsFor(ctx.scopes, Array.isArray(input.kinds) ? (input.kinds as string[]) : null);
  if (!kinds.length) return { cleaned: cleanedNotice('Nothing is searchable in this chat: the requested kinds belong to scopes that are off'), isError: true, row_count: 0 };
  const query = String(input.query ?? '');
  let embedding: number[] | null = null;
  let degraded = false;
  try {
    embedding = (await embed([query], ctx.lang, (n) => Deno.env.get(n), fetch as never, { inputType: 'query', local: localRunner() }))[0] ?? null;
  } catch (e) {
    degraded = true;
    logError('assistant-chat', errorText(e), 'embedding failed, full-text only');
  }
  const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_search', { p_query: query, p_embedding: embedding, p_kinds: kinds, p_limit: SEARCH_FETCH }), ctx.signal);
  if (error) {
    return { cleaned: cleanedNotice(safePgMessage(error, 'assistant-chat')), isError: true, row_count: null };
  }
  const rows = mergeWindows(Array.isArray(data) ? (data as SearchRow[]) : [], SEARCH_LIMIT);
  const cleaned = clean(sourceForTool(spec), rows, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
  if (degraded || embedding === null) {
    // One plain sentence, not a hidden flag: the UI prints it as a note.
    // withNote keeps the result's figures in the gate's set (clean.ts); a
    // cleanedNotice re-wrap emptied them and flagged every one (review 2026-11-09).
    return { cleaned: withNote(cleaned, SEARCH_TEXT_ONLY_NOTE), isError: false, row_count: rows.length };
  }
  return { cleaned, isError: false, row_count: rows.length };
}

export async function runKnowledgeOrMeta(ctx: DispatchCtx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched> {
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
        return { cleaned: cleanedNotice(safePgMessage(error, 'assistant-chat')), isError: true, row_count: null };
      }
      const cleaned = clean(sourceForTool(spec), data, { tz: ctx.tz, lang: ctx.lang, handles: ctx.handles });
      return { cleaned, isError: false, row_count: cleaned.stats.rows_out };
    }
    default:
      return { cleaned: cleanedNotice(`Tool ${spec.name} is not served here`), isError: true, row_count: null };
  }
}

/**
 * The checked calls of one job-plan slot, or the refusal. Each call goes
 * through what dispatchTool (turn.ts) runs on a live call: the catalog's input
 * rules, the chat's scopes, then handles resolved, so a stored plan never
 * holds raw ids, malformed args or a tool of a scope the owner switched off.
 * `steps` takes list tools with an RPC (the job pages them, so limit/offset
 * go); `aggregate_alternative` any catalog tool, args as given (review
 * 2026-11-09: it was stored with only a name check, and steps.calls had no
 * scope check). An entry without a tool name is skipped, as before.
 */
export function checkPlanCalls(ctx: DispatchCtx, list: unknown, slot: 'steps' | 'aggregate_alternative'): JobCall[] | string {
  const out: JobCall[] = [];
  if (!Array.isArray(list)) return out;
  for (const c of list) {
    const call = (c && typeof c === 'object' ? c : {}) as { tool?: unknown; args?: unknown };
    if (typeof call.tool !== 'string') continue;
    const spec = toolByName(call.tool);
    if (slot === 'steps' && (!spec || spec.kind !== 'list' || !spec.rpc)) return `${call.tool} is not a list tool a job can page`;
    if (!spec) return `aggregate_alternative: unknown tool ${call.tool}`;
    const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? { ...(call.args as Record<string, unknown>) } : {};
    if (slot === 'steps') {
      delete args.limit;
      delete args.offset;
    }
    const where = slot === 'steps' ? spec.name : `aggregate_alternative ${spec.name}`;
    const problems = validateToolInput(spec, args);
    if (problems.length) return `${where}: ${problems.join('; ')}`;
    const scope = checkScope(spec.name, ctx.scopes);
    if (!scope.ok) return `${where}: ${scope.message}`;
    const resolved = resolveArgs(spec, args, ctx.handles);
    if (typeof resolved === 'string') return resolved;
    out.push({ tool: spec.name, args: resolved });
  }
  return out;
}

/** propose_job: count as the owner, estimate, measure the first chunk exactly when a key is present. Nothing runs. */
export async function runProposeJob(ctx: DispatchCtx, provider: Provider, input: Record<string, unknown>, lang: Lang): Promise<Dispatched> {
  const steps = (input.steps ?? {}) as { calls?: unknown; extract?: unknown; reduce?: unknown };
  const calls = checkPlanCalls(ctx, steps.calls, 'steps');
  if (typeof calls === 'string') return { cleaned: cleanedNotice(calls), isError: true, row_count: null };
  if (!calls.length) return { cleaned: cleanedNotice('steps.calls must name at least one list tool'), isError: true, row_count: null };

  const alt = input.aggregate_alternative as { calls?: unknown } | null | undefined;
  const altCalls = checkPlanCalls(ctx, alt && typeof alt === 'object' ? alt.calls : null, 'aggregate_alternative');
  if (typeof altCalls === 'string') return { cleaned: cleanedNotice(altCalls), isError: true, row_count: null };
  const plan: JobPlan & { lang: Lang } = {
    question: String(input.question ?? ''),
    calls,
    extract: typeof steps.extract === 'string' ? steps.extract : undefined,
    reduce: typeof steps.reduce === 'string' ? steps.reduce : undefined,
    aggregate_alternative: altCalls.length ? { calls: altCalls } : null,
    lang,
  };

  // Exact row counts, as the owner — one count per call, in plan order
  // (estimateJob and chunksOf read them per call; summing by tool name
  // double-counted a tool called twice, review 2026-11-09).
  const counts: number[] = [];
  for (const call of calls) {
    const spec = toolByName(call.tool)!;
    const { data, error } = await aborting(ctx.asOwner.schema('app').rpc('assistant_count', { p_tool: spec.rpc, p_args: rpcArgs(spec, call.args) }), ctx.signal);
    if (error) {
      return { cleaned: cleanedNotice(`${call.tool}: ${safePgMessage(error, 'assistant-chat')}`), isError: true, row_count: null };
    }
    counts.push(Number(data ?? 0));
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
      logError('assistant-chat', errorText(e), 'first chunk not measured');
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


/**
 * The runner a stored call is re-run through (the re-check and the answer
 * reuse, recheck.ts rerunStored): only data tools reach it, so it picks
 * between posthog, file_read and the RPC dispatcher, as the live turn does.
 */
export function runStoredTool(ctx: DispatchCtx, spec: ToolSpec, resolved: Record<string, unknown>): Promise<Dispatched> {
  return spec.name === 'posthog' ? runPosthog(ctx, spec, resolved) : spec.name === 'file_read' ? runFileRead(ctx, spec, resolved) : runRpcTool(ctx, spec, resolved);
}

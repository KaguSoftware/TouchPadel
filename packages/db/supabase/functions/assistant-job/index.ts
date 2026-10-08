/**
 * assistant-job — accepted estimates become work (plan §4.3, §6.4, contracts
 * "assistant-job/index.ts").
 *
 *   POST {action:'accept', job_id, mode:'live'|'batch'}  owner session
 *     estimated → accepted → running. `live` runs the chunks inline (≤ 40
 *     chunks, LIVE_MAX_CHUNKS), JOB_LIVE_CONCURRENCY at a time, and
 *     reduces; `batch` reads every chunk's rows now (as the owner), submits
 *     one Batch API request per chunk with custom_id `job:<id>:<chunk>`,
 *     stores batch_id and returns.
 *   POST {action:'tick'}                                   service role (cron tp_assistant_job_tick)
 *     polls every running batch job; when ended, collects results by
 *     custom_id, reduces, finishes.
 *   POST {action:'cancel', job_id}                         owner session
 *     app.assistant_job_cancel, and the batch is cancelled when one exists.
 *
 * Rows never enter the chat (§11.6): each chunk is a fixed extraction prompt
 * over cleaned rows returning a JSON object; only the objects reach the
 * reduce step, whose answer is inserted as an ordinary assistant message
 * with `sources: [{job_id}]`. Rows are read through the owner's JWT client
 * (`assistant_run_tool`), never the service role. Per chunk:
 * `llm_begin_request` (the cap), one model call, `llm_record_usage`; the job
 * pauses in `over_estimate` when spend passes the accepted estimate × 1.25.
 *
 * Models (2026-10-08): every chunk extraction, live and batch, runs on
 * JOB_EXTRACT_MODEL (Sonnet 5.5, estimate.ts) — pulling counts and sums out
 * of one chunk is mechanical; the reduce step runs on the job's model (the
 * chat's, stamped as tokens.model at accept) because it writes the owner's
 * answer. Every call is priced (`llm_price_micros`), recorded
 * (`llm_record_usage`) and stored (`assistant_calls.model`) at the model
 * that served it; tokens.extract_model says which model read the chunks.
 * Batch ids are account-wide (one ANTHROPIC_API_KEY): the batch is created,
 * polled and read through the extraction provider and cancelled through the
 * default one; the model only rides in each request's params.
 * Live: a pool of JOB_LIVE_CONCURRENCY (_shared/assistant/pool.ts) launches
 * chunks in order, stops launching at the clock's cutoff, over the estimate
 * or at the monthly cap, and lets in-flight chunks finish. The clock
 * (liveClock) sits inside the request's WALL_MS abort: no launch after
 * launchBy, extraction streams cut at extractBy on their own signal, so the
 * reduce keeps its time and a cut chunk ends in the TIMEOUT "re-run as batch"
 * failure, not the generic one. The cap (budgetAllows) counts this job's calls
 * still in flight, which begin()'s month-to-date figure misses, so the month
 * overshoots by at most one call, as it did sequentially. Progress writes go
 * through one ordered queue, so chunks_done and tokens only grow, and every
 * transition waits for them and happens once, after the pool.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { callerClient, createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { handle, json, KB, logError, mapPgError, pgErrorBody, readJsonBody } from '../_shared/http.ts';
import { insertAtNextSeq } from '../_shared/assistant/seq.ts';
import { clean, CleanError, sourceForTool, type Cleaned } from '../_shared/assistant/clean.ts';
import { extractCallTokens, isOverEstimate, JOB_EXTRACT_MODEL, JOB_LIVE_CONCURRENCY, LIVE_MAX_CHUNKS, type JobEstimate, type JobPlan } from '../_shared/assistant/estimate.ts';
import { gateAnswer, numbersIn, type GateResult } from '../_shared/assistant/gate.ts';
import { newHandleTable, toJson, type HandleTable } from '../_shared/assistant/handles.ts';
import { budgetAllows, liveClock, runPool, serialQueue } from '../_shared/assistant/pool.ts';
import { buildChunkExtractPrompt, buildJobSystem, buildReducePrompt, buildReduceSystem } from '../_shared/assistant/prompt.ts';
import { providerFromEnv, ProviderError, textOf, type BatchRequest, type ContentBlock, type Provider, type ProviderUsage } from '../_shared/assistant/provider.ts';
import { LIST_ROW_CAP, rpcArgs, toolByName, validateToolInput, type ToolSpec } from '../_shared/assistant/tools.ts';

const WALL_MS = 50_000;
const CHUNK_MAX_TOKENS = 2000;
const REDUCE_MAX_TOKENS = 4000;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant_job';

type Lang = 'en' | 'ar';
type Status = 'estimated' | 'accepted' | 'running' | 'reducing' | 'done' | 'failed' | 'cancelled' | 'over_estimate';

interface JobRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  status: Status;
  plan: JobPlan & { lang?: Lang };
  estimate: JobEstimate;
  mode: 'live' | 'batch' | null;
  chunks_total: number | null;
  chunks_done: number;
  tokens: Record<string, unknown> | null;
  result: unknown;
  batch_id: string | null;
}

interface Chunk {
  no: number;
  spec: ToolSpec;
  args: Record<string, unknown>;
  offset: number;
  limit: number;
}

interface Spend extends ProviderUsage {
  cost_micros: number;
  calls: number;
  total: number;
  /** The job's model (the reduce step), stamped at accept. */
  model?: string;
  /** The model that read the chunks; absent on a batch submitted before 2026-10-08 (it ran on `model`). */
  extract_model?: string;
}

interface CallRow {
  call_no: number;
  model: string;
  usage: ProviderUsage;
  ms: number;
  stop_reason: string;
  cost_micros: number;
}

const zeroSpend = (): Spend => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, total: 0 });

function errorText(e: unknown): string {
  if (e instanceof CleanError) return `${e.code}: ${e.message}`;
  if (e instanceof ProviderError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * What a failed job shows the owner, by code (the HTTP answer and the stored
 * job error both carry the code; the vendor's or the database's own text goes
 * to the log only).
 */
const JOB_ERROR_TEXT: Record<string, string> = {
  LLM_DAILY_QUOTA: 'the daily assistant quota is used up',
  LLM_MONTHLY_CAP: 'the monthly assistant budget is used up',
  RATE_LIMITED: 'the model is rate-limited right now; try again in a minute',
  NOT_CONFIGURED: 'the model is not configured',
  TIMEOUT: 'the model call timed out',
  UPSTREAM: 'the job failed',
};
const jobErrorText = (code: string) => JOB_ERROR_TEXT[code] ?? JOB_ERROR_TEXT.UPSTREAM!;

/** The job's code from a thrown value: our LLM_* refusals, the provider's codes, else UPSTREAM. */
function jobErrorCode(e: unknown, text: string): string {
  if (text.includes('LLM_DAILY_QUOTA')) return 'LLM_DAILY_QUOTA';
  if (text.includes('LLM_MONTHLY_CAP')) return 'LLM_MONTHLY_CAP';
  return e instanceof ProviderError ? e.code : 'UPSTREAM';
}

/** accept / cancel / tick: a job id and a mode. */
const MAX_BODY = 4 * KB;

/** The chunk list from the plan and the accepted estimate (per_tool carries chunk_rows and rows). */
function chunksOf(job: JobRow): Chunk[] | string {
  const out: Chunk[] = [];
  let no = 0;
  for (const call of job.plan.calls) {
    const spec = toolByName(call.tool);
    if (!spec || spec.kind !== 'list' || !spec.rpc) return `${call.tool} is not a list tool`;
    const per = job.estimate.per_tool.find((p) => p.tool === call.tool);
    if (!per) return `${call.tool} has no estimate row`;
    const args = { ...call.args };
    delete args.limit;
    delete args.offset;
    const problems = validateToolInput(spec, args);
    if (problems.length) return `${call.tool}: ${problems.join('; ')}`;
    const limit = Math.min(per.chunk_rows, LIST_ROW_CAP);
    for (let offset = 0; offset < per.rows; offset += limit) {
      no++;
      out.push({ no, spec, args, offset, limit: Math.min(limit, per.rows - offset) });
    }
  }
  return out;
}

async function readChunk(asOwner: SupabaseClient, chunk: Chunk, handles: HandleTable, tz: string, lang: Lang): Promise<Cleaned> {
  const { data, error } = await asOwner
    .schema('app')
    .rpc('assistant_run_tool', { p_tool: chunk.spec.rpc, p_args: rpcArgs(chunk.spec, { ...chunk.args, limit: chunk.limit, offset: chunk.offset }) });
  if (error) {
    const m = mapPgError(error);
    throw new Error(`${chunk.spec.name} chunk ${chunk.no}: ${m.code}: ${m.message}`);
  }
  const payload = (data as { data?: unknown })?.data;
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const columns = Array.isArray(obj?.columns) ? (obj.columns as string[]) : null;
  return clean(sourceForTool(chunk.spec, columns), payload, { tz, lang, handles, cap: chunk.limit });
}

/** The chunk object the model returned, or a record of what it said instead. */
function parseObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(stripped);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return { value: v };
  } catch {
    return { parse_error: true, text: stripped.slice(0, 2000) };
  }
}

async function venueTimezone(asOwner: SupabaseClient | null, service: SupabaseClient): Promise<string> {
  const client = asOwner ?? service;
  const { data } = await client.from('platform_settings').select('timezone').eq('id', true).maybeSingle();
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === 'string' && tz ? tz : DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Bookkeeping (service)
// ---------------------------------------------------------------------------
class Book {
  /** Progress writes (chunks_done, tokens), one after another in call order; a transition drains it first. */
  private readonly writes = serialQueue((e) => console.error('[assistant-job] progress write failed', errorText(e)));

  /** `provider` is the job's model (the reduce step); `extract` reads the chunks (JOB_EXTRACT_MODEL). */
  constructor(
    readonly service: SupabaseClient,
    readonly provider: Provider,
    readonly extract: Provider = provider,
  ) {}

  /**
   * app.assistant_job_transition (0112). Its patch allowlist is mode,
   * chunks_total, chunks_done, tokens, result, error, batch_id, estimate,
   * message_id; any other key raises INVALID_ARGUMENT and the job never moves.
   * started_at and finished_at are NOT patch keys: the SQL stamps them itself
   * on the first 'running' and on a terminal state. tests/assistant-jobs.test.ts
   * holds every patch below to the allowlist parsed from the migration.
   */
  async transition(id: string, status: Status, patch: Record<string, unknown> = {}): Promise<void> {
    await this.writes.drain(); // no progress patch lands after a state change
    const { error } = await this.service.schema('app').rpc('assistant_job_transition', { p_id: id, p_status: status, p_patch: patch });
    if (error) throw new Error(`assistant_job_transition(${status}): ${error.message}${error.details ? ` (${error.details})` : ''}`);
  }

  async patch(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await this.service.from('assistant_jobs').update(patch).eq('id', id);
    if (error) console.error('[assistant-job] patch failed', id, error.message);
  }

  /**
   * Queue a progress patch. `build` runs when its turn comes, so it reads the
   * latest figures: with chunks in flight together, the stored chunks_done
   * and tokens never step back.
   */
  progress(id: string, build: () => Record<string, unknown>): void {
    void this.writes.push(() => this.patch(id, build()));
  }

  /**
   * The cap check, once per model call. Throws with the LLM_* code; otherwise
   * answers begin()'s standing budget (0207: month_cost_micros,
   * monthly_cap_micros, …), which the live pool reads (pool.ts budgetAllows).
   */
  async begin(): Promise<unknown> {
    const r = await this.service.schema('app').rpc('llm_begin_request');
    if (r.error) throw new Error(r.error.message ?? 'LLM_BUDGET');
    return r.data;
  }

  /** `model` is the model that served THIS call (llm_pricing has a rate per model). */
  async price(u: ProviderUsage, model: string): Promise<number> {
    const { data, error } = await this.service.schema('app').rpc('llm_price_micros', {
      p_model: model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
    });
    if (error) {
      console.error('[assistant-job] llm_price_micros', error.message);
      return 0;
    }
    return Number(data ?? 0);
  }

  async record(u: ProviderUsage, calls: number, model: string): Promise<void> {
    const rec = await this.service.schema('app').rpc('llm_record_usage', {
      p_model: model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
      p_model_calls: calls,
      p_surface: SURFACE,
    });
    if (rec.error) console.error('[assistant-job] usage not recorded', rec.error.message);
  }

  /** Add one model call's usage, priced at `model` (the call's own), to the running spend and queue it onto the job. Answers the call's cost. */
  async account(job: JobRow, spend: Spend, calls: CallRow[], u: ProviderUsage, ms: number, stop_reason: string, model: string): Promise<number> {
    const cost = await this.price(u, model);
    calls.push({ call_no: calls.length + 1, model, usage: u, ms, stop_reason, cost_micros: cost });
    spend.input += u.input;
    spend.cache_write += u.cache_write;
    spend.cache_read += u.cache_read;
    spend.output += u.output;
    spend.cost_micros += cost;
    spend.calls += 1;
    spend.total = spend.input + spend.cache_write + spend.cache_read + spend.output;
    await this.record(u, 1, model);
    this.progress(job.id, () => ({ tokens: { ...spend } }));
    return cost;
  }

  /** Reduce, write the answer into the conversation, finish. */
  async reduce(job: JobRow, objects: unknown[], spend: Spend, calls: CallRow[], handles: HandleTable | null, signal: AbortSignal): Promise<{ message_id: string }> {
    const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
    await this.transition(job.id, 'reducing', { chunks_done: objects.length, tokens: spend });
    await this.begin();
    const turn = await this.provider.stream({
      system: buildReduceSystem(lang),
      tools: [],
      messages: [{ role: 'user', content: buildReducePrompt(job.plan, objects) }],
      maxTokens: REDUCE_MAX_TOKENS,
      effort: 'high',
      onText: () => {},
      onToolStart: () => {},
      signal,
    });
    await this.account(job, spend, calls, turn.usage, turn.ms, turn.stop_reason, this.provider.model);
    const answer = textOf(turn.content) || (turn.stop_reason === 'refusal' ? 'The model declined to write this answer.' : '');
    const gate: GateResult = gateAnswer(answer, numbersIn(JSON.stringify(objects)), numbersIn(job.plan.question));

    // The answer as an ordinary assistant message, at the conversation's next
    // seq: the owner may be chatting meanwhile, so a taken number is re-read
    // and retried (assistant/seq.ts).
    const message_id = crypto.randomUUID();
    const tokens = { ...spend, model: this.provider.model };
    const ins = await insertAtNextSeq({
      maxSeq: async () => {
        const { data, error } = await this.service
          .from('assistant_messages')
          .select('seq')
          .eq('conversation_id', job.conversation_id)
          .order('seq', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return (data as { seq?: number } | null)?.seq ?? 0;
      },
      insert: async (seq) =>
        (
          await this.service.from('assistant_messages').insert({
            id: message_id,
            conversation_id: job.conversation_id,
            seq,
            role: 'assistant',
            content: [{ type: 'text', text: answer }],
            sources: [{ job_id: job.id, chunks: objects.length, rows: job.estimate.rows }],
            gate,
            tokens,
          })
        ).error,
    });
    if (ins.error) throw new Error(`answer not stored: ${ins.error.message}`);
    if (calls.length) {
      const rows = calls.map((c) => ({
        message_id,
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
      const r = await this.service.from('assistant_calls').insert(rows);
      if (r.error) console.error('[assistant-job] calls not stored', r.error.message);
    }
    const convPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (handles) convPatch.handles = toJson(handles);
    const conv = await this.service.from('assistant_conversations').update(convPatch).eq('id', job.conversation_id);
    if (conv.error) logError('assistant-job', conv.error, `conversation ${job.conversation_id} not updated after job ${job.id}`);

    // finished_at is stamped by the SQL on the terminal state (0112), never patched.
    await this.transition(job.id, 'done', {
      chunks_done: objects.length,
      tokens: spend,
      result: { message_id, answer, gate, objects: objects.length },
    });
    return { message_id };
  }

  /** `error` is what the owner reads on the job (JobProgress.tsx): a code and our sentence, never raw text. */
  async fail(job: JobRow, error: string, spend: Spend): Promise<void> {
    try {
      await this.transition(job.id, 'failed', { error: error.slice(0, 1000), tokens: spend });
    } catch (e) {
      console.error('[assistant-job] fail transition', errorText(e));
    }
  }
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------
async function runLive(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number) {
  const spend: Spend = { ...zeroSpend(), model: book.provider.model, extract_model: book.extract.model };
  const calls: CallRow[] = [];
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  let finished = 0;
  // The clock (pool.ts liveClock): no launch after launchBy, and extraction
  // streams are cut at extractBy on their own signal, both before the request's
  // abort at WALL_MS, so a chunk launched in time can finish and the reduce has
  // its time; a chunk cut by the clock counts as not done (the TIMEOUT below).
  const clock = liveClock(started, WALL_MS);
  const cut = new AbortController();
  const cutTimer = setTimeout(() => cut.abort(), Math.max(0, clock.extractBy - Date.now()));
  const extractSignal = AbortSignal.any([signal, cut.signal]);
  // The monthly cap with chunks in flight (pool.ts budgetAllows): begin()'s
  // month-to-date figure misses this job's calls still running, so each is
  // counted at one extraction call's high-band price, or the dearest chunk seen.
  const per = extractCallTokens(job.estimate);
  let perCallMicros = await book.price({ input: per.input, cache_write: 0, cache_read: per.cache_read, output: per.output }, book.extract.model);
  let unrecorded = 0; // calls of this job past begin() and not yet recorded
  let recorded = 0; // calls recorded so far (a reading taken before one was recorded misses it)
  let overBudget = false;
  // JOB_LIVE_CONCURRENCY chunks in flight; launches stop at the cutoff, over
  // the estimate or at the cap, and in-flight chunks finish and are kept
  // (their usage is spent).
  const pool = await runPool({
    items: chunks,
    concurrency: JOB_LIVE_CONCURRENCY,
    shouldStop: () =>
      overBudget ? 'budget' : Date.now() >= clock.launchBy ? 'wall' : isOverEstimate(spend.total, job.estimate) ? 'over_estimate' : null,
    run: async (chunk) => {
      const recordedAtBegin = recorded;
      const reading = await book.begin();
      if (!budgetAllows(reading, unrecorded + (recorded - recordedAtBegin), perCallMicros)) {
        overBudget = true;
        return null;
      }
      unrecorded++;
      let accounted = false;
      try {
        const cleaned = await readChunk(asOwner, chunk, handles, tz, lang);
        const turn = await book.extract.stream({
          system: buildJobSystem(),
          tools: [],
          messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, chunks.length, cleaned) }],
          maxTokens: CHUNK_MAX_TOKENS,
          effort: 'low',
          onText: () => {},
          onToolStart: () => {},
          signal: extractSignal,
        });
        const cost = await book.account(job, spend, calls, turn.usage, turn.ms, turn.stop_reason, book.extract.model);
        accounted = true;
        unrecorded--;
        recorded++;
        perCallMicros = Math.max(perCallMicros, cost);
        finished++;
        book.progress(job.id, () => ({ chunks_done: finished }));
        return { ...parseObject(textOf(turn.content)), chunk: chunk.no, tool: chunk.spec.name, rows_read: cleaned.stats.rows_out };
      } catch (e) {
        if (!accounted) unrecorded--;
        if (extractSignal.aborted) return null; // cut by the clock: not done, never the generic error
        throw e;
      }
    },
  });
  clearTimeout(cutTimer);
  // In chunk order for the reduce step; with every chunk done they are all here.
  const objects: unknown[] = pool.results.filter((o) => o != null);
  try {
    if (pool.hasError) throw pool.error;
    if (isOverEstimate(spend.total, job.estimate)) {
      await book.transition(job.id, 'over_estimate', { chunks_done: objects.length, tokens: spend, result: { objects } });
      return json({ job_id: job.id, status: 'over_estimate', chunks_done: objects.length, tokens: spend });
    }
    if (overBudget) throw new Error('LLM_MONTHLY_CAP'); // what begin() would have raised on the next chunk
    if (objects.length < chunks.length) {
      await book.fail(job, `TIMEOUT: ${objects.length} of ${chunks.length} chunks done inside the wall clock; re-run as batch`, spend);
      return json({ job_id: job.id, status: 'failed', error: 'TIMEOUT', chunks_done: objects.length });
    }
    const { message_id } = await book.reduce(job, objects, spend, calls, handles, signal);
    return json({ job_id: job.id, status: 'done', message_id, chunks_done: objects.length, tokens: spend });
  } catch (e) {
    const msg = errorText(e);
    const code = jobErrorCode(e, msg);
    logError('assistant-job', msg, `live job ${job.id} failed (${code})`);
    await book.fail(job, `${code}: ${jobErrorText(code)}`, spend);
    return json({ job_id: job.id, status: 'failed', error: code, message: jobErrorText(code), chunks_done: objects.length }, code.startsWith('LLM_') ? 429 : 502);
  }
}

// ---------------------------------------------------------------------------
// Batch path
// ---------------------------------------------------------------------------
async function submitBatch(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string) {
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  const spend = zeroSpend();
  try {
    await book.begin(); // one cap check at submission; the tick records the real usage
    const requests: BatchRequest[] = [];
    for (const chunk of chunks) {
      const cleaned = await readChunk(asOwner, chunk, handles, tz, lang);
      requests.push({
        custom_id: `job:${job.id}:${chunk.no}`,
        system: buildJobSystem(),
        messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, chunks.length, cleaned) }],
        maxTokens: CHUNK_MAX_TOKENS,
        effort: 'low',
      });
    }
    // The extraction model rides in every request; the tick prices the results at it (tokens.extract_model).
    const batch_id = await book.extract.batchCreate(requests);
    await book.patch(job.id, { batch_id, chunks_total: chunks.length, tokens: { ...(job.tokens ?? {}), model: book.provider.model, extract_model: book.extract.model } });
    const conv = await book.service.from('assistant_conversations').update({ handles: toJson(handles), updated_at: new Date().toISOString() }).eq('id', job.conversation_id);
    if (conv.error) logError('assistant-job', conv.error, `conversation ${job.conversation_id} handles not saved for job ${job.id}`);
    return json({ job_id: job.id, status: 'running', mode: 'batch', batch_id, chunks_total: chunks.length });
  } catch (e) {
    const msg = errorText(e);
    // The batch path has always answered 502 with the provider's code (an LLM_* cap included).
    const code = e instanceof ProviderError ? e.code : 'UPSTREAM';
    logError('assistant-job', msg, `batch job ${job.id} not submitted (${code})`);
    const stored = jobErrorCode(e, msg);
    await book.fail(job, `${stored}: ${jobErrorText(stored)}`, spend);
    return json({ job_id: job.id, status: 'failed', error: code, message: jobErrorText(code) }, 502);
  }
}

/**
 * The provider that reads the chunks: JOB_EXTRACT_MODEL, else `fallback`
 * (built from the same key, so it never differs in practice). Batch is a
 * vendor capability (provider.ts) of this provider, since it creates the batch.
 */
function extractProviderOr(fallback: Provider): Provider {
  return providerFromEnv((n) => Deno.env.get(n), JOB_EXTRACT_MODEL) ?? fallback;
}

/** A provider for `model`, else `fallback`. */
function providerOr(model: string | null | undefined, fallback: Provider): Provider {
  return model ? (providerFromEnv((n) => Deno.env.get(n), model) ?? fallback) : fallback;
}

async function tick(book: Book, signal: AbortSignal) {
  const { data, error } = await book.service.from('assistant_jobs').select('*').eq('status', 'running').eq('mode', 'batch').not('batch_id', 'is', null);
  if (error) {
    logError('assistant-job', error, 'tick: running jobs read failed');
    return json({ ok: false, error: 'INTERNAL' });
  }
  const jobs = (data ?? []) as JobRow[];
  const report: Record<string, unknown>[] = [];
  for (const job of jobs) {
    const spend: Spend = { ...zeroSpend(), ...((job.tokens ?? {}) as Partial<Spend>) };
    // 0114: the model the job was accepted on (tokens.model), else the tick's default
    // provider, reduces. The chunks were read by tokens.extract_model; a batch submitted
    // before 2026-10-08 has none and ran on the job's model, so it is priced at that.
    const jobProvider = providerOr(spend.model, book.provider);
    const jb = new Book(book.service, jobProvider, providerOr(spend.extract_model ?? spend.model, jobProvider));
    try {
      // Batch ids are account-wide: the extraction provider (same key) polls and reads it.
      const status = await jb.extract.batchStatus(job.batch_id!);
      await jb.patch(job.id, { chunks_done: status.counts.succeeded + status.counts.errored + status.counts.canceled + status.counts.expired });
      if (!status.ended) {
        report.push({ job_id: job.id, status: status.status, counts: status.counts });
        continue;
      }
      const results = await jb.extract.batchResults(job.batch_id!);
      const total = job.chunks_total ?? results.size;
      const objects: unknown[] = [];
      const calls: CallRow[] = [];
      for (let no = 1; no <= total; no++) {
        const r = results.get(`job:${job.id}:${no}`);
        if (!r) {
          objects.push({ chunk: no, missing: true });
          continue;
        }
        if (!r.ok) {
          objects.push({ chunk: no, error: r.error });
          continue;
        }
        await jb.account(job, spend, calls, r.usage, 0, r.stop_reason, jb.extract.model);
        objects.push({ ...parseObject(textOf(r.content as ContentBlock[])), chunk: no });
      }
      if (isOverEstimate(spend.total, job.estimate)) {
        await jb.transition(job.id, 'over_estimate', { chunks_done: objects.length, tokens: spend, result: { objects } });
        report.push({ job_id: job.id, status: 'over_estimate' });
        continue;
      }
      // The job's model writes the answer (until 2026-10-08 the tick's default provider did).
      const { message_id } = await jb.reduce(job, objects, spend, calls, null, signal);
      report.push({ job_id: job.id, status: 'done', message_id });
    } catch (e) {
      const msg = errorText(e);
      const code = jobErrorCode(e, msg);
      logError('assistant-job', msg, `tick: job ${job.id} failed (${code})`);
      await jb.fail(job, `${code}: ${jobErrorText(code)}`, spend);
      report.push({ job_id: job.id, status: 'failed', error: code });
    }
  }
  return json({ ok: true, jobs: report });
}

// ---------------------------------------------------------------------------
Deno.serve(handle('assistant-job', async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const started = Date.now();
  const service = createServiceClient();

  const read = await readJsonBody<{ action?: string; job_id?: string; mode?: string }>(req, {
    maxBytes: MAX_BODY,
    badJson: () => json({ error: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400),
  });
  if (!read.ok) return read.response;
  const body = read.value;
  const action = body.action;
  if (action !== 'accept' && action !== 'tick' && action !== 'cancel') return json({ error: 'INVALID_REQUEST', message: 'action must be accept, tick or cancel' }, 400);

  const provider = providerFromEnv((n) => Deno.env.get(n));
  const abort = new AbortController();
  const wall = setTimeout(() => abort.abort(), WALL_MS);

  try {
    if (action === 'tick') {
      if (!isServiceRoleRequest(req)) return json({ error: 'forbidden' }, 403);
      if (!provider) return json({ ok: false, error: 'NOT_CONFIGURED' });
      return await tick(new Book(service, provider), abort.signal);
    }

    const auth = await requireStaffRole(req, service, ['owner']);
    if (auth instanceof Response) return auth;
    if (!body.job_id) return json({ error: 'INVALID_REQUEST', message: 'job_id is required' }, 400);

    const { data: jobData, error: jobErr } = await service.from('assistant_jobs').select('*').eq('id', body.job_id).maybeSingle();
    if (jobErr) {
      logError('assistant-job', jobErr, 'job read failed');
      return json({ error: 'INTERNAL' }, 500);
    }
    if (!jobData) return json({ error: 'NOT_FOUND', code: 'NOT_FOUND', message: 'job not found' }, 404);
    const job = jobData as JobRow;
    const { data: conv, error: convErr } = await service.from('assistant_conversations').select('owner_id, handles, model').eq('id', job.conversation_id).maybeSingle();
    if (convErr) {
      logError('assistant-job', convErr, 'conversation read failed');
      return json({ error: 'INTERNAL' }, 500);
    }
    if (!conv || (conv as { owner_id: string }).owner_id !== auth.userId) return json({ error: 'FORBIDDEN', message: 'not your job' }, 403);
    const asOwner = callerClient(req);

    if (action === 'cancel') {
      const { error } = await asOwner.schema('app').rpc('assistant_job_cancel', { p_id: job.id });
      if (error) {
        const refused = pgErrorBody(error, 'assistant-job');
        return json(refused.body, refused.status);
      }
      if (job.batch_id && provider) {
        try {
          // Batch ids are account-wide: the default provider (same key) cancels it, whatever model it runs.
          await provider.batchCancel(job.batch_id);
        } catch (e) {
          console.error('[assistant-job] batch cancel failed', errorText(e));
        }
      }
      return json({ job_id: job.id, status: 'cancelled' });
    }

    // accept
    if (!provider) return json({ error: 'NOT_CONFIGURED', code: 'NOT_CONFIGURED', message: 'ANTHROPIC_API_KEY is not set' }, 503);
    const mode = body.mode === 'live' || body.mode === 'batch' ? body.mode : null;
    if (!mode) return json({ error: 'INVALID_REQUEST', message: "mode must be 'live' or 'batch'" }, 400);
    if (job.status !== 'estimated') return json({ error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: `job is ${job.status}` }, 409);
    if (mode === 'batch' && !extractProviderOr(provider).capabilities.batch) {
      return json({ error: 'INVALID_REQUEST', message: 'batch jobs are not available on this model; run the job live' }, 400);
    }
    if (mode === 'live' && (!job.estimate.modes.live.allowed || job.estimate.chunks > LIVE_MAX_CHUNKS)) {
      return json({ error: 'INVALID_REQUEST', message: job.estimate.modes.live.reason ?? `live jobs run at most ${LIVE_MAX_CHUNKS} chunks; choose batch` }, 400);
    }
    const chunks = chunksOf(job);
    if (typeof chunks === 'string') return json({ error: 'INVALID_REQUEST', message: chunks }, 400);

    // 0114: the job runs on the chat's model, else the chain default (platform_settings,
    // 0207); the tick rebuilds the same provider from tokens.model, stamped below.
    const { data: vs } = await service.from('platform_settings').select('llm_default_model').eq('id', true).maybeSingle();
    const jobModel = (conv as { model?: string | null }).model ?? (vs as { llm_default_model?: string | null } | null)?.llm_default_model ?? null;
    const jobProvider = providerOr(jobModel, provider);
    const book = new Book(service, jobProvider, extractProviderOr(jobProvider));
    await book.transition(job.id, 'accepted', { mode, tokens: { ...(job.tokens ?? {}), model: jobProvider.model } });
    // started_at is stamped by the SQL on the first 'running' (0112), never patched:
    // passing it raised INVALID_ARGUMENT and left the job stuck in 'accepted'.
    await book.transition(job.id, 'running', { chunks_total: chunks.length });
    job.mode = mode;
    job.chunks_total = chunks.length;
    const handles = newHandleTable((conv as { handles: unknown }).handles);
    const tz = await venueTimezone(asOwner, service);

    return mode === 'live' ? await runLive(book, asOwner, job, chunks, handles, tz, abort.signal, started) : await submitBatch(book, asOwner, job, chunks, handles, tz);
  } catch (e) {
    // Logged in full; the owner gets the code and our sentence.
    console.error('[assistant-job] failed', action, errorText(e));
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: jobErrorText('UPSTREAM') }, 502);
  } finally {
    clearTimeout(wall);
  }
}));

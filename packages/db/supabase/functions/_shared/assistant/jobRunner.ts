/**
 * jobRunner.ts — the work of an accepted assistant job (moved out of
 * assistant-job/index.ts on 2026-11-11, as assistant-chat's turn moved to
 * runners.ts / persist.ts / reads.ts on 2026-11-09). assistant-job/index.ts
 * keeps the request: the body, the owner check, the refusal ladder and the
 * wiring (which providers, from the function's env). Everything here takes
 * what it touches as an argument, so tests/assistant-job-runner.test.ts runs
 * it under vitest against a scripted provider and the recording fake client
 * (tests/assistant-edge-fakes.ts):
 *
 *   * Book — the bookkeeping on the service client: transitions (0112's
 *     allowlist), the ordered progress queue, the cap check
 *     (`llm_begin_request`), the price (`llm_price_micros`, else the
 *     TypeScript estimate, never 0), `llm_record_usage`, the reduce step that
 *     writes the answer into the conversation, and the failure;
 *   * chunksOf (the plan and the accepted estimate's per_tool, read by
 *     position) and readChunk (one chunk's rows through the OWNER's client,
 *     `assistant_run_tool`, never the service role);
 *   * runLive (the bounded pool inside the request's clock), submitBatch (one
 *     Batch API request per chunk) and tick (0405's claim, poll, collect,
 *     reduce, release).
 *
 * Deno-only by its imports (npm:@supabase/supabase-js types, provider.ts's
 * ProviderError and textOf), never by Deno.env: a test mocks provider.ts, as
 * for persist.ts. The design notes for the whole function stay in
 * assistant-job/index.ts's header.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, logError, safePgMessage } from '../http.ts';
import { insertAtNextSeq } from './seq.ts';
import { clean, CleanError, sourceForTool, type Cleaned } from './clean.ts';
import { extractCallTokens, isOverEstimate, JOB_LIVE_CONCURRENCY, type JobEstimate, type JobPlan } from './estimate.ts';
import { gateAnswer, numbersIn, type GateResult } from './gate.ts';
import { toJson, type HandleTable } from './handles.ts';
import { budgetAllows, liveClock, runPool, serialQueue } from './pool.ts';
import { buildChunkExtractPrompt, buildJobSystem, buildReducePrompt, buildReduceSystem } from './prompt.ts';
import { ProviderError, textOf, type BatchRequest, type ContentBlock, type Provider, type ProviderUsage } from './provider.ts';
import { LIST_ROW_CAP, rpcArgs, toolByName, validateToolInput, type ToolSpec } from './tools.ts';
import { parseRates, turnEstimateMicros, type ModelRates } from './turnPolicy.ts';

export const WALL_MS = 50_000;
const CHUNK_MAX_TOKENS = 2000;
const REDUCE_MAX_TOKENS = 4000;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant_job';

export type Lang = 'en' | 'ar';
export type Status = 'estimated' | 'accepted' | 'running' | 'reducing' | 'done' | 'failed' | 'cancelled' | 'over_estimate';

export interface JobRow {
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

export interface Chunk {
  no: number;
  spec: ToolSpec;
  args: Record<string, unknown>;
  offset: number;
  limit: number;
}

export interface Spend extends ProviderUsage {
  cost_micros: number;
  calls: number;
  total: number;
  /** The job's model (the reduce step), stamped at accept. */
  model?: string;
  /** The model that read the chunks; absent on a batch submitted before 2026-10-08 (it ran on `model`). */
  extract_model?: string;
}

export interface CallRow {
  call_no: number;
  model: string;
  usage: ProviderUsage;
  ms: number;
  stop_reason: string;
  cost_micros: number;
}

export const zeroSpend = (): Spend => ({ input: 0, cache_write: 0, cache_read: 0, output: 0, cost_micros: 0, calls: 0, total: 0 });

export function errorText(e: unknown): string {
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
export const JOB_ERROR_TEXT: Record<string, string> = {
  LLM_DAILY_QUOTA: 'the daily assistant quota is used up',
  LLM_MONTHLY_CAP: 'the monthly assistant budget is used up',
  RATE_LIMITED: 'the model is rate-limited right now; try again in a minute',
  NOT_CONFIGURED: 'the model is not configured',
  TIMEOUT: 'the model call timed out',
  UPSTREAM: 'the job failed',
};
export const jobErrorText = (code: string) => JOB_ERROR_TEXT[code] ?? JOB_ERROR_TEXT.UPSTREAM!;

/** The job's code from a thrown value: our LLM_* refusals, the provider's codes, else UPSTREAM. */
export function jobErrorCode(e: unknown, text: string): string {
  if (text.includes('LLM_DAILY_QUOTA')) return 'LLM_DAILY_QUOTA';
  if (text.includes('LLM_MONTHLY_CAP')) return 'LLM_MONTHLY_CAP';
  return e instanceof ProviderError ? e.code : 'UPSTREAM';
}

/** The chunk list from the plan and the accepted estimate (per_tool carries chunk_rows and rows). */
export function chunksOf(job: JobRow): Chunk[] | string {
  const out: Chunk[] = [];
  let no = 0;
  for (const [i, call] of job.plan.calls.entries()) {
    const spec = toolByName(call.tool);
    if (!spec || spec.kind !== 'list' || !spec.rpc) return `${call.tool} is not a list tool`;
    // per_tool is built per call in plan order (estimate.ts), so call i reads
    // row i: find() by name handed every call of a repeated tool the FIRST
    // row's figure (review 2026-11-09). The find() stays as the fallback for
    // an estimate stored with fewer rows than calls.
    const byIndex = job.estimate.per_tool[i];
    const per = byIndex?.tool === call.tool ? byIndex : job.estimate.per_tool.find((p) => p.tool === call.tool);
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

export async function readChunk(asOwner: SupabaseClient, chunk: Chunk, handles: HandleTable, tz: string, lang: Lang): Promise<Cleaned> {
  const { data, error } = await asOwner
    .schema('app')
    .rpc('assistant_run_tool', { p_tool: chunk.spec.rpc, p_args: rpcArgs(chunk.spec, { ...chunk.args, limit: chunk.limit, offset: chunk.offset }) });
  // The thrown text reaches only the log today (runLive / submitBatch store a
  // code and our sentence), but it stays our words all the same: safePgMessage
  // logs the raw Postgres text and hands back the code plus a fixed sentence.
  if (error) throw new Error(`${chunk.spec.name} chunk ${chunk.no}: ${safePgMessage(error, 'assistant-job')}`);
  const payload = (data as { data?: unknown })?.data;
  const obj = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  const columns = Array.isArray(obj?.columns) ? (obj.columns as string[]) : null;
  return clean(sourceForTool(chunk.spec, columns), payload, { tz, lang, handles, cap: chunk.limit });
}

/** The chunk object the model returned, or a record of what it said instead. */
export function parseObject(text: string): Record<string, unknown> {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const v = JSON.parse(stripped);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    return { value: v };
  } catch {
    return { parse_error: true, text: stripped.slice(0, 2000) };
  }
}

export async function venueTimezone(asOwner: SupabaseClient | null, service: SupabaseClient): Promise<string> {
  const client = asOwner ?? service;
  const { data, error } = await client.from('platform_settings').select('timezone').eq('id', true).maybeSingle();
  // Not fatal (DEFAULT_TZ, as before), but said: every chunk's times shift with it.
  if (error) logError('assistant-job', error, `platform_settings timezone unread; using ${DEFAULT_TZ}`);
  const tz = (data as { timezone?: string } | null)?.timezone;
  return typeof tz === 'string' && tz ? tz : DEFAULT_TZ;
}

// ---------------------------------------------------------------------------
// Bookkeeping (service)
// ---------------------------------------------------------------------------
export class Book {
  /** Progress writes (chunks_done, tokens), one after another in call order; a transition drains it first. */
  private readonly writes = serialQueue((e) => logError('assistant-job', errorText(e), 'progress write failed'));

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
    if (error) logError('assistant-job', error, `patch of job ${id} failed`);
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
    const n = Number(data);
    if (!error && data !== null && data !== undefined && Number.isFinite(n)) return n;
    logError('assistant-job', error ?? `llm_price_micros answered ${String(data)}`, `${model} priced by the TypeScript estimate`);
    return await this.estimate(u, model);
  }

  /** platform_settings' price list, read once per Book and only when a price read fails. */
  private rates: Promise<{ rates: Record<string, Partial<ModelRates>>; fallback: number }> | null = null;

  /**
   * What a call cost when app.llm_price_micros cannot say: the chat's own
   * TypeScript estimate (turnPolicy turnEstimateMicros, assistant-chat's
   * running total), from the price list, else 0079's blended rate, else
   * FLOOR_RATES (0312 Opus 5.5, the dearer model); an unread list is logged and
   * prices at the floor. Never 0 for a call that spent tokens: price() used to
   * answer 0, so one failed read wrote a free call into assistant_calls and the
   * job's tokens.cost_micros, and a 0 first reading switched off the live
   * pool's in-flight cap allowance (perCallMicros; review 2026-11-09). The
   * monthly cap itself is unaffected: llm_record_usage prices the tokens in SQL.
   */
  private async estimate(u: ProviderUsage, model: string): Promise<number> {
    this.rates ??= (async () => {
      const { data, error } = await this.service.from('platform_settings').select('llm_pricing, llm_cost_micros_per_mtok').eq('id', true).maybeSingle();
      if (error) logError('assistant-job', error, 'platform_settings price list unread; estimating at the floor rates');
      const row = data as { llm_pricing?: unknown; llm_cost_micros_per_mtok?: unknown } | null;
      const fallback = Number(row?.llm_cost_micros_per_mtok);
      return { rates: parseRates(row?.llm_pricing), fallback: Number.isFinite(fallback) && fallback >= 0 ? fallback : 0 };
    })();
    const { rates, fallback } = await this.rates;
    return turnEstimateMicros(model, u, rates, fallback);
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
    if (rec.error) logError('assistant-job', rec.error, 'usage not recorded');
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
      if (r.error) logError('assistant-job', r.error, 'calls not stored');
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
      logError('assistant-job', errorText(e), 'fail transition');
    }
  }
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------
export async function runLive(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number) {
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
export async function submitBatch(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string) {
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
    // One code for the answer and the stored job, and the live path's status
    // rule: at the cap the owner used to read "the job failed" (UPSTREAM, 502)
    // while the job row said the budget was used up (2026-11-11).
    const code = jobErrorCode(e, msg);
    logError('assistant-job', msg, `batch job ${job.id} not submitted (${code})`);
    await book.fail(job, `${code}: ${jobErrorText(code)}`, spend);
    return json({ job_id: job.id, status: 'failed', error: code, message: jobErrorText(code) }, code.startsWith('LLM_') ? 429 : 502);
  }
}

/**
 * The tick's lease on a job, in seconds (0405 app.assistant_job_claim_tick).
 * It outlasts this request's WALL_MS abort, so a job is never worked by two
 * ticks at once; a tick that dies leaves it to lapse and the job is retried.
 */
export const TICK_CLAIM_SECONDS = 120;

/**
 * Clears this tick's own claim (matched on the stamp the claim handed back,
 * so a lapsed claim another tick has since taken stays theirs), letting the
 * next minute poll a batch still in flight. A job that left 'running' keeps
 * its stamp: harmless, every reader filters on status first (0405 header).
 */
export async function releaseClaim(service: SupabaseClient, jobId: string, claimedUntil: string): Promise<void> {
  const { error } = await service.from('assistant_jobs').update({ tick_claimed_until: null }).eq('id', jobId).eq('tick_claimed_until', claimedUntil);
  // Not fatal: the claim lapses on its own after TICK_CLAIM_SECONDS.
  if (error) logError('assistant-job', error, `tick: claim on job ${jobId} not released`);
}

/**
 * The provider for a job's stored model, else `fallback` (assistant-job's
 * providerOr, which builds it from the function's env); injected so the tick
 * runs under vitest with a scripted provider.
 */
export type ProviderFor = (model: string | null | undefined, fallback: Provider) => Provider;

export async function tick(book: Book, signal: AbortSignal, providerOr: ProviderFor) {
  // 0405: claim first. Two overlapping ticks used to work the same batch job,
  // record every chunk's usage twice (assistant_calls rows and the monthly
  // spend doubled) and race the reducing / failed transitions (review
  // 2026-11-09). The claim takes 0113's predicate (running, batch, batch_id
  // set) FOR UPDATE SKIP LOCKED; only the jobs it hands back are worked.
  const claim = await book.service.schema('app').rpc('assistant_job_claim_tick', { p_seconds: TICK_CLAIM_SECONDS });
  if (claim.error) {
    logError('assistant-job', claim.error, 'tick: claim failed');
    return json({ ok: false, error: 'INTERNAL', code: 'INTERNAL' });
  }
  const claimed = new Map(((claim.data ?? []) as { job_id: string; claimed_until: string }[]).map((c) => [c.job_id, c.claimed_until]));
  if (claimed.size === 0) return json({ ok: true, jobs: [] }); // nothing due, or another tick holds it
  // Re-read with the predicate: an owner's cancel may have landed between the claim and this read.
  const { data, error } = await book.service.from('assistant_jobs').select('*').in('id', [...claimed.keys()]).eq('status', 'running').eq('mode', 'batch').not('batch_id', 'is', null);
  if (error) {
    logError('assistant-job', error, 'tick: running jobs read failed');
    return json({ ok: false, error: 'INTERNAL', code: 'INTERNAL' });
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
        await releaseClaim(jb.service, job.id, claimed.get(job.id)!); // still in flight: the next minute polls it
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

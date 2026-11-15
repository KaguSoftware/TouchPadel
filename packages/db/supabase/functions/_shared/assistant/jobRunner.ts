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
 *     reduce, release);
 *   * since 0423 (2026-11-12): resumeJob (a paused job continues from the
 *     chunks it already paid for, in the background by default) and sweep (the
 *     tick settles stuck jobs first: fails, pauses or finishes them, cancels a
 *     vendor batch still billing, no model call).
 *
 * Paid work is not thrown away (review 2026-11-11): a job starts only when
 * its high-band estimate fits what is left of the month; once every chunk is
 * read the reduce runs past the estimate × 1.25 and past the cap; a transient
 * tick failure leaves the batch job running for the next minute, with its
 * collected results saved on the row so nothing is read or recorded twice; a
 * job that fails for good cancels a batch still running and leaves a failed
 * message in the chat; cut calls are metered and usage records retried once.
 * Since 0423 a live job that stops with chunks unread and objects paid for
 * pauses instead of failing, a reduce try is counted before it is made, a
 * cancel stops a live run between chunks and before its reduce, and an answer
 * already in the chat is never followed by a failed message.
 *
 * Deno-only by its imports (npm:@supabase/supabase-js types, provider.ts's
 * ProviderError and textOf), never by Deno.env: a test mocks provider.ts, as
 * for persist.ts. The design notes for the whole function stay in
 * assistant-job/index.ts's header.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json, logError, safePgMessage } from '../http.ts';
import { insertAtNextSeq } from './seq.ts';
import { assistantEvent, reportInBackground, type Report } from './monitor.ts';
import { clean, CleanError, sourceForTool, type Cleaned } from './clean.ts';
import {
  extractCallTokens,
  isOverEstimate,
  JOB_LIVE_CONCURRENCY,
  LIVE_MAX_CHUNKS,
  restEstimate,
  resumeCeiling,
  type JobEstimate,
  type JobPlan,
  type RestEstimate,
  type ResumeRecord,
  type TokenBreakdown,
} from './estimate.ts';
import { gateAnswer, numbersIn, type GateResult } from './gate.ts';
import { toJson, type HandleTable } from './handles.ts';
import { budgetAllows, budgetFits, JOB_WALL_MS, liveClock, runPool, serialQueue } from './pool.ts';
import { buildChunkExtractPrompt, buildJobSystem, buildReducePrompt, buildReduceSystem } from './prompt.ts';
import { ProviderError, textOf, type BatchRequest, type ContentBlock, type Provider, type ProviderTurn, type ProviderUsage } from './provider.ts';
import { LIST_ROW_CAP, rpcArgs, toolByName, validateToolInput, type ToolSpec } from './tools.ts';
import { partialCallOf } from './turn.ts';
import { parseRates, turnEstimateMicros, type ModelRates } from './turnPolicy.ts';

export const WALL_MS = JOB_WALL_MS;
const CHUNK_MAX_TOKENS = 2000;
const REDUCE_MAX_TOKENS = 4000;
const DEFAULT_TZ = 'Asia/Baghdad';
const SURFACE = 'assistant_job';
/** The pause before the one retry of a usage record (persist.ts RECORD_RETRY_MS, the chat's). */
export const RECORD_RETRY_MS = 750;
/**
 * Reduce calls a batch job may try before it fails for good. A transient
 * failure of the reduce (rate limit, 5xx, the request's clock) leaves the job
 * running for the next tick; each try may bill a cut call, so the tries stop here.
 */
export const REDUCE_ATTEMPTS = 3;
/**
 * The failure codes both clients render for a stored assistant turn
 * (packages/core/src/assistant/outcome.ts TURN_ERROR_CODES; Deno cannot import
 * core; tests/assistant-job-runner.test.ts pins the two lists equal). Any
 * other code is stored as UPSTREAM with the exact code beside it in
 * tokens.job_error.
 */
export const TURN_ERROR_CODES: readonly string[] = ['TIMEOUT', 'UPSTREAM', 'RATE_LIMITED', 'NOT_CONFIGURED', 'LLM_MONTHLY_CAP', 'LLM_DAILY_QUOTA'];

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
  /** 0423: when the job entered its status (the sweeper ages it on this). */
  status_at?: string | null;
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
  // 0423: the sweeper ended a job that stopped making progress (stored on the
  // row; the chat's message carries UPSTREAM, the code both clients render).
  JOB_STALLED: 'the job stopped and was ended',
};
export const jobErrorText = (code: string) => JOB_ERROR_TEXT[code] ?? JOB_ERROR_TEXT.UPSTREAM!;

/** The job's code from a thrown value: our LLM_* refusals, the provider's codes, else UPSTREAM. */
export function jobErrorCode(e: unknown, text: string): string {
  if (text.includes('LLM_DAILY_QUOTA')) return 'LLM_DAILY_QUOTA';
  if (text.includes('LLM_MONTHLY_CAP')) return 'LLM_MONTHLY_CAP';
  return e instanceof ProviderError ? e.code : 'UPSTREAM';
}

/** A step of the tick that spent nothing failed in a way the next minute may not (a save the retry needs). */
export class RetryLater extends Error {}

/**
 * The job left 'running' under this request (the owner cancelled it): stop
 * spending, write nothing more (0423). The cancel itself already ended the job
 * and cancelled a vendor batch.
 */
export class JobGone extends Error {}

/** A transition the state machine refused (0112's INVALID_TRANSITION): a second press, or a cancel that landed first. */
export const isInvalidTransition = (e: unknown): boolean => e instanceof Error && /INVALID_TRANSITION/.test(e.message);

// ---------------------------------------------------------------------------
// Paid work carried between runs (0423)
// ---------------------------------------------------------------------------
/**
 * Why a live job paused with chunks unread. It pauses (status
 * 'over_estimate', the name 0112 gave the one paused state) instead of failing
 * whenever it holds paid objects, so a resume never pays for them again:
 *   over_estimate  spend passed the ceiling (estimate × 1.25, or a resume's);
 *   time           the request's clock stopped the launches;
 *   cap            the monthly budget or the daily quota refused a chunk;
 *   stopped        the sweeper found the request dead with objects saved.
 */
export type PauseReason = 'over_estimate' | 'time' | 'cap' | 'stopped';

/** result.pause on a paused job: what the card prices and the resume continues from. */
export interface Pause {
  reason: PauseReason;
  at: string;
  /** The chunk numbers still unread. */
  chunks_left: number[];
  /** What they and the reduce are expected to cost (estimate.ts restEstimate). */
  rest: RestEstimate;
}

/**
 * What a run inherits from the runs before it: the chunk objects already paid
 * for (each tagged with its `chunk`), the calls that bought them (recorded
 * then, stored as assistant_calls rows with the final message), the pause it
 * came from, and the rest's high-band price for the cap check.
 */
export interface Prior {
  objects: unknown[];
  calls: CallRow[];
  pause: Pause | null;
  micros: number | null;
}

/** The chunk number an object carries, or null. */
export function chunkOf(o: unknown): number | null {
  const n = o && typeof o === 'object' ? Number((o as { chunk?: unknown }).chunk) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The chunk numbers the objects cover. */
export const doneChunks = (objects: readonly unknown[]): Set<number> => new Set(objects.map(chunkOf).filter((n): n is number => n !== null));

/** The objects in chunk order, one per chunk (the first kept). */
export function byChunk(objects: readonly unknown[]): unknown[] {
  const seen = new Set<number>();
  const out: { no: number; o: unknown }[] = [];
  for (const o of objects) {
    const no = chunkOf(o);
    if (no === null || seen.has(no)) continue;
    seen.add(no);
    out.push({ no, o });
  }
  return out.sort((a, b) => a.no - b.no).map((x) => x.o);
}

/** The paid work a job row carries in `result` (a pause, a failure's kept objects, a live run's progress). */
export function priorOf(job: Pick<JobRow, 'result'>): Omit<Prior, 'micros'> {
  const r = job.result && typeof job.result === 'object' && !Array.isArray(job.result) ? (job.result as Record<string, unknown>) : {};
  const objects = Array.isArray(r.objects) ? byChunk(r.objects) : [];
  const calls = Array.isArray(r.calls) ? (r.calls as CallRow[]) : [];
  const p = r.pause as Partial<Pause> | undefined;
  const pause = p && typeof p === 'object' && Array.isArray(p.chunks_left) && p.rest && typeof p.rest === 'object' ? (p as Pause) : null;
  return { objects, calls, pause };
}

/** A job's stored spend as a Spend (tokens holds the counters and the two model names). */
export const spendOf = (job: Pick<JobRow, 'tokens'>): Spend => ({ ...zeroSpend(), ...((job.tokens ?? {}) as Partial<Spend>) });

/**
 * Whether the tick should leave a job running for the next minute rather than
 * fail it. A batch is polled every minute for up to 24 h, so one rate limit,
 * 5xx, dropped connection or timeout must not end it: until 2026-11-12 any throw
 * failed the job for good while the vendor batch ran on, billed and was never
 * collected (review 2026-11-11). A 4xx other than 408/409/429, a bad key, our
 * own refusals and database errors stay terminal.
 */
export function isTransient(e: unknown): boolean {
  if (e instanceof RetryLater) return true;
  if (!(e instanceof ProviderError)) return false;
  if (e.code === 'RATE_LIMITED' || e.code === 'TIMEOUT') return true;
  if (e.code !== 'UPSTREAM') return false;
  // No status: the connection itself failed (the SDK's APIConnectionError, a network error).
  return e.status === undefined || e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500;
}

/** Cancels a vendor batch the job no longer follows, so it stops billing. Never throws. */
async function cancelBatch(provider: Provider, batchId: string, jobId: string): Promise<void> {
  try {
    await provider.batchCancel(batchId);
  } catch (e) {
    logError('assistant-job', errorText(e), `batch ${batchId} of job ${jobId} not cancelled; it may run on and bill`);
  }
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

  /**
   * `provider` is the job's model (the reduce step); `extract` reads the chunks
   * (JOB_EXTRACT_MODEL); `recordRetryMs` is the pause before a failed usage
   * record's one retry (tests pass 0); `report` takes a failed job's
   * Monitoring event (monitor.ts, 2026-11-12; tests pass a recorder).
   */
  constructor(
    readonly service: SupabaseClient,
    readonly provider: Provider,
    readonly extract: Provider = provider,
    readonly recordRetryMs: number = RECORD_RETRY_MS,
    readonly report: Report = reportInBackground,
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

  /** A plain update of the job row (no state change); answers whether it was written. */
  async patch(id: string, patch: Record<string, unknown>): Promise<boolean> {
    const { error } = await this.service.from('assistant_jobs').update(patch).eq('id', id);
    if (error) logError('assistant-job', error, `patch of job ${id} failed`);
    return !error;
  }

  /**
   * Whether the job has left 'running' (0423): the owner cancelled it, or the
   * sweeper ended it. Read before each live chunk and before the reduce, so a
   * cancel stops the spending (the reduce on the job's model is the dearest
   * call). A failed or unreadable read answers false: the job goes on, and the
   * state machine still refuses whatever it writes after a cancel.
   */
  async cancelled(id: string): Promise<boolean> {
    try {
      const { data, error } = await this.service.from('assistant_jobs').select('status').eq('id', id).maybeSingle();
      if (error) {
        logError('assistant-job', error, `status of job ${id} unread; going on`);
        return false;
      }
      const status = data && typeof data === 'object' && !Array.isArray(data) ? (data as { status?: unknown }).status : undefined;
      return typeof status === 'string' && status !== 'running';
    } catch (e) {
      logError('assistant-job', errorText(e), `status of job ${id} unread; going on`);
      return false;
    }
  }

  /**
   * Pause a live job with chunks unread (0423), keeping what is paid for: the
   * objects, the calls not yet stored as assistant_calls rows, and what the rest
   * should cost, priced from what the finished chunks used. No message: the
   * card under the thread shows a paused job until it is resumed or cancelled.
   */
  async pause(job: JobRow, reason: PauseReason, objects: unknown[], calls: CallRow[], spend: Spend, left: number[]): Promise<Pause> {
    const rest = restEstimate(job.estimate, left.length, { chunks: objects.length, used: spend });
    const pause: Pause = { reason, at: new Date().toISOString(), chunks_left: left, rest };
    await this.transition(job.id, 'over_estimate', { chunks_done: objects.length, tokens: spend, result: { objects, calls, pause } });
    return pause;
  }

  /** patch() after the queued progress writes, so an older queued figure never lands over this one. */
  async save(id: string, patch: Record<string, unknown>): Promise<boolean> {
    await this.writes.drain();
    return await this.patch(id, patch);
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

  /**
   * llm_record_usage, retried once after `recordRetryMs` when it fails, as the
   * chat records its spend (persist.ts recordSpend): a lost record lets the
   * month run past the cap unseen. A second failure is logged loudly with the
   * amounts for a reconcile by hand. Never throws; answers whether it landed.
   */
  async record(u: ProviderUsage, calls: number, model: string): Promise<boolean> {
    const args = {
      p_model: model,
      p_input: u.input,
      p_cache_write: u.cache_write,
      p_cache_read: u.cache_read,
      p_output: u.output,
      p_model_calls: calls,
      p_surface: SURFACE,
    };
    const once = async (): Promise<unknown> => {
      try {
        return (await this.service.schema('app').rpc('llm_record_usage', args)).error ?? null;
      } catch (e) {
        return e ?? 'threw';
      }
    };
    const first = await once();
    if (!first) return true;
    logError('assistant-job', first, 'llm_record_usage failed; retrying once');
    await new Promise((r) => setTimeout(r, this.recordRetryMs));
    const second = await once();
    if (!second) return true;
    logError('assistant-job', second, `SPEND NOT RECORDED: llm_record_usage failed twice; reconcile by hand: ${JSON.stringify(args)}`);
    return false;
  }

  /** Price one model call at `model` (the call's own) and add it to the running spend and the call list. Answers its cost. */
  async addCall(spend: Spend, calls: CallRow[], u: ProviderUsage, ms: number, stop_reason: string, model: string): Promise<number> {
    const cost = await this.price(u, model);
    calls.push({ call_no: calls.length + 1, model, usage: u, ms, stop_reason, cost_micros: cost });
    spend.input += u.input;
    spend.cache_write += u.cache_write;
    spend.cache_read += u.cache_read;
    spend.output += u.output;
    spend.cost_micros += cost;
    spend.calls += 1;
    spend.total = spend.input + spend.cache_write + spend.cache_read + spend.output;
    return cost;
  }

  /** Add one model call's usage, priced at `model` (the call's own), to the running spend and queue it onto the job. Answers the call's cost. */
  async account(job: JobRow, spend: Spend, calls: CallRow[], u: ProviderUsage, ms: number, stop_reason: string, model: string): Promise<number> {
    const cost = await this.addCall(spend, calls, u, ms, stop_reason, model);
    await this.record(u, 1, model);
    this.progress(job.id, () => ({ tokens: { ...spend } }));
    return cost;
  }

  /**
   * A call cut mid-stream is billed for what it had used: provider.ts attaches
   * that usage to the thrown error as `partial`. Metered as the chat meters it
   * (turn.ts recordCutCall): a call with stop reason 'aborted'. The job used to
   * drop it, so a cut chunk or reduce never reached the cap. Never throws;
   * answers whether a call was added.
   */
  async accountCut(job: JobRow, spend: Spend, calls: CallRow[], e: unknown, model: string): Promise<boolean> {
    const partial = partialCallOf(e);
    if (!partial) return false;
    try {
      await this.account(job, spend, calls, partial.usage, partial.ms, 'aborted', model);
      return true;
    } catch (err) {
      logError('assistant-job', errorText(err), `cut call of job ${job.id} not metered`);
      return false;
    }
  }

  /** The whole job at its high band: the chunks at the extraction model, the reduce at the job's (the card's two steps). */
  async jobMicros(estimate: JobEstimate): Promise<number> {
    const asUsage = (t: TokenBreakdown): ProviderUsage => ({ input: t.input, cache_write: 0, cache_read: t.cache_read, output: t.output });
    // An estimate stored before 2026-10-08 has no steps: all of it at the job's model, which only errs high.
    if (!estimate.by_step) return await this.price(asUsage(estimate.tokens_high), this.provider.model);
    return (await this.price(asUsage(estimate.by_step.extract.tokens_high), this.extract.model)) + (await this.price(asUsage(estimate.by_step.reduce.tokens_high), this.provider.model));
  }

  /**
   * Reduce, write the answer into the conversation, finish. Runs only once
   * every chunk is read, so the extraction it reads is already paid for, and
   * one small call that turns it into the owner's answer costs less than
   * throwing it away: begin() is still called (the request is counted) but
   * neither the monthly cap nor the daily quota stops it (review 2026-11-11).
   * The job moves to 'reducing' only after the call answered, so a batch
   * job whose reduce fails transiently is still 'running' for the next tick.
   */
  async reduce(job: JobRow, objects: unknown[], spend: Spend, calls: CallRow[], handles: HandleTable | null, signal: AbortSignal): Promise<{ message_id: string }> {
    const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
    // 0423: a job the owner cancelled meanwhile is not reduced (the call would bill for nothing).
    if (await this.cancelled(job.id)) throw new JobGone(`job ${job.id} left running before its reduce`);
    try {
      await this.begin();
    } catch (e) {
      logError('assistant-job', errorText(e), `job ${job.id}: the reduce runs past the budget check (its extraction is paid for)`);
    }
    let turn: ProviderTurn;
    try {
      turn = await this.provider.stream({
        system: buildReduceSystem(lang),
        tools: [],
        messages: [{ role: 'user', content: buildReducePrompt(job.plan, objects) }],
        maxTokens: REDUCE_MAX_TOKENS,
        effort: 'high',
        onText: () => {},
        onToolStart: () => {},
        signal,
      });
    } catch (e) {
      await this.accountCut(job, spend, calls, e, this.provider.model);
      throw e;
    }
    await this.account(job, spend, calls, turn.usage, turn.ms, turn.stop_reason, this.provider.model);
    const answer = textOf(turn.content) || (turn.stop_reason === 'refusal' ? 'The model declined to write this answer.' : '');
    // No text (the output budget spent before any, say) is not an answer: a
    // failed job, never an empty message stored as done.
    if (!answer.trim()) throw new Error(`the reduce wrote no text (stop_reason ${turn.stop_reason})`);
    const gate: GateResult = gateAnswer(answer, numbersIn(JSON.stringify(objects)), numbersIn(job.plan.question));
    await this.transition(job.id, 'reducing', { chunks_done: objects.length, tokens: spend });

    // The answer as an ordinary assistant message, at the conversation's next
    // seq: the owner may be chatting meanwhile, so a taken number is re-read
    // and retried (assistant/seq.ts). stop_reason as the chat stores it
    // (persist.ts): max_tokens is drawn as cut short on both clients.
    const message_id = crypto.randomUUID();
    const tokens = { ...spend, model: this.provider.model, stop_reason: turn.stop_reason };
    const ins = await this.insertMessage(job, message_id, [{ type: 'text', text: answer }], [{ job_id: job.id, chunks: objects.length, rows: job.estimate.rows }], gate, tokens);
    if (ins) throw new Error(`answer not stored: ${ins.message}`);
    // The answer is in the chat from here on: nothing below may turn it into a
    // failure, which wrote a second, failed message under it (review
    // 2026-11-12). A done transition that does not land leaves the job
    // 'reducing'; the sweeper's stalled_reduce finds this answer and finishes it.
    try {
      await this.storeCalls(message_id, calls);
      const convPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (handles) convPatch.handles = toJson(handles);
      const conv = await this.service.from('assistant_conversations').update(convPatch).eq('id', job.conversation_id);
      if (conv.error) logError('assistant-job', conv.error, `conversation ${job.conversation_id} not updated after job ${job.id}`);

      // finished_at is stamped by the SQL on the terminal state (0112), never patched.
      await this.transition(job.id, 'done', {
        chunks_done: objects.length,
        tokens: spend,
        result: { message_id, answer, gate, objects: objects.length, stop_reason: turn.stop_reason },
      });
    } catch (e) {
      logError('assistant-job', errorText(e), `job ${job.id}: answer ${message_id} stored but the job not marked done; the sweeper finishes it`);
    }
    return { message_id };
  }

  /** An assistant message at the conversation's next seq; answers the insert's error, or null. */
  private async insertMessage(job: JobRow, id: string, content: unknown[], sources: unknown[], gate: GateResult | null, tokens: Record<string, unknown>): Promise<{ message: string } | null> {
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
            id,
            conversation_id: job.conversation_id,
            seq,
            role: 'assistant',
            content,
            sources,
            gate,
            tokens,
          })
        ).error,
    });
    return ins.error ? { message: ins.error.message ?? 'insert failed' } : null;
  }

  /** One assistant_calls row per model call, against the message that carries them. */
  private async storeCalls(message_id: string, calls: CallRow[]): Promise<void> {
    if (!calls.length) return;
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

  /**
   * `error` is what the owner reads on the job (JobProgress.tsx): a code and
   * our sentence, never raw text. `kept` goes into the job's result (the
   * objects already paid for), else the result stays as it was. Once the job
   * is failed, a failed assistant message goes into the conversation, so an
   * owner who closed the app finds the outcome in the chat: the chat's shape
   * for a failed turn (persist.ts), one empty text block with
   * tokens.error_code and stop_reason, which both clients draw as an error
   * (outcome.ts turnOutcome), carrying the calls this run spent. No model call.
   */
  async fail(job: JobRow, error: string, spend: Spend, o: { calls?: CallRow[]; done?: number; kept?: Record<string, unknown> | null; step?: string } = {}): Promise<void> {
    try {
      await this.transition(job.id, 'failed', { error: error.slice(0, 1000), tokens: spend, result: o.kept ?? job.result ?? null });
    } catch (e) {
      // Not failed by us (cancelled meanwhile, say): no message for it either.
      logError('assistant-job', errorText(e), 'fail transition');
      return;
    }
    const code = /^([A-Z_]+):/.exec(error)?.[1] ?? 'UPSTREAM';
    const shown = TURN_ERROR_CODES.includes(code) ? code : 'UPSTREAM';
    // 2026-11-12: the failure on the Monitoring page, in the background (no
    // wait, never throws): TIMEOUT warn, LLM_* info, else error (monitor.ts).
    try {
      this.report(
        assistantEvent({
          fn: 'assistant-job',
          kind: 'assistant_job_failed',
          what: 'job failed',
          code,
          // step: the sweeper's reason (0423), absent on every other failure.
          detail: { jobId: job.id, conversationId: job.conversation_id, model: this.provider.model, status: 'failed', step: o.step },
        }),
      );
    } catch {
      // Reporting never changes how the job ends.
    }
    const message_id = crypto.randomUUID();
    const tokens = { ...spend, model: this.provider.model, stop_reason: shown, error_code: shown, job_error: code };
    try {
      const ins = await this.insertMessage(job, message_id, [{ type: 'text', text: '' }], [{ job_id: job.id, chunks: o.done ?? 0, rows: job.estimate.rows }], null, tokens);
      if (ins) {
        logError('assistant-job', ins.message, `failure message of job ${job.id} not stored`);
        return;
      }
      await this.storeCalls(message_id, o.calls ?? []);
      const conv = await this.service.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', job.conversation_id);
      if (conv.error) logError('assistant-job', conv.error, `conversation ${job.conversation_id} not updated after failed job ${job.id}`);
    } catch (e) {
      logError('assistant-job', errorText(e), `failure message of job ${job.id} not stored`);
    }
  }
}

// ---------------------------------------------------------------------------
// Live path
// ---------------------------------------------------------------------------
/**
 * `chunks` are the chunks this run reads: all of them on accept, the ones still
 * unread on a resume (0423), whose `prior` carries the objects, calls and spend
 * already paid for, and the rest's high-band price for the cap.
 */
export async function runLive(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number, prior: Prior | null = null) {
  const spend: Spend = prior
    ? { ...spendOf(job), model: book.provider.model, extract_model: book.extract.model }
    : { ...zeroSpend(), model: book.provider.model, extract_model: book.extract.model };
  const calls: CallRow[] = prior ? [...prior.calls] : [];
  const earlier: unknown[] = prior ? prior.objects : [];
  // "chunk N of M" names the whole job, whichever part this run reads.
  const total = Math.max(job.chunks_total ?? 0, earlier.length + chunks.length);
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  let finished = 0;
  const got: unknown[] = [];
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
  // The refusal that stopped the launches: begin()'s own code (the daily quota
  // or the cap), else the cap the in-flight count or the whole-job check found.
  let budgetCode = 'LLM_MONTHLY_CAP';
  let gone = false; // 0423: the owner cancelled meanwhile
  // The whole job against what is left of the month (pool.ts budgetFits), on
  // the first reading begin() hands back: a job that cannot finish under the
  // cap never starts, rather than paying for chunks the cap then strands. A
  // resume checks what is left of the job (prior.micros), not all of it.
  const jobMicros = prior?.micros ?? (await book.jobMicros(job.estimate));
  let fits: boolean | null = null;
  // JOB_LIVE_CONCURRENCY chunks in flight; launches stop at the cutoff, over
  // the estimate or at the cap, and in-flight chunks finish and are kept
  // (their usage is spent).
  const pool = await runPool({
    items: chunks,
    concurrency: JOB_LIVE_CONCURRENCY,
    shouldStop: () =>
      gone ? 'cancelled' : overBudget ? 'budget' : Date.now() >= clock.launchBy ? 'wall' : isOverEstimate(spend.total, job.estimate) ? 'over_estimate' : null,
    run: async (chunk) => {
      // 0423: a cancelled job launches nothing more.
      if (await book.cancelled(job.id)) {
        gone = true;
        return null;
      }
      const recordedAtBegin = recorded;
      let reading: unknown;
      try {
        reading = await book.begin();
      } catch (e) {
        // A budget refusal stops the launches like the in-flight cap does, so
        // the chunks already read are kept (paused below), never thrown away.
        const code = jobErrorCode(e, errorText(e));
        if (!code.startsWith('LLM_')) throw e;
        budgetCode = code;
        overBudget = true;
        return null;
      }
      fits ??= budgetFits(reading, jobMicros);
      if (!fits || !budgetAllows(reading, unrecorded + (recorded - recordedAtBegin), perCallMicros)) {
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
          messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, total, cleaned) }],
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
        const obj = { ...parseObject(textOf(turn.content)), chunk: chunk.no, tool: chunk.spec.name, rows_read: cleaned.stats.rows_out };
        got.push(obj);
        // 0423: the paid objects and their calls ride on every progress write,
        // so a request that dies here leaves them on the row (the sweeper
        // pauses it as 'stopped' and a resume continues from them).
        book.progress(job.id, () => ({ chunks_done: earlier.length + finished, result: { objects: byChunk([...earlier, ...got]), calls: [...calls] } }));
        return obj;
      } catch (e) {
        if (!accounted) {
          unrecorded--;
          // A call cut mid-stream (the clock's cut included) is billed for what it used: metered, then not done.
          if (await book.accountCut(job, spend, calls, e, book.extract.model)) recorded++;
        }
        if (extractSignal.aborted) return null; // cut by the clock: not done, never the generic error
        throw e;
      }
    },
  });
  clearTimeout(cutTimer);
  // In chunk order for the reduce step, the earlier runs' objects included.
  const objects: unknown[] = byChunk([...earlier, ...pool.results.filter((o) => o != null)]);
  // What a failure keeps on the job: the objects already paid for.
  const kept = objects.length ? { objects } : null;
  if (gone) {
    logError('assistant-job', 'cancelled', `live job ${job.id} was cancelled; ${finished} chunks read in this run, nothing more launched`);
    return json({ job_id: job.id, status: 'cancelled', chunks_done: objects.length });
  }
  try {
    if (pool.hasError) throw pool.error;
    const left = chunks.filter((_, i) => pool.results[i] == null).map((c) => c.no);
    if (left.length) {
      // Chunks unread. Every chunk read: the extraction is spent, so the reduce
      // writes the answer even past the ceiling (pausing there stranded paid
      // work, review 2026-11-11). Here the pause is the spending it can still
      // prevent, and since 0423 it is also how a job that ran out of time or
      // budget keeps what it has paid for: Continue reads only the rest.
      const reason: PauseReason | null = isOverEstimate(spend.total, job.estimate) ? 'over_estimate' : objects.length ? (overBudget ? 'cap' : 'time') : null;
      if (reason) {
        await book.pause(job, reason, objects, calls, spend, left);
        return json({ job_id: job.id, status: 'over_estimate', reason, chunks_done: objects.length, tokens: spend });
      }
      // Nothing paid for to keep: ending the job loses nothing.
      if (overBudget) throw new Error(budgetCode); // what begin() raised, or would have on the next chunk
      await book.fail(job, `TIMEOUT: ${objects.length} of ${chunks.length} chunks done inside the wall clock; re-run as batch`, spend, { calls, done: objects.length, kept });
      return json({ job_id: job.id, status: 'failed', error: 'TIMEOUT', chunks_done: objects.length });
    }
    if (isOverEstimate(spend.total, job.estimate)) logError('assistant-job', `spend ${spend.total} tokens`, `live job ${job.id} ran past its estimate × 1.25 with every chunk read; reducing anyway`);
    const { message_id } = await book.reduce(job, objects, spend, calls, handles, signal);
    return json({ job_id: job.id, status: 'done', message_id, chunks_done: objects.length, tokens: spend });
  } catch (e) {
    if (e instanceof JobGone) {
      logError('assistant-job', 'cancelled', `live job ${job.id} was cancelled before its reduce; not reduced`);
      return json({ job_id: job.id, status: 'cancelled', chunks_done: objects.length });
    }
    const msg = errorText(e);
    const code = jobErrorCode(e, msg);
    logError('assistant-job', msg, `live job ${job.id} failed (${code})`);
    await book.fail(job, `${code}: ${jobErrorText(code)}`, spend, { calls, done: objects.length, kept });
    return json({ job_id: job.id, status: 'failed', error: code, message: jobErrorText(code), chunks_done: objects.length }, code.startsWith('LLM_') ? 429 : 502);
  }
}

// ---------------------------------------------------------------------------
// Batch path
// ---------------------------------------------------------------------------
/**
 * One Batch API request per chunk in `chunks` (all of them on accept; the
 * unread ones on a resume, 0423, each keeping its own number in its custom_id
 * so the tick merges them with `prior`'s objects in chunk order).
 */
export async function submitBatch(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, prior: Prior | null = null) {
  const lang: Lang = job.plan.lang === 'ar' ? 'ar' : 'en';
  const spend = zeroSpend();
  const total = Math.max(job.chunks_total ?? 0, (prior?.objects.length ?? 0) + chunks.length);
  let batch_id: string | null = null;
  try {
    const reading = await book.begin(); // one cap check at submission; the tick records the real usage
    // ...and the whole job (on a resume: what is left of it) against what is
    // left of the month (pool.ts budgetFits): begin() alone sent a job far
    // larger than the rest of the budget whole, to be paid for in full (review 2026-11-11).
    if (!budgetFits(reading, prior?.micros ?? (await book.jobMicros(job.estimate)))) throw new Error('LLM_MONTHLY_CAP');
    const requests: BatchRequest[] = [];
    for (const chunk of chunks) {
      const cleaned = await readChunk(asOwner, chunk, handles, tz, lang);
      requests.push({
        custom_id: `job:${job.id}:${chunk.no}`,
        system: buildJobSystem(),
        messages: [{ role: 'user', content: buildChunkExtractPrompt(job.plan, chunk.no, total, cleaned) }],
        maxTokens: CHUNK_MAX_TOKENS,
        effort: 'low',
      });
    }
    // 0423: said on the row before the vendor is asked. A request killed
    // between batchCreate and the id's save leaves a vendor batch nobody can
    // find; the sweeper (stalled_submit) then reports that one may be running.
    const submitting_at = new Date().toISOString();
    if (!(await book.patch(job.id, { result: prior ? { objects: prior.objects, calls: prior.calls, submitting_at } : { submitting_at } }))) {
      logError('assistant-job', 'marker not saved', `job ${job.id}: submitting_at not saved before batchCreate`);
    }
    // The extraction model rides in every request; the tick prices the results at it (tokens.extract_model).
    batch_id = await book.extract.batchCreate(requests);
    // Without its id on the row no tick ever polls or collects the batch, which
    // would run and bill unseen: a failed save cancels it (the catch below).
    if (!(await book.patch(job.id, { batch_id, chunks_total: total, tokens: { ...(job.tokens ?? {}), model: book.provider.model, extract_model: book.extract.model } }))) {
      throw new Error(`batch ${batch_id} not saved on job ${job.id}`);
    }
    const conv = await book.service.from('assistant_conversations').update({ handles: toJson(handles), updated_at: new Date().toISOString() }).eq('id', job.conversation_id);
    if (conv.error) logError('assistant-job', conv.error, `conversation ${job.conversation_id} handles not saved for job ${job.id}`);
    return json({ job_id: job.id, status: 'running', mode: 'batch', batch_id, chunks_total: total });
  } catch (e) {
    const msg = errorText(e);
    // One code for the answer and the stored job, and the live path's status
    // rule: at the cap the owner used to read "the job failed" (UPSTREAM, 502)
    // while the job row said the budget was used up (2026-11-11).
    const code = jobErrorCode(e, msg);
    logError('assistant-job', msg, `batch job ${job.id} not submitted (${code})`);
    if (batch_id) await cancelBatch(book.extract, batch_id, job.id);
    if (prior) {
      // 0423: a resume that could not hand the rest to the vendor goes back to
      // paused with its paid work; nothing was spent, and the owner may press
      // again or cancel.
      try {
        await book.transition(job.id, 'over_estimate', { result: { objects: prior.objects, calls: prior.calls, pause: prior.pause } });
      } catch (t) {
        logError('assistant-job', errorText(t), `job ${job.id}: not returned to paused after a failed resume`);
      }
      return json({ job_id: job.id, status: 'over_estimate', error: code, code, message: jobErrorText(code) }, code.startsWith('LLM_') ? 429 : 503);
    }
    await book.fail(job, `${code}: ${jobErrorText(code)}`, spend);
    return json({ job_id: job.id, status: 'failed', error: code, message: jobErrorText(code) }, code.startsWith('LLM_') ? 429 : 502);
  }
}

// ---------------------------------------------------------------------------
// Resume (0423)
// ---------------------------------------------------------------------------
/**
 * Whether the rows changed since the job was estimated: one `assistant_count`
 * per call, as the owner (no model call), against the accepted per_tool rows.
 * Chunks are offset pages over the rows, so a changed count means the pages
 * the finished chunks read no longer line up with the ones left: the resume is
 * refused rather than counting rows twice or missing some. 'error' when a
 * count cannot be read.
 */
export async function countsChanged(asOwner: SupabaseClient, job: JobRow): Promise<boolean | 'error'> {
  for (const [i, call] of job.plan.calls.entries()) {
    const spec = toolByName(call.tool);
    const byIndex = job.estimate.per_tool[i];
    const per = byIndex?.tool === call.tool ? byIndex : job.estimate.per_tool.find((p) => p.tool === call.tool);
    if (!spec || !per) return 'error';
    const args = { ...call.args };
    delete args.limit;
    delete args.offset;
    const { data, error } = await asOwner.schema('app').rpc('assistant_count', { p_tool: spec.name, p_args: rpcArgs(spec, args) });
    if (error) {
      logError('assistant-job', safePgMessage(error, 'assistant-job'), `resume: ${call.tool} not counted`);
      return 'error';
    }
    if (Number(data ?? 0) !== per.rows) return true;
  }
  return false;
}

export interface ResumeOptions {
  /** The owner's choice, else batch when the vendor has it (cost first), else live. */
  mode: 'live' | 'batch' | null;
  /** The extraction provider can create batches (provider.ts capabilities). */
  batchAvailable: boolean;
}

/**
 * Continue a paused job from the chunks it already paid for (0423). Never
 * re-reads or re-pays a finished chunk: only the chunks whose number no stored
 * object carries are read. Steps, in order: the state (only a paused job), the
 * mode, the rows (countsChanged), the price of the rest, then ONE transition
 * over_estimate → running that records what the owner agreed to (the ceiling
 * for a live run, the rest's price) under the row lock, so a second press or a
 * second device gets 409 before anything is spent. The cap is checked by the
 * path itself (submitBatch's begin() + budgetFits, the live pool's per-chunk
 * begin()), on the rest's price: a refusal leaves the job paused.
 */
export async function resumeJob(book: Book, asOwner: SupabaseClient, job: JobRow, chunks: Chunk[], handles: HandleTable, tz: string, signal: AbortSignal, started: number, o: ResumeOptions): Promise<Response> {
  if (job.status !== 'over_estimate') return json({ error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: `job is ${job.status}` }, 409);
  const prior = priorOf(job);
  const done = doneChunks(prior.objects);
  const left = chunks.filter((c) => !done.has(c.no));
  // Only the reduce left (the sweeper paused a job whose every chunk was read): it runs in this request.
  const mode: 'live' | 'batch' = left.length === 0 ? 'live' : (o.mode ?? (o.batchAvailable ? 'batch' : 'live'));
  if (mode === 'batch' && !o.batchAvailable) {
    return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: 'batch jobs are not available on this model; continue live' }, 400);
  }
  if (mode === 'live' && left.length > LIVE_MAX_CHUNKS) {
    return json({ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST', message: `${left.length} chunks are left; a live run reads at most ${LIVE_MAX_CHUNKS}; continue in the background` }, 400);
  }
  const drift = await countsChanged(asOwner, job);
  if (drift === 'error') return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: jobErrorText('UPSTREAM') }, 502);
  if (drift) return json({ error: 'JOB_DATA_CHANGED', code: 'JOB_DATA_CHANGED', message: 'the records changed since the job paused; ask the question again' }, 409);

  // What the rest costs: the figure the card showed (result.pause.rest) while
  // it still describes the chunks left, else priced afresh the same way.
  const spend = spendOf(job);
  const rest = prior.pause && prior.pause.rest.chunks === left.length ? prior.pause.rest : restEstimate(job.estimate, left.length, { chunks: prior.objects.length, used: spend });
  const asUsage = (t: TokenBreakdown): ProviderUsage => ({ input: t.input, cache_write: 0, cache_read: t.cache_read, output: t.output });
  // At the live price for the cap check, which only errs high for a batch run.
  const micros = (await book.price(asUsage(rest.extract_high), book.extract.model)) + (await book.price(asUsage(rest.reduce_high), book.provider.model));
  const ceiling = resumeCeiling(spend.total, rest);
  const record: ResumeRecord = { at: new Date().toISOString(), mode, chunks_left: left.length, spent_tokens: spend.total, spent_micros: spend.cost_micros, rest_micros_high: micros, ceiling_tokens: ceiling };
  const estimate: JobEstimate = { ...job.estimate, ceiling_tokens: ceiling, resumes: [...(job.estimate.resumes ?? []), record] };
  try {
    await book.transition(job.id, 'running', { mode, estimate, result: { objects: prior.objects, calls: prior.calls } });
  } catch (e) {
    if (isInvalidTransition(e)) return json({ error: 'INVALID_TRANSITION', code: 'INVALID_TRANSITION', message: 'job is no longer paused' }, 409);
    throw e;
  }
  const running: JobRow = { ...job, status: 'running', mode, estimate, result: { objects: prior.objects, calls: prior.calls } };
  const carried: Prior = { ...prior, micros };
  return mode === 'live'
    ? await runLive(book, asOwner, running, left, handles, tz, signal, started, carried)
    : await submitBatch(book, asOwner, running, left, handles, tz, carried);
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

/**
 * An ended batch's results as saved on the job (`result.collected`, a plain
 * patch while the job is still 'running'): the objects for the reduce, the
 * calls already recorded, and the reduce tries so far.
 */
export interface Collected {
  objects: unknown[];
  calls: CallRow[];
  attempts: number;
}

/** The results a previous tick collected and saved, or null. */
export function collectedOf(job: JobRow): Collected | null {
  const c = (job.result as { collected?: Partial<Collected> } | null)?.collected;
  if (!c || !Array.isArray(c.objects) || !Array.isArray(c.calls)) return null;
  return { objects: c.objects, calls: c.calls, attempts: Number(c.attempts) || 0 };
}

/**
 * Reads an ended batch's results once: every succeeded chunk priced at the
 * extraction model, then the objects, calls and spend saved on the job BEFORE
 * a single usage record, then recorded. A tick whose reduce does not finish
 * leaves the job running with these saved, and the next tick reduces from
 * them without reading or recording the batch a second time. A failed save
 * records nothing and is retried (RetryLater). A resumed job (0423) keeps the
 * objects its live part read (result.objects): those chunks were not in the
 * batch, and their calls, recorded then, are already in `calls`.
 */
async function collectBatch(jb: Book, job: JobRow, spend: Spend, calls: CallRow[]): Promise<Collected> {
  const results = await jb.extract.batchResults(job.batch_id!);
  const earlier = new Map(priorOf(job).objects.map((o) => [chunkOf(o)!, o]));
  const total = job.chunks_total ?? results.size + earlier.size;
  const start = calls.length;
  const objects: unknown[] = [];
  for (let no = 1; no <= total; no++) {
    if (earlier.has(no)) {
      objects.push(earlier.get(no));
      continue;
    }
    const r = results.get(`job:${job.id}:${no}`);
    if (!r) {
      objects.push({ chunk: no, missing: true });
      continue;
    }
    if (!r.ok) {
      objects.push({ chunk: no, error: r.error });
      continue;
    }
    await jb.addCall(spend, calls, r.usage, 0, r.stop_reason, jb.extract.model);
    objects.push({ ...parseObject(textOf(r.content as ContentBlock[])), chunk: no });
  }
  const collected: Collected = { objects, calls: [...calls], attempts: 0 };
  if (!(await jb.save(job.id, { chunks_done: objects.length, tokens: { ...spend }, result: { collected } }))) {
    throw new RetryLater(`collected results of job ${job.id} not saved`);
  }
  for (const c of calls.slice(start)) await jb.record(c.usage, 1, c.model);
  return collected;
}

// ---------------------------------------------------------------------------
// The sweeper (0423)
// ---------------------------------------------------------------------------
/** Stuck jobs one tick settles at most (app.assistant_job_claim_stuck p_limit). */
export const SWEEP_LIMIT = 10;

/** app.assistant_job_stuck_reason's answers (0423). */
export type StuckReason = 'stalled_start' | 'stalled_live' | 'stalled_submit' | 'batch_overdue' | 'lease_lapsing' | 'stalled_reduce';

/**
 * The answer a dead reduce already wrote, if any: an assistant message of the
 * job's chat whose sources name the job and that is not a failure. undefined
 * when the read failed (the next minute tries again).
 */
async function storedAnswerOf(service: SupabaseClient, job: JobRow): Promise<string | null | undefined> {
  const { data, error } = await service
    .from('assistant_messages')
    .select('id, tokens')
    .eq('conversation_id', job.conversation_id)
    .eq('role', 'assistant')
    .contains('sources', [{ job_id: job.id }])
    .order('seq', { ascending: false })
    .limit(5);
  if (error) {
    logError('assistant-job', error, `sweep: answers of job ${job.id} unread`);
    return undefined;
  }
  const rows = Array.isArray(data) ? (data as { id: string; tokens?: unknown }[]) : [];
  const ok = rows.find((m) => !(m.tokens && typeof m.tokens === 'object' && 'error_code' in (m.tokens as object)));
  return ok?.id ?? null;
}

/**
 * Settles the stuck jobs app.assistant_job_claim_stuck hands the tick. No
 * model call, ever; a vendor batch still billing is cancelled.
 *
 *   stalled_start   accepted and never ran          → failed (JOB_STALLED)
 *   stalled_live    the live request died           → paused 'stopped' with the
 *                                                     objects its progress saved,
 *                                                     else failed
 *   stalled_submit  the batch submit died           → failed; when it had said
 *                                                     submitting_at, an error event:
 *                                                     a batch may run unrecorded
 *   batch_overdue   past the vendor's 24 h, by 2 h  → batch cancelled, failed
 *   lease_lapsing   three ticks died holding it     → batch cancelled (unless its
 *                                                     results were collected), failed
 *   stalled_reduce  died between reducing and done  → done when its answer is in
 *                                                     the chat, else failed
 *
 * A failure is Book.fail: the row's error is `JOB_STALLED: …` (the operator
 * words it as a job that stopped), the chat's failed message carries UPSTREAM
 * (the code both clients render) with job_error JOB_STALLED, the objects and
 * calls already paid for are kept, and the Monitoring event names the reason
 * (detail.step). A pause or a recovered answer is an assistant_job_swept
 * event. A job whose settling throws is released for the next minute.
 */
export async function sweep(book: Book, providerOr: ProviderFor): Promise<Record<string, unknown>[]> {
  const claim = await book.service.schema('app').rpc('assistant_job_claim_stuck', { p_seconds: TICK_CLAIM_SECONDS, p_limit: SWEEP_LIMIT });
  if (claim.error) {
    logError('assistant-job', claim.error, 'sweep: claim failed');
    return [];
  }
  const claimed = Array.isArray(claim.data) ? (claim.data as { job_id: string; reason: StuckReason; claimed_until: string }[]) : [];
  if (claimed.length === 0) return [];
  const { data, error } = await book.service.from('assistant_jobs').select('*').in('id', claimed.map((c) => c.job_id));
  if (error) {
    logError('assistant-job', error, 'sweep: stuck jobs read failed; their claims lapse');
    return [];
  }
  const rows = new Map(((data ?? []) as JobRow[]).map((j) => [j.id, j]));
  const out: Record<string, unknown>[] = [];
  for (const c of claimed) {
    const job = rows.get(c.job_id);
    if (!job) continue;
    const spend = spendOf(job);
    const jobProvider = providerOr(spend.model, book.provider);
    const jb = new Book(book.service, jobProvider, providerOr(spend.extract_model ?? spend.model, jobProvider), book.recordRetryMs, book.report);
    const collected = collectedOf(job);
    const prior = priorOf(job);
    const objects = collected?.objects ?? prior.objects;
    const calls = collected?.calls ?? prior.calls;
    const age = job.status_at ? Date.now() - Date.parse(job.status_at) : undefined;
    const swept = (step: string, status: string, what: string) => {
      try {
        jb.report(
          assistantEvent({
            fn: 'assistant-job',
            kind: 'assistant_job_swept',
            what,
            code: step === 'batch_unrecorded' ? 'JOB_STALLED' : null,
            detail: { jobId: job.id, conversationId: job.conversation_id, step, status, ms: Number.isFinite(age) ? age : undefined },
          }),
        );
      } catch {
        // Reporting never changes how the job ends.
      }
    };
    try {
      if (c.reason === 'stalled_reduce') {
        const answer = await storedAnswerOf(jb.service, job);
        if (answer === undefined) throw new RetryLater('answer unread');
        if (answer) {
          await jb.transition(job.id, 'done', { result: { message_id: answer, recovered: true, objects: objects.length } });
          swept(c.reason, 'done', 'stuck job finished');
          out.push({ job_id: job.id, swept: c.reason, status: 'done', message_id: answer });
          continue;
        }
      }
      if (c.reason === 'stalled_live' && objects.length) {
        const all = chunksOf(job);
        const done = doneChunks(objects);
        const nos = typeof all === 'string' ? Array.from({ length: Math.max(0, job.chunks_total ?? 0) }, (_, i) => i + 1) : all.map((ch) => ch.no);
        await jb.pause(job, 'stopped', objects, calls, spend, nos.filter((n) => !done.has(n)));
        swept(c.reason, 'paused', 'stuck job paused');
        out.push({ job_id: job.id, swept: c.reason, status: 'over_estimate' });
        continue;
      }
      if (c.reason === 'stalled_submit') {
        const r = job.result as { submitting_at?: unknown } | null;
        // Owner's rule (2026-11-12): no listing of vendor batches; say what is known.
        if (r && typeof r === 'object' && typeof r.submitting_at === 'string') swept('batch_unrecorded', 'failed', 'batch may run unrecorded');
      }
      if ((c.reason === 'batch_overdue' || c.reason === 'lease_lapsing') && job.batch_id && !collected) await cancelBatch(jb.extract, job.batch_id, job.id);
      await jb.fail(job, `JOB_STALLED: ${jobErrorText('JOB_STALLED')}`, spend, { calls, done: objects.length, kept: objects.length ? { objects } : null, step: c.reason });
      out.push({ job_id: job.id, swept: c.reason, status: 'failed' });
    } catch (e) {
      logError('assistant-job', errorText(e), `sweep: job ${job.id} (${c.reason}) not settled; the next minute retries`);
      await releaseClaim(jb.service, job.id, c.claimed_until);
      out.push({ job_id: job.id, swept: c.reason, status: 'retry' });
    }
  }
  return out;
}

export async function tick(book: Book, signal: AbortSignal, providerOr: ProviderFor) {
  // 0423: the stuck jobs first (no model call; a forgotten vendor batch is
  // cancelled). Their leases keep this minute's claim off them.
  const swept = await sweep(book, providerOr);
  const extra = swept.length ? { swept } : {};
  // 0405: claim first. Two overlapping ticks used to work the same batch job,
  // record every chunk's usage twice (assistant_calls rows and the monthly
  // spend doubled) and race the reducing / failed transitions (review
  // 2026-11-09). The claim takes 0113's predicate (running, batch, batch_id
  // set) FOR UPDATE SKIP LOCKED; only the jobs it hands back are worked.
  const claim = await book.service.schema('app').rpc('assistant_job_claim_tick', { p_seconds: TICK_CLAIM_SECONDS });
  if (claim.error) {
    logError('assistant-job', claim.error, 'tick: claim failed');
    return json({ ok: false, error: 'INTERNAL', code: 'INTERNAL', ...extra });
  }
  const claimed = new Map(((claim.data ?? []) as { job_id: string; claimed_until: string }[]).map((c) => [c.job_id, c.claimed_until]));
  if (claimed.size === 0) return json({ ok: true, jobs: [], ...extra }); // nothing due, or another tick holds it
  // Re-read with the predicate: an owner's cancel may have landed between the claim and this read.
  const { data, error } = await book.service.from('assistant_jobs').select('*').in('id', [...claimed.keys()]).eq('status', 'running').eq('mode', 'batch').not('batch_id', 'is', null);
  if (error) {
    logError('assistant-job', error, 'tick: running jobs read failed');
    return json({ ok: false, error: 'INTERNAL', code: 'INTERNAL', ...extra });
  }
  const jobs = (data ?? []) as JobRow[];
  const report: Record<string, unknown>[] = [];
  for (const job of jobs) {
    const spend: Spend = spendOf(job);
    // 0114: the model the job was accepted on (tokens.model), else the tick's default
    // provider, reduces. The chunks were read by tokens.extract_model; a batch submitted
    // before 2026-10-08 has none and ran on the job's model, so it is priced at that.
    const jobProvider = providerOr(spend.model, book.provider);
    const jb = new Book(book.service, jobProvider, providerOr(spend.extract_model ?? spend.model, jobProvider), book.recordRetryMs, book.report);
    // The request's clock has run out (an earlier job's reduce took it): the next minute starts this one whole.
    if (signal.aborted) {
      await releaseClaim(jb.service, job.id, claimed.get(job.id)!);
      report.push({ job_id: job.id, status: 'retry', error: 'TIMEOUT' });
      continue;
    }
    let collected = collectedOf(job);
    // A resumed job's live part (0423): its calls were recorded when they ran;
    // they ride along to the answer's assistant_calls rows.
    const earlier = collected ? null : priorOf(job);
    const calls: CallRow[] = collected ? [...collected.calls] : [...(earlier?.calls ?? [])];
    let ended = collected !== null;
    let reducing = false;
    try {
      if (!collected) {
        // Batch ids are account-wide: the extraction provider (same key) polls and reads it.
        const status = await jb.extract.batchStatus(job.batch_id!);
        await jb.patch(job.id, { chunks_done: (earlier?.objects.length ?? 0) + status.counts.succeeded + status.counts.errored + status.counts.canceled + status.counts.expired });
        if (!status.ended) {
          await releaseClaim(jb.service, job.id, claimed.get(job.id)!); // still in flight: the next minute polls it
          report.push({ job_id: job.id, status: status.status, counts: status.counts });
          continue;
        }
        ended = true;
        if (status.counts.succeeded === 0 && !earlier?.objects.length) {
          // Nothing came back (expired or errored whole): failed without a reduce call over nothing.
          logError('assistant-job', JSON.stringify(status.counts), `tick: batch of job ${job.id} ended with no result`);
          await jb.fail(job, `UPSTREAM: ${jobErrorText('UPSTREAM')}`, spend, { calls });
          report.push({ job_id: job.id, status: 'failed', error: 'UPSTREAM' });
          continue;
        }
        collected = await collectBatch(jb, job, spend, calls);
      }
      // A reduce try is counted BEFORE it is made (review 2026-11-12): counted
      // after, a tick killed during a billed reduce left the count where it was,
      // and the next tick billed it again, without limit. The tries stop here.
      if (collected.attempts >= REDUCE_ATTEMPTS) throw new Error(`the reduce was tried ${collected.attempts} times`);
      const attempts = collected.attempts + 1;
      if (!(await jb.save(job.id, { tokens: { ...spend }, result: { collected: { ...collected, calls, attempts } } }))) {
        throw new RetryLater(`reduce try of job ${job.id} not counted`);
      }
      collected = { ...collected, attempts };
      // Every chunk is collected, so the extraction is spent: the reduce writes
      // the answer even past the estimate × 1.25. Pausing in over_estimate here
      // stranded work already paid for, with no way to resume it (review 2026-11-11).
      if (isOverEstimate(spend.total, job.estimate)) logError('assistant-job', `spend ${spend.total} tokens`, `tick: job ${job.id} ran past its estimate × 1.25; reducing anyway`);
      reducing = true;
      // The job's model writes the answer (until 2026-10-08 the tick's default provider did).
      const { message_id } = await jb.reduce(job, collected.objects, spend, calls, null, signal);
      report.push({ job_id: job.id, status: 'done', message_id });
    } catch (e) {
      if (e instanceof JobGone) {
        // Cancelled meanwhile (the cancel cancelled the batch): nothing more is written.
        report.push({ job_id: job.id, status: 'cancelled' });
        continue;
      }
      const msg = errorText(e);
      const code = jobErrorCode(e, msg);
      const attempts = collected?.attempts ?? 0;
      if (isTransient(e) && attempts < REDUCE_ATTEMPTS) {
        // Left running for the next minute, with the reduce's try (and any cut call) saved beside the results.
        if (collected && reducing) await jb.save(job.id, { tokens: { ...spend }, result: { collected: { ...collected, calls, attempts } } });
        logError('assistant-job', msg, `tick: job ${job.id} deferred (${code}); the next tick retries`);
        await releaseClaim(jb.service, job.id, claimed.get(job.id)!);
        report.push({ job_id: job.id, status: 'retry', error: code });
        continue;
      }
      logError('assistant-job', msg, `tick: job ${job.id} failed (${code})`);
      await jb.fail(job, `${code}: ${jobErrorText(code)}`, spend, { calls, done: collected?.objects.length ?? 0, kept: collected ? { objects: collected.objects } : null });
      // A batch still running would bill on for a job nobody follows any more.
      if (!ended) await cancelBatch(jb.extract, job.batch_id!, job.id);
      report.push({ job_id: job.id, status: 'failed', error: code });
    }
  }
  return json({ ok: true, jobs: report, ...extra });
}

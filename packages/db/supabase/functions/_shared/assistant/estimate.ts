/**
 * Job estimator (plan §6.2, contracts "estimate.ts"). Deterministic, no model
 * in the loop: exact row counts from `app.assistant_count`, shaped tokens per
 * row from the catalog, four named constants for the fixed parts. The card
 * shows the multiplication and the same +15 %; `first_chunk_exact` is filled
 * in by the edge function from `count_tokens` when a key is present.
 *
 * Since the cheaper-jobs pass (2026-10-08): chunk extraction (live and batch)
 * runs on JOB_EXTRACT_MODEL, Sonnet 5.5, because pulling counts and sums out of
 * one chunk is mechanical; the reduce step stays on the job's own model (the
 * chat's, it writes the owner's answer). `by_step` splits the same token
 * figures by step so the card prices each step at its own model's rates;
 * `tokens` / `tokens_high` stay the sums, so older readers and the
 * over-estimate pause (token totals, model-blind) are unchanged.
 *
 * Pure: imports only the catalog and pool.ts's clock constants.
 */
import { JOB_WALL_MS, liveChunkCapacity } from './pool.ts';
import { TOKENS_PER_ROW_FALLBACK, type ToolSpec } from './tools.ts';

/** Fixed prompt around one chunk's rows (system + extraction instruction). */
export const CHUNK_PROMPT_TOKENS = 1200;
/** The structured object one chunk returns. */
export const CHUNK_OUTPUT_TOKENS = 400;
/** The reduce step's instruction. */
export const REDUCE_PROMPT_TOKENS = 800;
/** The final answer the reduce step writes into the chat. */
export const REDUCE_OUTPUT_TOKENS = 1500;
/** One aggregate tool call read by the model, prompt and answer (the "aggregate first" way). */
export const AGGREGATE_CALL_TOKENS = 2000;
/**
 * The model every chunk extraction runs on, live and batch (owner rule
 * 0307/0312: only claude-opus-5-5 and claude-sonnet-5-5). The reduce step is
 * not here: it runs on the job's model, which this pure estimator never sees.
 */
export const JOB_EXTRACT_MODEL = 'claude-sonnet-5-5';
/** Live chunks in flight at once (assistant-job runLive, _shared/assistant/pool.ts). */
export const JOB_LIVE_CONCURRENCY = 4;
/**
 * Live jobs must finish inside the edge function's wall clock (§4.3): at most
 * this many chunks, the count the runner's own clock is sure to finish
 * (pool.ts liveChunkCapacity, 8 today). It was a flat 40, five times what the
 * 23 s launch window holds, so a big live job ended in TIMEOUT (review 2026-11-11).
 */
export const LIVE_MAX_CHUNKS = liveChunkCapacity(JOB_WALL_MS, JOB_LIVE_CONCURRENCY);
/** The range shown on the card: the multiplication, and the same +15 %. */
export const HIGH_BAND = 1.15;
/** Rows per chunk when a list tool has no `chunk_rows` in the catalog. */
export const DEFAULT_CHUNK_ROWS = 250;

export interface JobCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface JobPlan {
  question: string;
  calls: JobCall[];
  extract?: string;
  reduce?: string;
  aggregate_alternative?: { calls: JobCall[] } | null;
}

export interface TokenBreakdown {
  input: number;
  cache_read: number;
  output: number;
  total: number;
}

/** One step of a job priced at one model. `model: null` is the job's own model (the chat's). */
export interface EstimateStep {
  model: string | null;
  tokens: TokenBreakdown;
  tokens_high: TokenBreakdown;
}

export interface JobEstimate {
  job_id: string;
  rows: number;
  chunks: number;
  per_tool: { tool: string; rows: number; chunk_rows: number; tokens_per_row: number; measured: boolean }[];
  tokens: TokenBreakdown;
  tokens_high: TokenBreakdown;
  /**
   * The same tokens by step: `extract` on JOB_EXTRACT_MODEL, `reduce` on the
   * job's model (null). `tokens` is their sum. Absent on estimates stored
   * before 2026-10-08; a reader then prices `tokens` at the chat's model.
   */
  by_step?: { extract: EstimateStep & { model: string }; reduce: EstimateStep & { model: null } };
  modes: {
    aggregate: { calls: JobCall[]; tokens_est: number } | null;
    live: { allowed: boolean; reason?: string };
    batch: { allowed: boolean; reason?: string };
  };
  assumptions: string[];
  first_chunk_exact: number | null;
  /**
   * 0423: the token total a resumed job pauses at (the owner agreed to the rest
   * when they pressed Continue); absent until the first resume, when the
   * ceiling is `tokens.total` × OVER_ESTIMATE_FACTOR (ceilingTokens).
   */
  ceiling_tokens?: number;
  /** 0423: one entry per resume, what the owner saw when they pressed. */
  resumes?: ResumeRecord[];
}

/** What a resume recorded on the estimate (assistant-job resumeJob). */
export interface ResumeRecord {
  at: string;
  mode: 'live' | 'batch';
  chunks_left: number;
  spent_tokens: number;
  spent_micros: number;
  rest_micros_high: number;
  ceiling_tokens: number;
}

export type EstimateBody = Omit<JobEstimate, 'job_id' | 'first_chunk_exact'>;

const sumOf = (a: TokenBreakdown, b: TokenBreakdown): TokenBreakdown => {
  const input = a.input + b.input;
  const cache_read = a.cache_read + b.cache_read;
  const output = a.output + b.output;
  return { input, cache_read, output, total: input + cache_read + output };
};

function band(t: TokenBreakdown): TokenBreakdown {
  const up = (n: number) => Math.ceil(n * HIGH_BAND);
  return { input: up(t.input), cache_read: up(t.cache_read), output: up(t.output), total: up(t.input) + up(t.cache_read) + up(t.output) };
}

/**
 * Estimate a job. `counts[i]` is call i's rows from `app.assistant_count`, in
 * `plan.calls` order — per call, never summed by tool: a tool called twice
 * (two ranges, say) has two counts, and keying by name double-counted both
 * (review 2026-11-09). `catalog` is the tool list, so this stays pure and the
 * test can pass a fixture.
 */
export function estimateJob(plan: JobPlan, counts: readonly number[], catalog: readonly ToolSpec[]): EstimateBody {
  const byName = new Map(catalog.map((t) => [t.name, t]));
  const per_tool: EstimateBody['per_tool'] = [];
  const assumptions: string[] = [];
  let rows = 0;
  let chunks = 0;
  let rowTokens = 0;

  for (const [i, call] of plan.calls.entries()) {
    const spec = byName.get(call.tool);
    const n = Math.max(0, Math.floor(counts[i] ?? 0));
    const chunk_rows = spec?.chunk_rows ?? DEFAULT_CHUNK_ROWS;
    const measured = typeof spec?.tokens_per_row === 'number';
    const tokens_per_row = measured ? (spec?.tokens_per_row as number) : TOKENS_PER_ROW_FALLBACK;
    const c = Math.ceil(n / chunk_rows);
    per_tool.push({ tool: call.tool, rows: n, chunk_rows, tokens_per_row, measured });
    if (!measured) assumptions.push(`${call.tool}: tokens per row not measured yet, using ${TOKENS_PER_ROW_FALLBACK}`);
    if (!spec) assumptions.push(`${call.tool}: not in the catalog`);
    rows += n;
    chunks += c;
    rowTokens += n * tokens_per_row;
  }

  // §6.2, split by step: every chunk is an extraction call, the reduce one call.
  // The chunk prompt is billed once per chunk, as input. It used to be counted
  // again as cache reads for every chunk after the first, so the total ran
  // (chunks - 1) x CHUNK_PROMPT_TOKENS high (review 2026-11-11); nor is it read
  // from cache: the part chunks share (buildJobSystem, the question) is under
  // the vendor's minimum cacheable prefix, and the rest differs per chunk.
  const exInput = chunks * CHUNK_PROMPT_TOKENS + rowTokens;
  const exCacheRead = 0;
  const exOutput = chunks * CHUNK_OUTPUT_TOKENS;
  const extract: TokenBreakdown = { input: exInput, cache_read: exCacheRead, output: exOutput, total: exInput + exCacheRead + exOutput };
  const rdInput = chunks > 0 ? chunks * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS : 0;
  const rdOutput = chunks > 0 ? REDUCE_OUTPUT_TOKENS : 0;
  const reduce: TokenBreakdown = { input: rdInput, cache_read: 0, output: rdOutput, total: rdInput + rdOutput };
  const tokens = sumOf(extract, reduce);

  assumptions.push(
    `chunk prompt ${CHUNK_PROMPT_TOKENS} tokens, chunk output ${CHUNK_OUTPUT_TOKENS}, reduce prompt ${REDUCE_PROMPT_TOKENS}, reduce output ${REDUCE_OUTPUT_TOKENS}`,
    `no cache reads: each chunk's prompt is billed as input`,
    `each chunk is read by ${JOB_EXTRACT_MODEL}; the final answer is written by the chat's model`,
    `high band is +${Math.round((HIGH_BAND - 1) * 100)} %`,
  );

  const aggregate = plan.aggregate_alternative && plan.aggregate_alternative.calls.length
    ? { calls: plan.aggregate_alternative.calls, tokens_est: plan.aggregate_alternative.calls.length * AGGREGATE_CALL_TOKENS }
    : null;
  if (aggregate) assumptions.push(`an aggregate call is about ${AGGREGATE_CALL_TOKENS} tokens read and answered`);

  const live: EstimateBody['modes']['live'] =
    chunks <= LIVE_MAX_CHUNKS
      ? { allowed: true }
      : { allowed: false, reason: `${chunks} chunks; a live job runs at most ${LIVE_MAX_CHUNKS} inside one request. Batch runs any size.` };

  return {
    rows,
    chunks,
    per_tool,
    tokens,
    tokens_high: band(tokens),
    by_step: {
      extract: { model: JOB_EXTRACT_MODEL, tokens: extract, tokens_high: band(extract) },
      reduce: { model: null, tokens: reduce, tokens_high: band(reduce) },
    },
    modes: { aggregate, live, batch: { allowed: true } },
    assumptions,
  };
}

/**
 * One extraction call's tokens at the high band: the extract step's
 * `tokens_high` over the chunks (an estimate without `by_step`, accepted before
 * 2026-10-08, divides the whole job's, which only errs high). assistant-job
 * prices it at JOB_EXTRACT_MODEL so the live pool can keep the calls it has in
 * flight inside the monthly cap (pool.ts budgetAllows). Zero chunks → zeros.
 */
export function extractCallTokens(estimate: Pick<JobEstimate, 'chunks' | 'tokens_high' | 'by_step'>): TokenBreakdown {
  const n = Math.max(0, Math.floor(estimate.chunks));
  const from = estimate.by_step?.extract.tokens_high ?? estimate.tokens_high;
  if (!n || !from) return { input: 0, cache_read: 0, output: 0, total: 0 };
  const per = (v: number) => Math.ceil(Math.max(0, v) / n);
  const input = per(from.input);
  const cache_read = per(from.cache_read);
  const output = per(from.output);
  return { input, cache_read, output, total: input + cache_read + output };
}

/** Actual spend may exceed the accepted estimate by this factor before the job pauses (§6.4). */
export const OVER_ESTIMATE_FACTOR = 1.25;

/** The token total a running job pauses past: a resume's own ceiling, else the accepted estimate × 1.25. */
export function ceilingTokens(estimate: { tokens: TokenBreakdown; ceiling_tokens?: number | null }): number {
  const c = Number(estimate.ceiling_tokens);
  return estimate.ceiling_tokens != null && Number.isFinite(c) && c > 0 ? c : estimate.tokens.total * OVER_ESTIMATE_FACTOR;
}

export function isOverEstimate(actualTotal: number, estimate: { tokens: TokenBreakdown; ceiling_tokens?: number | null }): boolean {
  return actualTotal > ceilingTokens(estimate);
}

/**
 * What the unread part of a paused job is expected to cost (0423): the chunks
 * left at the dearer of the estimate's per-chunk extraction and what the
 * finished chunks actually used (a job pauses over its estimate because its
 * rows ran longer than measured, so the estimate alone would pause it again at
 * once), plus the reduce, which runs once over every chunk's object. The high
 * band is the card's +15 %. Pure, so the card's figures and the server's cap
 * check come from the one stored object (result.pause.rest).
 */
export interface RestEstimate {
  chunks: number;
  extract: TokenBreakdown;
  extract_high: TokenBreakdown;
  reduce: TokenBreakdown;
  reduce_high: TokenBreakdown;
}

export function restEstimate(
  estimate: Pick<JobEstimate, 'chunks' | 'tokens' | 'by_step'>,
  chunksLeft: number,
  done: { chunks: number; used: { input: number; cache_write?: number; cache_read: number; output: number } | null },
): RestEstimate {
  const total = Math.max(1, Math.floor(estimate.chunks) || 1);
  const left = Math.max(0, Math.floor(chunksLeft));
  const ex = estimate.by_step?.extract.tokens ?? estimate.tokens;
  const est = { input: ex.input / total, cache_read: ex.cache_read / total, output: ex.output / total };
  const n = Math.max(0, Math.floor(done.chunks));
  const u = done.used;
  const seen = n > 0 && u
    ? { input: (Math.max(0, u.input) + Math.max(0, u.cache_write ?? 0)) / n, cache_read: Math.max(0, u.cache_read) / n, output: Math.max(0, u.output) / n }
    : { input: 0, cache_read: 0, output: 0 };
  const per = { input: Math.max(est.input, seen.input), cache_read: Math.max(est.cache_read, seen.cache_read), output: Math.max(est.output, seen.output) };
  const input = Math.ceil(per.input * left);
  const cache_read = Math.ceil(per.cache_read * left);
  const output = Math.ceil(per.output * left);
  const extract: TokenBreakdown = { input, cache_read, output, total: input + cache_read + output };
  const rd = estimate.by_step?.reduce.tokens ?? {
    input: total * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS,
    cache_read: 0,
    output: REDUCE_OUTPUT_TOKENS,
    total: total * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS + REDUCE_OUTPUT_TOKENS,
  };
  const reduce: TokenBreakdown = { input: rd.input, cache_read: rd.cache_read, output: rd.output, total: rd.input + rd.cache_read + rd.output };
  return { chunks: left, extract, extract_high: band(extract), reduce, reduce_high: band(reduce) };
}

/** The ceiling a resume sets: what is spent plus the rest's high band, with the same 25 % room. */
export function resumeCeiling(spentTokens: number, rest: Pick<RestEstimate, 'extract_high' | 'reduce_high'>): number {
  return Math.ceil(Math.max(0, spentTokens) + (rest.extract_high.total + rest.reduce_high.total) * OVER_ESTIMATE_FACTOR);
}

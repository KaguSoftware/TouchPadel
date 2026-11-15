/**
 * The job estimator (plan §6.2, _shared/assistant/estimate.ts) against the
 * plan's worked example: 10,000 rows at 250 per chunk → 40 chunks, a +15 %
 * band, live allowed up to LIVE_MAX_CHUNKS (what the runner's clock finishes,
 * 8 since 2026-11-12) and refused above. Since 2026-10-08 the
 * same figures also come split by step (`by_step`): the chunks read on
 * JOB_EXTRACT_MODEL, the reduce on the job's model.
 */
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_CALL_TOKENS,
  CHUNK_OUTPUT_TOKENS,
  CHUNK_PROMPT_TOKENS,
  estimateJob,
  extractCallTokens,
  isOverEstimate,
  JOB_EXTRACT_MODEL,
  JOB_LIVE_CONCURRENCY,
  LIVE_MAX_CHUNKS,
  REDUCE_OUTPUT_TOKENS,
  REDUCE_PROMPT_TOKENS,
  type JobPlan,
} from '../supabase/functions/_shared/assistant/estimate.ts';
import { JOB_WALL_MS, LIVE_CHUNK_BUDGET_MS, liveChunkCapacity, liveClock } from '../supabase/functions/_shared/assistant/pool.ts';
import { ASSISTANT_TOOLS, TOKENS_PER_ROW_FALLBACK, type ToolSpec } from '../supabase/functions/_shared/assistant/tools.ts';

/** The two models the assistant may use (owner rule 0307/0312; provider.ts ASSISTANT_MODELS). */
const ALLOWED_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5'];

const plan: JobPlan = {
  question: "analyze 10,000 customers' purchases",
  calls: [{ tool: 'payments_list', args: { from: '2026-01-01', to: '2026-09-20' } }],
  extract: 'per payment: method and amount',
  reduce: 'sum by method',
  aggregate_alternative: { calls: [{ tool: 'report_revenue', args: {} }, { tool: 'analytics_best_sellers', args: {} }] },
};

/** The catalog with payments_list measured at 23 tokens per row (the plan's figure). */
const measured: ToolSpec[] = ASSISTANT_TOOLS.map((t) => (t.name === 'payments_list' ? { ...t, tokens_per_row: 23 } : t));

describe('estimateJob — the worked example', () => {
  const e = estimateJob(plan, [10_000], measured);

  it('10,000 rows at 250 per chunk is 40 chunks', () => {
    expect(e.rows).toBe(10_000);
    expect(e.chunks).toBe(40);
    expect(e.per_tool).toEqual([{ tool: 'payments_list', rows: 10_000, chunk_rows: 250, tokens_per_row: 23, measured: true }]);
  });

  it('does the §6.2 arithmetic', () => {
    const chunkInput = 40 * CHUNK_PROMPT_TOKENS + 10_000 * 23; // 48,000 + 230,000
    const reduceInput = 40 * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS; // 16,000 + 800
    expect(e.tokens.input).toBe(chunkInput + reduceInput);
    // the chunk prompt once per chunk, as input; never again as cache reads (review 2026-11-11)
    expect(e.tokens.cache_read).toBe(0);
    expect(e.tokens.output).toBe(40 * CHUNK_OUTPUT_TOKENS + REDUCE_OUTPUT_TOKENS);
    expect(e.tokens.total).toBe(e.tokens.input + e.tokens.cache_read + e.tokens.output);
    expect(e.tokens.total).toBe(chunkInput + reduceInput + 40 * CHUNK_OUTPUT_TOKENS + REDUCE_OUTPUT_TOKENS);
    // the plan's "~250k shaped, ~25k output" order of magnitude
    expect(e.tokens.input).toBeGreaterThan(240_000);
    expect(e.tokens.input).toBeLessThan(320_000);
    expect(e.tokens.output).toBeLessThan(25_000);
  });

  it('adds the +15 % band to every kind', () => {
    expect(e.tokens_high.input).toBe(Math.ceil(e.tokens.input * 1.15));
    expect(e.tokens_high.cache_read).toBe(Math.ceil(e.tokens.cache_read * 1.15));
    expect(e.tokens_high.output).toBe(Math.ceil(e.tokens.output * 1.15));
    expect(e.tokens_high.total).toBe(e.tokens_high.input + e.tokens_high.cache_read + e.tokens_high.output);
  });

  it('offers all three ways when an aggregate alternative exists and the job fits the live window', () => {
    const small = estimateJob(plan, [LIVE_MAX_CHUNKS * 250], measured);
    expect(small.modes.aggregate).toEqual({ calls: plan.aggregate_alternative!.calls, tokens_est: 2 * AGGREGATE_CALL_TOKENS });
    expect(small.modes.live).toEqual({ allowed: true });
    expect(small.modes.batch).toEqual({ allowed: true });
    // 40 chunks is past what one request can finish live: batch only
    expect(e.modes.live.allowed).toBe(false);
    expect(e.modes.batch).toEqual({ allowed: true });
  });

  it('lists the constants in the assumptions and does not claim an unmeasured tool', () => {
    expect(e.assumptions.join('\n')).toContain(`chunk prompt ${CHUNK_PROMPT_TOKENS} tokens`);
    expect(e.assumptions.join('\n')).toContain('+15 %');
    expect(e.assumptions.some((a) => a.includes('not measured'))).toBe(false);
  });
});

describe('estimateJob — edges', () => {
  it('refuses live above LIVE_MAX_CHUNKS and says why; batch stays allowed', () => {
    const e = estimateJob(plan, [LIVE_MAX_CHUNKS * 250 + 1], measured);
    expect(e.chunks).toBe(LIVE_MAX_CHUNKS + 1);
    expect(e.modes.live.allowed).toBe(false);
    expect(e.modes.live.reason).toContain(`${LIVE_MAX_CHUNKS}`);
    expect(e.modes.batch.allowed).toBe(true);
    expect(estimateJob(plan, [LIVE_MAX_CHUNKS * 250], measured).modes.live.allowed).toBe(true);
  });

  it('LIVE_MAX_CHUNKS is what the runner clock finishes: each worker launches one worst-case chunk per LIVE_CHUNK_BUDGET_MS of the launch window', () => {
    const window = liveClock(0, JOB_WALL_MS).launchBy;
    expect(window).toBe(23_000);
    expect(LIVE_MAX_CHUNKS).toBe(liveChunkCapacity(JOB_WALL_MS, JOB_LIVE_CONCURRENCY));
    expect(LIVE_MAX_CHUNKS).toBe(JOB_LIVE_CONCURRENCY * Math.ceil(window / LIVE_CHUNK_BUDGET_MS));
    expect(LIVE_MAX_CHUNKS).toBe(8);
    // a launch AT launchBy is refused (runLive's shouldStop), so a window of exactly two budgets is two launches
    expect(liveChunkCapacity(15_000 + 12_000 + 24_000, 1)).toBe(2);
    expect(liveChunkCapacity(15_000 + 12_000 + 24_001, 1)).toBe(3);
    // a wall too short for any launch window offers nothing live
    expect(liveChunkCapacity(20_000, 4)).toBe(0);
  });

  it('falls back to TOKENS_PER_ROW_FALLBACK for an unmeasured tool and says so', () => {
    const e = estimateJob(plan, [500], ASSISTANT_TOOLS);
    expect(e.per_tool[0]?.measured).toBe(false);
    expect(e.per_tool[0]?.tokens_per_row).toBe(TOKENS_PER_ROW_FALLBACK);
    expect(e.assumptions.some((a) => a.includes('payments_list: tokens per row not measured'))).toBe(true);
  });

  it('sums several tools and rounds chunks per tool', () => {
    const p: JobPlan = { question: 'q', calls: [{ tool: 'payments_list', args: {} }, { tool: 'audit_page', args: {} }] };
    const e = estimateJob(p, [251, 201], measured); // 2 + 2 chunks (audit 200/chunk)
    expect(e.rows).toBe(452);
    expect(e.chunks).toBe(4);
    expect(e.modes.aggregate).toBeNull();
  });

  it('zero rows is zero everything', () => {
    const e = estimateJob(plan, [], measured);
    expect(e.chunks).toBe(0);
    expect(e.tokens).toEqual({ input: 0, cache_read: 0, output: 0, total: 0 });
  });

  it('isOverEstimate pauses at +25 %', () => {
    const e = estimateJob(plan, [10_000], measured);
    expect(isOverEstimate(e.tokens.total * 1.2, e)).toBe(false);
    expect(isOverEstimate(e.tokens.total * 1.26, e)).toBe(true);
  });
});

describe('estimateJob — by step (extraction on the cheaper model)', () => {
  const e = estimateJob(plan, [10_000], measured);
  const steps = e.by_step!;

  it('extraction runs on claude-sonnet-5-5, an allowed model; the reduce on the job model (null)', () => {
    expect(JOB_EXTRACT_MODEL).toBe('claude-sonnet-5-5');
    expect(ALLOWED_MODELS).toContain(JOB_EXTRACT_MODEL);
    expect(steps.extract.model).toBe(JOB_EXTRACT_MODEL);
    expect(steps.reduce.model).toBeNull();
    expect(JOB_LIVE_CONCURRENCY).toBe(4);
  });

  it('splits the §6.2 arithmetic: chunks to extract, the reduce call to reduce', () => {
    expect(steps.extract.tokens).toEqual({
      input: 40 * CHUNK_PROMPT_TOKENS + 10_000 * 23,
      cache_read: 0,
      output: 40 * CHUNK_OUTPUT_TOKENS,
      total: 40 * CHUNK_PROMPT_TOKENS + 10_000 * 23 + 40 * CHUNK_OUTPUT_TOKENS,
    });
    expect(steps.reduce.tokens).toEqual({
      input: 40 * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS,
      cache_read: 0,
      output: REDUCE_OUTPUT_TOKENS,
      total: 40 * CHUNK_OUTPUT_TOKENS + REDUCE_PROMPT_TOKENS + REDUCE_OUTPUT_TOKENS,
    });
  });

  it('the steps sum to `tokens` exactly (older readers and the over-estimate pause see the same totals)', () => {
    for (const k of ['input', 'cache_read', 'output', 'total'] as const) {
      expect(steps.extract.tokens[k] + steps.reduce.tokens[k], k).toBe(e.tokens[k]);
    }
  });

  it('each step carries its own +15 % band', () => {
    for (const s of [steps.extract, steps.reduce]) {
      expect(s.tokens_high.input).toBe(Math.ceil(s.tokens.input * 1.15));
      expect(s.tokens_high.output).toBe(Math.ceil(s.tokens.output * 1.15));
      expect(s.tokens_high.total).toBe(s.tokens_high.input + s.tokens_high.cache_read + s.tokens_high.output);
    }
  });

  it('prices lower than the same tokens all on Opus 5.5 (the 0312 rates)', () => {
    // USD micros per Mtok, 20261007000312_assistant_models_5_5.sql
    const rates = {
      'claude-opus-5-5': { input: 4_000_000, cache_read: 200_000, output: 20_000_000 },
      'claude-sonnet-5-5': { input: 2_000_000, cache_read: 200_000, output: 10_000_000 },
    } as const;
    const price = (m: keyof typeof rates, t: { input: number; cache_read: number; output: number }) =>
      (t.input * rates[m].input + t.cache_read * rates[m].cache_read + t.output * rates[m].output) / 1_000_000;
    const allOpus = price('claude-opus-5-5', e.tokens);
    const split = price('claude-sonnet-5-5', steps.extract.tokens) + price('claude-opus-5-5', steps.reduce.tokens);
    expect(split).toBeLessThan(allOpus * 0.6);
  });

  it('names the extraction model in the assumptions', () => {
    expect(e.assumptions.join('\n')).toContain(JOB_EXTRACT_MODEL);
  });

  it('zero rows is zero in both steps', () => {
    const z = estimateJob(plan, [], measured).by_step!;
    expect(z.extract.tokens.total).toBe(0);
    expect(z.reduce.tokens).toEqual({ input: 0, cache_read: 0, output: 0, total: 0 });
  });
});

// ---------------------------------------------------------------------------
// One extraction call's high-band tokens: what assistant-job prices to keep the
// live pool's in-flight calls inside the monthly cap (pool.ts budgetAllows).
// ---------------------------------------------------------------------------
describe('extractCallTokens', () => {
  const e = estimateJob(plan, [10_000], measured);

  it('is the extract step high band over the chunks, rounded up', () => {
    const one = extractCallTokens(e);
    const hi = e.by_step!.extract.tokens_high;
    expect(one.input).toBe(Math.ceil(hi.input / 40));
    expect(one.cache_read).toBe(Math.ceil(hi.cache_read / 40));
    expect(one.output).toBe(Math.ceil(hi.output / 40));
    expect(one.total).toBe(one.input + one.cache_read + one.output);
    // never under the job's chunks taken together
    expect(one.total * 40).toBeGreaterThanOrEqual(hi.total);
  });

  it('an estimate without by_step (accepted before 2026-10-08) divides the whole job, erring high', () => {
    const { by_step: _drop, ...old } = e;
    const one = extractCallTokens(old);
    expect(one.input).toBe(Math.ceil(e.tokens_high.input / 40));
    expect(one.total).toBeGreaterThan(extractCallTokens(e).total);
  });

  it('zero chunks is zeros', () => {
    expect(extractCallTokens(estimateJob(plan, [], measured))).toEqual({ input: 0, cache_read: 0, output: 0, total: 0 });
  });
});

/**
 * The job estimate card's prices (JobEstimateCard.estimatePrices). Since
 * 2026-10-08 an estimate carries `by_step`: the chunks are read on Sonnet 5.5
 * and priced at its rates, the answer is written by the chat's model; an
 * older estimate (no `by_step`) prices every token at the chat's model.
 */
import { describe, expect, it } from 'vitest';
import { estimatePrices } from './JobEstimateCard';
import type { JobEstimate } from './api';
import type { PricingMap } from '../../lib/assistantPricing';

/** 0312's rates, USD micros per Mtok. */
const pricing: PricingMap = {
  'claude-opus-5-5': { input: 4_000_000, cache_write: 5_000_000, cache_read: 200_000, output: 20_000_000 },
  'claude-sonnet-5-5': { input: 2_000_000, cache_write: 2_500_000, cache_read: 200_000, output: 10_000_000 },
};

const t = (input: number, cache_read: number, output: number) => ({ input, cache_read, output, total: input + cache_read + output });
const up = (x: ReturnType<typeof t>) => t(Math.ceil(x.input * 1.15), Math.ceil(x.cache_read * 1.15), Math.ceil(x.output * 1.15));

const extract = t(1_000_000, 100_000, 50_000);
const reduce = t(20_000, 0, 2_000);
const base: JobEstimate = {
  job_id: 'j',
  rows: 10_000,
  chunks: 40,
  per_tool: [],
  tokens: t(1_020_000, 100_000, 52_000),
  tokens_high: up(t(1_020_000, 100_000, 52_000)),
  modes: { aggregate: null, live: { allowed: true }, batch: { allowed: true } },
  assumptions: [],
  first_chunk_exact: null,
};

describe('estimatePrices', () => {
  it('an estimate without by_step prices every token at the chat model and halves it for batch', () => {
    const p = estimatePrices(base, 'claude-opus-5-5', pricing, 0);
    // 1.02M × $4 + 0.1M × $0.20 + 52k × $20
    expect(p.live).toBe(4_080_000 + 20_000 + 1_040_000);
    expect(p.batch).toBe(Math.round(p.live / 2));
    expect(p.aggregate).toBeNull();
  });

  it('with by_step, the chunks are priced at the extraction model and the reduce at the chat model', () => {
    const e: JobEstimate = {
      ...base,
      by_step: {
        extract: { model: 'claude-sonnet-5-5', tokens: extract, tokens_high: up(extract) },
        reduce: { model: null, tokens: reduce, tokens_high: up(reduce) },
      },
    };
    const p = estimatePrices(e, 'claude-opus-5-5', pricing, 0);
    const ex = 2_000_000 + 20_000 + 500_000; // 1M × $2 + 0.1M × $0.20 + 50k × $10
    const rd = 80_000 + 40_000; // 20k × $4 + 2k × $20
    expect(p.live).toBe(ex + rd);
    // the Batch API halves the chunks; the reduce runs live either way
    expect(p.batch).toBe(Math.round(ex / 2) + rd);
    expect(p.high).toBeGreaterThan(p.live);
    // cheaper than the same tokens all on Opus 5.5
    expect(p.live).toBeLessThan(estimatePrices(base, 'claude-opus-5-5', pricing, 0).live);
  });
});

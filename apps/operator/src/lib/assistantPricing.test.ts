import { describe, expect, it } from 'vitest';
import { formatTokens, formatUsd, isBlendedFallback, priceFor, sumTokens, totalTokens } from './assistantPricing';

// Opus 5 as seeded by migration 0111: $5 / $6.25 / $0.50 / $25 per MTok.
const PRICING = {
  'claude-opus-5': { input: 5_000_000, cache_write: 6_250_000, cache_read: 500_000, output: 25_000_000 },
  'half-baked': { input: 1_000_000 },
};

describe('priceFor', () => {
  it('prices each kind at its own rate', () => {
    const micros = priceFor(
      { model: 'claude-opus-5', input: 10_000, cache_write: 20_000, cache_read: 100_000, output: 2_000 },
      PRICING,
      3_000_000,
    );
    // 10k*5 + 20k*6.25 + 100k*0.5 + 2k*25 = 50k + 125k + 50k + 50k micros
    expect(micros).toBe(275_000);
  });

  it('falls back to the blended rate for an unpriced or partial model', () => {
    const tokens = { input: 1_000, cache_write: 0, cache_read: 0, output: 1_000 };
    expect(priceFor({ model: 'unknown', ...tokens }, PRICING, 3_000_000)).toBe(6_000);
    expect(priceFor({ model: 'half-baked', ...tokens }, PRICING, 3_000_000)).toBe(6_000);
    expect(isBlendedFallback('half-baked', PRICING)).toBe(true);
    expect(isBlendedFallback('claude-opus-5', PRICING)).toBe(false);
  });

  it('treats missing kinds as zero and rounds to whole micros', () => {
    expect(priceFor({ model: 'claude-opus-5', input: 1 }, PRICING, 0)).toBe(5);
    expect(priceFor({ model: 'claude-opus-5' }, PRICING, 0)).toBe(0);
  });
});

describe('sums', () => {
  it('sumTokens and totalTokens agree', () => {
    const s = sumTokens([{ input: 1, output: 2 }, { cache_read: 3 }, {}]);
    expect(s).toEqual({ input: 1, cache_write: 0, cache_read: 3, output: 2 });
    expect(totalTokens(s)).toBe(6);
  });
});

describe('formatUsd', () => {
  it('prints dollars with two decimals and never calls a run free', () => {
    expect(formatUsd(275_000)).toBe('$0.28');
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1_200)).toBe('<$0.01');
    expect(formatUsd(12_345_678)).toBe('$12.35');
  });
});

describe('formatTokens', () => {
  it('shortens counts for labels', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(340)).toBe('340');
    expect(formatTokens(1_234)).toBe('1.2k');
    expect(formatTokens(10_000)).toBe('10k');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });
});

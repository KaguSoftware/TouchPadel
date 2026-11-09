import { describe, expect, it } from 'vitest';
import {
  asUsageSummary,
  chatCostMicros,
  formatUsd,
  isModelNotPriced,
  modelName,
  normaliseScopes,
  refusedScopes,
  toggleScope,
} from '../chat';

// The reducer, the refusal codes and the stored-row readers are shared with the
// operator; their tests live in packages/core/src/assistant/client.test.ts.

describe('scopes', () => {
  it('keeps catalog order and never empties the set', () => {
    expect(normaliseScopes(['howto', 'money', 'nope'])).toEqual(['money', 'howto']);
    expect(toggleScope(['howto'], 'howto')).toEqual(['howto']);
    expect(toggleScope(['money', 'howto'], 'howto')).toEqual(['money']);
    expect(toggleScope(['money'], 'cafe')).toEqual(['cafe', 'money']);
  });

  it('keeps a scope the phone does not offer when another is toggled', () => {
    expect(toggleScope(['audit', 'money'], 'money')).toEqual(['audit']);
    expect(toggleScope(['audit'], 'money')).toEqual(['money', 'audit']);
  });

  it('offers "turn on" only for scopes a tool error names and that are off', () => {
    const errors = ['Scope "cafe" is off for this chat', undefined, 'Scope "money" is off for this chat'];
    expect(refusedScopes(errors, ['money', 'howto'])).toEqual(['cafe']);
    expect(refusedScopes(['something else'], [])).toEqual([]);
  });
});

describe('models', () => {
  it('names the known models and prints any other id as is', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5');
    expect(modelName('other-model')).toBe('other-model');
  });

  it('recognises the unpriced-model refusal by code or message', () => {
    expect(isModelNotPriced({ code: 'ASSISTANT_MODEL_NOT_PRICED' })).toBe(true);
    expect(isModelNotPriced({ message: 'ASSISTANT_MODEL_NOT_PRICED' })).toBe(true);
    expect(isModelNotPriced(new Error('boom'))).toBe(false);
    expect(isModelNotPriced(null)).toBe(false);
  });
});

describe('spend', () => {
  it('formats micros as dollars, with a floor for a fraction of a cent', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(1_000)).toBe('<$0.01');
    expect(formatUsd(42_000)).toBe('$0.04');
    expect(formatUsd(1_250_000)).toBe('$1.25');
    expect(formatUsd(1_234_567_890)).toBe('$1,234.57');
  });

  it('reads the month and the cap from assistant_usage, and nothing from junk', () => {
    expect(asUsageSummary({ month: { cost_micros: 900 }, cap: { monthly_cap_micros: 20_000_000 } })).toEqual({
      monthMicros: 900,
      capMicros: 20_000_000,
    });
    expect(asUsageSummary(null)).toEqual({ monthMicros: 0, capMicros: null });
  });

  it('reads a chat’s spend from its tokens, zero when there is none', () => {
    expect(chatCostMicros({ tokens: { cost_micros: 3_400 } })).toBe(3_400);
    expect(chatCostMicros({ tokens: null })).toBe(0);
    expect(chatCostMicros(null)).toBe(0);
  });
});

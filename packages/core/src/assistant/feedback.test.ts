import { describe, expect, it } from 'vitest';
import { applyFeedback, canRate, nextRating, ratingOf, type RateableRow } from './feedback';

const answer = (over: Partial<RateableRow> = {}): RateableRow => ({
  id: 'a1',
  role: 'assistant',
  content: [{ type: 'text', text: 'Courts held up.' }],
  sources: null,
  tokens: { stop_reason: 'end_turn' },
  ...over,
});

describe('canRate', () => {
  it('allows a stored finished answer', () => {
    expect(canRate(answer())).toBe(true);
    expect(canRate(answer({ tokens: null }))).toBe(true);
  });
  it('refuses a user row and an empty answer', () => {
    expect(canRate(answer({ role: 'user' }))).toBe(false);
    expect(canRate(answer({ content: [{ type: 'text', text: ' ' }] }))).toBe(false);
  });
  it.each([
    ['failed', { error_code: 'UPSTREAM' }],
    ['stopped', { stop_reason: 'stopped' }],
    ['cut short', { stop_reason: 'max_tokens' }],
    ['refused', { stop_reason: 'refusal' }],
    ['a job proposal', { stop_reason: 'job_proposed' }],
  ])('refuses a %s turn', (_n, tokens) => {
    expect(canRate(answer({ tokens }))).toBe(false);
  });
  it('refuses a job answer (sources name a job_id)', () => {
    expect(canRate(answer({ sources: [{ job_id: 'j1' }] }))).toBe(false);
  });
});

describe('nextRating', () => {
  it('sets, switches and clears', () => {
    expect(nextRating(0, 1)).toBe(1);
    expect(nextRating(1, -1)).toBe(-1);
    expect(nextRating(1, 1)).toBe(0);
    expect(nextRating(-1, -1)).toBe(0);
  });
});

describe('ratingOf', () => {
  it('reads an object, an array, and nothing', () => {
    expect(ratingOf({ rating: -1 })).toBe(-1);
    expect(ratingOf([{ rating: 1 }])).toBe(1);
    expect(ratingOf(null)).toBe(0);
    expect(ratingOf(undefined)).toBe(0);
    expect(ratingOf({ rating: 5 })).toBe(0);
  });
});

describe('applyFeedback', () => {
  const rows = [answer({ id: 'a1' }), answer({ id: 'a2' })];
  it('changes only the named row and returns new rows', () => {
    const out = applyFeedback(rows, 'a2', 1, 'why');
    expect(out).not.toBe(rows);
    expect(out[0]).toBe(rows[0]);
    expect(out[1]?.feedback).toEqual({ rating: 1, note: 'why' });
    expect(rows[1]?.feedback).toBeUndefined();
  });
  it('clears with 0', () => {
    const rated = applyFeedback(rows, 'a1', -1);
    expect(applyFeedback(rated, 'a1', 0)[0]?.feedback).toBeNull();
  });
});

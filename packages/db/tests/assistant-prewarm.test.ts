/**
 * 0327 — the nightly pre-warm's cut (_shared/assistant/prewarm.ts): a card is
 * generated only while the owner's card read it within PREWARM_VIEWED_DAYS
 * (assistant_components.last_viewed_at, stamped by app.analytics_component);
 * every other card is listed as skipped, never generated. The stamp itself is
 * covered by tests/assistant-components.test.ts against the stack.
 */
import { describe, expect, it } from 'vitest';
import { PREWARM_VIEWED_DAYS, selectPrewarm } from '../supabase/functions/_shared/assistant/prewarm.ts';

const NOW = new Date('2026-10-08T00:30:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('selectPrewarm', () => {
  it('the window is seven days', () => {
    expect(PREWARM_VIEWED_DAYS).toBe(7);
  });

  it('keeps cards viewed within the window, in order, and skips the rest with their stamp', () => {
    const rows = [
      { key: 'cafe_findings', last_viewed_at: daysAgo(0.5), extra: 1 },
      { key: 'courts_findings', last_viewed_at: daysAgo(7) }, // exactly on the edge: kept
      { key: 'staff_note', last_viewed_at: daysAgo(7.01) },
      { key: 'stock_watch', last_viewed_at: null },
      { key: 'week_paragraph' }, // column absent (pre-0327 read): never viewed
      { key: 'what_changed', last_viewed_at: 'not a date' },
    ];
    const { warm, skipped } = selectPrewarm(rows, NOW);
    expect(warm.map((r) => r.key)).toEqual(['cafe_findings', 'courts_findings']);
    expect(warm[0]).toBe(rows[0]); // the rows themselves, not copies
    expect(skipped).toEqual([
      { key: 'staff_note', last_viewed_at: daysAgo(7.01) },
      { key: 'stock_watch', last_viewed_at: null },
      { key: 'week_paragraph', last_viewed_at: null },
      { key: 'what_changed', last_viewed_at: 'not a date' },
    ]);
  });

  it('a custom window moves the cut', () => {
    const rows = [{ key: 'a_card', last_viewed_at: daysAgo(2) }];
    expect(selectPrewarm(rows, NOW, 1).warm).toHaveLength(0);
    expect(selectPrewarm(rows, NOW, 3).warm).toHaveLength(1);
  });

  it('a stamp in the future (clock skew) still counts as viewed', () => {
    expect(selectPrewarm([{ key: 'a_card', last_viewed_at: daysAgo(-1) }], NOW).warm).toHaveLength(1);
  });

  it('an empty list skips nothing', () => {
    expect(selectPrewarm([], NOW)).toEqual({ warm: [], skipped: [] });
  });
});

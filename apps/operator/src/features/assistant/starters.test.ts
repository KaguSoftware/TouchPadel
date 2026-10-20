import { describe, expect, it } from 'vitest';
import { ASSISTANT_SCOPES } from '@touch/core/assistant/tools';
import { STARTER_TOPICS, followUpsFor } from './starters';

describe('STARTER_TOPICS', () => {
  it('names real scopes, at least one per topic, and uses each card colour once', () => {
    for (const t of STARTER_TOPICS) {
      expect(t.scopes.length).toBeGreaterThan(0);
      for (const s of t.scopes) expect(ASSISTANT_SCOPES).toContain(s);
      expect(t.questions.length).toBeGreaterThan(0);
    }
    expect(new Set(STARTER_TOPICS.map((t) => t.card)).size).toBe(STARTER_TOPICS.length);
  });
});

describe('followUpsFor', () => {
  it('follows the scope of the first tool the answer read', () => {
    expect(followUpsFor(['report_courts'], ['cafe', 'courts'])).toEqual(['compareLastWeek', 'byCourt', 'byHour']);
  });

  it("falls back to the chat's first business scope, then to how-to", () => {
    expect(followUpsFor([], ['stock', 'howto'])).toEqual(['whatToOrder', 'wasteByItem']);
    expect(followUpsFor([], ['howto'])).toEqual(['stepByStep', 'whoCanDoIt']);
  });

  it('offers the generic pair when nothing maps', () => {
    expect(followUpsFor(['no_such_tool'], ['system'])).toEqual(['explainMore', 'compareLastWeek']);
  });
});

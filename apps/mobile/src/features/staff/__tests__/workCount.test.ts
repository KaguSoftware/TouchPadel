import { describe, expect, it } from 'vitest';
import type { MyProtocolWork } from '@touch/core';
import type { ChecklistsToday } from '../checklists/logic';
import { waitingCount } from '../workCount';

const list = (run_id: string, done: number, total: number) => ({
  run_id,
  role: 'waiter' as const,
  slot: 'open' as const,
  name_en: run_id,
  name_ar: run_id,
  done,
  total,
  items: [],
});

const LISTS = {
  business_date: '2026-10-10',
  lists: [list('a', 0, 3), list('b', 3, 3), list('c', 1, 2), list('d', 0, 0)],
} as ChecklistsToday;

const WORK = {
  todo: [{}, {}],
  to_decide: [{}],
  waiting: [{}, {}, {}],
  decided: [{}],
  counts: { todo: 2, waiting: 3, to_decide: 1 },
} as unknown as MyProtocolWork;

describe('waitingCount', () => {
  it('counts unfinished checklists, steps to decide and open steps', () => {
    expect(waitingCount(LISTS, WORK)).toBe(2 + 1 + 2);
  });

  it('leaves out what the person sent and what was decided', () => {
    expect(waitingCount(null, { ...WORK, todo: [], to_decide: [] })).toBe(0);
  });

  it('is zero before either read has answered', () => {
    expect(waitingCount(undefined, undefined)).toBe(0);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// The count reads behind Stock ▸ Stock count (wave5-addendum-2026-09-25 §5.2,
// §6.2 "the Counts open-count filter"). Since the stores, a venue can have a
// manager's count open at the cafe store, another at the bakery store, and
// the kitchen's phone count waiting beside them, so the read that used to be
// "the open count" (`maybeSingle`) must narrow to the operator's own at one
// store, or it gets two rows and fails (rollout note 4 of lane S).

const calls = vi.hoisted(() => [] as { table: string; steps: [string, unknown[]][] }[]);
const result = vi.hoisted(() => ({ value: { data: null as unknown, error: null as unknown, count: 0 } }));

vi.mock('../../components/kit', () => ({ presetPeriod: () => ({}) }));
vi.mock('../../lib/appRpc', () => ({ appRpc: vi.fn() }));
vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const entry = { table, steps: [] as [string, unknown[]][] };
    calls.push(entry);
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'is', 'eq', 'not', 'order', 'limit', 'gte', 'lt']) {
      chain[step] = (...args: unknown[]) => {
        entry.steps.push([step, args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      entry.steps.push(['maybeSingle', []]);
      return Promise.resolve(result.value);
    };
    chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result.value).then(ok, fail);
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});

import { fetchLastCount, fetchNeedsCostCount, fetchOpenCount, fetchUnfinishedCounts } from './stockKeys';

const steps = (i = 0) => calls[i]!.steps;

beforeEach(() => {
  calls.length = 0;
  result.value = { data: null, error: null, count: 0 };
});

describe('count reads by store', () => {
  it('reads the manager’s own open count at one store, never a phone count or the other store’s', async () => {
    await fetchOpenCount('bakery');
    expect(calls[0]!.table).toBe('stock_counts');
    expect(steps()).toEqual(
      expect.arrayContaining([
        ['is', ['finalized_at', null]],
        ['eq', ['source', 'operator']],
        ['eq', ['location', 'bakery']],
        ['maybeSingle', []],
      ]),
    );
  });

  it('reads every count not applied yet, both stores and both sources, oldest first, with who', async () => {
    result.value = { data: [], error: null, count: 0 };
    await fetchUnfinishedCounts();
    expect(steps()).toEqual([
      ['select', ['id, location, source, started_at, staff:counted_by(display_name)']],
      ['is', ['finalized_at', null]],
      ['order', ['started_at']],
    ]);
  });

  it('reads the last finished count of the venue, or of one store', async () => {
    await fetchLastCount();
    expect(steps(0).some(([s, a]) => s === 'eq' && a[0] === 'location')).toBe(false);
    await fetchLastCount('cafe');
    expect(steps(1)).toContainEqual(['eq', ['location', 'cafe']]);
  });

  it('counts the staff-added lines booked at no cost, not the rows', async () => {
    result.value = { data: null, error: null, count: 3 };
    await expect(fetchNeedsCostCount()).resolves.toBe(3);
    expect(calls[0]!.table).toBe('delivery_lines');
    expect(steps()).toContainEqual(['eq', ['cost_source', 'none']]);
  });

  it('throws what the read refused', async () => {
    result.value = { data: null, error: new Error('denied'), count: 0 };
    await expect(fetchOpenCount('cafe')).rejects.toThrow('denied');
  });
});

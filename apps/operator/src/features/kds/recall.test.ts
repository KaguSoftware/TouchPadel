import { describe, expect, it } from 'vitest';
import {
  RECALL_SHOWN,
  RECALL_WINDOW_MS,
  forgetRecalled,
  minutesSinceCompleted,
  recallCandidates,
  rememberCompleted,
} from './recall';
import type { TicketRow } from './ticketView';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function row(id: string, status: TicketRow['status'], completedAgoMs: number | null): TicketRow {
  return {
    id,
    status,
    target_seconds: 600,
    created_at: ago(30 * 60_000),
    completed_at: completedAgoMs === null ? null : ago(completedAgoMs),
    last_actor_label: null,
    order: null,
  };
}

describe('recall memory (F-57)', () => {
  it('remembers a completed ticket for ten minutes, past the board read’s two', () => {
    let mem = rememberCompleted(new Map(), [row('a', 'completed', 60_000), row('b', 'ready', null)], NOW);
    expect([...mem.keys()]).toEqual(['a']);
    // Three minutes later the server no longer returns it; the board still lists it.
    mem = rememberCompleted(mem, [], NOW + 3 * 60_000);
    expect(recallCandidates(mem, NOW + 3 * 60_000).map((r) => r.id)).toEqual(['a']);
    // And not past the ten minutes app.recall_ticket allows.
    mem = rememberCompleted(mem, [], NOW + RECALL_WINDOW_MS);
    expect(mem.size).toBe(0);
  });

  it('never lists one completed more than ten minutes ago', () => {
    const mem = rememberCompleted(new Map(), [row('old', 'completed', RECALL_WINDOW_MS + 1)], NOW);
    expect(mem.size).toBe(0);
  });

  it('forgets a ticket another screen brought back', () => {
    let mem = rememberCompleted(new Map(), [row('a', 'completed', 60_000)], NOW);
    mem = rememberCompleted(mem, [row('a', 'ready', null)], NOW + 5_000);
    expect(mem.size).toBe(0);
  });

  it('lists newest first, at most six, and drops one at once on Bring back', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`t${i}`, 'completed', (i + 1) * 30_000));
    const mem = rememberCompleted(new Map(), rows, NOW);
    const shown = recallCandidates(mem, NOW);
    expect(shown).toHaveLength(RECALL_SHOWN);
    expect(shown[0]!.id).toBe('t0');
    expect(recallCandidates(forgetRecalled(mem, 't0'), NOW)[0]!.id).toBe('t1');
  });

  it('counts whole minutes since completion', () => {
    expect(minutesSinceCompleted(row('a', 'completed', 150_000), NOW)).toBe(2);
    expect(minutesSinceCompleted(row('a', 'completed', -5_000), NOW)).toBe(0);
  });
});

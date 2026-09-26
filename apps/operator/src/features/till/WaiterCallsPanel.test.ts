import { describe, expect, it } from 'vitest';
import { OLD_CALL_MIN, callUrgency, splitCalls } from './WaiterCallsPanel';

const NOW = Date.parse('2026-09-16T20:00:00Z');
const ago = (minutes: number) => ({ raised_at: new Date(NOW - minutes * 60_000).toISOString() });

describe('callUrgency', () => {
  it('escalates a raised call by how long it has waited', () => {
    expect(callUrgency('raised', 1, false)).toBe('calm');
    expect(callUrgency('raised', 3, false)).toBe('warn');
    expect(callUrgency('raised', 5, false)).toBe('late');
    // The alarm machine's own verdict wins even under the threshold.
    expect(callUrgency('raised', 1, true)).toBe('late');
  });

  it('an acknowledged call is somebody’s already — it is never shouted', () => {
    expect(callUrgency('acknowledged', 90, true)).toBe('calm');
  });
});

describe('splitCalls', () => {
  it('folds calls older than two hours away from the live ones, keeping order', () => {
    const calls = [ago(2800), ago(OLD_CALL_MIN), ago(OLD_CALL_MIN - 1), ago(4), ago(0)];
    const { recent, old } = splitCalls(calls, NOW);
    expect(old).toEqual([calls[0], calls[1]]);
    expect(recent).toEqual([calls[2], calls[3], calls[4]]);
  });
});

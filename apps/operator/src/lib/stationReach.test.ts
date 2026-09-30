import { describe, expect, it } from 'vitest';
import { reachFromHeartbeat } from './stationReach';

describe('reachFromHeartbeat (open matches §5.5)', () => {
  const beat = { degraded: false, queueDepth: 0, lastOkAt: 1 };

  it('fails open before the first beat', () => {
    expect(reachFromHeartbeat(null)).toEqual({ reachable: true });
  });

  it('is reachable while the beat succeeds, degraded venue or queued writes included', () => {
    expect(reachFromHeartbeat({ ...beat, error: null }).reachable).toBe(true);
    expect(reachFromHeartbeat({ ...beat, error: undefined, degraded: true, queueDepth: 4 }).reachable).toBe(true);
  });

  it('is unreachable once a beat failed', () => {
    expect(reachFromHeartbeat({ ...beat, error: new TypeError('Failed to fetch') }).reachable).toBe(false);
  });
});

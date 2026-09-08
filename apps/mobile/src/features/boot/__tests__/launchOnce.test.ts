import { beforeEach, describe, expect, it } from 'vitest';
import { __resetLaunchLatch, claimBootOverlay } from '../launchOnce';

describe('boot overlay latch', () => {
  beforeEach(() => __resetLaunchLatch());

  it('is claimable exactly once per launch', () => {
    expect(claimBootOverlay()).toBe(true);
    expect(claimBootOverlay()).toBe(false);
    expect(claimBootOverlay()).toBe(false);
  });

  it('stays spent — a remount (Fast Refresh) must not replay the screen', () => {
    claimBootOverlay();
    for (let i = 0; i < 20; i += 1) expect(claimBootOverlay()).toBe(false);
  });
});

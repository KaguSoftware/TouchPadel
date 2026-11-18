import { describe, expect, it } from 'vitest';
import type { LoyaltyReward } from '@touch/core/loyalty';
import { rewardLadder } from '../rewardLadder';

/** The rewards' order and fill on Points & rewards ("AD-1", 2026-11-16). */
const r = (id: string, cost: number, kind: LoyaltyReward['kind'] = 'item'): LoyaltyReward => ({
  id,
  name_en: id,
  name_ar: id,
  cost_points: cost,
  kind,
  iqd_off: kind === 'iqd_off' ? 5000 : null,
});

describe('rewardLadder', () => {
  it('cheapest first: the ones the balance covers, then the rest, the cheapest of those named next', () => {
    const l = rewardLadder([r('court', 1200, 'court_hour'), r('kunafa', 450), r('espresso', 150), r('off', 300, 'iqd_off')], 340);
    expect(l.ready.map((x) => x.reward.id)).toEqual(['espresso', 'off']);
    expect(l.ahead.map((x) => x.reward.id)).toEqual(['kunafa', 'court']);
    expect(l.next?.reward.id).toBe('kunafa');
    expect(l.next?.toGo).toBe(110);
    expect(l.ahead[0]?.fraction).toBeCloseTo(340 / 450);
    expect(l.ready.every((x) => x.fraction === 1 && x.toGo === 0)).toBe(true);
  });

  it('exactly the price is ready; nothing ready or everything ready', () => {
    expect(rewardLadder([r('a', 300)], 300).ready).toHaveLength(1);
    const none = rewardLadder([r('a', 300), r('b', 100)], 0);
    expect(none.ready).toEqual([]);
    expect(none.next?.reward.id).toBe('b');
    expect(none.ahead.every((x) => x.fraction === 0)).toBe(true);
    const all = rewardLadder([r('a', 300)], 900);
    expect(all.next).toBeNull();
  });

  it('a free reward is ready, a negative balance counts as none, equal prices keep a stable order', () => {
    expect(rewardLadder([r('free', 0)], 0).ready).toHaveLength(1);
    expect(rewardLadder([r('a', 100)], -50).ahead[0]?.toGo).toBe(100);
    expect(rewardLadder([r('b', 100), r('a', 100)], 0).ahead.map((x) => x.reward.id)).toEqual(['a', 'b']);
  });
});

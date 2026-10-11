import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT, draftArgs, fillFor, newlyReached, trackModel, visibleLabels } from '../logic';

const R = (id: string, target: number) => ({ id, target });
const THREE = [R('c', 300), R('a', 100), R('b', 200)];

describe('trackModel', () => {
  it('sorts by target and places each point against the top one', () => {
    const m = trackModel(THREE, 150);
    expect(m.points.map((p) => p.reward.id)).toEqual(['a', 'b', 'c']);
    expect(m.points.map((p) => p.at)).toEqual([1 / 3, 2 / 3, 1]);
    expect(m.fill).toBe(0.5);
  });

  it('names the first reward not reached as next, with what is left to place', () => {
    const m = trackModel(THREE, 150);
    expect(m.next?.id).toBe('b');
    expect(m.toGo).toBe(50);
    expect(m.reachedCount).toBe(1);
    expect(m.points.map((p) => [p.reached, p.next])).toEqual([
      [true, false],
      [false, true],
      [false, false],
    ]);
  });

  it('counts a target met exactly as reached', () => {
    const m = trackModel(THREE, 200);
    expect(m.points[1]!.reached).toBe(true);
    expect(m.next?.id).toBe('c');
  });

  it('holds the fill full past the top target, with nothing next', () => {
    const m = trackModel(THREE, 999);
    expect(m.fill).toBe(1);
    expect(m.next).toBeNull();
    expect(m.toGo).toBe(0);
    expect(m.reachedCount).toBe(3);
  });

  it('is empty without rewards', () => {
    const m = trackModel([], 40);
    expect(m.points).toEqual([]);
    expect(m.fill).toBe(0);
    expect(m.next).toBeNull();
  });
});

describe('fillFor', () => {
  it('clamps to 0..1', () => {
    expect(fillFor(-5, 100)).toBe(0);
    expect(fillFor(50, 100)).toBe(0.5);
    expect(fillFor(150, 100)).toBe(1);
    expect(fillFor(10, 0)).toBe(0);
  });
});

describe('newlyReached', () => {
  it('lists the targets crossed since the last look', () => {
    expect(newlyReached(THREE, 90, 210).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('starts a first look from zero', () => {
    expect(newlyReached(THREE, null, 120).map((r) => r.id)).toEqual(['a']);
  });

  it('finds nothing when the count did not move up', () => {
    expect(newlyReached(THREE, 120, 120)).toEqual([]);
    expect(newlyReached(THREE, 220, 180)).toEqual([]);
  });

  it('does not repeat a target already seen', () => {
    expect(newlyReached(THREE, 100, 150)).toEqual([]);
  });
});

describe('visibleLabels', () => {
  const pts = (ats: number[], next: number) => ats.map((at, i) => ({ at, next: i === next }));

  it('keeps every label that has room', () => {
    expect(visibleLabels(pts([1 / 3, 2 / 3, 1], 0), 300, 32)).toEqual([true, true, true]);
  });

  it('drops a crowded label but never the next one', () => {
    // 100 and 110 of 300 on a 300 px track are 10 px apart.
    expect(visibleLabels(pts([100 / 300, 110 / 300, 1], 1), 300, 32)).toEqual([false, true, true]);
  });

  it('keeps the top target over a crowded middle one', () => {
    expect(visibleLabels(pts([0.2, 0.95, 1], 0), 300, 32)).toEqual([true, false, true]);
  });

  it('shows nothing before the track has a width', () => {
    expect(visibleLabels(pts([0.5, 1], 0), 0, 32)).toEqual([false, false]);
  });
});

describe('draftArgs', () => {
  const at = (d: Partial<typeof EMPTY_DRAFT>) => draftArgs({ ...EMPTY_DRAFT, ...d }, 'v', 's');

  it('builds the arguments, Arabic digits and separators read', () => {
    expect(at({ target: '٢٠٠', bonus: '50,000', prize: '  Dinner  ' })).toEqual({
      args: { p_venue_id: 'v', p_staff_id: 's', p_target: 200, p_reward_iqd: 50000, p_prize: 'Dinner' },
    });
  });

  it('reads a bonus typed as 0 as no bonus: a prize alone is enough', () => {
    expect(at({ target: '10', bonus: '0', prize: 'Dinner' })).toEqual({
      args: { p_venue_id: 'v', p_staff_id: 's', p_target: 10, p_reward_iqd: 0, p_prize: 'Dinner' },
    });
    expect(at({ target: '10', bonus: '٠', prize: 'Dinner' })).toMatchObject({ args: { p_reward_iqd: 0 } });
    expect(at({ target: '10', bonus: '0', prize: '' })).toEqual({ error: 'staff.rewards.admin.rewardMissing' });
  });

  it('takes a prize alone', () => {
    expect(at({ target: '100', prize: 'Free lunch' })).toMatchObject({
      args: { p_reward_iqd: 0, p_prize: 'Free lunch' },
    });
  });

  it('refuses a missing or out-of-range target', () => {
    expect(at({ bonus: '1000' })).toEqual({ error: 'staff.rewards.admin.targetInvalid' });
    expect(at({ target: '0', bonus: '1000' })).toEqual({ error: 'staff.rewards.admin.targetInvalid' });
    expect(at({ target: '100001', bonus: '1000' })).toEqual({ error: 'staff.rewards.admin.targetInvalid' });
  });

  it('refuses a reward with neither money nor prize, or too much money', () => {
    expect(at({ target: '50' })).toEqual({ error: 'staff.rewards.admin.rewardMissing' });
    expect(at({ target: '50', bonus: 'abc', prize: 'x' })).toEqual({ error: 'staff.rewards.admin.rewardMissing' });
    expect(at({ target: '50', bonus: '10000001' })).toEqual({ error: 'staff.rewards.admin.rewardMissing' });
  });
});

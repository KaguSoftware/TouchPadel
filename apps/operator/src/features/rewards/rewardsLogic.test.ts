import { describe, expect, it } from 'vitest';
import {
  ACTIVE_MAX,
  EMPTY_DRAFT,
  canAddReward,
  cleanPrize,
  draftArgs,
  isReached,
  isRewardStale,
  ordersToGo,
  readRewardsBoard,
  rewardRefusalField,
  validateRewardDraft,
} from './rewardsLogic';

describe('readRewardsBoard', () => {
  it('reads the month and each person as the server sent them, rewards lowest target first', () => {
    const b = readRewardsBoard({
      month: '2026-10-01',
      month_end: '2026-10-31',
      days_left: 21,
      people: [
        {
          staff_id: 's1',
          name: 'Hasan',
          role: 'waiter',
          count: 84,
          last_month_count: 120,
          rewards: [
            { id: 'r2', target: 200, reward_iqd: 50000, prize: null, set_at: '2026-10-01T09:00:00Z' },
            { id: 'r1', target: 50, reward_iqd: 0, prize: 'Dinner for two', set_at: '2026-10-01T09:00:00Z' },
            { target: 10 },
          ],
        },
        { staff_id: 's2', name: 'Rusul', role: 'cashier' },
        { name: 'no id' },
      ],
    });
    expect(b.month).toBe('2026-10-01');
    expect(b.daysLeft).toBe(21);
    expect(b.people).toHaveLength(2);
    const [h, r] = b.people;
    expect(h!.role).toBe('waiter');
    expect(h!.count).toBe(84);
    expect(h!.lastMonthCount).toBe(120);
    expect(h!.rewards.map((x) => x.id)).toEqual(['r1', 'r2']);
    expect(h!.rewards[0]).toEqual({ id: 'r1', target: 50, rewardIqd: 0, prize: 'Dinner for two', setAt: '2026-10-01T09:00:00Z' });
    expect(r!.count).toBe(0);
    expect(r!.rewards).toEqual([]);
  });

  it('reads nothing as an empty board', () => {
    expect(readRewardsBoard(undefined)).toEqual({ month: null, monthEnd: null, daysLeft: null, people: [] });
  });
});

describe('reached and to go', () => {
  it('compares one person’s count with one of their own targets', () => {
    expect(isReached(200, 200)).toBe(true);
    expect(isReached(199, 200)).toBe(false);
    expect(ordersToGo(184, 200)).toBe(16);
    expect(ordersToGo(250, 200)).toBe(0);
  });

  it('offers Add reward below five', () => {
    const r = { id: 'x', target: 1, rewardIqd: 1, prize: null, setAt: null };
    expect(canAddReward({ rewards: Array.from({ length: ACTIVE_MAX - 1 }, () => r) })).toBe(true);
    expect(canAddReward({ rewards: Array.from({ length: ACTIVE_MAX }, () => r) })).toBe(false);
  });
});

describe('validateRewardDraft', () => {
  it('needs a target from 1 to 100,000', () => {
    expect(validateRewardDraft({ ...EMPTY_DRAFT, bonus: 1000 })).toEqual(['target']);
    expect(validateRewardDraft({ target: '0', bonus: 1000, prize: '' })).toEqual(['target']);
    expect(validateRewardDraft({ target: '100001', bonus: 1000, prize: '' })).toEqual(['target']);
    expect(validateRewardDraft({ target: '100000', bonus: 1000, prize: '' })).toEqual([]);
  });

  it('needs a bonus, a prize, or both', () => {
    expect(validateRewardDraft({ target: '200', bonus: null, prize: '  ' })).toEqual(['reward']);
    expect(validateRewardDraft({ target: '200', bonus: 0, prize: '' })).toEqual(['reward']);
    expect(validateRewardDraft({ target: '200', bonus: null, prize: 'Dinner for two' })).toEqual([]);
  });

  it('holds the bonus to 10,000,000 and the prize to 80 characters as Postgres counts them', () => {
    expect(validateRewardDraft({ target: '200', bonus: 10_000_001, prize: '' })).toEqual(['bonus']);
    expect(validateRewardDraft({ target: '200', bonus: null, prize: 'ع'.repeat(80) })).toEqual([]);
    expect(validateRewardDraft({ target: '200', bonus: null, prize: '🎁'.repeat(80) })).toEqual([]);
    expect(validateRewardDraft({ target: '200', bonus: 5000, prize: 'x'.repeat(81) })).toEqual(['prize']);
  });

  it('sends the target as a number, an empty bonus as 0 and the prize trimmed', () => {
    expect(draftArgs({ target: '200', bonus: null, prize: '  Dinner for two ' })).toEqual({ target: 200, rewardIqd: 0, prize: 'Dinner for two' });
    expect(draftArgs({ target: '50', bonus: 25000, prize: '' })).toEqual({ target: 50, rewardIqd: 25000, prize: null });
    expect(cleanPrize('   ')).toBeNull();
  });
});

describe('refusals', () => {
  it('marks the field a refusal names', () => {
    expect(rewardRefusalField('REWARD_TARGET_TAKEN', null)).toBe('target');
    expect(rewardRefusalField('REWARD_INVALID', 'target')).toBe('target');
    expect(rewardRefusalField('REWARD_INVALID', 'reward_iqd')).toBe('bonus');
    expect(rewardRefusalField('REWARD_INVALID', 'prize')).toBe('prize');
    expect(rewardRefusalField('REWARD_INVALID', 'empty')).toBe('reward');
    expect(rewardRefusalField('REWARD_LIMIT', null)).toBeNull();
  });

  it('refetches the board on a refusal that means it moved', () => {
    expect(isRewardStale('REWARD_LIMIT')).toBe(true);
    expect(isRewardStale('REWARD_STAFF_INVALID')).toBe(true);
    expect(isRewardStale('REF_NOT_FOUND')).toBe(true);
    expect(isRewardStale('REWARD_INVALID')).toBe(false);
    expect(isRewardStale(null)).toBe(false);
  });
});

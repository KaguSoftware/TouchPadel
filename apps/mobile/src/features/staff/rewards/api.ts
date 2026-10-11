/**
 * Rewards for orders placed on the staff phone (migration 0332): the owner sets
 * a person's rewards (a number of orders in a business month, for a bonus, a
 * prize or both), and each person reads only their own progress. The count is
 * the server's: the person's orders at the branch this business month, voided
 * ones left out. The phone never counts and never adds money up.
 *
 * Each query stores the RPC's result as it comes, as deductions/api.ts does.
 */
import { staffRpc } from '../api';
import type { RewardArgs } from './logic';

/** One reward as the person reads it. */
export interface MyReward {
  id: string;
  target: number;
  reward_iqd: number;
  prize: string | null;
}

/** A reward reached last month. */
export interface ReachedReward {
  target: number;
  reward_iqd: number;
  prize: string | null;
  /**
   * The wage month (`YYYY-MM-DD`, its first day) the bonus is paid in, once the
   * month has closed and the server wrote the bonus down (0333); null before.
   */
  pay_month: string | null;
}

/** app.my_rewards: the caller's own month, never anybody else's. */
export interface MyRewards {
  /** The business month's first day, `YYYY-MM-DD`. */
  month: string;
  month_end: string;
  /** Days left in the month, today counted. */
  days_left: number;
  /** The caller's orders this business month at the branch, voided ones left out. */
  count: number;
  /** Active rewards, by target. */
  rewards: MyReward[];
  last_month: { month: string; count: number; reached: ReachedReward[] };
}

export function fetchMyRewards(venueId: string): Promise<MyRewards> {
  return staffRpc<MyRewards>('my_rewards', { p_venue_id: venueId });
}

// ── The owner's page ────────────────────────────────────────────────────────

export interface BoardReward extends MyReward {
  set_at: string;
}

export interface BoardPerson {
  staff_id: string;
  name: string;
  role: string;
  count: number;
  last_month_count: number;
  rewards: BoardReward[];
}

/** app.staff_rewards_board: the branch's waiters, cashiers and managers, by name. */
export interface RewardsBoard {
  month: string;
  month_end: string;
  days_left: number;
  people: BoardPerson[];
}

export function fetchRewardsBoard(venueId: string): Promise<RewardsBoard> {
  return staffRpc<RewardsBoard>('staff_rewards_board', { p_venue_id: venueId });
}

/**
 * State-idempotent without a key: an active reward's target is unique per
 * person, so a retried save is refused (REWARD_TARGET_TAKEN) rather than doubled.
 */
export function setStaffReward(args: RewardArgs): Promise<string> {
  return staffRpc<string>('set_staff_reward', { ...args });
}

export function endStaffReward(id: string): Promise<void> {
  return staffRpc<void>('end_staff_reward', { p_id: id });
}

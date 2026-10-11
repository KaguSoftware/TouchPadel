/**
 * The owner's rewards reads and writes (0332): app.staff_rewards_board for the
 * branch on the rail, app.set_staff_reward and app.end_staff_reward. Online
 * calls through appRpc, not queued mutations: a reward is set from the
 * owner's machine with the board in front of them, and a refusal (a target
 * taken, five already set) belongs beside the form at once.
 *
 * Feature-private keys under ['rewards']: one invalidation after a write
 * refreshes the board. Wages are not touched by a write here: a bonus reaches
 * a wage only when its business month ends (0333).
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { currentBranchId } from '../../lib/venueScope';

/** The board of the branch the server resolves from the request's scope headers. */
export function fetchRewardsBoard(): Promise<unknown> {
  return appRpc<unknown>('staff_rewards_board', {});
}

export interface SetRewardArgs {
  staffId: string;
  target: number;
  rewardIqd: number;
  prize: string | null;
}

/** Returns the new reward's id. */
export function setStaffReward(a: SetRewardArgs): Promise<string> {
  return appRpc<string>('set_staff_reward', {
    p_venue_id: currentBranchId(),
    p_staff_id: a.staffId,
    p_target: a.target,
    p_reward_iqd: a.rewardIqd,
    p_prize: a.prize,
  });
}

export function endStaffReward(id: string): Promise<unknown> {
  return appRpc('end_staff_reward', { p_id: id });
}

export const RK = {
  all: ['rewards'] as const satisfies QueryKey,
  board: ['rewards', 'board'] as const satisfies QueryKey,
} as const;

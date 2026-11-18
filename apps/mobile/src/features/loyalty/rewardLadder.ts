import type { LoyaltyReward } from '@touch/core/loyalty';

/**
 * The rewards in the order Points & rewards draws them (Majed, 2026-11-16, "AD-1"): cheapest
 * first, the ones the balance already covers, then the "You" line, then the ones still to reach,
 * each tile filled with green by how much of its price the balance holds.
 */
export interface RewardTile {
  reward: LoyaltyReward;
  /** The balance covers it: the tile is all green with Redeem on it. */
  ready: boolean;
  /** How much of its price the balance holds, 0..1 (1 when ready or free). */
  fraction: number;
  /** Points still to earn (0 when ready). */
  toGo: number;
}

export interface RewardLadder {
  ready: RewardTile[];
  ahead: RewardTile[];
  /** The cheapest reward still out of reach, named on the "You" line; null when all are ready. */
  next: RewardTile | null;
}

export function rewardLadder(rewards: readonly LoyaltyReward[], balance: number): RewardLadder {
  const have = Math.max(0, balance);
  const tiles = [...rewards]
    .sort((a, b) => a.cost_points - b.cost_points || a.name_en.localeCompare(b.name_en) || a.id.localeCompare(b.id))
    .map((reward): RewardTile => {
      const fraction = reward.cost_points > 0 ? Math.min(1, have / reward.cost_points) : 1;
      return { reward, ready: fraction >= 1, fraction, toGo: Math.max(0, reward.cost_points - have) };
    });
  const ready = tiles.filter((x) => x.ready);
  const ahead = tiles.filter((x) => !x.ready);
  return { ready, ahead, next: ahead[0] ?? null };
}

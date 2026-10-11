/**
 * The reward track's geometry and states, from the server's figures (0332).
 * Nothing here is money: a reward's amount is carried, never added up.
 *
 * PURE (vitest).
 */
import { parseTypedAmount, westernDigits } from '@touch/core';
import type { MessageKey } from '@touch/i18n';

export interface TrackReward {
  id: string;
  target: number;
}

export interface TrackPoint<R extends TrackReward> {
  reward: R;
  /** Where the point sits on the track, 0..1 from its start. */
  at: number;
  reached: boolean;
  /** The first reward not yet reached: the one the card is about. */
  next: boolean;
}

export interface TrackModel<R extends TrackReward> {
  points: TrackPoint<R>[];
  /** The fill, 0..1: the count against the highest target, held at 1 past it. */
  fill: number;
  next: R | null;
  /** Orders still to place for `next`; 0 when every reward is reached. */
  toGo: number;
  reachedCount: number;
}

/** The track for `count` orders against these rewards (any order; sorted here by target). */
export function trackModel<R extends TrackReward>(rewards: readonly R[], count: number): TrackModel<R> {
  const sorted = [...rewards].sort((a, b) => a.target - b.target);
  const max = sorted.length > 0 ? sorted[sorted.length - 1]!.target : 0;
  const safe = Math.max(0, count);
  const next = sorted.find((r) => r.target > safe) ?? null;
  return {
    points: sorted.map((reward) => ({
      reward,
      at: max > 0 ? reward.target / max : 0,
      reached: reward.target <= safe,
      next: reward === next,
    })),
    fill: fillFor(safe, max),
    next,
    toGo: next ? next.target - safe : 0,
    reachedCount: sorted.filter((r) => r.target <= safe).length,
  };
}

/** The fill for a count against the highest target, 0..1. */
export function fillFor(count: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, count) / max);
}

/**
 * The rewards crossed since the person last looked: a target above what they
 * saw and at or below the count now. A first look (nothing stored) starts from
 * zero, so a reward reached before it is still news.
 */
export function newlyReached<R extends TrackReward>(
  rewards: readonly R[],
  seen: number | null,
  count: number,
): R[] {
  const from = seen ?? 0;
  if (count <= from) return [];
  return [...rewards]
    .filter((r) => r.target > from && r.target <= count)
    .sort((a, b) => a.target - b.target);
}

/**
 * Which point labels fit: a label is dropped when its centre is closer than
 * `minGap` px to the last one kept. The next reward's label always shows, and
 * the last point's (the top target) unless the next one crowds it.
 */
export function visibleLabels(
  points: readonly { at: number; next: boolean }[],
  width: number,
  minGap: number,
): boolean[] {
  const keep = points.map(() => false);
  if (width <= 0) return keep;
  const nextIndex = points.findIndex((p) => p.next);
  if (nextIndex >= 0) keep[nextIndex] = true;
  const fits = (i: number) =>
    keep.every((k, j) => !k || j === i || Math.abs(points[j]!.at - points[i]!.at) * width >= minGap);
  const last = points.length - 1;
  if (last >= 0 && !keep[last] && fits(last)) keep[last] = true;
  for (let i = 0; i < points.length; i++) {
    if (!keep[i] && fits(i)) keep[i] = true;
  }
  return keep;
}

// ── The owner's form ────────────────────────────────────────────────────────

/** The server's bounds (0332), checked here first so the owner reads why at once. */
export const TARGET_MAX = 100_000;
export const BONUS_MAX = 10_000_000;

export interface RewardDraft {
  target: string;
  bonus: string;
  prize: string;
}

export const EMPTY_DRAFT: RewardDraft = { target: '', bonus: '', prize: '' };

export interface RewardArgs {
  p_venue_id: string;
  p_staff_id: string;
  p_target: number;
  p_reward_iqd: number;
  p_prize: string | null;
}

/** The draft as set_staff_reward's arguments, or the key of what is wrong with it. */
export function draftArgs(
  draft: RewardDraft,
  venueId: string,
  staffId: string,
): { args: RewardArgs } | { error: MessageKey } {
  const target = parseTypedAmount(draft.target);
  if (target === null || target > TARGET_MAX) return { error: 'staff.rewards.admin.targetInvalid' };
  const bonusText = draft.bonus.trim();
  // A bonus typed as 0 (in either digit set) is no bonus, as an empty field is.
  const zero = /^0+$/.test(westernDigits(bonusText).replace(/[,\s٬]/g, ''));
  const bonus = bonusText === '' || zero ? 0 : parseTypedAmount(bonusText);
  const prize = draft.prize.trim();
  if (bonus === null || bonus > BONUS_MAX || (bonus === 0 && prize === '')) {
    return { error: 'staff.rewards.admin.rewardMissing' };
  }
  return {
    args: {
      p_venue_id: venueId,
      p_staff_id: staffId,
      p_target: target,
      p_reward_iqd: bonus,
      p_prize: prize === '' ? null : prize,
    },
  };
}

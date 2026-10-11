/**
 * Pure helpers for the owner's Rewards page (0332–0333): the reader of
 * app.staff_rewards_board, the add form's rules (app.set_staff_reward's own
 * limits, stated before it refuses) and the field a refusal names.
 *
 * Nothing here adds money up or ranks anyone: the board is the server's,
 * ordered by name, and "Reached" is one person's count against one of their
 * own targets. The reader takes the payload as returned and reads it
 * defensively.
 */
import type { StaffRole } from '../../lib/auth';
import { isObject, list, num, role, str } from '../roleExtras/roleExtrasLogic';

/** The server's limits (0332 staff_rewards CHECKs, app.set_staff_reward). */
export const TARGET_MIN = 1;
export const TARGET_MAX = 100_000;
export const BONUS_MAX = 10_000_000;
export const PRIZE_MAX = 80;
/** Active rewards per person (REWARD_LIMIT). */
export const ACTIVE_MAX = 5;

const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));

// ---------------------------------------------------------------------------
// app.staff_rewards_board
// ---------------------------------------------------------------------------

export interface BoardReward {
  id: string;
  target: number;
  rewardIqd: number;
  prize: string | null;
  setAt: string | null;
}

export interface BoardPerson {
  staffId: string;
  name: string;
  role: StaffRole | null;
  /** Orders placed this business month, voided ones excluded. */
  count: number;
  lastMonthCount: number;
  /** Active rewards, lowest target first. */
  rewards: BoardReward[];
}

export interface RewardsBoard {
  /** 'YYYY-MM-01', the branch's business month. */
  month: string | null;
  monthEnd: string | null;
  /** Days left in the month, today counted. */
  daysLeft: number | null;
  /** By name, as the server ordered them. */
  people: BoardPerson[];
}

export function readRewardsBoard(payload: unknown): RewardsBoard {
  const p = isObject(payload) ? payload : {};
  const days = num(p.days_left);
  return {
    month: str(p.month),
    monthEnd: str(p.month_end),
    daysLeft: days === null ? null : Math.max(0, Math.trunc(days)),
    people: list(p.people)
      .filter((r) => typeof r.staff_id === 'string')
      .map(
        (r): BoardPerson => ({
          staffId: str(r.staff_id) ?? '',
          name: str(r.name) ?? '',
          role: role(r.role),
          count: count(r.count),
          lastMonthCount: count(r.last_month_count),
          rewards: list(r.rewards)
            .filter((x) => typeof x.id === 'string')
            .map((x) => ({
              id: str(x.id) ?? '',
              target: count(x.target),
              rewardIqd: num(x.reward_iqd) ?? 0,
              prize: str(x.prize),
              setAt: str(x.set_at),
            }))
            .sort((a, b) => a.target - b.target),
        }),
      ),
  };
}

/** A person's own count has reached one of their own targets. */
export function isReached(count: number, target: number): boolean {
  return count >= target;
}

/** Orders still to place for a target; 0 once reached. */
export function ordersToGo(count: number, target: number): number {
  return Math.max(0, target - count);
}

/** Add reward is offered below the per-person limit (REWARD_LIMIT otherwise). */
export function canAddReward(person: Pick<BoardPerson, 'rewards'>): boolean {
  return person.rewards.length < ACTIVE_MAX;
}

// ---------------------------------------------------------------------------
// The add form
// ---------------------------------------------------------------------------

export interface RewardDraft {
  /** The orders box as typed: digits only. */
  target: string;
  /** null when empty: a prize-only reward. */
  bonus: number | null;
  prize: string;
}

export const EMPTY_DRAFT: RewardDraft = { target: '', bonus: null, prize: '' };

/** `reward` is the form as a whole: neither a bonus nor a prize. */
export type RewardField = 'target' | 'bonus' | 'prize' | 'reward';

/** The prize as app.set_staff_reward stores it: trimmed, null when empty. */
export function cleanPrize(prize: string): string | null {
  const p = prize.trim();
  return p === '' ? null : p;
}

/** Characters as Postgres length() counts them (code points), not UTF-16 units. */
function charLength(s: string): number {
  return [...s].length;
}

/** Every rule app.set_staff_reward applies to the figures, stated before it refuses. */
export function validateRewardDraft(d: RewardDraft): RewardField[] {
  const issues: RewardField[] = [];
  const t = d.target.trim();
  const target = /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isInteger(target) || target < TARGET_MIN || target > TARGET_MAX) issues.push('target');
  if (d.bonus !== null && (!Number.isInteger(d.bonus) || d.bonus < 0 || d.bonus > BONUS_MAX)) issues.push('bonus');
  const prize = cleanPrize(d.prize);
  if (prize !== null && charLength(prize) > PRIZE_MAX) issues.push('prize');
  if ((d.bonus ?? 0) === 0 && prize === null) issues.push('reward');
  return issues;
}

/** The arguments of a valid draft (validateRewardDraft first). */
export function draftArgs(d: RewardDraft): { target: number; rewardIqd: number; prize: string | null } {
  return { target: Number(d.target.trim()), rewardIqd: d.bonus ?? 0, prize: cleanPrize(d.prize) };
}

/** The field a refusal of app.set_staff_reward names, so the form marks it. */
export function rewardRefusalField(code: string | null, hint: string | null): RewardField | null {
  if (code === 'REWARD_TARGET_TAKEN') return 'target';
  if (code !== 'REWARD_INVALID') return null;
  if (hint === 'target') return 'target';
  if (hint === 'reward_iqd') return 'bonus';
  if (hint === 'prize') return 'prize';
  if (hint === 'empty') return 'reward';
  return null;
}

/**
 * The refusals that mean the board is out of date: the person left the
 * branch or changed role, five are already set, or the reward is already
 * gone. The page refetches, so the row says what happened.
 */
export const REWARD_STALE: ReadonlySet<string> = new Set(['REWARD_STAFF_INVALID', 'REWARD_LIMIT', 'REWARD_TARGET_TAKEN', 'REF_NOT_FOUND']);

export function isRewardStale(code: string | null): boolean {
  return code !== null && REWARD_STALE.has(code);
}

/**
 * Reward vouchers on the phone (0415, Majed 2026-11-13): the guest redeems a reward on Points &
 * rewards, the points leave the balance at once, and a fixed single-use QR for that one reward
 * lives 15 minutes for the till to scan. Pure: parsing, the countdown and what the screen shows.
 *
 * Every time is the server's: `voucherMsLeft` (core) corrects the phone's clock by the `now` the
 * read came with, so a phone set five minutes fast never shows a code as dead that the till takes.
 */
import {
  VOUCHER_CODE_RE,
  voucherMsLeft,
  type MyRewardVouchers,
  type RedeemRewardResult,
  type RewardVoucher,
  type VoucherStatus,
} from '@touch/core/loyalty';

/** The last stretch, shown in amber so the guest heads to the counter. */
export const VOUCHER_URGENT_MS = 2 * 60 * 1000;

/** How often an open voucher asks whether the till has scanned it. */
export const VOUCHER_POLL_MS = 4000;

export const NO_VOUCHERS: MyRewardVouchers = { now: new Date(0).toISOString(), vouchers: [] };

const STATUSES: readonly VoucherStatus[] = ['active', 'used', 'cancelled', 'expired'];
const KINDS: readonly RewardVoucher['kind'][] = ['item', 'court_hour', 'iqd_off'];

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** One voucher row, or null when it is not one (a malformed row is dropped, never drawn). */
export function parseRewardVoucher(raw: unknown): RewardVoucher | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const code = str(o.code);
  const rewardId = str(o.reward_id);
  const createdAt = str(o.created_at);
  const expiresAt = str(o.expires_at);
  const status = o.status as VoucherStatus;
  const kind = o.kind as RewardVoucher['kind'];
  const points = Number(o.points);
  if (!id || !code || !VOUCHER_CODE_RE.test(code) || !rewardId || !createdAt || !expiresAt) return null;
  if (!STATUSES.includes(status) || !Number.isFinite(points)) return null;
  return {
    id,
    code,
    reward_id: rewardId,
    name_en: str(o.name_en) ?? '',
    name_ar: str(o.name_ar) ?? str(o.name_en) ?? '',
    kind: KINDS.includes(kind) ? kind : 'item',
    points,
    status,
    created_at: createdAt,
    expires_at: expiresAt,
    ended_at: str(o.ended_at),
  };
}

/** app.my_reward_vouchers: `{now, vouchers}`; anything unreadable is no vouchers. */
export function parseMyRewardVouchers(raw: unknown): MyRewardVouchers {
  if (!raw || typeof raw !== 'object') return NO_VOUCHERS;
  const o = raw as Record<string, unknown>;
  const now = str(o.now) ?? new Date().toISOString();
  const list = Array.isArray(o.vouchers) ? o.vouchers : [];
  return {
    now,
    vouchers: list.map(parseRewardVoucher).filter((v): v is RewardVoucher => v !== null),
  };
}

/** app.redeem_reward: the new voucher with the balance and the server clock. */
export function parseRedeemResult(raw: unknown): RedeemRewardResult {
  const v = parseRewardVoucher(raw);
  if (!v) throw new Error('VOUCHER_MALFORMED');
  const o = raw as Record<string, unknown>;
  return { ...v, balance: Number(o.balance) || 0, now: str(o.now) ?? new Date().toISOString() };
}

/** What the voucher screen shows. */
export type VoucherPhase = 'active' | 'urgent' | 'collected' | 'cancelled' | 'expired';

/**
 * The phase from the server's status and the time left. An active voucher whose time ran out
 * reads as expired at once (the server gives the points back within a minute and says so on
 * the next read); the till still takes it for that minute, which costs the guest nothing.
 */
export function voucherPhase(status: VoucherStatus, msLeft: number): VoucherPhase {
  if (status === 'used') return 'collected';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'expired' || msLeft <= 0) return 'expired';
  return msLeft <= VOUCHER_URGENT_MS ? 'urgent' : 'active';
}

/** "14:32": whole minutes and seconds left, rounded up so 0:00 means gone. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** The share of the 15 minutes still left, 0..1 (the bar's fill). */
export function voucherFraction(msLeft: number, lifetimeMs: number): number {
  if (lifetimeMs <= 0) return 0;
  return Math.min(1, Math.max(0, msLeft / lifetimeMs));
}

/** The vouchers still to collect, soonest to end first (the strip on Points & rewards). */
export function activeVouchers(
  data: MyRewardVouchers,
  readAt: number,
  deviceNow: number,
): (RewardVoucher & { msLeft: number })[] {
  return data.vouchers
    .filter((v) => v.status === 'active')
    .map((v) => ({ ...v, msLeft: voucherMsLeft(v.expires_at, data.now, readAt, deviceNow) }))
    .filter((v) => v.msLeft > 0)
    .sort((a, b) => a.msLeft - b.msLeft);
}

export { voucherMsLeft };

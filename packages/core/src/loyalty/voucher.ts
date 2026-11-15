// Reward vouchers (0415, Majed 2026-11-13): the guest redeems a reward in the app and gets a fixed,
// single-use code, shown as a QR that the till scans. The code is TPV- and twelve characters of
// the member code's Crockford base32 alphabet (no I L O U). It lives 15 minutes.

/** The canonical voucher code, as the server stores it and the QR carries it. */
export const VOUCHER_CODE_RE = /^TPV-[0-9A-HJKMNP-TV-Z]{12}$/;

/** How long a voucher lives after Redeem (the server's expires_at; shown as a countdown). */
export const VOUCHER_LIFETIME_MS = 15 * 60 * 1000;

/**
 * A voucher code from what a scanner or a person typed: any case, spaces or dashes anywhere
 * (the phone shows it as TPV-XXXX-XXXX-XXXX). Null when it is not one.
 */
export function parseVoucherCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  const m = /^TPV([0-9A-HJKMNP-TV-Z]{12})$/.exec(s);
  return m ? `TPV-${m[1]}` : null;
}

/** True when a scanner burst or a typed string is a reward voucher, not a member card. */
export function isVoucherCode(raw: string): boolean {
  return parseVoucherCode(raw) !== null;
}

/** The code for reading aloud or typing: TPV-XXXX-XXXX-XXXX. */
export function formatVoucherCode(code: string): string {
  const c = parseVoucherCode(code);
  if (!c) return code;
  const body = c.slice(4);
  return `TPV-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

export type VoucherStatus = 'active' | 'used' | 'cancelled' | 'expired';

/** One voucher as app.my_reward_vouchers and app.redeem_reward answer it. */
export interface RewardVoucher {
  id: string;
  code: string;
  reward_id: string;
  name_en: string;
  name_ar: string;
  kind: 'item' | 'court_hour' | 'iqd_off';
  points: number;
  status: VoucherStatus;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
}

/** app.redeem_reward: the new voucher, the balance after, and the server clock. */
export interface RedeemRewardResult extends RewardVoucher {
  balance: number;
  now: string;
  duplicate?: boolean;
}

/** app.my_reward_vouchers. */
export interface MyRewardVouchers {
  now: string;
  vouchers: RewardVoucher[];
}

/** app.use_reward_voucher: what the till gave. */
export interface UseVoucherResult {
  voucher_id: string;
  reward_id: string;
  name_en: string;
  name_ar: string;
  kind: RewardVoucher['kind'];
  points: number;
  amount_iqd: number;
  adjustment_id: string | null;
  order_item_id: string | null;
  item_added: boolean;
  court_reward_id: string | null;
  reservation_id: string | null;
  member_name: string | null;
}

/**
 * Milliseconds a voucher has left, by the server's clock: `serverNow` is the `now` of the read
 * that brought it, `readAt` the device time of that read, so a wrong phone clock does not bend
 * the countdown. Never below 0.
 */
export function voucherMsLeft(expiresAt: string, serverNow: string, readAt: number, deviceNow: number): number {
  const skew = Date.parse(serverNow) - readAt;
  return Math.max(0, Date.parse(expiresAt) - (deviceNow + skew));
}

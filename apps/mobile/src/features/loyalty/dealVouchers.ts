/**
 * A deal's own QR on the phone (0445, Majed 2026-11-15): Redeem on a deal gives a fixed
 * single-use TPD- code alive 15 minutes, like a reward's. PURE: parsing only (the countdown and
 * its phases are vouchers.ts's, shared with the rewards).
 */
import { DEAL_VOUCHER_CODE_RE, type DealVoucher, type MyDealVouchers, type RedeemDealResult, type VoucherStatus } from '@touch/core/loyalty';

export const NO_DEAL_VOUCHERS: MyDealVouchers = { now: new Date(0).toISOString(), vouchers: [] };

const STATUSES: readonly VoucherStatus[] = ['active', 'used', 'cancelled', 'expired'];
const TYPES: readonly DealVoucher['type'][] = ['percent', 'amount', 'free_item'];
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** One deal code, or null when it is not one (a malformed row is dropped, never drawn). */
export function parseDealVoucher(raw: unknown): DealVoucher | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  const code = str(o.code);
  const promotionId = str(o.promotion_id);
  const createdAt = str(o.created_at);
  const expiresAt = str(o.expires_at);
  const status = o.status as VoucherStatus;
  const type = o.type as DealVoucher['type'];
  if (!id || !code || !DEAL_VOUCHER_CODE_RE.test(code) || !promotionId || !createdAt || !expiresAt) return null;
  if (!STATUSES.includes(status) || !TYPES.includes(type) || !Number.isFinite(Date.parse(expiresAt))) return null;
  const value = typeof o.value === 'number' ? o.value : Number(o.value);
  return {
    id,
    code,
    promotion_id: promotionId,
    name_en: typeof o.name_en === 'string' ? o.name_en : '',
    name_ar: typeof o.name_ar === 'string' ? o.name_ar : '',
    type,
    value: Number.isFinite(value) ? value : 0,
    status,
    created_at: createdAt,
    expires_at: expiresAt,
    ended_at: str(o.ended_at),
  };
}

/** app.my_deal_vouchers. Anything unreadable reads as none. */
export function parseMyDealVouchers(raw: unknown): MyDealVouchers {
  if (!raw || typeof raw !== 'object') return NO_DEAL_VOUCHERS;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.vouchers) ? o.vouchers : [];
  return {
    now: str(o.now) ?? new Date().toISOString(),
    vouchers: list.map(parseDealVoucher).filter((v): v is DealVoucher => v !== null),
  };
}

/** app.redeem_deal. A code that does not parse is a server fault. */
export function parseRedeemDeal(raw: unknown): RedeemDealResult {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const voucher = parseDealVoucher(o.voucher);
  if (!voucher) throw new Error('VOUCHER_MALFORMED');
  return { now: str(o.now) ?? new Date().toISOString(), voucher };
}

/** The live code for one deal, if the guest has one (it is the deal's "Show code"). */
export function liveDealVoucher(
  vouchers: MyDealVouchers | null | undefined,
  promotionId: string,
): DealVoucher | null {
  return vouchers?.vouchers.find((v) => v.promotion_id === promotionId && v.status === 'active') ?? null;
}

/**
 * The Touch Shop sales reward (0355, Sait 2026-10-21): whoever rings up a shop
 * sale earns a percent of what the customer paid for their lines, on their
 * wage. One percent for the whole shop (shop_sale_reward_pct, the owner's).
 *
 * app.shop_reward_info is the one read: the percent, each shop size's price,
 * cost and reward, and the caller's own month so far. The shop assistant cannot
 * read cafe_settings, so the percent comes from there too. A reward shown
 * before the sale is at the shelf price (an estimate); the wage pays on what
 * was charged, after discounts and refunds.
 */
import { appRpc } from '../../lib/appRpc';

/** Under the Products key, so whatever refreshes the products refreshes this. */
export const SHOP_REWARD_KEY = ['stock', 'products', 'reward'] as const;

export interface ShopRewardProduct {
  variantId: string;
  priceIqd: number;
  /** The latest delivery's cost, else the one typed on the product; null when neither. */
  costIqd: number | null;
  rewardIqd: number;
}

export interface ShopRewardInfo {
  pct: number;
  products: ShopRewardProduct[];
  /** The caller's own shop sales this business month; null for the owner, who earns none. */
  me: { monthSalesIqd: number; monthRewardIqd: number } | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Reads the RPC's answer defensively: anything unreadable is left out, never shown as 0. */
export function readShopRewardInfo(raw: unknown): ShopRewardInfo {
  const r = isObject(raw) ? raw : {};
  const products = (Array.isArray(r.products) ? r.products : [])
    .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.variant_id === 'string')
    .map((p) => ({
      variantId: p.variant_id as string,
      priceIqd: num(p.price_iqd) ?? 0,
      costIqd: num(p.cost_iqd),
      rewardIqd: num(p.reward_iqd) ?? 0,
    }));
  const me = isObject(r.me)
    ? { monthSalesIqd: num(r.me.month_sales_iqd) ?? 0, monthRewardIqd: num(r.me.month_reward_iqd) ?? 0 }
    : null;
  return { pct: Math.min(50, Math.max(0, Math.trunc(num(r.pct) ?? 0))), products, me };
}

export async function fetchShopRewardInfo(): Promise<ShopRewardInfo> {
  return readShopRewardInfo(await appRpc('shop_reward_info', {}));
}

/** What a line of `qty` at `priceIqd` earns at `pct`, rounded down per line as the server does. */
export function rewardFor(priceIqd: number, pct: number, qty = 1): number {
  if (pct <= 0 || priceIqd <= 0 || qty <= 0) return 0;
  return Math.floor((priceIqd * qty * pct) / 100);
}

/** What a basket earns at the shelf price: the sum of its lines' rewards. */
export function basketReward(lines: readonly { priceIqd: number; qty: number }[], pct: number): number {
  return lines.reduce((sum, l) => sum + rewardFor(l.priceIqd, pct, l.qty), 0);
}

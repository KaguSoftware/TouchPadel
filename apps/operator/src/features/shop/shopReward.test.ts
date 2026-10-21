import { describe, expect, it } from 'vitest';
import { basketReward, readShopRewardInfo, rewardFor } from './shopReward';

describe('shop sales reward (0355)', () => {
  it('rounds down per line, as the server does', () => {
    expect(rewardFor(12_345, 10)).toBe(1_234);
    expect(rewardFor(12_345, 10, 2)).toBe(2_469);
    expect(rewardFor(200_000, 15)).toBe(30_000);
    expect(rewardFor(50_000, 0)).toBe(0);
    expect(rewardFor(0, 10)).toBe(0);
  });

  it('adds a basket up line by line', () => {
    expect(basketReward([{ priceIqd: 12_345, qty: 2 }, { priceIqd: 200_000, qty: 1 }], 10)).toBe(22_469);
    expect(basketReward([], 10)).toBe(0);
  });

  it('reads the server’s answer, leaving out what it cannot read', () => {
    const info = readShopRewardInfo({
      pct: 10,
      products: [
        { variant_id: 'v1', price_iqd: 12_345, cost_iqd: 8_000, reward_iqd: 1_234 },
        { variant_id: 'v2', price_iqd: 200_000, cost_iqd: null, reward_iqd: 20_000 },
        { price_iqd: 1 },
      ],
      me: { month: '2026-10-01', month_sales_iqd: 250_000, month_reward_iqd: 25_000 },
    });
    expect(info.pct).toBe(10);
    expect(info.products).toEqual([
      { variantId: 'v1', priceIqd: 12_345, costIqd: 8_000, rewardIqd: 1_234 },
      { variantId: 'v2', priceIqd: 200_000, costIqd: null, rewardIqd: 20_000 },
    ]);
    expect(info.me).toEqual({ monthSalesIqd: 250_000, monthRewardIqd: 25_000 });
  });

  it('reads the owner’s answer (no month of their own) and nothing at all as no reward', () => {
    expect(readShopRewardInfo({ pct: 10, products: [], me: null }).me).toBeNull();
    expect(readShopRewardInfo(null)).toEqual({ pct: 0, products: [], me: null });
    expect(readShopRewardInfo({ pct: 80 }).pct).toBe(50);
  });
});

import { describe, expect, it } from 'vitest';
import { deliveredWhen, lineDraftProblem, lineKind, purchaseHasShopLine, readPurchases, unitCost, type PurchaseLine } from './driverPurchasesLogic';

// The pure half of Goods in ▸ "Bought by the driver" (DriverPurchases.tsx).

const line = (over: Record<string, unknown>) => ({
  id: 'l-milk',
  ingredient_id: 'ing-milk',
  ingredient_active: true,
  name_en: 'Milk',
  name_ar: 'حليب',
  unit: 'ml',
  label: null,
  qty: 2000,
  price_iqd: 6000,
  status: 'to_receive',
  ...over,
});

const purchase = (lines: unknown[], over: Record<string, unknown> = {}) => ({
  id: 'p1',
  staff_name: 'Dev Driver',
  bought_at: '2026-09-25T07:30:00Z',
  shop_name: 'Al-Noor market',
  total_iqd: 9500,
  receipt_path: null,
  delivered_at: null,
  delivered_by_name: null,
  lines,
  ...over,
});

describe('readPurchases', () => {
  it('reads the payload and sorts each line into stock, switched off or not stock', () => {
    const [p] = readPurchases({
      count: 1,
      purchases: [purchase([line({}), line({ id: 'l-bags', ingredient_id: null, ingredient_active: null, label: 'Bin bags' }), line({ id: 'l-off', ingredient_active: false })])],
    });
    expect(p!.lines.map(lineKind)).toEqual(['stock', 'notStock', 'switchedOff']);
    expect(p!.lines[0]).toMatchObject({ qty: 2000, price_iqd: 6000, status: 'to_receive' });
  });

  it('reads anything that is not the RPC payload as nothing, and a bad field as its safe default', () => {
    expect(readPurchases(null)).toEqual([]);
    expect(readPurchases([])).toEqual([]);
    expect(readPurchases({ purchases: [{ nope: 1 }] })).toEqual([]);
    const [p] = readPurchases({ purchases: [purchase([line({ qty: 'x', price_iqd: null, status: 'lost' }), { no: 'id' }], { total_iqd: 'n/a', bought_at: 5 })] });
    expect(p!.total_iqd).toBe(0);
    expect(p!.bought_at).toBe('');
    expect(p!.lines).toHaveLength(1);
    expect(p!.lines[0]).toMatchObject({ qty: 0, price_iqd: 0, status: 'to_receive' });
  });

  it('reads the delivery confirmation, null until there is one', () => {
    const [p] = readPurchases({ purchases: [purchase([], { delivered_at: '2026-09-25T08:05:00Z', delivered_by_name: 'Dev Driver' })] });
    expect(p!.delivered_at).toBe('2026-09-25T08:05:00Z');
    expect(p!.delivered_by_name).toBe('Dev Driver');
    expect(readPurchases({ purchases: [purchase([])] })[0]!.delivered_at).toBeNull();
  });
});

describe('lineDraftProblem', () => {
  it('takes a received amount of 0 or more, a trailing point included, and no past expiry', () => {
    const today = '2026-09-25';
    expect(lineDraftProblem({ received: '0', expiry: '' }, today)).toBeNull();
    expect(lineDraftProblem({ received: '20.', expiry: '' }, today)).toBeNull();
    expect(lineDraftProblem({ received: '.5', expiry: '' }, today)).toBeNull();
    expect(lineDraftProblem({ received: '1.5', expiry: '2026-09-25' }, today)).toBeNull();
    expect(lineDraftProblem({ received: '', expiry: '' }, today)).toBe('received');
    expect(lineDraftProblem({ received: '1.2.3', expiry: '' }, today)).toBe('received');
    expect(lineDraftProblem({ received: '3', expiry: '2026-09-24' }, today)).toBe('expiry');
  });
});

describe('deliveredWhen', () => {
  it('says the time alone on the day of the purchase at the venue, else the date too', () => {
    // 08:05 UTC is 11:05 in Baghdad, the day it was bought there.
    expect(deliveredWhen({ bought_at: '2026-09-25T07:30:00Z', delivered_at: '2026-09-25T08:05:00Z' }, 'en')).toMatch(/^11:05\sAM$/);
    // Confirmed the next day at the venue: the date is part of it.
    expect(deliveredWhen({ bought_at: '2026-09-25T07:30:00Z', delivered_at: '2026-09-25T22:10:00Z' }, 'en')).toMatch(/26/);
    expect(deliveredWhen({ bought_at: '2026-09-25T07:30:00Z', delivered_at: null }, 'en')).toBeNull();
    expect(deliveredWhen({ bought_at: '2026-09-25T07:30:00Z', delivered_at: 'not a date' }, 'en')).toBeNull();
  });
});

describe('unitCost', () => {
  it('works out the cost per base unit as the server books it', () => {
    expect(unitCost({ price_iqd: 6000, qty: 2000 })).toBe(3);
    expect(unitCost({ price_iqd: 1000, qty: 3 })).toBe(333.3333);
    expect(unitCost({ price_iqd: 1000, qty: 0 })).toBe(0);
  });
});

describe('purchaseHasShopLine', () => {
  // Shop stock lives in the cafe store only (wave5-addendum-2026-09-25 V14):
  // receive_purchase refuses such a line into the bakery store, so the picker
  // turns the bakery store off while one is still to receive.
  const kinds = new Map([
    ['ing-milk', 'purchased'],
    ['ing-water', 'retail'],
  ]);
  const l = (over: Record<string, unknown>) => line(over) as PurchaseLine;

  it('finds a shop line still to receive', () => {
    expect(purchaseHasShopLine([l({}), l({ id: 'l-water', ingredient_id: 'ing-water' })], kinds)).toBe(true);
    expect(purchaseHasShopLine([l({})], kinds)).toBe(false);
  });

  it('ignores a shop line already dealt with, switched off, not stock, or of a kind it does not know', () => {
    expect(purchaseHasShopLine([l({ ingredient_id: 'ing-water', status: 'received' })], kinds)).toBe(false);
    expect(purchaseHasShopLine([l({ ingredient_id: 'ing-water', ingredient_active: false })], kinds)).toBe(false);
    expect(purchaseHasShopLine([l({ ingredient_id: null, ingredient_active: null, label: 'Bin bags' })], kinds)).toBe(false);
    expect(purchaseHasShopLine([l({ ingredient_id: 'ing-unknown' })], kinds)).toBe(false);
  });
});

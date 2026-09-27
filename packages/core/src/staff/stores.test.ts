/**
 * The stores' rules as the apps see them (wave5-addendum-2026-09-25 §2.8.5;
 * the shop store, 0245, docs/design/shop/shop-desk-2026-09-27.md). Each list here mirrors one RPC guard; the database tests
 * (packages/db/tests/stock-*.test.ts) prove the guards themselves, and
 * staff-roles-parity.test.ts holds STOCK_LOCATIONS equal to the enum.
 */
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES } from './roles';
import {
  COUNT_ROLES,
  LOG_ROLES,
  MOVABLE_STORES,
  MOVE_KINDS,
  MOVE_ROLES,
  STOCK_LOCATIONS,
  STOCK_VIEW_ROLES,
  countKindsFor,
  countStoresFor,
  homeStore,
  isStockLocation,
  logKindsFor,
  logStoresFor,
  otherStore,
  stockViewKindsFor,
  toBaseQty,
} from './stores';

describe('STOCK_LOCATIONS', () => {
  it('lists the stock_location enum in its own order', () => {
    expect(STOCK_LOCATIONS).toEqual(['cafe', 'bakery', 'shop']);
  });

  it('knows its own values and nothing else', () => {
    expect(isStockLocation('cafe')).toBe(true);
    expect(isStockLocation('bakery')).toBe(true);
    expect(isStockLocation('shop')).toBe(true);
    for (const v of ['Cafe', 'kitchen', '', null, undefined, 1]) expect(isStockLocation(v)).toBe(false);
    expect(otherStore('cafe')).toBe('bakery');
    expect(otherStore('bakery')).toBe('cafe');
    // Nothing moves in or out of the shop store (0245 transfer_stock).
    expect(MOVABLE_STORES).toEqual(['cafe', 'bakery']);
    expect(otherStore('shop')).toBe('shop');
  });
});

describe('the role groups mirror the guards', () => {
  it('names only known roles, neither wave-5 role joins LOG or COUNT, and the shop assistant takes the desk\'s place', () => {
    for (const list of [MOVE_ROLES, LOG_ROLES, COUNT_ROLES, STOCK_VIEW_ROLES]) {
      for (const role of list) expect(STAFF_ROLES).toContain(role);
    }
    expect([...MOVE_ROLES].sort()).toEqual(['manager', 'owner', 'waiter']);
    expect([...LOG_ROLES].sort()).toEqual(['cashier', 'head_barista', 'head_chef', 'manager', 'owner', 'shop_staff']);
    expect([...COUNT_ROLES].sort()).toEqual(['chef', 'head_chef', 'manager', 'owner', 'shop_staff']);
    expect([...STOCK_VIEW_ROLES].sort()).toEqual(['head_barista', 'head_chef', 'manager', 'owner', 'shop_staff', 'waiter']);
    // The court desk keeps no stock of its own any more (Parsa, 2026-09-27).
    for (const list of [LOG_ROLES, COUNT_ROLES, STOCK_VIEW_ROLES, MOVE_ROLES]) expect(list).not.toContain('court_desk');
    for (const list of [LOG_ROLES, COUNT_ROLES]) {
      expect(list).not.toContain('waiter');
      expect(list).not.toContain('assistant_barista');
    }
    expect(MOVE_KINDS).toEqual(['purchased', 'prepared']);
  });
});

describe('homeStore', () => {
  it('is the bakery for the kitchen, the shop store for the shop assistant and the cafe for everyone else', () => {
    expect(homeStore('head_chef')).toBe('bakery');
    expect(homeStore('chef')).toBe('bakery');
    expect(homeStore('shop_staff')).toBe('shop');
    for (const role of STAFF_ROLES.filter((r) => r !== 'head_chef' && r !== 'chef' && r !== 'shop_staff')) {
      expect(homeStore(role), role).toBe('cafe');
    }
    expect(homeStore(null)).toBe('cafe');
    expect(homeStore(undefined)).toBe('cafe');
  });
});

describe('logKindsFor and logStoresFor', () => {
  it('gives each LOG role its kinds, never prepared, and nothing to anyone else', () => {
    expect(logKindsFor('head_barista')).toEqual(['purchased']);
    expect(logKindsFor('head_chef')).toEqual(['purchased']);
    expect(logKindsFor('cashier')).toEqual(['purchased']);
    expect(logKindsFor('shop_staff')).toEqual(['retail']);
    for (const role of ['manager', 'owner'] as const) expect(logKindsFor(role), role).toEqual(['purchased', 'retail']);
    for (const role of ['barista', 'assistant_barista', 'chef', 'waiter', 'driver', 'marketing', 'prep', 'court_desk'] as const) {
      expect(logKindsFor(role), role).toEqual([]);
      expect(logStoresFor(role), role).toEqual([]);
    }
    expect(logKindsFor(null)).toEqual([]);
  });

  it('puts the home store first, and shop stock in the shop store only (0245)', () => {
    expect(logStoresFor('head_barista')).toEqual(['cafe', 'bakery']);
    expect(logStoresFor('head_chef')).toEqual(['bakery', 'cafe']);
    expect(logStoresFor('head_chef', 'purchased')).toEqual(['bakery', 'cafe']);
    expect(logStoresFor('cashier')).toEqual(['cafe', 'bakery']);
    expect(logStoresFor('shop_staff')).toEqual(['shop']);
    expect(logStoresFor('shop_staff', 'retail')).toEqual(['shop']);
    for (const role of ['manager', 'owner'] as const) {
      expect(logStoresFor(role), role).toEqual(['cafe', 'bakery', 'shop']);
      expect(logStoresFor(role, 'purchased'), role).toEqual(['cafe', 'bakery']);
      expect(logStoresFor(role, 'retail'), role).toEqual(['shop']);
    }
  });

  it('offers no store for a kind the role may not log', () => {
    expect(logStoresFor('head_barista', 'retail')).toEqual([]);
    expect(logStoresFor('shop_staff', 'purchased')).toEqual([]);
    expect(logStoresFor('cashier', 'retail')).toEqual([]);
    expect(logStoresFor('manager', 'prepared')).toEqual([]);
  });
});

describe('countStoresFor and countKindsFor', () => {
  it('lets the kitchen count the bakery only, the shop assistant the shop store only and MGMT any store', () => {
    expect(countStoresFor('head_chef')).toEqual(['bakery']);
    expect(countStoresFor('chef')).toEqual(['bakery']);
    expect(countStoresFor('shop_staff')).toEqual(['shop']);
    expect(countStoresFor('manager')).toEqual(['cafe', 'bakery', 'shop']);
    expect(countStoresFor('owner')).toEqual(['cafe', 'bakery', 'shop']);
    for (const role of ['head_barista', 'barista', 'assistant_barista', 'cashier', 'court_desk', 'waiter', 'driver', 'marketing'] as const) {
      expect(countStoresFor(role), role).toEqual([]);
    }
  });

  it('counts shop stock in the shop store only, and nothing else there', () => {
    expect(countKindsFor('cafe')).toEqual(['purchased', 'prepared']);
    expect(countKindsFor('bakery')).toEqual(['purchased', 'prepared']);
    expect(countKindsFor('shop')).toEqual(['retail']);
  });
});

describe('stockViewKindsFor', () => {
  it('gives the waiter what he moves, and nothing to a role outside STOCK_VIEW', () => {
    expect(stockViewKindsFor('waiter')).toEqual(['purchased', 'prepared']);
    expect(stockViewKindsFor('head_barista')).toEqual(['purchased', 'prepared']);
    expect(stockViewKindsFor('shop_staff')).toEqual(['retail']);
    expect(stockViewKindsFor('owner')).toEqual(['purchased', 'prepared', 'retail']);
    for (const role of ['barista', 'assistant_barista', 'chef', 'cashier', 'driver', 'marketing', 'prep', 'court_desk'] as const) {
      expect(stockViewKindsFor(role), role).toEqual([]);
    }
  });
});

describe('toBaseQty', () => {
  const milk = { unit: 'ml', pack_size: 1000 };
  const loose = { unit: 'g', pack_size: null };

  it('keeps the base unit and multiplies a pack, to 3 places, as the server does', () => {
    expect(toBaseQty(250, 'ml', milk)).toBe(250);
    expect(toBaseQty(250, null, milk)).toBe(250);
    expect(toBaseQty(250, '', milk)).toBe(250);
    expect(toBaseQty(2, 'pack', milk)).toBe(2000);
    expect(toBaseQty(0.0004, 'pack', milk)).toBe(0.4);
    expect(toBaseQty(1.23456, 'ml', milk)).toBe(1.235);
  });

  it('is null where the server refuses the line', () => {
    expect(toBaseQty(0, 'ml', milk)).toBeNull();
    expect(toBaseQty(-1, 'ml', milk)).toBeNull();
    expect(toBaseQty(Number.NaN, 'ml', milk)).toBeNull();
    expect(toBaseQty(1, 'pack', loose)).toBeNull();
    expect(toBaseQty(1, 'pc', milk)).toBeNull();
    expect(toBaseQty(0.0001, 'ml', milk)).toBeNull();
    expect(toBaseQty(1_000_000_000, 'ml', milk)).toBeNull();
  });
});

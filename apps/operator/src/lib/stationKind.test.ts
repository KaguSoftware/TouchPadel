import { describe, expect, it } from 'vitest';
import { shopPathTakesMoney, stationKindRefusal } from './stationKind';

describe('stationKindRefusal (F-29)', () => {
  it('the shop till opens on the shop station only: never on the café till, the desk or a kitchen screen', () => {
    expect(stationKindRefusal('shopTill', { electron: true, mode: 'shop' })).toBeNull();
    expect(stationKindRefusal('shopTill', { electron: true, mode: 'till' })).toBe('till');
    expect(stationKindRefusal('shopTill', { electron: true, mode: 'desk' })).toBe('desk');
    expect(stationKindRefusal('shopTill', { electron: true, mode: 'kds' })).toBe('kds');
  });

  it('the kitchen board opens on a kitchen screen and the café till it is paired with', () => {
    expect(stationKindRefusal('kds', { electron: true, mode: 'kds' })).toBeNull();
    expect(stationKindRefusal('kds', { electron: true, mode: 'till' })).toBeNull();
    expect(stationKindRefusal('kds', { electron: true, mode: 'desk' })).toBe('desk');
    expect(stationKindRefusal('kds', { electron: true, mode: 'shop' })).toBe('shop');
  });

  it('browser mode is not a station and keeps today’s behaviour', () => {
    expect(stationKindRefusal('shopTill', { electron: false, mode: 'till' })).toBeNull();
    expect(stationKindRefusal('kds', { electron: false, mode: 'desk' })).toBeNull();
  });
});

describe('shopPathTakesMoney', () => {
  it('is the shop till and its drawer, not its stock, products or suppliers', () => {
    expect(shopPathTakesMoney('/shop')).toBe(true);
    expect(shopPathTakesMoney('/shop/')).toBe(true);
    expect(shopPathTakesMoney('/shop/drawer')).toBe(true);
    expect(shopPathTakesMoney('/shop/stock')).toBe(false);
    expect(shopPathTakesMoney('/shop/products')).toBe(false);
    expect(shopPathTakesMoney('/shop/suppliers')).toBe(false);
  });
});

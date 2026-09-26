import { describe, expect, it } from 'vitest';
import { can, permissionsFor, requiredRoleFor } from '../../../lib/auth';
import { validateProtocolsSearch } from '../../protocols/search';
import { heroLocks, lockedHeroDraft, priceChangeSearch, type FeaturedState } from './priceChange';

const ITEM = '0b1e0f5e-7c43-4a55-9f6e-1c2d3e4f5a6b';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

describe('priceChangeSearch', () => {
  it('opens a price or promo start prefilled from the row, and survives the route’s parser', () => {
    const search = priceChangeSearch({ change: 'addon_price', addon: ITEM });
    expect(search).toEqual({ start: 'price_promo', change: 'addon_price', addon: ITEM });
    expect(validateProtocolsSearch({ ...search })).toEqual(search);
  });

  it('carries only the target that was given', () => {
    expect(priceChangeSearch({ change: 'rate' })).toEqual({ start: 'price_promo', change: 'rate' });
    expect(priceChangeSearch({ change: 'promotion_enable', promotion: ITEM })).toEqual({
      start: 'price_promo',
      change: 'promotion_enable',
      promotion: ITEM,
    });
  });
});

describe('heroLocks (#57, §2.13)', () => {
  const saved = (over: Partial<FeaturedState>): FeaturedState => ({
    hero_mode: 'none',
    featured_item_id: ITEM,
    featured_discount_pct: 0,
    ...over,
  });

  it('leaves the owner’s builder alone', () => {
    expect(heroLocks(saved({ featured_discount_pct: 20 }), true)).toEqual({ discount: false, switchOff: false, item: false, featuredMode: false });
  });

  it('with no discount stored, locks only the percentage for a manager', () => {
    expect(heroLocks(saved({}), false)).toEqual({ discount: true, switchOff: false, item: false, featuredMode: false });
  });

  it('with a discount live in Featured mode, locks the item and offers the switch-off', () => {
    expect(heroLocks(saved({ hero_mode: 'featured', featured_discount_pct: 20 }), false)).toEqual({
      discount: true,
      switchOff: true,
      item: true,
      featuredMode: false,
    });
  });

  it('with a discount stored but not on sale, also locks the Featured tile', () => {
    for (const hero_mode of ['none', 'media'] as const) {
      expect(heroLocks(saved({ hero_mode, featured_discount_pct: 20 }), false).featuredMode).toBe(true);
    }
  });
});

describe('lockedHeroDraft', () => {
  const stored: FeaturedState = { hero_mode: 'none', featured_item_id: ITEM, featured_discount_pct: 20 };

  it('never sends a locked value that moved since the builder opened', () => {
    const draft = { hero_mode: 'featured' as const, featured_item_id: OTHER, featured_discount_pct: 5, featured_label_en: 'New' };
    const locks = heroLocks(stored, false);
    expect(lockedHeroDraft(draft, stored, locks)).toEqual({
      hero_mode: 'none',
      featured_item_id: ITEM,
      featured_discount_pct: 20,
      featured_label_en: 'New',
    });
  });

  it('keeps what a manager may still change: moving off Featured, and the item once the discount is off', () => {
    const live: FeaturedState = { hero_mode: 'featured', featured_item_id: ITEM, featured_discount_pct: 20 };
    expect(lockedHeroDraft({ ...live, hero_mode: 'media' }, live, heroLocks(live, false)).hero_mode).toBe('media');
    const off: FeaturedState = { ...live, featured_discount_pct: 0 };
    expect(lockedHeroDraft({ ...off, featured_item_id: OTHER }, off, heroLocks(off, false)).featured_item_id).toBe(OTHER);
  });

  it('is the draft itself for the owner', () => {
    const draft = { hero_mode: 'featured' as const, featured_item_id: OTHER, featured_discount_pct: 5 };
    expect(lockedHeroDraft(draft, stored, heroLocks(stored, true))).toEqual(draft);
  });
});

describe('the flags the five screens read (#57, §5.5)', () => {
  it('leaves promotions and rates to the owner, and names the owner when refusing', () => {
    expect(permissionsFor('manager')).toMatchObject({ editPromotions: false, editRates: false, editMenu: true });
    expect(permissionsFor('owner')).toMatchObject({ editPromotions: true, editRates: true });
    expect(requiredRoleFor('editPromotions')).toBe('owner');
    expect(requiredRoleFor('editRates')).toBe('owner');
  });

  it('lets a manager start the change each lock offers', () => {
    expect(can('manager', 'startProtocolPriceChange')).toBe(true);
    expect(can('manager', 'editLaunchedPrices')).toBe(false);
    expect(can('manager', 'launchDirectly')).toBe(false);
  });
});

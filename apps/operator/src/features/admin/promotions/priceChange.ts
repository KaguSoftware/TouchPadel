/**
 * Where a manager goes instead of editing a price the owner now approves
 * (build-contracts-2026-09-23 §5.5; plan #41, #51, #53, #57).
 *
 * Promotions, Rates, the hero's featured discount, Stock ▸ Products and
 * Add-ons are read-only for a manager wherever the server would refuse the
 * write (PRICE_VIA_PROTOCOL, LAUNCH_VIA_PROTOCOL, price_promo), and each
 * offers the start of a price or promo change on /protocols instead,
 * prefilled from what it sits on. The server is the wall; this only saves a
 * manager from typing a change that is refused on Save.
 *
 * The pure half: the start's search params, and the hero builder's locks
 * (the one screen whose lock depends on stored values rather than a role).
 */
import type { HeroMode } from '../../../lib/settings';
import type { PriceChangeKind, ProtocolsSearch } from '../../protocols/search';

export interface PriceChangeTarget {
  change: PriceChangeKind;
  item?: string;
  addon?: string;
  promotion?: string;
  rule?: string;
}

/** The /protocols search that opens a price or promo start for `t`. */
export function priceChangeSearch(t: PriceChangeTarget): ProtocolsSearch {
  const out: ProtocolsSearch = { start: 'price_promo', change: t.change };
  if (t.item) out.item = t.item;
  if (t.addon) out.addon = t.addon;
  if (t.promotion) out.promotion = t.promotion;
  if (t.rule) out.rule = t.rule;
  return out;
}

/** The three stored settings the featured-discount lock reads (§2.13). */
export interface FeaturedState {
  hero_mode: HeroMode;
  featured_item_id: string | null;
  featured_discount_pct: number;
}

export interface HeroLocks {
  /** The discount field is read-only: it changes through a featured_discount change. */
  discount: boolean;
  /** "Switch the discount off" is offered: a discount above 0 is stored. */
  switchOff: boolean;
  /** The featured item picker is off: moving it would move the stored discount. */
  item: boolean;
  /**
   * The Featured mode tile is off: choosing it would put the stored discount
   * on sale (add_order_items applies it only in Featured mode, 0095:169).
   * Moving the hero off Featured is never locked.
   */
  featuredMode: boolean;
}

const UNLOCKED: HeroLocks = { discount: false, switchOff: false, item: false, featuredMode: false };

/**
 * What set_cafe_setting would refuse a manager, read from the SAVED values,
 * never the draft: a manager who switches the hero off Featured in the draft
 * may still switch it back before saving.
 */
export function heroLocks(saved: FeaturedState, canEditLaunchedPrices: boolean): HeroLocks {
  if (canEditLaunchedPrices) return UNLOCKED;
  const stored = saved.featured_discount_pct > 0;
  return { discount: true, switchOff: stored, item: stored, featuredMode: stored && saved.hero_mode !== 'featured' };
}

/**
 * The draft as it may be saved: each locked value follows what is stored, so
 * a draft opened before the owner (or an applied change) moved it never
 * re-sends the old value, which the setter would refuse.
 */
export function lockedHeroDraft<D extends FeaturedState>(draft: D, saved: FeaturedState, locks: HeroLocks): D {
  return {
    ...draft,
    featured_discount_pct: locks.discount ? saved.featured_discount_pct : draft.featured_discount_pct,
    featured_item_id: locks.item ? saved.featured_item_id : draft.featured_item_id,
    hero_mode: locks.featuredMode && draft.hero_mode === 'featured' ? saved.hero_mode : draft.hero_mode,
  };
}

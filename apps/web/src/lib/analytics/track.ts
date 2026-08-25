import { capture } from './posthog';

/**
 * Typed event helpers — one function per row of web-slice §5. Components call
 * these instead of `capture()` so the event NAMES and PROPERTY SHAPES live in
 * exactly one place (the operator dashboards query them by name).
 *
 * Everything below is fire-and-forget: `capture()` no-ops until the SDK is
 * loaded and swallows its own errors, so analytics can never break the UI.
 */

export type ItemSource = 'list' | 'featured' | 'suggested';
export type WaiterKind = 'order' | 'bill' | 'water' | 'assistance';
export type QrAction = 'order' | 'waiter';

/** Dwell below this is a mis-tap, not an abandoned view (web-slice §5). */
export const ABANDON_DWELL_MS = 5_000;

export const track = {
  itemViewed(p: {
    item_id: string;
    item_name: string;
    category_id: string;
    price_iqd: number;
    discount_pct: number;
    source: ItemSource;
    has_photo: boolean;
  }): void {
    capture('item_viewed', p);
  },

  /**
   * Close without adding. Below ABANDON_DWELL_MS nothing is sent — the caller
   * may pass `beacon` when the page is going away (visibilitychange → hidden).
   */
  itemViewAbandoned(
    p: { item_id: string; item_name: string; dwell_ms: number },
    opts?: { beacon?: boolean },
  ): void {
    if (!Number.isFinite(p.dwell_ms) || p.dwell_ms < ABANDON_DWELL_MS) return;
    capture(
      'item_view_abandoned',
      { ...p, dwell_ms: Math.round(p.dwell_ms) },
      opts?.beacon ? { transport: 'sendBeacon' } : undefined,
    );
  },

  itemAddedToBasket(p: {
    item_id: string;
    item_name: string;
    variant_id: string;
    price_iqd: number;
    qty: number;
    modifiers_count: number;
    has_note: boolean;
    discount_pct: number;
  }): void {
    capture('item_added_to_basket', p);
  },

  itemRemovedFromBasket(p: { item_id: string; item_name: string; qty: number }): void {
    capture('item_removed_from_basket', p);
  },

  categorySelected(p: { category_id: string; category_name_en: string }): void {
    capture('category_selected', p);
  },

  basketOpened(p: { item_count: number; total_iqd: number; has_table: boolean }): void {
    capture('basket_opened', p);
  },

  featuredItemClicked(p: { item_id: string }): void {
    capture('featured_item_clicked', p);
  },

  suggestedItemClicked(p: { item_id: string; from_item_id: string }): void {
    capture('suggested_item_clicked', p);
  },

  waiterCalled(p: { kind: WaiterKind; source?: 'fab' }): void {
    capture('waiter_called', { source: 'fab', ...p });
  },

  orderSubmitted(p: {
    order_id: string;
    total_iqd: number;
    subtotal_iqd: number;
    discount_total_iqd: number;
    item_count: number;
    line_count: number;
    has_note: boolean;
  }): void {
    capture('order_submitted', p);
  },

  orderFailed(p: { error_type: string }): void {
    capture('order_failed', p);
  },

  qrRequiredShown(p: { action: QrAction }): void {
    capture('qr_required_shown', p);
  },
} as const;

export type Track = typeof track;

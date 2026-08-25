/**
 * Pure order helpers (unit-tested) — shared by `useOrders` and the orders UI.
 * Kept out of the hook so the partition rule is testable in the node env.
 */

export type GuestOrderStatus = 'sent' | 'preparing' | 'ready' | 'served' | 'voided';

export interface GuestOrderItem {
  id: string;
  qty: number;
  line_total_iqd: number;
  voided: boolean;
  name_en: string;
  name_ar: string;
  variant_en: string;
  variant_ar: string;
}

export interface GuestOrder {
  id: string;
  status: GuestOrderStatus;
  placed_at: string;
  /** when the client first saw the order reach `served` (broadcast or reload) */
  served_at?: string | null;
  items: GuestOrderItem[];
}

/** The three steps the guest sees; `served` completes the bar. */
export const ORDER_STEPS: readonly GuestOrderStatus[] = ['sent', 'preparing', 'ready'] as const;

/** A served order stays in the live strip for 10 minutes, then drops to "Earlier". */
export const SERVED_GRACE_MS = 10 * 60 * 1000;

/** 0…3 filled segments of the 3-step bar. */
export function orderStepIndex(status: GuestOrderStatus): number {
  if (status === 'served') return ORDER_STEPS.length;
  const i = ORDER_STEPS.indexOf(status);
  return i < 0 ? 0 : i + 1;
}

/** Orders whose status the guest is still waiting on (drives the strip + FAB copy). */
export function isLiveStatus(status: GuestOrderStatus): boolean {
  return status === 'sent' || status === 'preparing' || status === 'ready';
}

const ts = (v: string | null | undefined): number => {
  const n = v ? Date.parse(v) : NaN;
  return Number.isNaN(n) ? 0 : n;
};

export interface OrdersPartition<T> {
  live: T[];
  earlier: T[];
}

/**
 * Split the session's orders into the live strip and the collapsed "Earlier"
 * list. Live = sent/preparing/ready, plus anything served within the last
 * 10 minutes (so a guest who just got their coffee still sees the card).
 * Voided orders are always "Earlier" (muted "Cancelled — please ask staff").
 * Both lists come back newest-first. Pure; `now` is injected for tests.
 */
export function ordersPartition<T extends Pick<GuestOrder, 'status' | 'placed_at' | 'served_at'>>(
  orders: readonly T[],
  now: number = Date.now(),
): OrdersPartition<T> {
  const live: T[] = [];
  const earlier: T[] = [];
  for (const o of orders) {
    if (o.status === 'voided') {
      earlier.push(o);
    } else if (isLiveStatus(o.status)) {
      live.push(o);
    } else {
      const at = ts(o.served_at) || ts(o.placed_at);
      (now - at <= SERVED_GRACE_MS ? live : earlier).push(o);
    }
  }
  const newestFirst = (a: T, b: T) => ts(b.placed_at) - ts(a.placed_at);
  return { live: live.sort(newestFirst), earlier: earlier.sort(newestFirst) };
}

/** Total of an order's non-voided lines. */
export function orderTotal(order: Pick<GuestOrder, 'items'>): number {
  return order.items.reduce((sum, i) => (i.voided ? sum : sum + i.line_total_iqd), 0);
}

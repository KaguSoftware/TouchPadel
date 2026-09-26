/**
 * The pure half of Goods in ▸ "Bought by the driver" (DriverPurchases.tsx;
 * build-contracts-2026-09-23 §2.15, §2.24.10, §5.5): the payload of
 * app.purchases_to_receive read defensively, which kind each line is, the cost
 * per base unit the server books, a line's draft problems and the short form
 * of the delivery confirmation. No React here, so the node tests beside it
 * cover every branch.
 */
import { formatDate, formatDateTime, formatTime } from '@touch/i18n';

export interface PurchaseLine {
  id: string;
  ingredient_id: string | null;
  /** Null on a line that is not stock; false on a stock line switched off since it was bought. */
  ingredient_active: boolean | null;
  name_en: string | null;
  name_ar: string | null;
  unit: string | null;
  label: string | null;
  qty: number;
  price_iqd: number;
  status: 'to_receive' | 'received' | 'acknowledged';
}

export interface DriverPurchase {
  id: string;
  staff_name: string | null;
  bought_at: string;
  shop_name: string | null;
  total_iqd: number;
  receipt_path: string | null;
  /** When the buyer (or a manager) confirmed it reached the venue; null until then. */
  delivered_at: string | null;
  delivered_by_name: string | null;
  lines: PurchaseLine[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const LINE_STATUSES = ['to_receive', 'received', 'acknowledged'] as const;

/** The RPC's payload (QK.purchasesToReceive holds it as returned); anything else reads as none. */
export function readPurchases(payload: unknown): DriverPurchase[] {
  if (!isObject(payload) || !Array.isArray(payload.purchases)) return [];
  return payload.purchases
    .filter((p): p is Record<string, unknown> => isObject(p) && typeof p.id === 'string')
    .map((p) => ({
      id: p.id as string,
      staff_name: strOrNull(p.staff_name),
      bought_at: typeof p.bought_at === 'string' ? p.bought_at : '',
      shop_name: strOrNull(p.shop_name),
      total_iqd: Number(p.total_iqd) || 0,
      receipt_path: strOrNull(p.receipt_path),
      delivered_at: strOrNull(p.delivered_at),
      delivered_by_name: strOrNull(p.delivered_by_name),
      lines: (Array.isArray(p.lines) ? p.lines : [])
        .filter((l): l is Record<string, unknown> => isObject(l) && typeof l.id === 'string')
        .map((l) => ({
          id: l.id as string,
          ingredient_id: strOrNull(l.ingredient_id),
          ingredient_active: typeof l.ingredient_active === 'boolean' ? l.ingredient_active : null,
          name_en: strOrNull(l.name_en),
          name_ar: strOrNull(l.name_ar),
          unit: strOrNull(l.unit),
          label: strOrNull(l.label),
          qty: Number(l.qty) || 0,
          price_iqd: Number(l.price_iqd) || 0,
          status: (LINE_STATUSES as readonly unknown[]).includes(l.status) ? (l.status as PurchaseLine['status']) : 'to_receive',
        })),
    }));
}

export type LineKind = 'stock' | 'switchedOff' | 'notStock';

export function lineKind(l: Pick<PurchaseLine, 'ingredient_id' | 'ingredient_active'>): LineKind {
  if (l.ingredient_id === null) return 'notStock';
  return l.ingredient_active === false ? 'switchedOff' : 'stock';
}

/**
 * Whether a stock line still to receive is shop (retail) stock. Shop stock
 * lives in the cafe store only (wave5-addendum-2026-09-25 V14): receive_purchase
 * refuses such a line into the bakery store, so the picker turns the bakery
 * store off while one is on the purchase. `kindOf` is the ingredient list's
 * kinds; a line whose ingredient it does not know is not assumed to be shop.
 */
export function purchaseHasShopLine(lines: readonly PurchaseLine[], kindOf: ReadonlyMap<string, string>): boolean {
  return lines.some((l) => l.status === 'to_receive' && lineKind(l) === 'stock' && l.ingredient_id !== null && kindOf.get(l.ingredient_id) === 'retail');
}

/** What receive_purchase books per base unit: the line's price over its quantity, as the server rounds it. */
export function unitCost(l: Pick<PurchaseLine, 'price_iqd' | 'qty'>): number {
  return l.qty > 0 ? Math.round((l.price_iqd / l.qty) * 10_000) / 10_000 : 0;
}

export interface LineDraft {
  received: string;
  expiry: string;
}

export type LineProblem = 'received' | 'expiry' | null;

export function lineDraftProblem(d: LineDraft, today: string): LineProblem {
  const t = d.received.trim();
  // A trailing point is a number still being typed ("20."), not a mistake.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) return 'received';
  if (d.expiry !== '' && d.expiry < today) return 'expiry';
  return null;
}

/**
 * When the delivery was confirmed, as short as it can be read: the time alone
 * on the day the purchase was made (at the venue), else the date and time.
 */
export function deliveredWhen(p: Pick<DriverPurchase, 'bought_at' | 'delivered_at'>, locale: 'en' | 'ar'): string | null {
  if (!p.delivered_at) return null;
  const at = new Date(p.delivered_at);
  if (Number.isNaN(at.getTime())) return null;
  const sameDay = p.bought_at !== '' && formatDate(new Date(p.bought_at), 'en') === formatDate(at, 'en');
  return sameDay ? formatTime(at, locale) : formatDateTime(at, locale);
}

/**
 * Promotions data (migration 0067, build plan §4). The `promotions` table is
 * not in the generated Database types until `pnpm db:types` runs against the
 * new migration, so the read goes through a loosely typed `from()`; the
 * column names below ARE the contract.
 *
 * 0410: a promotion can be listed as a deal in the guests' app (`in_app`, with the line guests
 * read under it, `app_blurb_en` / `app_blurb_ar`). A server without the migration has no such
 * columns and refuses the whole select, so a read that fails on them is asked once more with
 * the old column list; the rows then carry no `in_app` at all, which every reader takes as
 * "not listed, and listing is not offered" (promotionLogic.appListingKnown).
 */
import { supabase } from '../../../lib/supabase';
import { appColumnsMissing } from './promotionLogic';

export type PromotionType = 'percent' | 'amount';

export interface PromotionScope {
  courtIds: string[];
  categoryIds: string[];
  itemIds: string[];
}

export interface PromotionLimits {
  total: number | null;
  perCustomer: number | null;
  minSpendIqd: number | null;
  /** A loyalty tier id (0309): only customers at that tier or above. Sent only when set. */
  tierMin?: string | null;
}

export interface PromotionRow {
  id: string;
  name_en: string;
  name_ar: string;
  type: PromotionType;
  value: number;
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[] | null;
  hour_from: string | null;
  hour_to: string | null;
  scope: Partial<PromotionScope> | null;
  limits: Partial<PromotionLimits> | null;
  auto: boolean;
  public_code: string | null;
  code_single_use: boolean;
  enabled: boolean;
  /** 0410: listed as a deal in the guests' app. Absent from a server without the column. */
  in_app?: boolean;
  /** 0410: the line guests read under the deal; both or neither. */
  app_blurb_en?: string | null;
  app_blurb_ar?: string | null;
}

export const PROMOTIONS_KEY = ['promotions'] as const;
export const promotionKey = (id: string) => ['promotions', id] as const;

/** The columns every server has (0067). */
const BASE_COLUMNS =
  'id, name_en, name_ar, type, value, starts_at, ends_at, weekdays, hour_from, hour_to, scope, limits, auto, public_code, code_single_use, enabled';
/** 0410: the listing in the guests' app. */
const APP_COLUMNS = 'in_app, app_blurb_en, app_blurb_ar';
const PROMOTION_COLUMNS = `${BASE_COLUMNS}, ${APP_COLUMNS}`;

type ReadError = { message: string; code?: string } | null;

type ReadResult = { data: unknown; error: ReadError };

type LooseFrom = (table: string) => {
  select: (columns: string) => {
    order: (column: string, opts?: { ascending?: boolean }) => PromiseLike<ReadResult>;
    eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<ReadResult> };
  };
};

function fromPromotions(columns: string) {
  return (supabase.from as unknown as LooseFrom)('promotions').select(columns);
}

/** The read with the 0410 columns, then once more without them when the server has none. */
async function readWithFallback(read: (columns: string) => PromiseLike<ReadResult>): Promise<unknown> {
  const full = await read(PROMOTION_COLUMNS);
  if (!full.error) return full.data;
  if (!appColumnsMissing(full.error)) throw full.error;
  const base = await read(BASE_COLUMNS);
  if (base.error) throw base.error;
  return base.data;
}

export async function fetchPromotions(): Promise<PromotionRow[]> {
  const data = await readWithFallback((columns) => fromPromotions(columns).order('name_en'));
  return (data ?? []) as PromotionRow[];
}

export async function fetchPromotion(id: string): Promise<PromotionRow | null> {
  const data = await readWithFallback((columns) => fromPromotions(columns).eq('id', id).maybeSingle());
  return (data as PromotionRow | null) ?? null;
}

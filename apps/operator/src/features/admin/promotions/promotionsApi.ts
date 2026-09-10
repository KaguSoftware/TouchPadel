/**
 * Promotions data (migration 0067, build plan §4). The `promotions` table is
 * not in the generated Database types until `pnpm db:types` runs against the
 * new migration, so the read goes through a loosely typed `from()`; the
 * column names below ARE the contract.
 */
import { supabase } from '../../../lib/supabase';

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
}

export const PROMOTIONS_KEY = ['promotions'] as const;
export const promotionKey = (id: string) => ['promotions', id] as const;

const PROMOTION_COLUMNS =
  'id, name_en, name_ar, type, value, starts_at, ends_at, weekdays, hour_from, hour_to, scope, limits, auto, public_code, code_single_use, enabled';

type LooseFrom = (table: string) => {
  select: (columns: string) => {
    order: (column: string, opts?: { ascending?: boolean }) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
    eq: (column: string, value: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  };
};

function fromPromotions() {
  return (supabase.from as unknown as LooseFrom)('promotions').select(PROMOTION_COLUMNS);
}

export async function fetchPromotions(): Promise<PromotionRow[]> {
  const { data, error } = await fromPromotions().order('name_en');
  if (error) throw error;
  return (data ?? []) as PromotionRow[];
}

export async function fetchPromotion(id: string): Promise<PromotionRow | null> {
  const { data, error } = await fromPromotions().eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as PromotionRow | null) ?? null;
}

/**
 * Types for legacy-cafe.mjs, so the tests import it under `strict` without
 * `allowJs`. The script is the source of truth.
 */
export const DATA_DIR: string;
export const DEFAULT_VENUE_ID: string;

/** A row of legacy_cafe_hours without its venue: one calendar day and clock hour of the old till. */
export interface CafeHourRow {
  day: string;
  hour: number;
  item_lines: number;
  units: number;
  items_gross_iqd: number;
  tickets: number;
  /** The four orders columns are null on a day no orders report covers. */
  orders: number | null;
  orders_gross_iqd: number | null;
  discount_iqd: number | null;
  received_iqd: number | null;
}

export interface CafeItemDayRow {
  day: string;
  product: string;
  unit_price_iqd: number;
  units: number;
}

export interface CafeProductRow {
  product: string;
  unit_price_iqd: number;
  group_key: string;
  cost_iqd: number | null;
  cost_stated: string | null;
}

/** A row of the view legacy_cafe_days without its venue. */
export interface CafeDayFigures {
  day: string;
  gross_iqd: number;
  discount_iqd: number | null;
  net_iqd: number;
  orders: number;
  units: number;
  has_orders_export: boolean;
}

export function parseCsv(text: string): Record<string, string>[];
export function readHistory(): { hours: CafeHourRow[]; items: CafeItemDayRow[]; products: CafeProductRow[] };
export function dayFigures(hours: readonly CafeHourRow[]): CafeDayFigures[];
export function migrationRowsSql(venueId?: string): string;

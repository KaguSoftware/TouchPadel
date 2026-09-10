/**
 * Contract shapes for the 0068 report RPCs (build plan §4) and the pure
 * helpers that turn a server result into something DataTable can render:
 * column normalisation, kind inference, cell formatting, client-side sort.
 *
 * The server owns every number. Nothing here adds, divides or rounds — the
 * only "arithmetic" is comparing two values to order rows.
 */
import { formatDate, formatDateTime, formatIQD, formatNumber, type Locale } from '@touch/i18n';

export type ColumnKind = 'money' | 'number' | 'percent' | 'minutes' | 'hours' | 'date' | 'datetime' | 'text';

/** A column as the RPC may describe it: a bare key, or a spec with optional labels and kind. */
export interface ReportColumnSpec {
  key: string;
  label?: string | null;
  label_en?: string | null;
  label_ar?: string | null;
  /** Migration 0068 emits camelCase labels; both spellings are accepted. */
  labelEn?: string | null;
  labelAr?: string | null;
  kind?: ColumnKind | string | null;
}
export type ReportColumnInput = string | ReportColumnSpec;

export type ReportRow = Record<string, unknown>;

export interface ReportResult {
  columns?: ReportColumnInput[] | null;
  rows?: ReportRow[] | null;
  totals?: ReportRow | null;
  comparison?: unknown;
}

export interface DrillResult {
  transactions?: ReportRow[] | null;
}

export type ReportName = 'revenue' | 'courts' | 'cafe' | 'stock' | 'staff';
export type ReportGroup = 'day' | 'week' | 'month';
export type PaymentMethodFilter = 'cash' | 'card';

export interface ReportFilters {
  view: string;
  courtId?: string;
  categoryId?: string;
  staffId?: string;
  paymentMethod?: PaymentMethodFilter;
}

/** Column keys with a catalog label (`ws.reports.columns.*`). Anything else falls back to the server label or the key. */
export const COLUMN_LABEL_KEYS = [
  'date', 'period', 'business_date', 'court', 'hour', 'category', 'item', 'staff', 'method', 'source',
  'revenue_iqd', 'padel_iqd', 'cafe_iqd', 'cash_iqd', 'card_iqd', 'bookings', 'orders', 'aov_iqd',
  'discounts_iqd', 'voids_iqd', 'refunds_iqd', 'tax_iqd', 'rate', 'occupancy_pct', 'utilisation_pct',
  'available_hours', 'booked_hours', 'revenue_per_hour_iqd', 'cancellations', 'no_shows',
  'cancellation_rate_pct', 'no_show_rate_pct', 'peak_iqd', 'off_peak_iqd', 'peak_bookings',
  'off_peak_bookings', 'qty', 'cogs_iqd', 'gross_profit_iqd', 'margin_pct', 'reason', 'waste_qty',
  'waste_iqd', 'station', 'avg_prep_min', 'max_prep_min', 'ingredient', 'unit', 'on_hand', 'value_iqd',
  'theoretical', 'counted', 'variance', 'variance_iqd', 'par', 'expires_on', 'consumed', 'orders_taken',
  'bookings_created', 'days_worked', 'busiest_day', 'authoriser', 'count', 'amount_iqd', 'response_min',
  'closed_by', 'cash_variance_iqd', 'kind', 'reference', 'at', 'actor', 'note',
] as const;
export type ColumnLabelKey = (typeof COLUMN_LABEL_KEYS)[number];
const LABEL_KEY_SET: ReadonlySet<string> = new Set(COLUMN_LABEL_KEYS);
export function isColumnLabelKey(key: string): key is ColumnLabelKey {
  return LABEL_KEY_SET.has(key);
}

const KINDS: ReadonlySet<string> = new Set<ColumnKind>(['money', 'number', 'percent', 'minutes', 'hours', 'date', 'datetime', 'text']);

/** Kind from the column's declared kind, else its key suffix, else the sample value. */
export function inferKind(key: string, declared: string | null | undefined, sample: unknown): ColumnKind {
  if (declared && KINDS.has(declared)) return declared as ColumnKind;
  if (key.endsWith('_iqd')) return 'money';
  if (key.endsWith('_pct')) return 'percent';
  if (key.endsWith('_min')) return 'minutes';
  if (key.endsWith('_hours')) return 'hours';
  if (key === 'at' || key.endsWith('_at')) return 'datetime';
  if (key === 'date' || key === 'business_date' || key.endsWith('_on') || key.endsWith('_date')) return 'date';
  if (typeof sample === 'number') return 'number';
  return 'text';
}

export interface NormalizedColumn {
  key: string;
  kind: ColumnKind;
  labelEn: string | null;
  labelAr: string | null;
}

/** Keys shown first when the server sends none (drill-through transactions). */
const PREFERRED_ORDER = ['at', 'occurred_at', 'business_date', 'date', 'kind', 'reference', 'court', 'item', 'staff', 'actor', 'method', 'reason', 'amount_iqd', 'total_iqd', 'note'];

/** Server columns → uniform specs. With no columns, the first row's keys stand in. */
export function normalizeColumns(columns: ReportColumnInput[] | null | undefined, rows: readonly ReportRow[]): NormalizedColumn[] {
  const sample = rows[0] ?? {};
  let specs: ReportColumnSpec[];
  if (columns && columns.length > 0) {
    specs = columns.map((c) => (typeof c === 'string' ? { key: c } : c)).filter((c) => typeof c.key === 'string' && c.key !== '');
  } else {
    const keys = Object.keys(sample).filter((k) => !k.endsWith('_id') && k !== 'id');
    keys.sort((a, b) => {
      const ia = PREFERRED_ORDER.indexOf(a);
      const ib = PREFERRED_ORDER.indexOf(b);
      return (ia === -1 ? PREFERRED_ORDER.length : ia) - (ib === -1 ? PREFERRED_ORDER.length : ib);
    });
    specs = keys.map((key) => ({ key }));
  }
  return specs.map((c) => ({
    key: c.key,
    kind: inferKind(c.key, serverKind(c.kind ?? null), sample[c.key]),
    labelEn: c.labelEn ?? c.label_en ?? c.label ?? null,
    labelAr: c.labelAr ?? c.label_ar ?? null,
  }));
}

/** 0068's column kinds ('count', 'pct') mapped onto the UI's vocabulary. */
function serverKind(kind: string | null): string | null {
  if (kind === 'count') return 'number';
  if (kind === 'pct') return 'percent';
  return kind;
}

/** Human fallback for an unknown key: `revenue_per_seat` → `revenue per seat`. */
export function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ');
}

export function isNumericKind(kind: ColumnKind): boolean {
  return kind === 'money' || kind === 'number' || kind === 'percent' || kind === 'minutes' || kind === 'hours';
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || value === '') return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format one cell for display. `unit` supplies the localised suffix strings
 * (percent sign, min, h) so nothing here hard-codes a user-facing literal.
 */
export function formatCell(
  value: unknown,
  kind: ColumnKind,
  locale: Locale,
  unit: { percent: (n: string) => string; minutes: (n: string) => string; hours: (n: string) => string },
): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (kind) {
    case 'money':
      return typeof value === 'number' && Number.isInteger(value) ? formatIQD(value, locale) : typeof value === 'number' ? formatNumber(value, locale) : String(value);
    case 'number':
      return typeof value === 'number' ? formatNumber(value, locale) : String(value);
    case 'percent':
      return typeof value === 'number' ? unit.percent(formatNumber(value, locale)) : String(value);
    case 'minutes':
      return typeof value === 'number' ? unit.minutes(formatNumber(value, locale)) : String(value);
    case 'hours':
      return typeof value === 'number' ? unit.hours(formatNumber(value, locale)) : String(value);
    case 'date': {
      const d = parseDate(value);
      return d ? formatDate(d, locale) : String(value);
    }
    case 'datetime': {
      const d = parseDate(value);
      return d ? formatDateTime(d, locale) : String(value);
    }
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

/** Stable client-side ordering of server rows. Never mutates. */
export function sortRows(rows: readonly ReportRow[], key: string | null, dir: 'asc' | 'desc'): ReportRow[] {
  if (!key) return [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const va = a.row[key];
      const vb = b.row[key];
      let cmp: number;
      if (va == null && vb == null) cmp = 0;
      else if (va == null) cmp = 1;
      else if (vb == null) cmp = -1;
      else if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb));
      // Nulls sink regardless of direction; ties keep server order.
      if (va == null || vb == null) return cmp || a.index - b.index;
      return cmp * sign || a.index - b.index;
    })
    .map((x) => x.row);
}

/** The drill key for a row: `court:<id>` / `item:<id>` / `staff:<id>` per the contract, else the row's label. */
export function drillKeyFor(row: ReportRow): string | null {
  for (const [prefix, idKey] of [
    ['court', 'court_id'],
    ['item', 'item_id'],
    ['staff', 'staff_id'],
    ['category', 'category_id'],
    ['ingredient', 'ingredient_id'],
  ] as const) {
    const id = row[idKey];
    if (typeof id === 'string' && id !== '') return `${prefix}:${id}`;
  }
  for (const k of ['date', 'business_date', 'period', 'hour', 'method', 'reason', 'station']) {
    const v = row[k];
    if (typeof v === 'string' && v !== '') return `${k}:${v}`;
    if (typeof v === 'number') return `${k}:${v}`;
  }
  return null;
}

/** First text-ish cell of a row, for dialog titles. */
export function rowLabel(row: ReportRow, columns: readonly NormalizedColumn[]): string {
  for (const c of columns) {
    const v = row[c.key];
    if (!isNumericKind(c.kind) && typeof v === 'string' && v !== '') return v;
  }
  const first = columns[0];
  const v = first ? row[first.key] : undefined;
  return v == null ? '' : String(v);
}

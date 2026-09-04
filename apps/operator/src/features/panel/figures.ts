/**
 * Management panel figure model (spec 06.39). Maps the `panel_headline`
 * result onto the twelve figures the panel knows, with their display kind,
 * the report each opens, and whether a rise is bad (refunds, waste, no-shows).
 * Pure: no formatting, no arithmetic — the server's `changeAbs` / `changePct`
 * are rendered as given.
 */
import type { CsvCell } from '../analytics/csv';

export const FIGURE_KEYS = [
  'revenue',
  'padelRevenue',
  'cafeRevenue',
  'cash',
  'card',
  'bookings',
  'orders',
  'avgOrderValue',
  'discounts',
  'refunds',
  'waste',
  'noShows',
] as const;
export type FigureKey = (typeof FIGURE_KEYS)[number];

export type FigureGroup = 'headline' | 'padel' | 'cafe';
export type ReportPath = '/reports/revenue' | '/reports/courts' | '/reports/cafe' | '/reports/stock' | '/reports/staff';

export interface FigureMeta {
  key: FigureKey;
  kind: 'money' | 'count';
  /** A rise is bad. */
  invert?: boolean;
  report: ReportPath;
  group: FigureGroup;
}

export const FIGURES: Record<FigureKey, FigureMeta> = {
  revenue: { key: 'revenue', kind: 'money', report: '/reports/revenue', group: 'headline' },
  cash: { key: 'cash', kind: 'money', report: '/reports/revenue', group: 'headline' },
  card: { key: 'card', kind: 'money', report: '/reports/revenue', group: 'headline' },
  padelRevenue: { key: 'padelRevenue', kind: 'money', report: '/reports/courts', group: 'padel' },
  bookings: { key: 'bookings', kind: 'count', report: '/reports/courts', group: 'padel' },
  noShows: { key: 'noShows', kind: 'count', invert: true, report: '/reports/courts', group: 'padel' },
  cafeRevenue: { key: 'cafeRevenue', kind: 'money', report: '/reports/cafe', group: 'cafe' },
  orders: { key: 'orders', kind: 'count', report: '/reports/cafe', group: 'cafe' },
  avgOrderValue: { key: 'avgOrderValue', kind: 'money', report: '/reports/cafe', group: 'cafe' },
  discounts: { key: 'discounts', kind: 'money', invert: true, report: '/reports/revenue', group: 'cafe' },
  refunds: { key: 'refunds', kind: 'money', invert: true, report: '/reports/revenue', group: 'cafe' },
  waste: { key: 'waste', kind: 'money', invert: true, report: '/reports/stock', group: 'cafe' },
};

/** Figures per group in display order. */
export function figuresIn(group: FigureGroup): FigureMeta[] {
  return FIGURE_KEYS.map((k) => FIGURES[k]).filter((f) => f.group === group);
}

export interface HeadlineFigureRow {
  key: string;
  value: number | null;
  previous?: number | null;
  changeAbs?: number | null;
  changePct?: number | null;
}

export interface PanelHeadline {
  figures?: HeadlineFigureRow[] | null;
}

const KEY_SET: ReadonlySet<string> = new Set(FIGURE_KEYS);
export function isFigureKey(key: string): key is FigureKey {
  return KEY_SET.has(key);
}

/** Known figures from the result, by key. Unknown keys are dropped; a missing figure is simply absent. */
export function mapFigures(result: PanelHeadline | null | undefined): Map<FigureKey, HeadlineFigureRow> {
  const out = new Map<FigureKey, HeadlineFigureRow>();
  for (const f of result?.figures ?? []) {
    if (f && typeof f.key === 'string' && isFigureKey(f.key)) out.set(f.key, f);
  }
  return out;
}

/** "Period has no trading": no figures at all, or every figure null or zero. */
export function panelIsEmpty(result: PanelHeadline | null | undefined): boolean {
  const figures = result?.figures ?? [];
  if (figures.length === 0) return true;
  return figures.every((f) => f.value == null || f.value === 0);
}

/** One CSV row per known figure, raw numbers, in panel order. */
export function figuresToCsvRows(figures: ReadonlyMap<FigureKey, HeadlineFigureRow>, labelOf: (key: FigureKey) => string): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const key of FIGURE_KEYS) {
    const f = figures.get(key);
    if (!f) continue;
    rows.push([labelOf(key), f.value ?? null, f.previous ?? null, f.changeAbs ?? null, f.changePct ?? null]);
  }
  return rows;
}

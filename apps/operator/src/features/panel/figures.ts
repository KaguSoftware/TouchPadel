/**
 * Management panel figure model (spec 06.39). Maps the `panel_headline`
 * result onto the thirteen figures the panel knows, with their display kind,
 * the report each opens, and whether a rise is bad (refunds, waste, no-shows).
 * Pure: no formatting, no arithmetic — the server's `changeAbs` / `changePct`
 * are rendered as given.
 */
import type { CsvCell } from '../analytics/csv';

export const FIGURE_KEYS = [
  'revenue',
  'padelRevenue',
  'cafeRevenue',
  'cafeNet',
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

/**
 * `losses` is money given away or thrown out: discounts, refunds, waste. They
 * sat at the bottom of the cafe column, which made that column twice the
 * padel column's height and left a hole beside it — and a refund or a
 * discount is not only a cafe matter to an owner reading the list.
 */
export type FigureGroup = 'headline' | 'padel' | 'cafe' | 'losses';
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
  // 0096: the cafe after its refunds, the same figure the Analytics "Cafe sales" tile shows.
  cafeNet: { key: 'cafeNet', kind: 'money', report: '/reports/cafe', group: 'cafe' },
  orders: { key: 'orders', kind: 'count', report: '/reports/cafe', group: 'cafe' },
  avgOrderValue: { key: 'avgOrderValue', kind: 'money', report: '/reports/cafe', group: 'cafe' },
  discounts: { key: 'discounts', kind: 'money', invert: true, report: '/reports/revenue', group: 'losses' },
  refunds: { key: 'refunds', kind: 'money', invert: true, report: '/reports/revenue', group: 'losses' },
  waste: { key: 'waste', kind: 'money', invert: true, report: '/reports/stock', group: 'losses' },
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
  /** The window the figures cover, as the server resolved it. */
  period?: { from: string; to: string } | null;
  /** The window the changes are measured against; absent when comparing with nothing. */
  comparison?: { from: string; to: string } | null;
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

/**
 * One CSV row per known figure, raw numbers, in panel order: the label, then
 * the server key, the group and the kind (so a reader can tell IQD from a
 * count), then value, previous, change and change %.
 */
export function figuresToCsvRows(
  figures: ReadonlyMap<FigureKey, HeadlineFigureRow>,
  labelOf: (key: FigureKey) => string,
  groupOf: (group: FigureGroup) => string = (g) => g,
  kindOf: (kind: FigureMeta['kind']) => string = (k) => k,
): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const key of FIGURE_KEYS) {
    const f = figures.get(key);
    if (!f) continue;
    const meta = FIGURES[key];
    rows.push([labelOf(key), key, groupOf(meta.group), kindOf(meta.kind), f.value ?? null, f.previous ?? null, f.changeAbs ?? null, f.changePct ?? null]);
  }
  return rows;
}

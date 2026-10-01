/**
 * Management panel figure model (spec 06.39). Maps the `panel_headline`
 * result onto the figures the panel knows, with their display kind, the
 * report each opens, and whether a rise is bad (refunds, waste, no-shows).
 * Pure: no formatting, no arithmetic — the server's `changeAbs` / `changePct`
 * are rendered as given.
 *
 * Open matches (docs/design/open-matches/operator.md §5.19; panel_headline's
 * seven keys since 0265): the `online` group. They live in their own list,
 * ONLINE_FIGURE_KEYS, beside the thirteen of FIGURE_KEYS rather than in it:
 * report_drill has no transactions for them, so the export's drill set
 * (exportAll.ts DRILLABLE_FIGURES, drawn from FIGURE_KEYS) must not grow, and
 * a row of the group opens its report instead of a drill window.
 *
 * Coaching (docs/design/coaching/operator.md §5.18.4; panel_headline's two
 * lesson keys since 0285, C-18): the `lessons` group, LESSON_FIGURE_KEYS,
 * likewise outside FIGURE_KEYS and never drilled. Lesson revenue opens the
 * revenue report, what is owed to coaches opens Coach pay.
 */
import type { CsvCell } from '../analytics/exportTables';

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

/** panel_headline's online and open-match figures (0265), in panel order. Never drilled; each opens its report. */
export const ONLINE_FIGURE_KEYS = ['onlineDeposits', 'depositForfeits', 'ticketSales', 'ticketRefunds', 'ticketForfeits', 'ticketLiability', 'matchWrittenOff'] as const;
export type OnlineFigureKey = (typeof ONLINE_FIGURE_KEYS)[number];

/** panel_headline's lesson figures (0285, C-18), in panel order. Never drilled; each opens its report. */
export const LESSON_FIGURE_KEYS = ['lessonRevenue', 'owedToCoaches'] as const;
export type LessonFigureKey = (typeof LESSON_FIGURE_KEYS)[number];

export type FigureKey = (typeof FIGURE_KEYS)[number] | OnlineFigureKey | LessonFigureKey;

/** Every figure the panel knows, in panel order: the thirteen, then the online group, then the lessons group. */
export const ALL_FIGURE_KEYS: readonly FigureKey[] = [...FIGURE_KEYS, ...ONLINE_FIGURE_KEYS, ...LESSON_FIGURE_KEYS];

/**
 * `losses` is money given away or thrown out: discounts, refunds, waste. They
 * sat at the bottom of the cafe column, which made that column twice the
 * padel column's height and left a hole beside it — and a refund or a
 * discount is not only a cafe matter to an owner reading the list.
 */
export type FigureGroup = 'headline' | 'padel' | 'cafe' | 'losses' | 'online';
/**
 * Every group a figure sits in: the five above, whose words are
 * `ws.owner.panel.<group>`, and the coaching `lessons` group, worded by the
 * coaching catalog (its CSV word is the lesson-revenue label, "Lessons").
 */
export type PanelGroup = FigureGroup | 'lessons';
export type ReportPath = '/reports/revenue' | '/reports/courts' | '/reports/cafe' | '/reports/stock' | '/reports/staff' | '/reports/coaches';

export interface FigureMeta {
  key: FigureKey;
  kind: 'money' | 'count';
  /** A rise is bad. */
  invert?: boolean;
  report: ReportPath;
  group: PanelGroup;
  /** Counted across every branch whatever the scope (ticket money is chain-wide): the row says "All branches". */
  chainWide?: boolean;
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
  // Open matches (0265): deposits open the revenue report, tickets and match shares the courts report.
  onlineDeposits: { key: 'onlineDeposits', kind: 'money', report: '/reports/revenue', group: 'online' },
  depositForfeits: { key: 'depositForfeits', kind: 'money', report: '/reports/revenue', group: 'online' },
  ticketSales: { key: 'ticketSales', kind: 'money', report: '/reports/courts', group: 'online', chainWide: true },
  ticketRefunds: { key: 'ticketRefunds', kind: 'money', invert: true, report: '/reports/courts', group: 'online', chainWide: true },
  ticketForfeits: { key: 'ticketForfeits', kind: 'money', report: '/reports/courts', group: 'online' },
  ticketLiability: { key: 'ticketLiability', kind: 'money', report: '/reports/courts', group: 'online', chainWide: true },
  matchWrittenOff: { key: 'matchWrittenOff', kind: 'money', invert: true, report: '/reports/courts', group: 'online' },
  // Coaching (0285): lesson money opens the revenue report, the coaches' share Coach pay.
  lessonRevenue: { key: 'lessonRevenue', kind: 'money', report: '/reports/revenue', group: 'lessons' },
  owedToCoaches: { key: 'owedToCoaches', kind: 'money', report: '/reports/coaches', group: 'lessons' },
};

/** Figures per group in display order. */
export function figuresIn(group: PanelGroup): FigureMeta[] {
  return ALL_FIGURE_KEYS.map((k) => FIGURES[k]).filter((f) => f.group === group);
}

/** The online group is drawn only when the server sent at least one of its figures (0265 and later). */
export function hasOnlineFigures(figures: ReadonlyMap<FigureKey, HeadlineFigureRow>): boolean {
  return ONLINE_FIGURE_KEYS.some((k) => figures.has(k));
}

/** The lessons group is drawn only when the server sent at least one of its figures (0285 and later). */
export function hasLessonFigures(figures: ReadonlyMap<FigureKey, HeadlineFigureRow>): boolean {
  return LESSON_FIGURE_KEYS.some((k) => figures.has(k));
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

const KEY_SET: ReadonlySet<string> = new Set(ALL_FIGURE_KEYS);
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
 * One CSV row per known figure, raw numbers, in panel order: the label, the
 * group and what it is measured in (so a reader can tell IQD from a count),
 * then value, previous, change and change %, and the server key last — it is
 * there to correlate two exports, not to be read, so it does not sit between
 * the figure's name and its value.
 */
export function figuresToCsvRows(
  figures: ReadonlyMap<FigureKey, HeadlineFigureRow>,
  labelOf: (key: FigureKey) => string,
  groupOf: (group: FigureGroup) => string = (g) => g,
  kindOf: (kind: FigureMeta['kind']) => string = (k) => k,
): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const key of ALL_FIGURE_KEYS) {
    const f = figures.get(key);
    if (!f) continue;
    const meta = FIGURES[key];
    // The lessons group's word is its lead figure's ("Lessons" / «الحصص»).
    const group = meta.group === 'lessons' ? labelOf('lessonRevenue') : groupOf(meta.group);
    rows.push([labelOf(key), group, kindOf(meta.kind), f.value ?? null, f.previous ?? null, f.changeAbs ?? null, f.changePct ?? null, key]);
  }
  return rows;
}

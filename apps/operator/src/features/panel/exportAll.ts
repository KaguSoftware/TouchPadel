/**
 * The management panel's full export: everything the panel was given for the
 * period, in one CSV — not the thirteen totals alone.
 *
 * Three sections:
 *   1. The window: period, comparison mode and the window the changes are
 *      measured against, and when the file was made.
 *   2. The figures: label, server key, group, kind, value, previous, change
 *      and change %, raw numbers as `panel_headline` sent them.
 *   3. The transactions behind every figure that can be opened (the same
 *      `report_drill` rows the drill dialog shows), one row per transaction
 *      per figure, with every field the server sends flattened into its own
 *      column: id, when, kind, the words, who (name and id), the reference,
 *      the amount, and each `detail` fact (status, court, guest, table,
 *      method, reason, item, ingredient, quantity…) as raw codes.
 *
 * Why the drill is fetched in pieces: `report_drill` lists the latest 500
 * rows of a figure and no more. An export that stopped there would drop the
 * oldest transactions of a busy month without saying so. So when a call
 * comes back full, the range is split in two and each half is read on its
 * own, down to a single day. A single day still full is the one case the
 * server cannot be asked for more, and the file says which day.
 *
 * `avgOrderValue` is a ratio, not a list of things; the server has no drill
 * for it and the export does not pretend to.
 */
import { addDays } from '@touch/core';
import { formatDateTime, type Locale, type MessageKey } from '@touch/i18n';
import type { ComparisonMode, Period } from '../../components/kit';
import type { CsvCell, CsvSection } from '../analytics/csv';
import type { DrillTransaction } from '../reports/reportPayloads';
import { drillWords } from '../reports/drillWords';
import { FIGURE_KEYS, figuresToCsvRows, type FigureKey, type HeadlineFigureRow } from './figures';

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The latest rows one `report_drill` call returns (its `limit 500`). */
export const DRILL_CAP = 500;

/** The figures the server can list transactions for, in panel order. */
export const DRILLABLE_FIGURES: readonly FigureKey[] = FIGURE_KEYS.filter((k) => k !== 'avgOrderValue');

/**
 * The `detail` facts `report_drill` writes (0102), each its own column. Raw
 * codes on purpose: the words column beside them is the translation, and a
 * code in a spreadsheet can be filtered and counted where a sentence cannot.
 */
export const DETAIL_COLUMNS = [
  'status',
  'courtEn',
  'courtAr',
  'guest',
  'table',
  'tabLabel',
  'method',
  'source',
  'reason',
  'adjKind',
  'itemEn',
  'itemAr',
  'ingredientEn',
  'ingredientAr',
  'movement',
  'qty',
  'unit',
] as const;
export type DetailColumn = (typeof DETAIL_COLUMNS)[number];

export interface DrillRange {
  from: string;
  to: string;
}

export type DrillFetch = (figure: FigureKey, range: DrillRange) => Promise<DrillTransaction[]>;

export interface FigureTransactions {
  figure: FigureKey;
  rows: DrillTransaction[];
  /** Single days the server still capped: their oldest rows are not in the file. */
  cappedDays: string[];
}

/** The two halves of a range of at least two days, split at the middle day. */
export function splitRange(range: DrillRange): [DrillRange, DrillRange] {
  const days = daysBetween(range.from, range.to);
  if (days < 1) throw new RangeError(`cannot split a single day: ${range.from}`);
  const mid = addDays(range.from, Math.floor(days / 2));
  return [
    { from: range.from, to: mid },
    { from: addDays(mid, 1), to: range.to },
  ];
}

function daysBetween(from: string, to: string): number {
  const ms = Date.UTC(...ymd(to)) - Date.UTC(...ymd(from));
  return Math.round(ms / 86_400_000);
}
function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y!, (m ?? 1) - 1, d ?? 1];
}

/**
 * Every transaction of a figure over the range, newest first, bisecting any
 * piece that came back full. Later halves are read before earlier ones so
 * the concatenation keeps the server's order.
 */
export async function fetchAllTransactions(figure: FigureKey, range: DrillRange, fetch: DrillFetch, cap = DRILL_CAP): Promise<FigureTransactions> {
  const rows = await fetch(figure, range);
  if (rows.length < cap) return { figure, rows, cappedDays: [] };
  if (range.from === range.to) return { figure, rows, cappedDays: [range.from] };
  const [earlier, later] = splitRange(range);
  const [b, a] = await Promise.all([fetchAllTransactions(figure, later, fetch, cap), fetchAllTransactions(figure, earlier, fetch, cap)]);
  return { figure, rows: [...b.rows, ...a.rows], cappedDays: [...b.cappedDays, ...a.cappedDays] };
}

export interface PanelExportInput {
  period: Period;
  compare: ComparisonMode;
  comparison: { from: string; to: string } | null;
  figures: ReadonlyMap<FigureKey, HeadlineFigureRow>;
  transactions: readonly FigureTransactions[];
  exportedAt: Date;
  tr: Tr;
  locale: Locale;
}

const detailCell = (v: unknown): CsvCell => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return JSON.stringify(v);
};

/** The three sections, ready for `toCsvSections`. */
export function buildPanelExport(input: PanelExportInput): CsvSection[] {
  const { tr, locale, period, compare, comparison, figures, transactions, exportedAt } = input;
  const label = (key: FigureKey) => tr(`ws.owner.panel.figures.${key}`);

  const meta: CsvCell[][] = [
    [tr('ws.owner.panel.csv.periodFrom'), period.from],
    [tr('ws.owner.panel.csv.periodTo'), period.to],
    [tr('ws.owner.panel.csv.comparison'), tr(`ws.kit.comparison.${compare}`)],
    [tr('ws.owner.panel.csv.comparisonFrom'), comparison?.from ?? null],
    [tr('ws.owner.panel.csv.comparisonTo'), comparison?.to ?? null],
    [tr('ws.owner.panel.csv.exportedAt'), exportedAt.toISOString()],
  ];
  const capped = transactions.flatMap((t) => t.cappedDays.map((day) => [tr('ws.owner.panel.csv.cappedDay'), `${label(t.figure)} · ${day}`] as CsvCell[]));

  const figureRows = figuresToCsvRows(
    figures,
    label,
    (g) => tr(`ws.owner.panel.${g}`),
    (k) => tr(`ws.owner.panel.csv.kinds.${k}`),
  );

  const txRows: CsvCell[][] = [];
  for (const { figure, rows } of transactions) {
    for (const t of rows) {
      const w = drillWords(t, tr, locale);
      const d = t.detail ?? {};
      txRows.push([
        label(figure),
        figure,
        t.id,
        t.at ? formatDateTime(new Date(t.at), locale) : null,
        t.at,
        t.kind,
        w.kind,
        w.text ?? t.label,
        t.label,
        t.staffName,
        t.staffId,
        t.reference,
        t.amountIqd,
        ...DETAIL_COLUMNS.map((c) => detailCell(d[c])),
      ]);
    }
  }

  const c = (k: 'figure' | 'key' | 'group' | 'kind' | 'value' | 'previous' | 'changeAbs' | 'changePct' | 'id' | 'when' | 'whenIso' | 'serverKind' | 'type' | 'description' | 'label' | 'by' | 'staffId' | 'reference' | 'amount') =>
    tr(`ws.owner.panel.csv.${k}`);

  return [
    { title: tr('ws.owner.panel.title'), rows: [...meta, ...capped] },
    {
      title: tr('ws.owner.panel.csv.figuresSection'),
      headers: [c('figure'), c('key'), c('group'), c('kind'), c('value'), c('previous'), c('changeAbs'), c('changePct')],
      rows: figureRows,
    },
    {
      title: tr('ws.owner.panel.csv.transactionsSection'),
      headers: [
        c('figure'),
        c('key'),
        c('id'),
        c('when'),
        c('whenIso'),
        c('serverKind'),
        c('type'),
        c('description'),
        c('label'),
        c('by'),
        c('staffId'),
        c('reference'),
        c('amount'),
        ...DETAIL_COLUMNS.map((col) => tr(`ws.owner.panel.csv.detail.${col}`)),
      ],
      rows: txRows,
    },
  ];
}

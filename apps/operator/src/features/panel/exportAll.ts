/**
 * The management panel's full export: everything the panel was given for the
 * period — not the thirteen totals alone.
 *
 * Three TABLES, and since they are three tables they are three files, zipped.
 * They used to be three blocks of one CSV separated by blank lines, which no
 * spreadsheet reads as three tables: it takes the first header row and fits
 * everything below into those columns, so the figures landed under the window
 * labels and the transactions landed under the figures. That single ragged
 * sheet is most of what made this export unreadable.
 *
 *   1. `window` — the period, the comparison mode and the window the changes
 *      are measured against, when the file was made, and any warning.
 *   2. `figures` — one row per figure: its name, its group, what it is
 *      measured in, then value, previous, change and change %.
 *   3. `transactions` — the rows behind every figure that can be opened (the
 *      same `report_drill` rows the drill dialog shows), one row per
 *      transaction, with the date and the time in their own columns and every
 *      fact said in words.
 *
 * Why words and not codes: the transactions table used to carry all seventeen
 * `detail` keys raw, including `courtEn`, `courtAr`, `itemEn`, `itemAr`,
 * `ingredientEn`, `ingredientAr` — six columns of which at most one was ever
 * filled — beside a server label, a translated label, an ISO instant, a
 * formatted instant, a staff id and a transaction uuid. Thirty columns, mostly
 * empty, with the same fact written three ways. The argument for raw codes was
 * that a spreadsheet can filter and count them; so it can, and it filters and
 * counts a word from a fixed catalog exactly as well.
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
import type { Locale, MessageKey } from '@touch/i18n';
import type { ComparisonMode, Period } from '../../components/kit';
import type { CsvCell, ExportBundle, ExportTable } from '../analytics/exportTables';
import { cellText, dayCell, momentCells, shortId, timeCell } from '../analytics/cellFormat';
import type { DrillTransaction } from '../reports/reportPayloads';
import { drillFacts } from '../reports/drillWords';
import { FIGURE_KEYS, figuresToCsvRows, type FigureKey, type HeadlineFigureRow } from './figures';

type Tr = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The latest rows one `report_drill` call returns (its `limit 500`). */
export const DRILL_CAP = 500;

/** The figures the server can list transactions for, in panel order. */
export const DRILLABLE_FIGURES: readonly FigureKey[] = FIGURE_KEYS.filter((k) => k !== 'avgOrderValue');

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

/** The three tables, one sheet each. */
export function buildPanelExport(input: PanelExportInput): ExportBundle {
  const { tr, locale, period, compare, comparison, figures, transactions, exportedAt } = input;
  const label = (key: FigureKey) => tr(`ws.owner.panel.figures.${key}`);
  const c = (k: string) => tr(`ws.owner.panel.csv.${k}` as MessageKey);

  const windowTable: ExportTable = {
    name: c('tabs.window'),
    columns: [c('setting'), c('settingValue')],
    rows: [
      [c('periodFrom'), period.from],
      [c('periodTo'), period.to],
      [c('comparison'), tr(`ws.kit.comparison.${compare}`)],
      [c('comparisonFrom'), comparison?.from ?? null],
      [c('comparisonTo'), comparison?.to ?? null],
      [c('exportedAt'), `${dayCell(exportedAt.toISOString())} ${timeCell(exportedAt.toISOString())}`],
      // A day the server capped is a warning about THIS file, so it belongs in it.
      ...transactions.flatMap((t) => t.cappedDays.map((day): CsvCell[] => [c('cappedDay'), `${label(t.figure)} · ${day}`])),
    ],
  };

  const figuresTable: ExportTable = {
    name: c('tabs.figures'),
    columns: [c('figure'), c('group'), c('kind'), { header: c('value'), type: 'money' }, { header: c('previous'), type: 'money' }, { header: c('changeAbs'), type: 'money' }, { header: c('changePct'), type: 'percent' }, c('key')],
    rows: figuresToCsvRows(
      figures,
      label,
      (g) => tr(`ws.owner.panel.${g}`),
      (k) => tr(`ws.owner.panel.csv.kinds.${k}`),
    ),
  };

  const txRows: CsvCell[][] = [];
  for (const { figure, rows } of transactions) {
    for (const t of rows) {
      const f = drillFacts(t, tr, locale);
      const [day, time] = momentCells(t.at);
      txRows.push([
        label(figure),
        day,
        time,
        f.kind ?? cellText(t.kind),
        f.what,
        cellText(f.text ?? t.label),
        f.where,
        f.guest,
        f.reason,
        f.method,
        f.status,
        f.source,
        f.qty,
        f.unit,
        t.amountIqd ?? null,
        cellText(t.staffName),
        cellText(t.reference),
        shortId(t.id),
      ]);
    }
  }

  const transactionsTable: ExportTable = {
    name: c('tabs.transactions'),
    columns: [
      c('figure'),
      c('date'),
      c('time'),
      c('type'),
      c('what'),
      c('description'),
      c('where'),
      c('detail.guest'),
      c('detail.reason'),
      c('detail.method'),
      c('detail.status'),
      c('detail.source'),
      c('detail.qty'),
      c('detail.unit'),
      { header: c('amount'), type: 'money' },
      c('by'),
      c('reference'),
      c('id'),
    ],
    rows: txRows,
  };

  return [windowTable, figuresTable, transactionsTable];
}

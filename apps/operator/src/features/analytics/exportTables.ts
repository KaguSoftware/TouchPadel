/**
 * What an export IS, everywhere in the workspace: one or more tables, each
 * with a header row and rows of the same width, downloaded as a styled
 * `.xlsx` workbook with one sheet per table.
 *
 * It used to be a CSV, and the two things a CSV could not do were exactly the
 * two things wrong with the files:
 *
 *   - **No presentation.** No column width, so every heading longer than
 *     eight characters arrived cut off ("Opening f", "Cash taker", "Voided
 *     lin"); no fill or weight, so a header row looked like a data row; no
 *     number format, so an amount was a bare string of digits. `xlsx.ts`
 *     carries all of it.
 *   - **No second table.** Several tables in one CSV, separated by blank
 *     lines, is not a format any spreadsheet reads back: it takes the first
 *     header row and squeezes everything under it into those columns. That is
 *     what a sheet per table is for.
 *
 * Cell CONTENT is normalised on the way in by `cellFormat.ts` — one line per
 * cell, a moment split into a date column and a time column, codes said in
 * words. This module is only about the shape of the file.
 */
import type { Locale } from '@touch/i18n';
import { downloadXlsx, type ColumnType, type Sheet, type SheetCell, type SheetColumn } from './xlsx';

/** A cell: text, a number, or nothing. Never `0` standing in for "not reported". */
export type CsvCell = SheetCell;

export type { ColumnType, SheetColumn };

/**
 * One table of an export. `columns` may be plain header strings — the column
 * type is then read off the values, which is right wherever the cells came
 * through `cellFormat.ts` — or a `{ header, type }` where the values alone
 * would be ambiguous.
 */
export interface ExportTable {
  /** The sheet tab's name, in the reader's language. */
  name: string;
  columns: readonly (SheetColumn | string)[];
  rows: readonly (readonly CsvCell[])[];
}

/** Several tables, one per sheet. */
export type ExportBundle = readonly ExportTable[];

/** Headers as a spreadsheet needs them: present, and no two the same. */
export function uniqueHeaders(columns: readonly (SheetColumn | string)[]): (SheetColumn | string)[] {
  const seen = new Map<string, number>();
  return columns.map((raw) => {
    const header = typeof raw === 'string' ? raw : raw.header;
    const key = header.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    // Two columns with the same name make a filter ambiguous and a lookup wrong.
    const next = n === 1 ? header : `${header} (${n})`;
    return typeof raw === 'string' ? next : { ...raw, header: next };
  });
}

/**
 * Every row padded to the width of its header row. A short row used to leave
 * the sheet ragged from that row down.
 */
function squared(table: ExportTable): Sheet {
  const columns = uniqueHeaders(table.columns);
  const width = columns.length;
  return {
    name: table.name,
    columns,
    rows: table.rows.map((row) =>
      row.length === width ? row : [...row.slice(0, width), ...Array.from({ length: Math.max(0, width - row.length) }, () => null)],
    ),
  };
}

/**
 * Download the tables as `<filename>.xlsx`. In Arabic every sheet is laid out
 * right to left, so column A is the rightmost one.
 */
export function downloadWorkbook(filename: string, locale: Locale, bundle: ExportBundle): void {
  const sheets = bundle.map((table) => ({ ...squared(table), rightToLeft: locale === 'ar' }));
  downloadXlsx(filename, sheets);
}

/** One table, one sheet — the shape most screens export. */
export function downloadTable(filename: string, locale: Locale, table: ExportTable): void {
  downloadWorkbook(filename, locale, [table]);
}

/**
 * CSV export — comma-separated, UTF-8 BOM so Excel (EN and AR) opens it as
 * UTF-8, Latin digits, plain "." decimals (no locale decimal comma).
 *
 * A file written here is ONE table: one header row, then rows of the same
 * width. It used to be possible to write several tables into one file, with
 * titles and blank lines between them; no spreadsheet reads that back as
 * several tables — it reads the first header row and squeezes everything
 * after it into those columns, which is how an export of three tables arrived
 * as one ragged sheet. An export of several tables is a `CsvBundle`: one file
 * per table, delivered as a zip.
 *
 * Cells are normalised on the way out (`csvFormat.ts`): one line each, never
 * longer than `MAX_CELL`. A newline inside a quoted field is legal CSV and
 * every spreadsheet honours it by drawing a row several lines tall — the
 * "overflowing cells" in the old exports were mostly that, and free text
 * pasted by staff is the one place it came from.
 */
import { MAX_CELL, cellText } from './csvFormat';
import { zipBlob, type ZipEntry } from './zip';

export type CsvCell = string | number | null | undefined;

function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  // One line, clipped: a cell is something a person reads across, not down.
  const s = cellText(v, MAX_CELL) ?? '';
  // Neutralise formula injection (=, +, -, @ leading) — a name like "=1+1" must stay text.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const CSV_BOM = '﻿';

/**
 * One table. `rows` narrower than `headers` are padded and rows wider than it
 * are refused in development, because a ragged table is the bug this module
 * exists to prevent.
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const width = headers.length;
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) {
    if (import.meta.env?.DEV && row.length > width) {
      console.error('csv: a row is wider than its headers and would misalign the sheet', { width, row });
    }
    const padded = row.length === width ? row : [...row.slice(0, width), ...Array.from({ length: Math.max(0, width - row.length) }, () => null)];
    lines.push(padded.map(escapeCell).join(','));
  }
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/** One table of an export, with the name its file gets inside the zip. */
export interface CsvTable {
  /** File name without the extension — numbered so the files open in reading order. */
  name: string;
  headers: readonly string[];
  rows: readonly (readonly CsvCell[])[];
}

/** Several tables, each its own file. */
export type CsvBundle = readonly CsvTable[];

export function bundleEntries(bundle: CsvBundle): ZipEntry[] {
  return bundle.map((table, i) => ({
    name: `${String(i + 1).padStart(2, '0')}-${table.name}.csv`,
    text: toCsv(table.headers, table.rows),
  }));
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Trigger a browser download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  download(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

/**
 * Trigger a browser download of a multi-table export as `<filename>.zip`. A
 * bundle of one table is sent as that table's CSV instead — a zip holding a
 * single file is a step for nothing.
 */
export function downloadCsvBundle(filename: string, bundle: CsvBundle): void {
  const tables = bundle.filter((t) => t.rows.length > 0 || t.headers.length > 0);
  if (tables.length === 1) {
    downloadCsv(`${filename}.csv`, toCsv(tables[0]!.headers, tables[0]!.rows));
    return;
  }
  download(`${filename}.zip`, zipBlob(bundleEntries(tables)));
}

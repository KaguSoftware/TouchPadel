/**
 * CSV export — comma-separated, UTF-8 BOM so Excel (EN and AR) opens it as
 * UTF-8, Latin digits, plain "." decimals (no locale decimal comma).
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  // Neutralise formula injection (=, +, -, @ leading) — a name like "=1+1" must stay text.
  const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const CSV_BOM = '﻿';

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(escapeCell).join(',')];
  for (const row of rows) lines.push(row.map(escapeCell).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}

/**
 * One block of a sectioned CSV: an optional title line, an optional header
 * row, then the rows. Sections are separated by a blank line so a spreadsheet
 * shows them as distinct tables in one sheet.
 */
export interface CsvSection {
  title?: string;
  headers?: readonly string[];
  rows: readonly (readonly CsvCell[])[];
}

/** Several tables in one file — the management panel's full export. */
export function toCsvSections(sections: readonly CsvSection[]): string {
  const blocks: string[] = [];
  for (const section of sections) {
    const lines: string[] = [];
    if (section.title !== undefined) lines.push(escapeCell(section.title));
    if (section.headers) lines.push(section.headers.map(escapeCell).join(','));
    for (const row of section.rows) lines.push(row.map(escapeCell).join(','));
    blocks.push(lines.join('\r\n'));
  }
  return CSV_BOM + blocks.join('\r\n\r\n') + '\r\n';
}

/** Trigger a browser download of `csv` as `filename`. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A minimal `.xlsx` writer: the workbook an exported table should have been
 * all along.
 *
 * WHY THIS EXISTS
 *
 * A CSV is text. It carries no column width, no font, no fill and no number
 * format, so a spreadsheet opens every column at the same default width and
 * every heading longer than eight characters is cut off — "Opening f",
 * "Cash taker", "Voided lin" — with nothing to tell a header row from a data
 * row and nothing to mark an amount from a count. Cleaning up what goes IN
 * the cells (csvFormat.ts) fixed the content; it cannot fix the presentation,
 * because a CSV has nowhere to put it.
 *
 * An `.xlsx` does. It is a zip of XML parts and we already have a zip writer
 * (zip.ts), so this costs a file rather than a dependency — the alternative
 * was a spreadsheet library, several hundred kilobytes in a bundle the
 * operator station has to hold offline.
 *
 * WHAT IT PRODUCES
 *
 *   - Columns sized to their widest cell, so no heading is cut off.
 *   - A dark header row in white bold, frozen, with filter arrows on it.
 *   - Banded rows, so the eye keeps its place across a wide table.
 *   - Real types: an amount is a number with thousands separators and red
 *     negatives, a date is a date, a clock is a time. They sort, filter and
 *     total as themselves, where a CSV's `2026-09-23` was text.
 *   - One sheet per table in one file: the management panel's three tables
 *     are three tabs, not three files in a zip.
 *   - Right-to-left sheets in Arabic.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No formulas, no charts, no merged cells, and no Excel "Table" parts. A
 * table part would add the native Format-as-Table look, but it needs its own
 * part, its own relationship and a unique display name, and a malformed one
 * makes Excel offer to repair the file — worse than plain. The header, the
 * banding and the filters here are ordinary cell formatting, which Excel,
 * LibreOffice, Numbers and Google Sheets all render the same way.
 */
import { zipBlob, type ZipEntry } from './zip';

export type SheetCell = string | number | null | undefined;

/**
 * How a column is written. Left out, it is inferred from the values — which
 * is right nearly always, because the cells already arrive normalised
 * (`csvFormat.ts` writes a day as `2026-09-23` and a clock as `14:05`).
 */
export type ColumnType = 'text' | 'number' | 'money' | 'decimal' | 'percent' | 'date' | 'time';

export interface SheetColumn {
  header: string;
  type?: ColumnType;
  /** Width in characters; measured from the content when absent. */
  width?: number;
}

export interface Sheet {
  /** The tab's name. Trimmed to what a sheet name is allowed to be. */
  name: string;
  columns: readonly (SheetColumn | string)[];
  rows: readonly (readonly SheetCell[])[];
  /** Arabic: the sheet itself reads right to left. */
  rightToLeft?: boolean;
}

// ---------------------------------------------------------------------------
// Types and number formats
// ---------------------------------------------------------------------------

const TYPES: readonly ColumnType[] = ['text', 'number', 'money', 'decimal', 'percent', 'date', 'time'];

/** Custom number formats, from 164 — the first id a file is allowed to define. */
const NUM_FMT: Record<ColumnType, number> = {
  text: 0,
  number: 164,
  money: 165,
  decimal: 166,
  percent: 167,
  date: 168,
  time: 169,
};

const NUM_FMT_CODE: readonly (readonly [number, string])[] = [
  [164, '#,##0'],
  // A refund or a cash difference is read by its sign before its size.
  [165, '#,##0;[Red]-#,##0'],
  [166, '#,##0.0;[Red]-#,##0.0'],
  // The server sends 15.4 meaning 15.4 per cent. Excel's own percent format
  // would multiply that by a hundred, so the sign is part of the format.
  [167, '0.0"%";[Red]-0.0"%"'],
  [168, 'yyyy-mm-dd'],
  [169, 'hh:mm'],
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

/**
 * The type of a column, read off its values: whole numbers are amounts,
 * fractional ones decimals, `2026-09-23` a date, `14:05` a time. A column
 * with nothing in it is text.
 */
export function inferType(header: string, values: readonly SheetCell[]): ColumnType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (present.length === 0) return 'text';
  if (present.every((v) => typeof v === 'number')) {
    if (header.includes('%')) return 'percent';
    return present.every((v) => Number.isInteger(v)) ? 'money' : 'decimal';
  }
  if (present.every((v) => typeof v === 'string' && DAY.test(v))) return 'date';
  if (present.every((v) => typeof v === 'string' && CLOCK.test(v))) return 'time';
  return 'text';
}

/** Days since 1899-12-30, the epoch a spreadsheet counts dates from. */
function dateSerial(day: string): number | null {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  return Date.UTC(y, m - 1, d) / 86_400_000 + 25_569;
}

/** A clock as a fraction of a day. */
function timeSerial(clock: string): number | null {
  const [h, m] = clock.split(':').map(Number);
  if (h === undefined || m === undefined) return null;
  return (h * 60 + m) / 1440;
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

function xml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&apos;'));
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * Style ids, in the order they are written to `cellXfs`:
 *   0          the default
 *   1          the header
 *   2 and up   one pair per type — plain, then banded
 */
const HEADER_STYLE = 1;

export function styleFor(type: ColumnType, banded: boolean): number {
  return 2 + TYPES.indexOf(type) * 2 + (banded ? 1 : 0);
}

function stylesXml(): string {
  const fmts = NUM_FMT_CODE.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${xml(code)}"/>`).join('');
  const xfs: string[] = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
  ];
  for (const type of TYPES) {
    for (const banded of [false, true]) {
      const fmt = NUM_FMT[type];
      const fill = banded ? 3 : 0;
      xfs.push(
        `<xf numFmtId="${fmt}" fontId="0" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="${fmt ? 1 : 0}" applyFill="${banded ? 1 : 0}" applyAlignment="1"><alignment vertical="center"/></xf>`,
      );
    }
  }
  return (
    `${DECL}<styleSheet xmlns="${NS}">` +
    `<numFmts count="${NUM_FMT_CODE.length}">${fmts}</numFmts>` +
    '<fonts count="2">' +
    '<font><sz val="11"/><color rgb="FF1B2430"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    // Fills 0 and 1 are reserved by the format and have to be exactly these two.
    '<fills count="4">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF1F3A5F"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF3F9"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

// ---------------------------------------------------------------------------
// A sheet
// ---------------------------------------------------------------------------

interface ResolvedColumn {
  header: string;
  type: ColumnType;
  width: number;
}

/** Roughly how wide a cell reads once its number format has been applied. */
function cellWidth(value: SheetCell, type: ColumnType): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    // Thousands separators and a minus sign take room the bare digits do not.
    const digits = Math.abs(Math.trunc(value)).toString().length;
    const groups = Math.max(0, Math.ceil(digits / 3) - 1);
    const decimals = type === 'decimal' || type === 'percent' ? 2 : 0;
    return digits + groups + decimals + (value < 0 ? 1 : 0) + (type === 'percent' ? 1 : 0);
  }
  return value.length;
}

export function resolveColumns(sheet: Sheet): ResolvedColumn[] {
  return sheet.columns.map((raw, i) => {
    const col: SheetColumn = typeof raw === 'string' ? { header: raw } : raw;
    const values = sheet.rows.map((r) => r[i]);
    const type = col.type ?? inferType(col.header, values);
    const widest = Math.max(col.header.length, ...values.map((v) => cellWidth(v, type)), 0);
    // Room for the header's filter arrow, and never so wide that one column
    // pushes every other one off the screen.
    const width = col.width ?? Math.min(48, Math.max(10, widest + 4));
    return { header: col.header, type, width };
  });
}

function cellXml(ref: string, value: SheetCell, type: ColumnType, style: number): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}" s="${style}"><v>${value}</v></c>` : '';
  }
  if (type === 'date') {
    const serial = dateSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  if (type === 'time') {
    const serial = timeSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  // An inline string keeps each sheet self-contained — no shared-strings part
  // to keep in step — and the file still opens everywhere.
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet, columns: readonly ResolvedColumn[]): string {
  const lastCol = columnLetter(Math.max(0, columns.length - 1));
  const dimension = `A1:${lastCol}${sheet.rows.length + 1}`;
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');

  const header =
    `<row r="1" spans="1:${columns.length}" ht="24" customHeight="1" s="${HEADER_STYLE}" customFormat="1">` +
    columns.map((c, i) => cellXml(`${columnLetter(i)}1`, c.header, 'text', HEADER_STYLE)).join('') +
    '</row>';

  const body = sheet.rows
    .map((row, r) => {
      const banded = r % 2 === 1;
      const cells = columns.map((c, i) => cellXml(`${columnLetter(i)}${r + 2}`, row[i], c.type, styleFor(c.type, banded))).join('');
      return `<row r="${r + 2}" spans="1:${columns.length}">${cells}</row>`;
    })
    .join('');

  // The order of these elements is fixed by the format: cols, then sheetData,
  // then autoFilter. Out of order, Excel treats the file as damaged.
  return (
    `${DECL}<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${sheet.rightToLeft ? ' rightToLeft="1"' : ''}>` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    (sheet.rows.length > 0 ? `<autoFilter ref="${dimension}"/>` : '') +
    '</worksheet>'
  );
}

/** What a sheet is allowed to be called: 31 characters, and none of `: \ / ? * [ ]`. */
export function sheetName(name: string, taken: ReadonlySet<string>): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Sheet';
  if (!taken.has(cleaned.toLowerCase())) return cleaned;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = cleaned.slice(0, 31 - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

/** The workbook's parts, so a test can read them without unzipping a blob. */
export function xlsxEntries(sheets: readonly Sheet[]): ZipEntry[] {
  if (sheets.length === 0) throw new RangeError('a workbook needs at least one sheet');
  const taken = new Set<string>();
  const named = sheets.map((sheet) => {
    const name = sheetName(sheet.name, taken);
    taken.add(name.toLowerCase());
    return { sheet, name };
  });

  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      text:
        `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        named
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      text: `${DECL}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      text:
        `${DECL}<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20000" windowHeight="12000"/></bookViews>' +
        `<sheets>${named.map(({ name }, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      text:
        `${DECL}<Relationships xmlns="${NS_PKG_REL}">` +
        named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${named.length + 1}" Type="${NS_R}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { name: 'xl/styles.xml', text: stylesXml() },
  ];

  named.forEach(({ sheet }, i) => {
    entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sheet, resolveColumns(sheet)) });
  });
  return entries;
}

export function xlsxBlob(sheets: readonly Sheet[], now: Date = new Date()): Blob {
  return new Blob([zipBlob(xlsxEntries(sheets), now)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Trigger a browser download of the sheets as `<filename>.xlsx`. */
export function downloadXlsx(filename: string, sheets: readonly Sheet[]): void {
  const url = URL.createObjectURL(xlsxBlob(sheets));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

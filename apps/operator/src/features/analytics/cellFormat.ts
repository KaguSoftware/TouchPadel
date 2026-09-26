/**
 * How a value is written into an exported cell, so every export in the
 * workspace reads the same way.
 *
 * The rules, and what each one is fixing:
 *
 *  - **A cell is one line.** A pasted note or a typed reason could carry a
 *    newline; a newline inside a quoted CSV field is legal but every
 *    spreadsheet then draws a row three lines tall, which is most of what
 *    "the cells overflow" was.
 *  - **A cell is short.** Nothing a person reads is longer than `MAX_CELL`
 *    characters; past that the value is cut with an ellipsis. Only free text
 *    and serialised JSON ever reach that length, and a wall of JSON in a
 *    column tells a manager nothing anyway.
 *  - **A moment is two columns, a date and a time**, never an ISO instant.
 *    `2026-09-23` and `14:05` read at a glance, sort correctly as text, and
 *    are parsed as a date and a time by Excel and Sheets;
 *    `2026-09-23T11:05:23.481Z` does none of those things.
 *  - **Latin digits, 24-hour clock, dot decimals**, in both languages — the
 *    file convention csv.ts already states. A localised Arabic date string
 *    would not sort and would not parse.
 *  - **A uuid is not an identifying column.** Ids stay in the file, because
 *    an investigation correlates on them, but they go last and they are
 *    labelled as ids, so the columns a person reads come first.
 */

/** Longest a text cell may be before it is cut. Wide enough for a sentence, narrow enough to read. */
export const MAX_CELL = 160;

/** Whitespace, newlines included, collapsed to single spaces. */
export function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** One line, and no longer than `max`. */
export function cellText(value: string | null | undefined, max = MAX_CELL): string | null {
  if (value === null || value === undefined) return null;
  const text = oneLine(value);
  if (text === '') return null;
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The station's calendar day for an instant: `2026-09-23`. */
export function dayCell(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` : null;
}

/** The station's clock for an instant, 24-hour: `14:05`. */
export function timeCell(iso: string | null | undefined): string | null {
  const d = parse(iso);
  return d ? `${two(d.getHours())}:${two(d.getMinutes())}` : null;
}

/** A moment as the two cells it should be written as. */
export function momentCells(iso: string | null | undefined): [day: string | null, time: string | null] {
  return [dayCell(iso), timeCell(iso)];
}

/** A `YYYY-MM-DD` business day passed straight through; anything else cleaned. */
export function dateOnlyCell(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : (dayCell(value) ?? cellText(value));
}

/**
 * The first block of a uuid — enough to correlate two exports against each
 * other, short enough not to push every readable column off the screen. A
 * non-uuid id (a numeric one, a slug) is left whole.
 */
export function shortId(id: string | null | undefined): string | null {
  if (!id) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : cellText(id, 40);
}

/** Yes / No in the reader's language, for a stored boolean. */
export function boolCell(value: unknown, yes: string, no: string): string | null {
  if (value === true || value === 'true') return yes;
  if (value === false || value === 'false') return no;
  return null;
}

/** A finite number, or nothing — never `0` standing in for "not reported". */
export function numberCell(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `sold_out` → `Sold out`, `price_iqd` → `Price (IQD)`, `wrong_item` → `Wrong item`. */
export function humanizeCode(code: string): string {
  const iqd = /_iqd$/.test(code);
  const base = (iqd ? code.slice(0, -4) : code).replace(/[._-]+/g, ' ').trim();
  const words = base.charAt(0).toUpperCase() + base.slice(1);
  return iqd ? `${words} (IQD)` : words;
}

/**
 * A jsonb leaf as a person reads it. An object or an array is still JSON —
 * there is nothing better to show — but it is one line and it is clipped, so
 * it occupies a cell rather than a paragraph.
 */
export function valueCell(value: unknown, words: { yes: string; no: string }): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? words.yes : words.no;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') {
    if (value === 'true') return words.yes;
    if (value === 'false') return words.no;
    // A stored instant reads as a date and a time, not as an ISO string.
    if (ISO_INSTANT.test(value)) {
      const d = parse(value);
      if (d) return `${dayCell(value)} ${timeCell(value)}`;
    }
    return cellText(value);
  }
  try {
    return cellText(JSON.stringify(value));
  } catch {
    return cellText(String(value));
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** A filename piece with nothing in it a filesystem or a zip entry dislikes. */
export function fileSlug(value: string): string {
  return oneLine(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

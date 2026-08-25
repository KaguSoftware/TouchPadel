/**
 * Ticker phrases are stored as two parallel arrays (`ticker_en`, `ticker_ar`,
 * migration 0029: text_array(12,120)). The editor works on paired rows; these
 * pure helpers convert both ways and validate before a save.
 */

export const TICKER_MAX_ROWS = 12;
export const TICKER_MAX_LEN = 120;

export interface TickerRow {
  en: string;
  ar: string;
}

export type TickerProblem = 'too_many' | 'incomplete' | 'too_long';

/** Zip the stored arrays into rows; a missing side becomes an empty string. */
export function pairTicker(en: readonly string[], ar: readonly string[]): TickerRow[] {
  const n = Math.max(en.length, ar.length);
  const rows: TickerRow[] = [];
  for (let i = 0; i < n; i++) rows.push({ en: en[i] ?? '', ar: ar[i] ?? '' });
  return rows;
}

/** Trim every cell and drop rows that are blank on BOTH sides. */
export function normalizeTicker(rows: readonly TickerRow[]): TickerRow[] {
  return rows
    .map((r) => ({ en: r.en.trim(), ar: r.ar.trim() }))
    .filter((r) => r.en !== '' || r.ar !== '');
}

/** First problem found in normalized rows, or null when they can be saved. */
export function validateTicker(rows: readonly TickerRow[]): TickerProblem | null {
  if (rows.length > TICKER_MAX_ROWS) return 'too_many';
  for (const r of rows) {
    if (r.en === '' || r.ar === '') return 'incomplete';
    if (r.en.length > TICKER_MAX_LEN || r.ar.length > TICKER_MAX_LEN) return 'too_long';
  }
  return null;
}

/** Split rows back into the two stored arrays. */
export function splitTicker(rows: readonly TickerRow[]): { ticker_en: string[]; ticker_ar: string[] } {
  return { ticker_en: rows.map((r) => r.en), ticker_ar: rows.map((r) => r.ar) };
}

export function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

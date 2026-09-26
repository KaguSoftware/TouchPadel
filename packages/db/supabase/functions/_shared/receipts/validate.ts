/**
 * Validates what a model returned for a receipt and turns it into the
 * Reading app.receipt_store_reading takes. Nothing a model says is trusted:
 * money becomes whole non-negative IQD, digits are folded (Arabic-Indic and
 * Persian), dates must be real YYYY-MM-DD, text is trimmed and capped, and a
 * field that does not survive is dropped rather than guessed. Then each line
 * is checked against its own numbers (flags), so the manager's review shows
 * where the reading does not add up. Pure.
 */
import { RECEIPT_MAX_LINES, SLIP_MAX_LINES } from './prompt.ts';
import type { LineFlag, RawReading, Reading, ReadingLine, SlipLine, SlipReading } from './types.ts';

export type ValidateResult = { ok: true; reading: Reading } | { ok: false; reason: string };
export type ValidateSlipResult = { ok: true; reading: SlipReading } | { ok: false; reason: string };

const MAX_IQD = 10_000_000_000; // ten billion dinar: far above any delivery
const MAX_QTY = 1_000_000_000; // numeric(12,3)

const DIGITS: Record<string, string> = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)));
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)));

function foldDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d);
}

/** A number or a numeric string ("25,000", "٢٥٠٠٠", "1.5"); undefined otherwise. */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = foldDigits(v).replace(/[\s,٬]/g, '').replace('٫', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function iqd(v: unknown): number | undefined {
  const n = toNumber(v);
  if (n === undefined || n < 0 || n > MAX_IQD) return undefined;
  return Math.round(n);
}

function qty(v: unknown): number | undefined {
  const n = toNumber(v);
  if (n === undefined || n <= 0 || n >= MAX_QTY) return undefined;
  const r = Math.round(n * 1000) / 1000;
  return r > 0 ? r : undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length === 0 ? undefined : s.slice(0, max);
}

/** YYYY-MM-DD that is a real calendar day between 2000 and 2100. */
export function isoDate(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = foldDigits(v.trim());
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return undefined;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return s;
}

/** A JSON string (with or without a ``` fence) or an already-parsed object. */
function parse(raw: RawReading): unknown {
  if (typeof raw !== 'string') return raw;
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateReading(raw: RawReading): ValidateResult {
  const obj = parse(raw);
  if (!isObject(obj)) return { ok: false, reason: 'not a JSON object' };
  if (!Array.isArray(obj.lines)) return { ok: false, reason: 'lines is not an array' };

  const lines: ReadingLine[] = [];
  for (const el of obj.lines.slice(0, RECEIPT_MAX_LINES)) {
    if (!isObject(el)) continue;
    const t = text(el.text, 200);
    if (!t) continue;
    const line: ReadingLine = { text: t, flags: [] };
    const q = qty(el.qty);
    if (q !== undefined) line.qty = q;
    const u = text(el.unit, 20);
    if (u !== undefined) line.unit = u;
    const up = iqd(el.unit_price_iqd);
    if (up !== undefined) line.unit_price_iqd = up;
    const lt = iqd(el.line_total_iqd);
    if (lt !== undefined) line.line_total_iqd = lt;
    const ex = isoDate(el.expiry_date);
    if (ex !== undefined) line.expiry_date = ex;
    line.flags = lineFlags(line);
    if (el.unclear === true) line.flags.push('UNCLEAR');
    lines.push(line);
  }

  const reading: Reading = { lines };
  const sup = text(obj.supplier_name, 120);
  if (sup !== undefined) reading.supplier_name = sup;
  const date = isoDate(obj.receipt_date);
  if (date !== undefined) reading.receipt_date = date;
  const total = iqd(obj.total_iqd);
  if (total !== undefined) reading.total_iqd = total;

  if (total !== undefined && totalMismatch(lines, total)) {
    for (const l of lines) l.flags.push('TOTAL_MISMATCH');
  }
  return { ok: true, reading };
}

function lineFlags(l: ReadingLine): LineFlag[] {
  const flags: LineFlag[] = [];
  if (l.unit_price_iqd === undefined && l.line_total_iqd === undefined) flags.push('NO_PRICE');
  if (l.qty !== undefined && l.unit_price_iqd !== undefined && l.line_total_iqd !== undefined) {
    // One dinar per unit of slack for rounding on the receipt itself.
    if (Math.abs(l.qty * l.unit_price_iqd - l.line_total_iqd) > Math.max(1, l.qty)) flags.push('ARITHMETIC');
  }
  return flags;
}

/** Only when every line printed a total: they must add up to the receipt's. */
function totalMismatch(lines: ReadingLine[], total: number): boolean {
  if (lines.length === 0 || lines.some((l) => l.line_total_iqd === undefined)) return false;
  const sum = lines.reduce((s, l) => s + (l.line_total_iqd ?? 0), 0);
  return Math.abs(sum - total) > lines.length;
}

// ---------------------------------------------------------------------------
// Order slips
// ---------------------------------------------------------------------------

/** A whole quantity 1..99 ("2", "٢", 2.0); undefined otherwise. */
function slipQty(v: unknown): number | undefined {
  const n = toNumber(v);
  if (n === undefined || !Number.isInteger(n) || n < 1 || n > 99) return undefined;
  return n;
}

/** The table as written, digits folded, letters and words around it dropped ("طاولة ٥" -> "5", "T12" -> "12"). */
export function tableNumber(v: unknown): string | undefined {
  const t = typeof v === 'number' ? String(v) : text(v, 40);
  if (!t) return undefined;
  const m = /\d{1,4}/.exec(foldDigits(t));
  return m ? String(Number(m[0])) : undefined;
}

export function validateSlip(raw: RawReading): ValidateSlipResult {
  const obj = parse(raw);
  if (!isObject(obj)) return { ok: false, reason: 'not a JSON object' };
  if (!Array.isArray(obj.lines)) return { ok: false, reason: 'lines is not an array' };

  const lines: SlipLine[] = [];
  for (const el of obj.lines.slice(0, SLIP_MAX_LINES)) {
    if (!isObject(el)) continue;
    const t = text(el.text, 200);
    if (!t) continue;
    const line: SlipLine = { text: t, flags: [] };
    const q = slipQty(el.qty);
    if (q !== undefined) line.qty = q;
    else line.flags.push('NO_QTY');
    const n = text(el.notes, 200);
    if (n !== undefined) line.notes = n;
    if (el.unclear === true) line.flags.push('UNCLEAR');
    lines.push(line);
  }
  const reading: SlipReading = { lines };
  const table = tableNumber(obj.table_number);
  if (table !== undefined) reading.table_number = table;
  return { ok: true, reading };
}

/**
 * The answer gate (plan §4.5, contracts "gate.ts"): every number in the model's
 * answer must be one it was given this turn, one the owner typed, or a sum,
 * difference or percentage of two given numbers. Anything else is
 * `unverified` — the model gets one retry with the list, and whatever remains
 * is marked in the UI, never silently shown.
 *
 * Generalises `_shared/insightsGate.ts` (which only lets an IQD amount through
 * when it appears verbatim in the payload). Pure: no imports, no Deno. The
 * tokenizer here is also what `clean.ts` uses to compute the allowed set from
 * the laid-out text, so both sides see the same numbers.
 */

export interface GateResult {
  status: 'ok' | 'unverified';
  unverified: { raw: string; value: number }[];
  /** How many number tokens the answer contained (after dates and times were set aside). */
  checked: number;
}

/** Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic (U+06F0–U+06F9) digits → ASCII. */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Bare counts up to this are allowed unverified ("two tools", list ordinals). */
export const SMALL_COUNT_MAX = 12;
/** A percentage must be within this of a ratio × 100 of two given figures (contracts). */
export const PCT_TOLERANCE = 0.1;

/** Currency words the tokenizer strips so `IQD 1,250,000` and `1,250,000 د.ع` read the same. */
const CURRENCY_RE = /\b(?:IQD|USD|iqd|usd)\b|د\.ع\.?|دينار(?:اً|ا|ًا)?\s*(?:عراقي(?:اً|ا)?)?/g;

/** ISO dates, clock times and 4-digit years are never figures the model invented. */
const DATE_RE = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b/g;
const TIME_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

/**
 * A number token: not glued to a letter or `#` (so `r12` and `phone#3` are
 * handles, not figures), optional sign, thousands separators `,` or Arabic
 * `٬`, decimal `.` or Arabic `٫`, optional `%`.
 */
const NUMBER_RE = /(?<![A-Za-z0-9#_.])[-−]?\d[\d,٬]*(?:[.٫]\d+)?%?(?![A-Za-z0-9_])/g;

export interface NumberToken {
  raw: string;
  value: number;
  /** Decimal places shown, for the tolerance. */
  decimals: number;
  percent: boolean;
  /** No separators, no decimals, no percent — a bare integer. */
  bare: boolean;
}

/** Plain-text preparation: markdown table pipes off, digits to ASCII, currency words off. */
export function plainText(text: string): string {
  return latinDigits(text)
    .replace(/\|/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/٪/g, '%')
    .replace(CURRENCY_RE, ' ');
}

/** Every number token in a text, dates / times / years excluded. */
export function tokenizeNumbers(text: string): NumberToken[] {
  const cleaned = plainText(text).replace(DATE_RE, ' ').replace(TIME_RE, ' ').replace(YEAR_RE, ' ');
  const out: NumberToken[] = [];
  for (const m of cleaned.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const percent = raw.endsWith('%');
    const body = raw.replace(/%$/, '').replace(/[,٬]/g, '').replace('٫', '.').replace('−', '-');
    const value = Number(body);
    if (!Number.isFinite(value)) continue;
    const dot = body.indexOf('.');
    const decimals = dot === -1 ? 0 : body.length - dot - 1;
    const bare = !percent && decimals === 0 && !/[,٬]/.test(raw) && !raw.startsWith('-') && !raw.startsWith('−');
    out.push({ raw, value, decimals, percent, bare });
  }
  return out;
}

/** The numeric values in a text — what `clean.ts` records as the allowed set. */
export function numbersIn(text: string): number[] {
  return tokenizeNumbers(text).map((t) => t.value);
}

function toleranceFor(token: NumberToken): number {
  // One unit of the last shown digit: 1 for integers, 0.1 for one decimal, …
  return token.decimals === 0 ? 1 : Math.pow(10, -token.decimals);
}

function nearIn(sorted: readonly number[], value: number, tol: number): boolean {
  // Binary search for the insertion point, then check the neighbours.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  const eps = tol + 1e-9;
  for (const i of [lo - 1, lo]) {
    const v = sorted[i];
    if (v !== undefined && Math.abs(v - value) <= eps) return true;
  }
  return false;
}

/**
 * Gate an answer. `allowed` is every number from this turn's cleaned tool
 * results; `userNumbers` every number the owner typed this turn.
 */
export function gateAnswer(text: string, allowed: readonly number[], userNumbers: readonly number[]): GateResult {
  const given = [...new Set([...allowed, ...userNumbers])].sort((a, b) => a - b);
  const tokens = tokenizeNumbers(text);
  const unverified: { raw: string; value: number }[] = [];
  const seen = new Set<string>();

  for (const tok of tokens) {
    if (passes(tok, given)) continue;
    const key = `${tok.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unverified.push({ raw: tok.raw, value: tok.value });
  }
  return { status: unverified.length ? 'unverified' : 'ok', unverified, checked: tokens.length };
}

function passes(tok: NumberToken, given: readonly number[]): boolean {
  const tol = toleranceFor(tok);
  const v = Math.abs(tok.value);
  // 1. given verbatim (within one unit of the last shown digit)
  if (nearIn(given, v, tol) || nearIn(given, tok.value, tol)) return true;
  // 2. a bare small count
  if (tok.bare && v <= SMALL_COUNT_MAX) return true;
  // 3. a percentage: ratio × 100 of two given numbers within 0.1
  if (tok.percent) {
    for (const a of given) {
      if (a === 0) continue;
      for (const b of given) {
        if (b === 0) continue;
        const pct = (a / b) * 100;
        if (Math.abs(pct - v) <= PCT_TOLERANCE + 1e-9) return true;
        // a change: (a - b) / b × 100
        const change = ((a - b) / b) * 100;
        if (Math.abs(Math.abs(change) - v) <= PCT_TOLERANCE + 1e-9) return true;
      }
    }
  }
  // 4. a sum or difference of two given numbers
  for (const a of given) {
    if (nearIn(given, v - a, tol) || nearIn(given, a - v, tol) || nearIn(given, a + v, tol)) return true;
  }
  return false;
}

/** The operator instruction appended when the first answer failed (contracts, chat flow). */
export function retryMessage(unverified: readonly { raw: string }[]): string {
  const list = unverified.map((u) => u.raw).join(', ');
  return `These figures are not in this turn's tool results: ${list}. Restate the answer using only figures you were given, or say you do not have them.`;
}

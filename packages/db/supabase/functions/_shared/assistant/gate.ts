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
 *
 * Scale: the sum / difference / percentage rules (3 and 4) build on the given
 * figures the answer itself quotes (its operands: "up 550,000 (15.1%) on last week
 * (3,650,000)" quotes both periods), not on the whole payload, so a tool result of
 * hundreds of figures does not make every invented number a pair sum or ratio. A
 * derived figure whose operands the answer does not quote falls back to the whole
 * given set, but only while that set is small (`PAIR_RULE_MAX_GIVEN`,
 * `PCT_RULE_MAX_GIVEN`). The pair values are built once per answer, never per token.
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
/**
 * Rule 4 (sum or difference of two given figures) runs on a pool of at most this
 * many distinct figures: the figures the answer quotes (the nearest ones past the
 * cap), or, when it quotes no operand, the whole given set while it is this small.
 * Measured (seeded, tests/assistant-gate.test.ts "pair-rule false accepts"; invented
 * round 250-IQD figures, the worst case): the share that happens to be a pair sum or
 * difference is about 0.3 % at 10 figures, 4 % at 50, 13 % at 100, 29 % at 200 and
 * 57 % at 500 (±1 or exact alike).
 */
export const PAIR_RULE_MAX_GIVEN = 50;
/**
 * Rule 3 (percentage = ratio × 100 of two given figures, within 0.1) runs on a pool
 * of at most this many distinct figures (quoted operands, nearest past the cap, else
 * the whole given set while it is this small). The n² ratios and changes cover the
 * 0–200 % line so densely that a random percent is some ratio; measured: 4 % of
 * invented percents pass at 5 given figures, 12 % at 8, 42 % at 20, 92 % at 50.
 */
export const PCT_RULE_MAX_GIVEN = 8;
/** `shouldRetry` regenerates the answer only for a percent or a figure at least this large. */
export const RETRY_MIN_ABS = 1000;

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
// `\d{1,3}(?:[ \u00a0\u202f]\d{3})+` lets "29 000" / "١٢ ٣٤٥" (a space as the thousands
// separator, common in Arabic and French formatting) read as one figure; the
// group must be exactly three digits so "2 3" stays two numbers.
const NUMBER_RE = /(?<![A-Za-z0-9#_.])[-−]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d[\d,٬]*)(?:[.٫]\d+)?%?(?![A-Za-z0-9_])/g;

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
    const body = raw.replace(/%$/, '').replace(/[,٬ \u00a0\u202f]/g, '').replace('٫', '.').replace('−', '-');
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

/** The member of `sorted` within `tol` of `value` (the nearest), or undefined. */
function nearestIn(sorted: ArrayLike<number>, value: number, tol: number): number | undefined {
  // Binary search for the insertion point, then check the neighbours.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  const eps = tol + 1e-9;
  let best: number | undefined;
  for (const i of [lo - 1, lo]) {
    const v = sorted[i];
    if (v !== undefined && Math.abs(v - value) <= eps && (best === undefined || Math.abs(v - value) < Math.abs(best - value))) best = v;
  }
  return best;
}

function nearIn(sorted: ArrayLike<number>, value: number, tol: number): boolean {
  return nearestIn(sorted, value, tol) !== undefined;
}

/** A figure the answer quotes that was given verbatim: the operand pool of rules 3 and 4. */
interface Operand {
  value: number;
  /** Index of the token in the answer, for the nearest-operands window. */
  pos: number;
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

  // Pass 1 (rules 1 and 2): what is given verbatim or a small count. The given figures
  // the answer itself quotes become the operands of rules 3 and 4, so a payload of
  // hundreds of figures (packs, 500-row tool results) does not widen what a derived
  // figure may be built from.
  const settled: boolean[] = [];
  const operands: Operand[] = [];
  tokens.forEach((tok, pos) => {
    const hit = verbatim(tok, given);
    settled[pos] = hit !== undefined || (tok.bare && Math.abs(tok.value) <= SMALL_COUNT_MAX);
    if (hit !== undefined && !(tok.bare && Math.abs(tok.value) <= SMALL_COUNT_MAX)) operands.push({ value: hit, pos });
  });

  // Pass 2 (rules 3 and 4): the rest.
  const derived = new DerivedFigures(given, operands);
  tokens.forEach((tok, pos) => {
    if (settled[pos] || derivedPasses(tok, pos, derived)) return;
    const key = `${tok.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    unverified.push({ raw: tok.raw, value: tok.value });
  });
  return { status: unverified.length ? 'unverified' : 'ok', unverified, checked: tokens.length };
}

/** |a + b| and |a - b| over every pair of `vals` (a may equal b), sorted. */
function pairValuesOf(vals: readonly number[]): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    for (let j = i; j < vals.length; j++) {
      const a = vals[i] as number;
      const b = vals[j] as number;
      out.push(Math.abs(a + b), Math.abs(a - b));
    }
  }
  return Float64Array.from(out).sort();
}

/** a/b x 100 and |a/b x 100 - 100| (the change) over every ordered pair of `vals`, sorted. */
function pctValuesOf(vals: readonly number[]): Float64Array {
  const out: number[] = [];
  for (const a of vals) {
    if (a === 0) continue;
    for (const b of vals) {
      if (b === 0) continue;
      const pct = (a / b) * 100;
      out.push(pct, Math.abs(pct - 100));
    }
  }
  return Float64Array.from(out).sort();
}

/**
 * The sums / differences and the percentages that rules 3 and 4 check against, from
 * two pools, each built on first use (most answers never reach them) and never per
 * token:
 *  - the figures the answer quotes that were given verbatim (the operands). Within
 *    the caps all of them; past a cap the nearest ones to the token being checked
 *    (the figures a derived number sits beside), so a long table answer still
 *    verifies its own "up 550,000 (15.1%)";
 *  - the whole given set, only while it is small (the older behaviour, for a
 *    derived figure whose operands the answer does not quote).
 */
class DerivedFigures {
  private givenPairs: Float64Array | null | undefined;
  private givenPcts: Float64Array | null | undefined;
  private quotedPairs: Float64Array | undefined;
  private quotedPcts: Float64Array | undefined;
  private readonly quoted: number[];
  constructor(
    private readonly given: readonly number[],
    private readonly operands: readonly Operand[],
  ) {
    this.quoted = [...new Set(operands.map((o) => o.value))];
  }

  /** Whether `v` is a sum or difference (tolerance `tol`) of two figures from either pool. */
  pairHit(v: number, tol: number, pos: number): boolean {
    if (this.quoted.length > 0) {
      let arr: Float64Array;
      if (this.quoted.length <= PAIR_RULE_MAX_GIVEN) arr = this.quotedPairs ??= pairValuesOf(this.quoted);
      else arr = pairValuesOf(this.nearest(pos, PAIR_RULE_MAX_GIVEN));
      if (nearIn(arr, v, tol)) return true;
    }
    if (this.givenPairs === undefined) this.givenPairs = this.given.length > PAIR_RULE_MAX_GIVEN ? null : pairValuesOf(this.given);
    return this.givenPairs !== null && nearIn(this.givenPairs, v, tol);
  }

  /** Whether the percent `v` is a ratio x 100 (or a change) of two figures from either pool. */
  pctHit(v: number, pos: number): boolean {
    if (this.quoted.length > 0) {
      let arr: Float64Array;
      if (this.quoted.length <= PCT_RULE_MAX_GIVEN) arr = this.quotedPcts ??= pctValuesOf(this.quoted);
      else arr = pctValuesOf(this.nearest(pos, PCT_RULE_MAX_GIVEN));
      if (nearIn(arr, v, PCT_TOLERANCE)) return true;
    }
    if (this.givenPcts === undefined) this.givenPcts = this.given.length > PCT_RULE_MAX_GIVEN ? null : pctValuesOf(this.given);
    return this.givenPcts !== null && nearIn(this.givenPcts, v, PCT_TOLERANCE);
  }

  /** The `cap` distinct quoted figures nearest (by position in the answer) to `pos`. */
  private nearest(pos: number, cap: number): number[] {
    const byDistance = [...this.operands].sort((a, b) => Math.abs(a.pos - pos) - Math.abs(b.pos - pos));
    const out = new Set<number>();
    for (const o of byDistance) {
      out.add(o.value);
      if (out.size >= cap) break;
    }
    return [...out];
  }
}

/** Rule 1: given verbatim (within one unit of the last shown digit). Returns the given figure. */
function verbatim(tok: NumberToken, given: readonly number[]): number | undefined {
  const tol = toleranceFor(tok);
  return nearestIn(given, Math.abs(tok.value), tol) ?? nearestIn(given, tok.value, tol);
}

/** Rules 3 and 4: a percentage or a sum / difference of two given figures. */
function derivedPasses(tok: NumberToken, pos: number, derived: DerivedFigures): boolean {
  const v = Math.abs(tok.value);
  // 3. a percentage: ratio x 100 of two given numbers within 0.1
  if (tok.percent && derived.pctHit(v, pos)) return true;
  // 4. a sum or difference of two given numbers. A figure shown without decimals must
  //    match exactly; +-1 on every pair swallowed invented integers.
  return derived.pairHit(v, tok.decimals === 0 ? 0 : toleranceFor(tok), pos);
}

/**
 * Whether an unverified answer is worth a full regenerated answer: only when a
 * flagged figure is a percentage or money-sized (|value| >= RETRY_MIN_ABS). The
 * rest (a stray 40 or 17.5) is only marked in the UI.
 */
export function shouldRetry(gate: GateResult): boolean {
  if (gate.status !== 'unverified') return false;
  return gate.unverified.some((u) => /[%٪]/.test(u.raw) || Math.abs(u.value) >= RETRY_MIN_ABS);
}

/** The operator instruction appended when the first answer failed (contracts, chat flow). */
export function retryMessage(unverified: readonly { raw: string }[]): string {
  const list = unverified.map((u) => u.raw).join(', ');
  return `These figures are not in this turn's tool results or in a web passage you cited: ${list}. Restate the answer using only figures you were given, or say you do not have them.`;
}

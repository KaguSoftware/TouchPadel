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
 *
 * Scaled figures: a number followed by a scale is ONE figure with the scaled value:
 * k / K (thousand), M / mn (million), bn (billion) glued to the number (only when the
 * letters end the word, so "12 months", "5 km", "10 managers" stay bare numbers; a lone
 * "m" or "B" counts only after a decimal, "12.9m", "1.2B", because "20m" is metres or
 * minutes and "4B" a court), the words thousand / million / billion after at most one
 * space, and Arabic الف / ألف / آلاف, مليون / ملايين, مليار ("12.9M", "12.9 million",
 * "١٢٫٩ مليون"). Its tolerance is one unit of the
 * last digit shown, scaled ("12.9M" matches a given figure within 100,000, "13k" within
 * 1,000). A figure recognised through its scale is marked `scaled` (token and `unverified`
 * entry, additive) and `shouldRetry` ignores it, so the stricter reading never buys a paid
 * regeneration; the one exception keeps today's behaviour: a spaced or Arabic-scaled base
 * of 1000 or more that was already a flagged figure before scales were read stays one.
 *
 * Small counts beside a discipline word: a bare integer 1..SMALL_COUNT_MAX stays exempt
 * unless it directly quantifies (next three words, cut at punctuation, a digit or a
 * connector) discount, void, refund, no-show, cancellation, break, absence, late arrival,
 * missed shift, write-off, comp (and the Arabic خصم, الغاء, استرجاع / مرتجع, غياب, استراحة,
 * تأخير, شطب): then it must be given verbatim (tolerance 0, no sum or ratio) or typed by
 * the owner. Under 1000, it never triggers a retry. "top 5 refunds" (a ranking word
 * before the number) stays exempt.
 */

export interface GateResult {
  status: 'ok' | 'unverified';
  /** `scaled` (additive, only ever `true`) marks a figure recognised through a scale ("12.9M"): never a retry trigger. */
  unverified: { raw: string; value: number; scaled?: boolean }[];
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
const PLAIN_NUMBER =
  String.raw`(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d[\d,٬]*)(?:[.٫]\d+)?%?(?![A-Za-z0-9_])`;
// A scale after a number. A letter scale is glued to the number and ends the word
// ("12 months", "5 km", "10 managers", "2 mins", "4 kids" are not scales; nor is "5 m", a
// width). A scale word may follow one space. A lone lowercase "m" or capital "B" counts
// only after a decimal ("12.9m", "1.2B"): "20m" is metres or minutes and "4B" a court,
// and neither is a figure, as before scales were read (tokenizeNumbers skips them).
const SCALE_LATIN = String.raw`(?:bn|mn|[kKmMB])(?![A-Za-z0-9_\u0600-\u06ff])`;
const SCALE_WORD_EN = String.raw`(?:[Tt]housand|[Mm]illion|[Bb]illion)(?![A-Za-z0-9_])`;
const SCALE_WORD_AR = String.raw`(?:آلاف|ألف|الف|الاف|ملايين|مليون|مليار(?:ات)?)(?![\u0600-\u06ff])`;
const SCALE_RE_SRC = String.raw`(?:${SCALE_LATIN}|[ \u00a0]?(?:${SCALE_WORD_EN}|${SCALE_WORD_AR}))`;
// Group 1 = the scaled figure's number, group 2 = its scale; the plain figure otherwise.
const NUMBER_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9#_.])[-−]?(?:(\d[\d,٬]*(?:[.٫]\d+)?)(${SCALE_RE_SRC})|${PLAIN_NUMBER})`,
  'g',
);

export interface NumberToken {
  raw: string;
  value: number;
  /** Decimal places shown, for the tolerance. */
  decimals: number;
  percent: boolean;
  /** No separators, no decimals, no percent — a bare integer. */
  bare: boolean;
  /** Scaled figure only: the multiplier of its scale (1000, 1e6, 1e9); `value` is already scaled. */
  scale?: number;
  /** Scaled figure only: the number as written, before the scale. */
  base?: number;
  /** Scaled figure only: the base alone was a figure of its own before scales were read (spaced or Arabic scale). */
  plainBefore?: boolean;
  /** A bare count 1..SMALL_COUNT_MAX that directly quantifies a discipline noun: must be given verbatim. */
  discipline?: boolean;
}

const WORD = String.raw`[^\s.,;:!?()،؛\d%]+`;
const AFTER_RE = new RegExp(String.raw`^[ \u00a0]+(${WORD}(?:[ \u00a0]+${WORD}){0,2})`);
const BEFORE_RE = /([^\s]+)[ \u00a0]*$/;
const CONNECTORS = new Set([
  'and', 'or', 'but', 'with', 'had', 'have', 'has', 'were', 'was', 'who', 'that', 'which', 'is', 'are', 'in', 'on', 'at', 'for', 'from', 'by', 'to',
  'و', 'مع', 'في', 'من', 'على', 'عن', 'الى', 'إلى', 'ان', 'أن', 'كان', 'كانت', 'لدى', 'قد', 'التي', 'الذي',
]);
const RANKING = new Set(['top', 'first', 'last', 'next', 'latest', 'recent', 'biggest', 'largest', 'worst', 'best', 'اعلى', 'أعلى', 'اخر', 'آخر', 'اول', 'أول', 'اكبر', 'أكبر']);
const DISCIPLINE_EN =
  /(?<![A-Za-z])(?:discounts?|voids?|refunds?|no[- ]shows?|cancell?ations?|breaks?|absences?|late arrivals?|missed shifts?|write[- ]?offs?|comps?)(?![A-Za-z])/i;
const DISCIPLINE_AR =
  /(?<![\u0600-\u06ff])[وبلفك]?(?:ال)?(?:خصومات|خصم|الغاءات|الغاء|إلغاءات|إلغاء|لغاء|استرجاع|مرتجعات|مرتجع|غيابات|غياب|استراحات|استراحه|استراحة|تأخير|تاخير|شطب)(?![\u0600-\u06ff])/;

/** Whether the bare count ending at `end` (starting at `start`) directly quantifies a discipline noun. */
function quantifiesDiscipline(cleaned: string, start: number, end: number): boolean {
  const before = BEFORE_RE.exec(cleaned.slice(Math.max(0, start - 24), start));
  if (before && RANKING.has((before[1] as string).toLowerCase())) return false;
  const after = AFTER_RE.exec(cleaned.slice(end, end + 120));
  if (!after) return false;
  const words: string[] = [];
  for (const w of (after[1] as string).split(/[ \u00a0]+/)) {
    if (CONNECTORS.has(w.toLowerCase())) break;
    words.push(w);
  }
  const phrase = words.join(' ');
  return DISCIPLINE_EN.test(phrase) || DISCIPLINE_AR.test(phrase);
}

function scaleMultiplier(text: string): number {
  const t = text.trim();
  if (/^(?:bn|B|[Bb]illion|مليار)/.test(t)) return 1e9;
  if (/^(?:mn|[mM]|[Mm]illion|مليون|ملايين)/.test(t)) return 1e6;
  return 1e3;
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
    const neg = raw.startsWith('-') || raw.startsWith('−');
    if (m[1] !== undefined) {
      const body = m[1].replace(/[,٬]/g, '').replace('٫', '.');
      const base = Number(body);
      if (!Number.isFinite(base)) continue;
      const dot = body.indexOf('.');
      const decimals = dot === -1 ? 0 : body.length - dot - 1;
      // "20m", "4B": a unit or a name glued to a whole number, never a figure.
      if ((m[2] === 'm' || m[2] === 'B') && decimals === 0) continue;
      const scale = scaleMultiplier(m[2] as string);
      const value = Number(((neg ? -base : base) * scale).toPrecision(15));
      const plainBefore = /^[ \u00a0]/.test(m[2] as string) || /[\u0600-\u06ff]/.test(m[2] as string);
      out.push({ raw, value, decimals, percent: false, bare: false, scale, base: neg ? -base : base, plainBefore });
      continue;
    }
    const percent = raw.endsWith('%');
    const body = raw.replace(/%$/, '').replace(/[,٬ \u00a0\u202f]/g, '').replace('٫', '.').replace('−', '-');
    const value = Number(body);
    if (!Number.isFinite(value)) continue;
    const dot = body.indexOf('.');
    const decimals = dot === -1 ? 0 : body.length - dot - 1;
    const bare = !percent && decimals === 0 && !/[,٬]/.test(raw) && !raw.startsWith('-') && !raw.startsWith('−');
    const tok: NumberToken = { raw, value, decimals, percent, bare };
    if (bare && value >= 1 && value <= SMALL_COUNT_MAX && quantifiesDiscipline(cleaned, m.index as number, (m.index as number) + raw.length)) tok.discipline = true;
    out.push(tok);
  }
  return out;
}

/** The numeric values in a text — what `clean.ts` records as the allowed set. */
export function numbersIn(text: string): number[] {
  // A scaled figure also records its base as written, so a tool line such as "5 m" keeps allowing 5.
  return tokenizeNumbers(text).flatMap((t) => (t.base !== undefined ? [t.value, t.base] : [t.value]));
}

function toleranceFor(token: NumberToken): number {
  // One unit of the last shown digit: 1 for integers, 0.1 for one decimal, …; a scaled
  // figure's unit is scaled too ("13k" 1,000, "12.9M" 100,000).
  const unit = token.decimals === 0 ? 1 : Math.pow(10, -token.decimals);
  return token.scale === undefined ? unit : unit * token.scale;
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
  const unverified: { raw: string; value: number; scaled?: boolean }[] = [];
  const seen = new Set<string>();

  // Pass 1 (rules 1 and 2): what is given verbatim or a small count. The given figures
  // the answer itself quotes become the operands of rules 3 and 4, so a payload of
  // hundreds of figures (packs, 500-row tool results) does not widen what a derived
  // figure may be built from.
  const settled: boolean[] = [];
  const operands: Operand[] = [];
  tokens.forEach((tok, pos) => {
    const hit = verbatim(tok, given);
    const small = tok.bare && Math.abs(tok.value) <= SMALL_COUNT_MAX;
    settled[pos] = hit !== undefined || (small && !tok.discipline);
    if (hit !== undefined && !small) operands.push({ value: hit, pos });
  });

  // Pass 2 (rules 3 and 4): the rest.
  const derived = new DerivedFigures(given, operands);
  tokens.forEach((tok, pos) => {
    // A count beside a discipline word is verbatim-or-flagged: no sum or ratio vouches for it.
    if (settled[pos] || (!tok.discipline && derivedPasses(tok, pos, derived))) return;
    const key = `${tok.raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    // `scaled` never buys a retry, except a base that was already a flagged money-sized figure.
    let scaled = tok.scale !== undefined;
    if (scaled && tok.plainBefore && Math.abs(tok.base as number) >= RETRY_MIN_ABS) {
      const baseTok: NumberToken = { raw: tok.raw, value: tok.base as number, decimals: tok.decimals, percent: false, bare: false };
      if (verbatim(baseTok, given) === undefined && !derivedPasses(baseTok, pos, derived)) scaled = false;
    }
    unverified.push(scaled ? { raw: tok.raw, value: tok.value, scaled: true } : { raw: tok.raw, value: tok.value });
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
  private readonly given: readonly number[];
  private readonly operands: readonly Operand[];
  constructor(given: readonly number[], operands: readonly Operand[]) {
    this.given = given;
    this.operands = operands;
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
  const tol = tok.discipline ? 0 : toleranceFor(tok);
  return nearestIn(given, Math.abs(tok.value), tol) ?? nearestIn(given, tok.value, tol);
}

/** Rules 3 and 4: a percentage or a sum / difference of two given figures. */
function derivedPasses(tok: NumberToken, pos: number, derived: DerivedFigures): boolean {
  const v = Math.abs(tok.value);
  // 3. a percentage: ratio x 100 of two given numbers within 0.1
  if (tok.percent && derived.pctHit(v, pos)) return true;
  // 4. a sum or difference of two given numbers. A figure shown without decimals must
  //    match exactly; +-1 on every pair swallowed invented integers.
  return derived.pairHit(v, tok.decimals === 0 && tok.scale === undefined ? 0 : toleranceFor(tok), pos);
}

/**
 * Whether an unverified answer is worth a full regenerated answer: only when a
 * flagged figure is a percentage or money-sized (|value| >= RETRY_MIN_ABS). The
 * rest (a stray 40 or 17.5) is only marked in the UI, and so is a `scaled` figure.
 */
export function shouldRetry(gate: GateResult): boolean {
  if (gate.status !== 'unverified') return false;
  return gate.unverified.some((u) => !u.scaled && (/[%٪]/.test(u.raw) || Math.abs(u.value) >= RETRY_MIN_ABS));
}

/** The operator instruction appended when the first answer failed (contracts, chat flow). */
export function retryMessage(unverified: readonly { raw: string }[]): string {
  const list = unverified.map((u) => u.raw).join(', ');
  return `These figures are not in this turn's tool results or in a web passage you cited: ${list}. Restate the answer using only figures you were given, or say you do not have them.`;
}

// COPY — keep in sync with packages/core/src/analytics/insightsText.ts
// (parity test: packages/db/tests/insights-text-parity.test.ts)
// Do not edit here; edit the core file and re-copy.
/**
 * Post-processing for free-text AI findings — the gates that run AFTER a model answers.
 *
 * ZERO IMPORTS ON PURPOSE. This file is shared by relative path with the Deno edge function
 * (`analytics-insights`) as well as the operator UI, so it must not reach into the rest of
 * `@touch/core`, Node builtins, or any package. Everything it needs is defined here; other
 * core modules (`confidence.ts`) import their shared constants FROM this file.
 *
 * Three concerns live here, all pure:
 *  - `normalizeFinding` — the dedupe / rejection key. Has a SQL twin (`app.normalize_finding`)
 *    that must produce the same bytes; the algorithm is spelled out step by step below.
 *  - `findingImpact` / `rankFindings` — order findings by the money they cite.
 *  - the drop gates — owner rejections, thin-sample claims, excluded item mentions.
 */

/** A weekday claim needs this many occurrences of that weekday among days WITH sales data. */
export const MIN_WEEKDAY_DAYS = 4;

/** Under this many recorded sales days there is no trend to describe. */
export const MIN_TREND_DAYS = 7;

/** Below this the whole period is too thin to lead with confident findings. */
export const THIN_PERIOD_DAYS = 10;

/** Hard cap on findings shown per set; ranking (not this number) decides which survive. */
export const MAX_FINDINGS = 8;

/**
 * The slice of a `DataBasis` (see ./confidence.ts) the confidence gate reads. Declared
 * structurally so this file stays import-free; `DataBasis` satisfies it.
 */
export type FindingBasis = {
  /** Days that actually have sales data. */
  salesDays: number;
  /** Occurrences of each weekday (JS index, 0 = Sunday) among the days with sales data. */
  weekdayCounts: readonly { day: number; days: number }[];
};

/**
 * Map Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic (U+06F0–U+06F9) digits to
 * ASCII 0–9. Every other character is left untouched.
 */
export function latinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Canonical form of a finding for equality checks — the dedupe key persisted as
 * `analytics_insight_rejections.text_key`.
 *
 * ALGORITHM (the SQL function `app.normalize_finding(text)` must match this byte-for-byte;
 * the steps are ordered and none may be skipped or reordered):
 *
 *   1. Lowercase. Plain `String.prototype.toLowerCase()` — no locale rules
 *      (Postgres: `lower(s)`).
 *   2. Map Arabic-Indic digits U+0660–U+0669 and Extended Arabic-Indic U+06F0–U+06F9 to
 *      ASCII '0'–'9' (Postgres: `translate(s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')`).
 *   3. Delete (not replace) Arabic tatweel U+0640, the harakat U+064B–U+0652, and the
 *      superscript alef U+0670 (Postgres: `regexp_replace(s, '[ـً-ْٰ]', '', 'g')`).
 *   4. Replace every character that is not a Unicode letter, a Unicode decimal digit, or
 *      whitespace with a single SPACE — so "12,500" becomes "12 500" and "a-b" becomes "a b"
 *      (Postgres: `regexp_replace(s, '[^[:alnum:][:space:]]', ' ', 'g')` under a UTF-8 ctype,
 *      where `[:alnum:]` covers Unicode letters/digits). JS uses `[^\p{L}\p{N}\s]`.
 *   5. Collapse every run of whitespace to one SPACE and trim
 *      (Postgres: `btrim(regexp_replace(s, '\s+', ' ', 'g'))`).
 *
 * No Unicode normalisation (NFC/NFD) and no hamza/alef folding is applied on either side:
 * two spellings that differ in a hamza are two different keys, deliberately. Combining marks
 * outside the Arabic set in step 3 count as punctuation in step 4.
 */
export const normalizeFinding = (s: string): string =>
  latinDigits(s.toLowerCase())
    .replace(/[ـً-ْٰ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Currency markers a finding may attach to an amount: "IQD", "dinar(s)", "د.ع", "دينار"
 * (with common suffixes / "عراقي"). Matched case-insensitively on the lowercased text.
 */
const MONEY_MARKER =
  '(?:iqd|dinars?|د\\.?\\s?ع\\.?|دينار(?:ا|اً|ًا)?(?:\\s*عراقي(?:ا|اً|ًا)?)?)';
/** "12,500" / "12٬500" / "12.500" / "12500" — IQD has no decimals, so every separator groups. */
const AMOUNT = '(\\d{1,3}(?:[,٬.]\\d{3})+|\\d+)';
const NOT_ALNUM_BEFORE = '(?<![\\p{L}\\p{N}])';
const NOT_ALNUM_AFTER = '(?![\\p{L}\\p{N}])';
const AMOUNT_RE = new RegExp(
  `${NOT_ALNUM_BEFORE}${MONEY_MARKER}\\s*${AMOUNT}${NOT_ALNUM_AFTER}` +
    `|${NOT_ALNUM_BEFORE}${AMOUNT}\\s*${MONEY_MARKER}${NOT_ALNUM_AFTER}`,
  'giu',
);

/**
 * Largest IQD amount a finding cites, in dinars; 0 when it names no amount (which sorts it
 * below every finding that does). Only numbers next to a currency marker count — a bare
 * "12" in "12 units" is a quantity, not money. Arabic-Indic digits and the Arabic thousands
 * separator (U+066C) are accepted.
 */
export function findingImpact(text: string): number {
  const t = latinDigits(text).toLowerCase();
  let max = 0;
  for (const m of t.matchAll(AMOUNT_RE)) {
    const raw = (m[1] ?? m[2] ?? '').replace(/[,٬.]/g, '');
    const n = Number(raw);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max;
}

/** Rank by money at stake (stable for ties) and cut to `limit`. */
export function rankFindings(findings: readonly string[], limit = MAX_FINDINGS): string[] {
  return findings
    .map((text, i) => ({ text, impact: findingImpact(text), i }))
    .sort((a, b) => b.impact - a.impact || a.i - b.i)
    .slice(0, limit)
    .map((f) => f.text);
}

/**
 * A finding must cite a number and not be trivially short — the prompt's strength bar,
 * enforced. Arabic-Indic digits count as digits.
 */
export function isStrongFinding(text: string): boolean {
  return /\d/.test(latinDigits(text)) && text.trim().length >= 15;
}

/**
 * Drop findings the owner has already rejected. `rejectedKeys` holds ALREADY-NORMALISED keys
 * (`analytics_insight_rejections.text_key`); each finding is normalised the same way and
 * matched exactly — never fuzzily, so a genuinely new claim about the same item survives.
 */
export function dropRejectedFindings(
  findings: readonly string[],
  rejectedKeys: ReadonlySet<string>,
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const text of findings) {
    if (rejectedKeys.size > 0 && rejectedKeys.has(normalizeFinding(text))) dropped.push(text);
    else kept.push(text);
  }
  return { kept, dropped };
}

/** Build the rejection key set from raw rejected sentences (blank keys are ignored). */
export function rejectionKeys(rejectedTexts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of rejectedTexts) {
    const k = normalizeFinding(t);
    if (k) out.add(k);
  }
  return out;
}

/**
 * Words that assert a movement over time — the claims `MIN_TREND_DAYS` guards. English and
 * Arabic stems; callers may pass their own regex to `dropLowConfidenceClaims`.
 */
export const TREND_WORDS =
  /(increas|decreas|\brose\b|\brise|\brising|\bfell\b|\bfall|\bdrop|declin|\bgrew\b|growth|trend|momentum|accelerat|slow(ed|ing|down)|improv|worsen|\bup \d|\bdown \d|ارتفع|ارتفاع|انخفض|انخفاض|تراجع|زاد|زياد|نمو|اتجاه|تباط|تسارع|تحسن|تدهور|هبوط|صعود)/i;

/**
 * Drop findings whose sample the data cannot support — the last line of the confidence gate.
 *
 *  - a sentence naming a weekday is dropped unless that weekday occurs at least
 *    `MIN_WEEKDAY_DAYS` times among the days with sales data;
 *  - a sentence asserting a rise or fall is dropped when fewer than `MIN_TREND_DAYS` sales
 *    days exist to draw a line through.
 *
 * `weekdayNames.en` / `.ar` are indexed 0 = Sunday … 6 = Saturday, exactly as the finding
 * would spell them. Matching is on the normalised text, longest name first, so "Saturday"
 * never credits "Sunday" and Arabic spelling variants can be supplied as extra entries via
 * `extraWeekdayNames` (e.g. both "الاثنين" and "الإثنين" for Monday).
 */
export function dropLowConfidenceClaims(
  findings: readonly string[],
  basis: FindingBasis,
  weekdayNames: { en: readonly string[]; ar: readonly string[] },
  opts: { trendWords?: RegExp; extraWeekdayNames?: readonly { day: number; name: string }[] } = {},
): { kept: string[]; dropped: string[] } {
  const patterns: { day: number; key: string }[] = [];
  const push = (day: number, name: string) => {
    const key = normalizeFinding(name);
    if (key) patterns.push({ day, key });
  };
  weekdayNames.en.forEach((n, i) => push(i, n));
  weekdayNames.ar.forEach((n, i) => push(i, n));
  for (const e of opts.extraWeekdayNames ?? []) push(e.day, e.name);
  patterns.sort((a, b) => b.key.length - a.key.length);

  const counts = new Map<number, number>();
  for (const w of basis.weekdayCounts) counts.set(w.day, w.days);
  const trend = opts.trendWords ?? TREND_WORDS;

  const kept: string[] = [];
  const dropped: string[] = [];
  for (const text of findings) {
    const norm = normalizeFinding(text);
    const named = patterns.find((p) => norm.includes(p.key));
    if (named && (counts.get(named.day) ?? 0) < MIN_WEEKDAY_DAYS) {
      dropped.push(text);
      continue;
    }
    if (basis.salesDays < MIN_TREND_DAYS && trend.test(text)) {
      dropped.push(text);
      continue;
    }
    kept.push(text);
  }
  return { kept, dropped };
}

/**
 * Drop free-text lines that NAME an excluded item — a safety net for stored sets generated
 * before the owner excluded it. Substring match on the normalised text; needles shorter than
 * two characters are ignored so a stray letter can't blank the card.
 */
export function dropExcludedMentions(
  findings: readonly string[],
  excludedNames: readonly string[],
): string[] {
  const needles = excludedNames.map(normalizeFinding).filter((n) => n.length >= 2);
  if (!needles.length) return [...findings];
  return findings.filter((t) => {
    const norm = normalizeFinding(t);
    return !needles.some((n) => norm.includes(n));
  });
}

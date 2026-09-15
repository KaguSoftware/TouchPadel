/**
 * analytics-insights — owner-only, STATELESS LLM layer over the analytics data
 * (db-slice.md Wave 4; contract in _shared/insightsContract.ts, shared byte-for-
 * byte with @touch/core). The operator gathers SQL (app.analytics_*) + PostHog
 * data first and POSTs it here; the function never reads or writes the database
 * — persistence is the operator's job through the owner's save_analytics_* /
 * reject_insight RPCs.
 *
 * Request  POST {mode:'insights'|'patterns'|'revalidate'|'replace_rejected',
 *                lang:'ar'|'en', range_from, range_to, compare_basis:'prev'|'4w'|'52w',
 *                scope?:'cafe'|'courts' (missing = 'cafe'; old clients keep working),
 *                data: CafeInsightsPayload | CourtsInsightsPayload}
 *                (aggregates and display names only; no identifiers of any kind)
 * Response 200 {degraded:boolean, model:string|null,
 *               insights:InsightWire[] (+status), resolved?:string[],
 *               patterns?:JudgedPatternWire[]}
 *          400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN · 429 LLM_* · 502 {error:'UPSTREAM'}
 *
 *  - No GROQ_API_KEY → 200 {degraded:true, model:null} with deterministic
 *    templated sentences built from `data` (_shared/insightsFallback.ts);
 *    `patterns` mode phrases the operator-mined candidates with `fallbackText`.
 *  - With Groq: raw fetch to the OpenAI-compatible endpoint, JSON mode, five
 *    directed scan angles per scope for `insights` + `replace_rejected`, one
 *    revalidate call, and a smaller judge model for `patterns`. 25 s budget for
 *    the whole request.
 *  - THE PAGE AND THE MODEL READ THE SAME NUMBERS. The payload is the typed
 *    contract the cards render from; the deterministic `patterns` travel inside
 *    it as ground truth; the floors in the prompt are the contract's constants;
 *    and the gate (_shared/insightsGate.ts) drops any finding citing an IQD
 *    amount the payload does not contain, so nothing is scaled, projected or
 *    summed on the way to the owner. Ranking is confidence, then sample —
 *    never money.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import {
  MIN_ATTACH_BOOKINGS,
  MIN_CELL_OPEN_DAYS,
  MIN_ITEM_UNITS,
  MIN_ITEM_VIEWS,
  MIN_RATE_DENOM,
  type CafeInsightsPayload,
  type CourtsInsightsPayload,
  type FindingBasisWire,
  type InsightConfidence,
  type InsightKind,
  type InsightWire,
  type InsightsScope,
  type JudgedPatternWire,
  type PatternCandidateWire,
} from '../_shared/insightsContract.ts';
import { collectAmounts, gateInsights } from '../_shared/insightsGate.ts';
import { templatedInsights } from '../_shared/insightsFallback.ts';
import {
  MAX_FINDINGS,
  MIN_TREND_DAYS,
  MIN_WEEKDAY_DAYS,
  isStrongFinding,
  latinDigits,
  normalizeFinding,
  rejectionKeys,
} from '../_shared/insightsText.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const MODEL = Deno.env.get('GROQ_MODEL') || 'openai/gpt-oss-120b';
const JUDGE_MODEL = Deno.env.get('GROQ_JUDGE_MODEL') || 'llama-3.1-8b-instant';
const BUDGET_MS = 25_000;

/**
 * SEC-29 (0079) — per-request token tally, created in the handler and threaded
 * through every `chat()` call. Never module scope: an edge instance can serve
 * two requests at once, and a shared accumulator would bill one owner's calls
 * to the other. Flushed to app.llm_record_usage once, at the end.
 */
interface Tally {
  calls: number;
  prompt: number;
  completion: number;
}

const MAX_SPAN_DAYS = 400;
const MAX_ITEM_ROWS = 40;
const MAX_SECONDARY_ROWS = 25;
const MAX_REJECTED_EXAMPLES = 15;
const MAX_PATTERN_CANDIDATES = 40;
/** Courts scope: rows the model reads per block. The floors come from the contract. */
const MAX_COURT_ROWS = 12;
const MAX_HEAT_ROWS = 12;

const configured = () => Boolean(API_KEY);

type Lang = 'ar' | 'en';
type Mode = 'insights' | 'patterns' | 'revalidate' | 'replace_rejected';
type Scope = InsightsScope;
const KINDS = [
  'profit', 'conversion', 'pricing', 'movement', 'structural', // cafe angles
  'occupancy', 'reliability', 'demand', 'attach', // courts angles ('movement' is shared)
  'summary',
] as const satisfies readonly InsightKind[];
type Kind = InsightKind;

type Insight = InsightWire;
type PatternCandidate = PatternCandidateWire;
type JudgedPattern = JudgedPatternWire;

type Row = Record<string, unknown>;

interface ReqBase {
  mode: Mode;
  lang: Lang;
  range_from: string;
  range_to: string;
  compare_basis: string;
}
interface CafeReq extends ReqBase {
  scope: 'cafe';
  data: CafeInsightsPayload;
}
interface CourtsReq extends ReqBase {
  scope: 'courts';
  data: CourtsInsightsPayload;
}
/** `scope` discriminates `data`; the gates only touch the fields both shapes share. */
type Req = CafeReq | CourtsReq;

// ---------------------------------------------------------------------------
// Validation — tolerant: a missing block is an empty one, never a 400. The
// parsers return the CONTRACT types; the casts on nested rows are the one place
// the wire is trusted, and the fallback and the gate read only what they check.
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && ISO_DATE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Row[] : []);
const obj = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
const rowsAs = <T,>(v: unknown): T[] => rows(v) as unknown as T[];
const objAs = <T,>(v: unknown): T | null => obj(v) as unknown as T | null;

function parseBasis(v: unknown): FindingBasisWire | null {
  const b = obj(v);
  if (!b || typeof b.salesDays !== 'number' || !Array.isArray(b.weekdayCounts)) return null;
  return {
    salesDays: b.salesDays,
    weekdayCounts: (b.weekdayCounts as unknown[])
      .map((w) => obj(w))
      .filter((w): w is Row => !!w && typeof w.day === 'number' && typeof w.days === 'number')
      .map((w) => ({ day: w.day as number, days: w.days as number })),
  };
}

function parsePatterns(v: unknown): PatternCandidate[] {
  return rows(v)
    .filter((p) => typeof p.id === 'string' && typeof p.fallbackText === 'string')
    .slice(0, MAX_PATTERN_CANDIDATES)
    .map((p) => ({
      id: p.id as string,
      kind: typeof p.kind === 'string' ? p.kind : 'co-move',
      subjects: strings(p.subjects),
      metrics: obj(p.metrics) as Record<string, number | string> ?? {},
      confidence: (['high', 'medium', 'low'] as const).includes(p.confidence as InsightConfidence)
        ? (p.confidence as InsightConfidence)
        : 'low',
      sampleLabel: typeof p.sampleLabel === 'string' ? p.sampleLabel : '',
      desc: typeof p.desc === 'string' ? p.desc : typeof p.hint === 'string' ? p.hint : undefined,
      fallbackText: p.fallbackText as string,
    }));
}

function parseCafeData(d: Row, patterns: PatternCandidate[]): CafeInsightsPayload {
  const margins = obj(d.margins);
  return {
    kpis: (obj(d.kpis) ?? {}) as unknown as CafeInsightsPayload['kpis'],
    daily: rowsAs<CafeInsightsPayload['daily'][number]>(d.daily),
    best_sellers: rowsAs<CafeInsightsPayload['best_sellers'][number]>(d.best_sellers),
    margins: margins ? ({ ...margins, items: rows(margins.items) } as unknown as CafeInsightsPayload['margins']) : null,
    bought_together: rowsAs<CafeInsightsPayload['bought_together'][number]>(d.bought_together),
    price_bands: rowsAs<CafeInsightsPayload['price_bands'][number]>(d.price_bands),
    promo: objAs<NonNullable<CafeInsightsPayload['promo']>>(d.promo),
    engagement: objAs<NonNullable<CafeInsightsPayload['engagement']>>(d.engagement) ?? undefined,
    prior_insights: strings(d.prior_insights),
    rejections: strings(d.rejections),
    patterns,
    basis: parseBasis(d.basis),
    excluded_names: strings(d.excluded_names),
    compare: objAs<NonNullable<CafeInsightsPayload['compare']>>(d.compare) ?? undefined,
    coverage: objAs<NonNullable<CafeInsightsPayload['coverage']>>(d.coverage) ?? undefined,
  };
}

function parseCourtsData(d: Row, patterns: PatternCandidate[]): CourtsInsightsPayload {
  return {
    kpis: (obj(d.kpis) ?? {}) as unknown as CourtsInsightsPayload['kpis'],
    compare: objAs<NonNullable<CourtsInsightsPayload['compare']>>(d.compare) ?? undefined,
    coverage: objAs<NonNullable<CourtsInsightsPayload['coverage']>>(d.coverage) ?? undefined,
    basis: parseBasis(d.basis),
    per_court: rowsAs<CourtsInsightsPayload['per_court'][number]>(d.per_court),
    by_day: rowsAs<CourtsInsightsPayload['by_day'][number]>(d.by_day),
    heatmap_top: rowsAs<CourtsInsightsPayload['heatmap_top'][number]>(d.heatmap_top),
    heatmap_bottom: rowsAs<CourtsInsightsPayload['heatmap_bottom'][number]>(d.heatmap_bottom),
    demand: (obj(d.demand) ?? {}) as unknown as CourtsInsightsPayload['demand'],
    endings: (obj(d.endings) ?? {}) as unknown as CourtsInsightsPayload['endings'],
    guests: objAs<NonNullable<CourtsInsightsPayload['guests']>>(d.guests),
    cafe: objAs<NonNullable<CourtsInsightsPayload['cafe']>>(d.cafe),
    prior_insights: strings(d.prior_insights),
    rejections: strings(d.rejections),
    patterns,
    excluded_names: strings(d.excluded_names),
  };
}

function parseBody(body: unknown): Req | string {
  const b = obj(body);
  if (!b) return 'body must be a JSON object';
  const mode = b.mode;
  if (mode !== 'insights' && mode !== 'patterns' && mode !== 'revalidate' && mode !== 'replace_rejected') {
    return "mode must be one of insights|patterns|revalidate|replace_rejected";
  }
  const lang = b.lang === 'en' ? 'en' : b.lang === 'ar' ? 'ar' : null;
  if (!lang) return "lang must be 'ar' or 'en'";
  // Missing = the original cafe contract; anything present must be one of the two.
  const scope: Scope | null = b.scope === undefined ? 'cafe' : b.scope === 'cafe' || b.scope === 'courts' ? b.scope : null;
  if (!scope) return "scope must be 'cafe' or 'courts'";
  if (!isIsoDate(b.range_from) || !isIsoDate(b.range_to)) return 'range_from/range_to must be YYYY-MM-DD';
  const span = (Date.parse(`${b.range_to}T00:00:00Z`) - Date.parse(`${b.range_from}T00:00:00Z`)) / 86_400_000;
  if (span < 0) return 'range_to is before range_from';
  if (span > MAX_SPAN_DAYS) return `span exceeds ${MAX_SPAN_DAYS} days`;
  const compare_basis = typeof b.compare_basis === 'string' ? b.compare_basis : 'prev';
  if (!['prev', '4w', '52w'].includes(compare_basis)) return "compare_basis must be prev|4w|52w";
  const d = obj(b.data);
  if (!d) return 'data must be an object';
  const patterns = parsePatterns(d.patterns);
  if (mode === 'patterns' && !Array.isArray(d.patterns)) return 'patterns mode requires data.patterns';
  const base: ReqBase = { mode, lang, range_from: b.range_from, range_to: b.range_to, compare_basis };
  if (scope === 'courts') return { ...base, scope, data: parseCourtsData(d, patterns) };
  return { ...base, scope, data: parseCafeData(d, patterns) };
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

// ---------------------------------------------------------------------------
// Post-model gate (pure; _shared/insightsGate.ts). `amounts` is every number in
// the payload the model read, so a cited IQD figure must be one it was given.
// ---------------------------------------------------------------------------
function gate(items: Insight[], req: Req, cap = MAX_FINDINGS): Insight[] {
  return gateInsights(
    items,
    {
      rejections: req.data.rejections,
      basis: req.data.basis,
      excludedNames: req.data.excluded_names,
      amounts: collectAmounts(payload(req)),
    },
    cap,
  );
}

// ---------------------------------------------------------------------------
// Groq transport — JSON mode, one deadline for the whole request
// ---------------------------------------------------------------------------
class UpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function chat(
  system: string,
  user: string,
  model: string,
  deadline: number,
  tally: Tally,
): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining < 1500) throw new UpstreamError(504, 'budget exhausted');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), remaining);
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new UpstreamError(res.status, `groq ${res.status}: ${text.slice(0, 300)}`);
    const parsed = JSON.parse(text) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    // SEC-29 (0079): the bill is denominated in these. Accumulated on the
    // request's own tally and flushed once at the end, so a spend cap has
    // something real to measure.
    tally.calls += 1;
    tally.prompt += parsed.usage?.prompt_tokens ?? 0;
    tally.completion += parsed.usage?.completion_tokens ?? 0;
    return parsed.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(504, err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(content: string): unknown {
  const trimmed = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim()
    .replace(/^```(?:json)?/, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** A finding as the model (or a stored set) shaped it; `sample` is the count it rests on. */
function toInsight(raw: unknown, fallbackKind: Kind): Insight | null {
  if (typeof raw === 'string') {
    return { text: raw.trim(), kind: fallbackKind, subjects: [], metrics: {}, confidence: 'medium', sample: null };
  }
  const r = obj(raw);
  if (!r || typeof r.text !== 'string') return null;
  const kind = (KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as Kind) : fallbackKind;
  const confidence = (['high', 'medium', 'low'] as const).includes(r.confidence as InsightConfidence)
    ? (r.confidence as InsightConfidence)
    : 'medium';
  const metrics: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(obj(r.metrics) ?? {})) {
    if (typeof v === 'number' || typeof v === 'string') metrics[k] = v;
  }
  const sampleRaw = typeof r.sample === 'number' ? r.sample : typeof r.sample === 'string' ? Number(latinDigits(r.sample).replace(/[^\d.]/g, '')) : NaN;
  const sample = Number.isFinite(sampleRaw) && sampleRaw >= 0 ? Math.round(sampleRaw) : null;
  return { text: r.text.trim(), kind, subjects: strings(r.subjects).slice(0, 6), metrics, confidence, sample };
}

function parseInsightArray(content: string, key: string, fallbackKind: Kind): Insight[] {
  const parsed = parseJson(content);
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(obj(parsed)?.[key]) ? (obj(parsed)![key] as unknown[]) : [];
  return arr.map((x) => toInsight(x, fallbackKind)).filter((x): x is Insight => !!x);
}

// ---------------------------------------------------------------------------
// Prompts (adapted from UpperDeck insights.ts; IQD / Arabic-first)
// ---------------------------------------------------------------------------
const CAFE_FINDING_SHAPE = `Each finding is an object:
{"text": "<one sentence for the owner>", "kind": "profit|conversion|pricing|movement|structural",
 "subjects": ["<item or category names the finding is about>"],
 "metrics": {"<figure name>": <number>}, "confidence": "high|medium|low",
 "sample": <the count the finding rests on — units sold, views, orders or days, as a number>}`;

const COURTS_FINDING_SHAPE = `Each finding is an object:
{"text": "<one sentence for the owner>", "kind": "occupancy|reliability|demand|attach|movement",
 "subjects": ["<court names, weekdays or hours the finding is about>"],
 "metrics": {"<figure name>": <number>}, "confidence": "high|medium|low",
 "sample": <the count the finding rests on — bookings, open days or booked slots, as a number>}`;

const findingShape = (scope: Scope) => (scope === 'courts' ? COURTS_FINDING_SHAPE : CAFE_FINDING_SHAPE);

/** The money rule, both scopes: a figure is quoted, never made. */
const MONEY_RULES = `Every finding must cite a specific number from the data AND carry a concrete action; never just restate a
number. CITE AN IQD AMOUNT ONLY AS IT APPEARS IN THE DATA; never scale, estimate or project one — no "per month",
no "approximately", no sum of two figures. A finding whose amount is not in the data is dropped unread. NEVER
FORECAST: describe what happened in the range, never what will happen.`;

/** The deterministic patterns travel with the data and are the ground truth the model may not bend. */
const PATTERNS_RULE = `"patterns" are REAL statistical patterns already computed from these same numbers (each with its metrics,
sample and confidence). They are ground truth: never contradict one, never recompute one, and never restate one as
a finding of your own — a finding may build ON a pattern, not repeat it.`;

function languageRules(lang: Lang): string {
  return lang === 'ar'
    ? `WRITE THE "text" OF EVERY FINDING IN ARABIC — plain Modern Standard Arabic a cafe owner in Iraq reads
naturally, no dialect slang, no English words except item names as given. Use LATIN digits (0-9) for every
number, never Arabic-Indic digits. Write amounts as "12,500 د.ع" (number, space, د.ع). Keep item names exactly
as their "name" in the data.`
    : `WRITE THE "text" OF EVERY FINDING IN ENGLISH. Use Latin digits and write amounts as "12,500 IQD".
Keep item names exactly as their "name" in the data.`;
}

function courtsLanguageRules(lang: Lang): string {
  return lang === 'ar'
    ? `WRITE THE "text" OF EVERY FINDING IN ARABIC: plain Modern Standard Arabic a padel venue owner in Iraq reads
naturally, no dialect slang, no English words except court and item names as given. Use LATIN digits (0-9) for
every number, never Arabic-Indic digits. Write amounts as "12,500 د.ع" (number, space, د.ع). Keep court and item
names exactly as their "name" in the data.`
    : `WRITE THE "text" OF EVERY FINDING IN ENGLISH. Use Latin digits and write amounts as "12,500 IQD".
Keep court and item names exactly as their "name" in the data.`;
}

function dataContext(req: Req): string {
  return req.scope === 'courts' ? courtsDataContext(req) : cafeDataContext(req);
}

function courtsDataContext(req: CourtsReq): string {
  const courts = n(req.data.kpis.courts_count);
  const venue = courts > 0 ? `a padel venue with ${courts} courts` : 'a padel venue';
  return `You are a bookings analytics advisor for ${venue} in Iraq. Courts are booked through the mobile app or at
the front desk; the venue's cafe runs a QR-code menu and the desk can link a cafe tab to a booking. Currency is
Iraqi dinar (IQD), integer amounts, no decimals. You receive, for the date range ${req.range_from}..${req.range_to}:
- "kpis": headline totals (bookings, booked_minutes, occupancy_pct, revenue_iqd, rev_per_open_hour_iqd,
  price_per_booked_hour_iqd, cancellations, no_shows, booked_total, cancellation_rate_pct, no_show_rate_pct,
  mobile_bookings, desk_bookings, holds_expired, booking_days, courts_count), and "compare": the same figures for
  the comparison window under "kpis" plus the signed "deltas" (basis "${req.compare_basis}": prev = the period
  before this one, 4w = four weeks earlier, 52w = the same period last year). NAME that window in any
  period-over-period sentence; calling it the wrong thing makes the finding false.
- "per_court": per court: bookings, occupancy_pct, revenue_iqd, rev_per_open_hour_iqd, cancellations, no_shows,
  attach_pct, cafe_per_linked_iqd.
- "by_day": per business day: bookings, revenue_iqd, cancellations, no_shows.
- "heatmap_top" / "heatmap_bottom": the fullest and the emptiest weekday-by-hour cells of OPEN time, venue-wide:
  weekday (0 = Sunday) with its weekday_label, hour, occupancy_pct, bookings, open_days (how many such days were
  open in the range). There is no per-court heatmap.
- "demand": durations (bookings per slot length), lead_time (how far ahead people book), sources (app versus
  desk), hold_funnel (app holds ended, converted, pending), players (group size where recorded), series
  (standing weekly bookings).
- "endings": cancellations (total, rate_pct, by_notice = how long before the slot, by_actor = who cancelled,
  top_segments = where cancellations cluster, each with dim, label, n, bookings_total and rate_pct) and no_shows
  (total, rate_pct, top_segments).
- "guests" (may be null): identities, returning_pct, visit_buckets, regulars, lapsing_regulars,
  regulars_bookings_pct. Counts only; there are no people in this data.
- "cafe" (null when nothing is linked): attach_pct, cafe_per_booking_iqd, per_court, top_items_per_court,
  order_timing (before, during or after the slot), value_per_court_hour (court plus linked cafe revenue per open
  hour).
- "coverage": how much of the period has booking data. Below 0.9 the totals are INCOMPLETE; missing days, not
  lost business, so never call a gap a decline.
- "basis": salesDays (days with bookings) and weekdayCounts.
- "patterns": see below.

DEFINITIONS, use them exactly:
- A LIVE booking is confirmed, arrived or completed. booked_total = live + cancelled + no-show;
  cancellation_rate_pct and no_show_rate_pct are shares of booked_total, and a rate is null when its
  denominator is under ${MIN_RATE_DENOM}: then say "n of N", never a percentage.
- occupancy_pct = booked minutes over open minutes. Opening hours are venue-wide: every court is open the same
  hours, so a court with low occupancy is a court guests did not pick, not a court that was closed.
- ATTACH = the share of live bookings with a till-linked cafe tab. QR orders from the phone never link to a
  booking, so a low attach means "not linked", never "did not order".
- lead_time excludes standing (series) bookings; they are booked once and repeat.
- players = null means the group size was not recorded, never that nobody played.

SAMPLE SIZE IS A HARD GATE. Never make a weekday claim unless that weekday appears at least ${MIN_WEEKDAY_DAYS}
times in basis.weekdayCounts. Never build a finding on a heat cell with fewer than ${MIN_CELL_OPEN_DAYS}
open days, on a rate whose denominator is under ${MIN_RATE_DENOM} bookings, or on a court's attach with
fewer than ${MIN_ATTACH_BOOKINGS} bookings. When basis.salesDays is under ${MIN_TREND_DAYS}, describe no
trend, rise or fall at all. When a finding rests on a subset of the period, state the sample inside the sentence
and put the count in "sample". Dropping a thin finding costs nothing; publishing one costs the owner's trust.

${MONEY_RULES} NEVER NAME A PERSON: guests appear only as counts, and no name, phone number or identifier of any
kind may appear in a finding.

${PATTERNS_RULE}

WRITE FOR A VENUE OWNER, NOT AN ANALYST. Never name the internal fields ("heatmap_top", "endings", "kpis"…).
Do NOT restate what the dashboard already shows (occupancy per court, the busiest hour, the totals). Each finding
must expose a TENSION the owner would not catch from the boards: an open hour that sits empty while the same
hour on another day is full, late cancellations that free hours nobody rebooks, app holds that expire without
converting, a segment that no-shows far above the base rate, a court whose bookings rarely link a cafe tab, a
reversal versus the comparison window. If many courts or slots share a problem, that is ONE finding about the
group, citing the figures as given.

${courtsLanguageRules(req.lang)}

${findingShape(req.scope)}`;
}

function cafeDataContext(req: CafeReq): string {
  return `You are a menu analytics advisor for a cafe with a QR-code digital menu (guests order from their
phone at the table; there is no online payment — they pay at the desk). Currency is Iraqi dinar (IQD), integer
amounts, no decimals. You receive, for the date range ${req.range_from}..${req.range_to}:
- "kpis": headline totals (total_sales_iqd = cafe money actually paid, net of refunds; tabs, orders, items_qty,
  cash_iqd, card_iqd, discount_iqd, refunds_iqd, qr_orders, till_orders, qr_share_pct, sessions, views,
  median_seconds, waiter_calls, basket_to_call_pct), and "compare": the same figures for the comparison window
  under "kpis" plus the signed "deltas" (basis "${req.compare_basis}": prev = the period before this one, 4w =
  four weeks earlier, 52w = the same period last year). NAME that window in any period-over-period sentence;
  calling it the wrong thing makes the finding false.
- "daily": per business day — revenue_iqd (net of refunds), tabs, orders, items_qty, discount_iqd, refunds_iqd,
  waiter_calls.
- "best_sellers": per item — name, qty, revenue_iqd, share_pct.
- "margins": per item — name, qty, revenue_iqd, has_cost, cost_iqd, margin_iqd, margin_pct, quadrant,
  losing_money, plus "coverage" (share of revenue whose items have a cost entered). PROFIT IS THE LANGUAGE, NOT
  REVENUE: a popular low-margin item ("يبيع كثيراً لكن لا يربح" / "sells a lot but earns little") is where the
  money usually is; an item with a negative margin_iqd is sold below cost — always worth a finding. When
  coverage.revenue_with_cost_pct is low, a profit finding speaks ONLY for the costed items — say so. When
  "margins" is null or every has_cost is false: never mention cost, margin or profit, and never estimate them.
- "bought_together": item pairs — a, b, both (co-occurrences), confidence_pct (of orders with a, the share that
  also had b), lift.
- "price_bands": views, units sold and conv_pct per list-price band (min_iqd..max_iqd).
- "promo": what the featured/discounted items sold and the discount given away (discount_iqd).
- "engagement" (may be absent — guest analytics not configured): funnel (sessions per step), item_conversion
  (per item: views, carts, sold, conv_pct — the looked-versus-bought table), abandoned (per item: views that did
  not order, by dwell — dwell_under_10s: photo/appeal weak; dwell_10_20s: description not convincing;
  dwell_over_20s: read everything and still did not order — content or price). Sales are the ground truth for
  demand; a conv_pct above 100 means guests order WITHOUT opening the page (an exposure problem, never a
  success).
- "coverage": how much of the period has sales data. Below 0.9 the totals are INCOMPLETE — missing days, not lost
  business — so never call a gap a decline.
- "basis": salesDays and weekdayCounts.
- "patterns": see below.

SAMPLE SIZE IS A HARD GATE. Never make a weekday claim unless that weekday appears at least ${MIN_WEEKDAY_DAYS}
times in basis.weekdayCounts. Never build a finding on fewer than ${MIN_ITEM_UNITS} sold units or
${MIN_ITEM_VIEWS} views. When basis.salesDays is under ${MIN_TREND_DAYS}, describe no trend, rise or fall at
all. When a finding rests on a subset of the period, state the sample inside the sentence and put the count in
"sample". Dropping a thin finding costs nothing; publishing one costs the owner's trust.

${MONEY_RULES}

${PATTERNS_RULE}

WRITE FOR A CAFE OWNER, NOT AN ANALYST. Never name the internal fields ("best_sellers", "price_bands", "kpis"…).
Do NOT restate what the dashboard already shows (rankings, best sellers, most viewed). Each finding must expose a
TENSION the owner would not catch from the tables: viewed a lot but rarely sold, a band that barely converts, a
dwell-time signal, a reversal versus the comparison window, a discount not moving sales, a popular item beaten on
profit by a quieter one. If many items share a problem, that is ONE finding about the group, citing the figures
as given.

${languageRules(req.lang)}

${findingShape(req.scope)}`;
}

type ScanAngle = { id: Kind; focus: string };

const CAFE_SCAN_ANGLES: ScanAngle[] = [
  {
    id: 'profit',
    focus: `THIS PASS: PROFIT AND COST ONLY ("margins"). Find items selling below cost or near zero margin; a
popular low-margin item whose price or portion cost is where the money is; a high-margin item almost nobody buys
and what would expose it; a top-REVENUE item beaten on PROFIT by a quieter one. If margins is null or nothing
has a cost, return {"findings":[]} — never estimate a margin.`,
  },
  {
    id: 'conversion',
    focus: `THIS PASS: THE GAP BETWEEN LOOKING AND BUYING ONLY ("engagement" against "best_sellers"). Find items
with heavy views and poor sales and WHY (read the dwell buckets — each implies a different fix); items sold far
more than viewed (exposure problem). Group items sharing a failure into ONE finding. If engagement is absent,
return {"findings":[]}.`,
  },
  {
    id: 'pricing',
    focus: `THIS PASS: PRICE AND DISCOUNT STRUCTURE ONLY ("price_bands", "promo"). Find a band that draws
attention but sells poorly; a band that quietly outperforms; whether the promo discount actually moves sales — a
discount that does not is margin given away for nothing, say so with the discount_iqd figure as given.`,
  },
  {
    id: 'movement',
    focus: `THIS PASS: CHANGE OVER TIME ONLY ("kpis" vs "compare", "daily", "prior_insights"). Name the comparison
window exactly. Find a headline figure that moved materially, citing both windows' figures as given; a REVERSAL
where two figures moved in opposite directions; follow-ups on prior_insights — did earlier advice land? Respect
coverage and the trend gate.`,
  },
  {
    id: 'structural',
    focus: `THIS PASS: THE MENU AS A WHOLE. Find the shared trait the owner cannot see item-by-item: a category,
price tier or pairing pattern ("bought_together") where MANY items behave together; a category with heavy
engagement and thin sales or the reverse; a structural gap. Single-item observations do not belong here.`,
  },
];

// Five angles so a press stays five model calls, the same as the cafe scope.
const COURTS_SCAN_ANGLES: ScanAngle[] = [
  {
    id: 'occupancy',
    focus: `THIS PASS: WHERE THE COURTS SIT EMPTY OR FULL ONLY ("heatmap_top", "heatmap_bottom", "per_court",
"by_day"). Find dead open hours (a slot that barely books while the same hour on other days fills), saturated
slots where demand is being turned away, and the weekday shape; cite the venue's own figures as given. A cell
with fewer than ${MIN_CELL_OPEN_DAYS} open days is not evidence. If both heatmaps are empty, return
{"findings":[]}; never estimate occupancy.`,
  },
  {
    id: 'reliability',
    focus: `THIS PASS: CANCELLATIONS AND NO-SHOWS ONLY ("endings", "per_court"). Read the notice buckets (a late
cancellation frees hours nobody rebooks), who cancels (guest versus desk), and the segments that cancel or
no-show far above the base rate; the late_revenue_iqd figure is the money freed too late, cite it as given. A
rate on fewer than ${MIN_RATE_DENOM} bookings is not evidence. If "endings" is absent or empty, return
{"findings":[]}; never estimate a rate.`,
  },
  {
    id: 'demand',
    focus: `THIS PASS: HOW PEOPLE BOOK ONLY ("demand", "per_court"): lead time, app versus desk, the hold funnel
(an expired hold is a guest who wanted the slot and left), slot lengths, group size where recorded, standing
weekly series. Find where the app loses bookings the desk keeps, a slot length booked far more than the others,
the share of the week standing bookings lock up and whether they show up. If "demand" is absent, return
{"findings":[]}; never estimate conversion.`,
  },
  {
    id: 'attach',
    focus: `THIS PASS: THE CAFE ON TOP OF THE COURT ONLY ("cafe", "per_court"). Find the courts whose bookings
rarely link a cafe tab against the venue attach rate, the spend per booking, what each court's players order,
when orders land (before, during or after the slot), and the combined court-plus-cafe value per open hour; the
gap between the best and the worst court is the finding, cited as given. Attach on fewer than
${MIN_ATTACH_BOOKINGS} bookings is not evidence, and QR orders never link, so never call a low attach "nobody
ordered". If "cafe" is null, return {"findings":[]}; never estimate cafe spend.`,
  },
  {
    id: 'movement',
    focus: `THIS PASS: CHANGE OVER TIME ONLY ("kpis" vs "compare", "by_day", "prior_insights"). Name the comparison
window exactly. Find a headline figure that moved materially, citing both windows' figures as given; a REVERSAL
where two figures moved in opposite directions (more bookings but less revenue per open hour, fewer
cancellations but more no-shows); follow-ups on prior_insights: did earlier advice land? Respect coverage and
the trend gate; describe what happened, never what will happen. If "compare" is null, return {"findings":[]}.`,
  },
];

const scanAngles = (scope: Scope): ScanAngle[] => (scope === 'courts' ? COURTS_SCAN_ANGLES : CAFE_SCAN_ANGLES);

function generateSystem(req: Req, angle: ScanAngle): string {
  return `${dataContext(req)}

Return AT MOST ${MAX_FINDINGS} findings ordered by confidence, then by the sample they rest on, strongest first.
Fewer is fine; two sharp findings beat eight padded ones. The user message includes "already_found": findings
from earlier passes — do NOT repeat or rephrase any of them. DIG: cross two tables against each other before you
emit anything.

=== FOCUS OF THIS PASS: ${angle.id.toUpperCase()} ===
${angle.focus}
Stay inside this pass's focus; set "kind" to "${angle.id}".

${rejectionsBlock(req)}
Respond with ONLY a JSON object: {"findings":[...]} (an empty array is a correct answer).`;
}

function revalidateSystem(req: Req): string {
  return `${dataContext(req)}

You are re-checking an existing set of findings ("existing") against the LATEST data:
- "ongoing": findings STILL TRUE now — keep them, updating figures to current values.
- "resolved": findings that NO LONGER hold (improved or reversed) — briefly restate what changed (plain strings).
- "added": NEW distinct findings not covered by the existing set.
Hold "ongoing" and "added" to the full strength bar (sample, material number, action, amounts only as given).
"ongoing" plus "added" must not exceed ${MAX_FINDINGS}.
${rejectionsBlock(req)}
Respond with ONLY a JSON object: {"ongoing":[finding…],"resolved":["…"],"added":[finding…]}.`;
}

function rejectionsBlock(req: Req): string {
  const rejected = req.data.rejections.slice(-MAX_REJECTED_EXAMPLES);
  if (!rejected.length) return '';
  const lines = rejected.map((t, i) => `${i + 1}. "${t}"`).join('\n');
  return `
REJECTED BY THE OWNER — DO NOT WRITE FINDINGS LIKE THESE. They override every rule above:
${lines}
Treat each as a CLASS of finding, not a banned string: the same shape or reasoning about another item, band or
period counts as repeating it. Returning fewer findings is better than returning one of these again.
`;
}

function judgeSystem(lang: Lang, scope: Scope): string {
  const langLine = lang === 'ar'
    ? 'Write each sentence in plain Modern Standard Arabic with Latin digits; amounts as "12,500 د.ع".'
    : 'Write each sentence in plain English with Latin digits; amounts as "12,500 IQD".';
  if (scope === 'courts') {
    return `You are the quality gate for a padel venue's court bookings "patterns" feature (courts booked through a
mobile app and a front desk, a cafe on site, Iraqi dinar).
You receive "candidates": REAL statistical patterns already computed from the bookings (a dead or a saturated
open slot, a shift against the comparison window, a cluster of cancellations or no-shows in one segment, regulars
lapsing as a count, a court whose bookings rarely link a cafe tab, a court's cafe basket). Occupancy,
cancellations and no-shows, lead time, guests as counts and cafe attach are the vocabulary. The numbers are
ground truth; never recompute or adjust them. Your ONLY job is judgment + phrasing.

Each candidate carries "sampleLabel" (how much data it rests on) and "confidence". Include the sampleLabel inside
the sentence verbatim, and match the STRENGTH OF THE CLAIM to the confidence: high → state it and recommend the
action; medium → an emerging signal with a cheap, reversible action; low → a hypothesis to watch, never a
confident instruction. A thin sample is not a reason to reject.

KEEP a candidate only if a smart venue owner would find it genuinely NON-OBVIOUS and ACTIONABLE. REJECT anything
obvious (evenings fuller than mornings, a closed hour that is empty, a lift barely above 1), circular, an
artifact of overall volume, or unusable. Never name a person; guests are counts. Keeping nothing is a valid
answer.

For every KEPT candidate write ONE sentence: the relationship in plain words, the single most telling number
from its metrics, and a concrete action. ${langLine}
Respond with ONLY a JSON object: {"kept":[{"id":"<candidate id>","sentence":"…"}]}.`;
  }
  return `You are the quality gate for a cafe menu "patterns" feature (QR-code digital menu, Iraqi dinar).
You receive "candidates": REAL statistical patterns already computed from the data (correlation, market-basket
lift, weekday over-indexing, a price cliff, a cost-based margin movement). The numbers are ground truth — never
recompute or adjust them. Your ONLY job is judgment + phrasing.

Each candidate carries "sampleLabel" (how much data it rests on) and "confidence". Include the sampleLabel inside
the sentence verbatim, and match the STRENGTH OF THE CLAIM to the confidence: high → state it and recommend the
action; medium → an emerging signal with a cheap, reversible action; low → a hypothesis to watch, never a
confident instruction. A thin sample is not a reason to reject.

KEEP a candidate only if a smart cafe owner would find it genuinely NON-OBVIOUS and ACTIONABLE. REJECT anything
obvious (two staples selling together, "people who order food also order a drink", lift barely above 1),
circular, an artifact of overall volume, or unusable. Keeping nothing is a valid answer.

For every KEPT candidate write ONE sentence: the relationship in plain words, the single most telling number
from its metrics, and a concrete action. ${langLine}
Respond with ONLY a JSON object: {"kept":[{"id":"<candidate id>","sentence":"…"}]}.`;
}

// ---------------------------------------------------------------------------
// Payload trimming (what the model actually reads per angle)
// ---------------------------------------------------------------------------
function payload(req: Req, angle?: Kind): Row {
  return req.scope === 'courts' ? courtsPayload(req, angle) : cafePayload(req, angle);
}

/** The mined patterns as the model reads them: the statistics without the templated sentence. */
function patternsForModel(patterns: readonly PatternCandidate[]): Row[] {
  return patterns.map(({ fallbackText: _f, hint: _h, ...c }) => c as unknown as Row);
}

// Emptied rather than deleted: a present-but-empty key says "exists, not this
// pass's subject"; a missing key would invite the model to invent it. The
// patterns stay in every pass: they are ground truth, not a subject.
function trimTo(base: Row, want: string[]): Row {
  const keep = new Set(['range', 'compare_basis', 'lang', 'kpis', 'coverage', 'basis', 'patterns', ...want]);
  const out: Row = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = keep.has(k) ? v : Array.isArray(v) ? [] : v && typeof v === 'object' ? null : v;
  }
  return out;
}

function courtsPayload(req: CourtsReq, angle?: Kind): Row {
  const d = req.data;
  const base: Row = {
    range: { from: req.range_from, to: req.range_to },
    compare_basis: req.compare_basis,
    lang: req.lang,
    kpis: d.kpis,
    compare: d.compare ?? null,
    coverage: d.coverage ?? null,
    basis: d.basis,
    per_court: d.per_court.slice(0, MAX_COURT_ROWS),
    by_day: d.by_day,
    heatmap_top: d.heatmap_top.slice(0, MAX_HEAT_ROWS),
    heatmap_bottom: d.heatmap_bottom.slice(0, MAX_HEAT_ROWS),
    demand: d.demand,
    endings: d.endings,
    guests: d.guests,
    cafe: d.cafe,
    patterns: patternsForModel(d.patterns ?? []),
    prior_insights: (d.prior_insights ?? []).slice(0, MAX_FINDINGS),
  };
  if (!angle) return base;
  const WANT: Partial<Record<Kind, string[]>> = {
    occupancy: ['per_court', 'by_day', 'heatmap_top', 'heatmap_bottom'],
    reliability: ['endings', 'per_court'],
    demand: ['demand', 'per_court'],
    attach: ['cafe', 'per_court'],
    movement: ['compare', 'by_day', 'prior_insights'],
    summary: [],
  };
  return trimTo(base, WANT[angle] ?? []);
}

function cafePayload(req: CafeReq, angle?: Kind): Row {
  const d = req.data;
  const base: Row = {
    range: { from: req.range_from, to: req.range_to },
    compare_basis: req.compare_basis,
    lang: req.lang,
    kpis: d.kpis,
    compare: d.compare ?? null,
    coverage: d.coverage ?? null,
    basis: d.basis,
    daily: d.daily,
    best_sellers: d.best_sellers.slice(0, MAX_ITEM_ROWS),
    margins: d.margins ? { ...d.margins, items: d.margins.items.slice(0, MAX_ITEM_ROWS) } : null,
    bought_together: d.bought_together.slice(0, MAX_SECONDARY_ROWS),
    price_bands: d.price_bands,
    promo: d.promo,
    engagement: d.engagement
      ? {
          ...d.engagement,
          item_conversion: (d.engagement.item_conversion ?? []).slice(0, MAX_SECONDARY_ROWS),
          abandoned: (d.engagement.abandoned ?? []).slice(0, MAX_SECONDARY_ROWS),
        }
      : null,
    patterns: patternsForModel(d.patterns ?? []),
    prior_insights: (d.prior_insights ?? []).slice(0, MAX_FINDINGS),
  };
  if (!angle) return base;
  const WANT: Partial<Record<Kind, string[]>> = {
    profit: ['margins', 'best_sellers'],
    conversion: ['engagement', 'best_sellers'],
    pricing: ['price_bands', 'promo', 'best_sellers'],
    movement: ['compare', 'daily', 'prior_insights', 'best_sellers'],
    structural: ['bought_together', 'best_sellers', 'engagement', 'price_bands'],
    summary: [],
  };
  return trimTo(base, WANT[angle] ?? []);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------
async function runScan(req: Req, alreadyFound: string[], deadline: number, tally: Tally): Promise<Insight[]> {
  const found: Insight[] = [];
  const known = new Set(alreadyFound.map(normalizeFinding));
  for (const angle of scanAngles(req.scope)) {
    if (deadline - Date.now() < 3000) break; // return what we have rather than time out
    let content: string;
    try {
      content = await chat(
        generateSystem(req, angle),
        JSON.stringify({ ...payload(req, angle.id), already_found: [...alreadyFound, ...found.map((f) => f.text)] }),
        MODEL,
        deadline,
        tally,
      );
    } catch (err) {
      // Nothing collected yet → the whole request is an upstream failure.
      if (!found.length) throw err;
      console.warn(`[analytics-insights] pass ${angle.id} failed after ${found.length} findings:`, err);
      break;
    }
    for (const ins of parseInsightArray(content, 'findings', angle.id)) {
      const key = normalizeFinding(ins.text);
      if (!key || known.has(key)) continue;
      known.add(key);
      found.push(ins);
    }
  }
  return found;
}

async function modeInsights(req: Req, deadline: number, tally: Tally) {
  const alreadyFound = req.mode === 'replace_rejected' ? (req.data.prior_insights ?? []) : [];
  const found = await runScan(req, alreadyFound, deadline, tally);
  return { insights: gate(found, req).map((i) => ({ ...i, status: 'new' as const })) };
}

async function modeRevalidate(req: Req, deadline: number, tally: Tally) {
  const content = await chat(
    revalidateSystem(req),
    JSON.stringify({ ...payload(req), existing: req.data.prior_insights ?? [] }),
    MODEL,
    deadline,
    tally,
  );
  const parsed = obj(parseJson(content)) ?? {};
  const ongoing = parseInsightArray(JSON.stringify({ x: parsed.ongoing ?? [] }), 'x', 'summary')
    .map((i) => ({ ...i, status: 'ongoing' as const }));
  const added = parseInsightArray(JSON.stringify({ x: parsed.added ?? [] }), 'x', 'summary')
    .map((i) => ({ ...i, status: 'new' as const }));
  const resolved = strings(parsed.resolved);
  return { insights: gate([...ongoing, ...added], req), resolved };
}

function phraseFallback(req: Req): JudgedPattern[] {
  const banned = rejectionKeys(req.data.rejections);
  return (req.data.patterns ?? [])
    .filter((p) => isStrongFinding(p.fallbackText) && !banned.has(normalizeFinding(p.fallbackText)))
    .map(({ fallbackText, desc: _d, hint: _h, ...p }) => ({ ...p, text: fallbackText }));
}

async function modePatterns(req: Req, deadline: number, tally: Tally): Promise<{ patterns: JudgedPattern[]; degraded: boolean }> {
  const all = req.data.patterns ?? [];
  if (!all.length) return { patterns: [], degraded: false };
  const candidates = all.map(({ fallbackText: _f, ...c }) => c);
  const content = await chat(judgeSystem(req.lang, req.scope), JSON.stringify({ candidates }), JUDGE_MODEL, deadline, tally);
  const parsed = obj(parseJson(content));
  const keptRaw = Array.isArray(parsed?.kept) ? (parsed!.kept as unknown[]) : [];
  const byId = new Map(all.map((p) => [p.id, p]));
  const banned = rejectionKeys(req.data.rejections);
  const out: JudgedPattern[] = [];
  const used = new Set<string>();
  for (const raw of keptRaw) {
    const r = obj(raw);
    if (!r) continue;
    const id = String(r.id ?? '');
    const text = latinDigits(String(r.sentence ?? r.text ?? '')).trim();
    const cand = byId.get(id);
    if (!cand || used.has(id) || !isStrongFinding(text) || banned.has(normalizeFinding(text))) continue;
    used.add(id);
    const { fallbackText: _f, desc: _d, hint: _h, ...rest } = cand;
    out.push({ ...rest, text });
  }
  return { patterns: out, degraded: false };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, ['owner']);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'INVALID_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const parsed = parseBody(body);
  if (typeof parsed === 'string') return json({ error: 'INVALID_REQUEST', message: parsed }, 400);

  // Degraded path: no key → templated sentences, 200 (the card still renders).
  if (!configured()) {
    if (parsed.mode === 'patterns') {
      return json({ degraded: true, model: null, insights: [], patterns: phraseFallback(parsed) });
    }
    const templated = gate(templatedInsights(parsed), parsed);
    if (parsed.mode === 'revalidate') {
      // Keep the stored set (minus rejections) — age alone is not a reason to drop it.
      const prior = gate(
        (parsed.data.prior_insights ?? []).map((text) => toInsight(text, 'summary')!),
        parsed,
      ).map((i) => ({ ...i, status: 'ongoing' as const }));
      return json({ degraded: true, model: null, insights: prior, resolved: [] });
    }
    if (parsed.mode === 'replace_rejected') {
      const known = new Set((parsed.data.prior_insights ?? []).map(normalizeFinding));
      return json({
        degraded: true,
        model: null,
        insights: templated.filter((i) => !known.has(normalizeFinding(i.text))).map((i) => ({ ...i, status: 'new' })),
      });
    }
    return json({ degraded: true, model: null, insights: templated.map((i) => ({ ...i, status: 'new' })) });
  }

  // SEC-29 (0079): the quota gate. Deliberately AFTER the degraded path above —
  // templated sentences cost nothing and must keep working when the budget is
  // spent, so the card still renders. Only the paid path is gated.
  const tally: Tally = { calls: 0, prompt: 0, completion: 0 };
  const budget = await service.schema('app').rpc('llm_begin_request');
  if (budget.error) {
    const code = budget.error.message ?? 'LLM_BUDGET';
    if (code.includes('LLM_DAILY_QUOTA') || code.includes('LLM_MONTHLY_CAP')) {
      // 429, not 502: this is our own ceiling, not Groq failing. The operator
      // shows the owner why, and the templated fallback is still available.
      return json(
        { error: code.includes('LLM_MONTHLY_CAP') ? 'LLM_MONTHLY_CAP' : 'LLM_DAILY_QUOTA',
          message: budget.error.details ?? code,
          hint: budget.error.hint ?? null },
        429,
      );
    }
    console.error('[analytics-insights] budget gate failed', code);
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', message: code }, 502);
  }

  const deadline = Date.now() + BUDGET_MS;
  try {
    switch (parsed.mode) {
      case 'patterns': {
        const r = await modePatterns(parsed, deadline, tally);
        return json({ degraded: false, model: JUDGE_MODEL, insights: [], patterns: r.patterns });
      }
      case 'revalidate': {
        const r = await modeRevalidate(parsed, deadline, tally);
        return json({ degraded: false, model: MODEL, ...r });
      }
      default: {
        const r = await modeInsights(parsed, deadline, tally);
        return json({ degraded: false, model: MODEL, ...r });
      }
    }
  } catch (err) {
    const status = err instanceof UpstreamError ? err.status : 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error('[analytics-insights] upstream failure', status, message);
    // 429 / 5xx / timeout at Groq → 502 UPSTREAM (operator maps 5xx → EDGE_UPSTREAM, one retry).
    // Other 4xx (bad key, retired model) are permanent: 502 too, but say so in detail.
    return json({ error: 'UPSTREAM', code: 'UPSTREAM', upstream_status: status, message }, 502);
  } finally {
    // In `finally` on purpose: a request that burned five calls and then timed
    // out on the sixth has still spent the money, and a cap that only counts
    // successes is not a cap. Never allowed to throw — failing to record must
    // not turn a served answer into an error.
    if (tally.calls > 0) {
      const rec = await service.schema('app').rpc('llm_record_usage', {
        p_model_calls: tally.calls,
        p_prompt_tokens: tally.prompt,
        p_completion_tokens: tally.completion,
      });
      if (rec.error) console.error('[analytics-insights] usage not recorded', rec.error.message);
    }
  }
});

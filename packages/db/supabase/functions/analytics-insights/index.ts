/**
 * analytics-insights — owner-only, STATELESS LLM layer over the analytics data
 * (db-slice.md Wave 4; contract in the reconciled plan §1.2). The operator
 * gathers SQL (app.analytics_*) + PostHog data first and POSTs it here; the
 * function never reads or writes the database — persistence is the operator's
 * job through the owner's save_analytics_* / reject_insight RPCs.
 *
 * Request  POST {mode:'insights'|'patterns'|'revalidate'|'replace_rejected',
 *                lang:'ar'|'en', range_from, range_to, compare_basis:'prev'|'4w'|'52w',
 *                scope?:'cafe'|'courts' (missing = 'cafe'; old clients keep working),
 *                data: cafe  {kpis, daily, best_sellers, margins, bought_together, price_bands,
 *                             promo, engagement?, prior_insights?:string[], rejections:string[],
 *                             patterns?:PatternCandidate[], basis?:{salesDays, weekdayCounts},
 *                             excluded_names?:string[], compare?:{...}, coverage?:{...}}
 *                      courts {kpis, compare?, coverage?, basis, per_court[], by_day[],
 *                             heatmap_top[], heatmap_bottom[], demand, endings, guests|null,
 *                             cafe|null, patterns?, prior_insights?, rejections, excluded_names}
 *                             (aggregates and display names only; no identifiers of any kind)
 * Response 200 {degraded:boolean, model:string|null,
 *               insights:[{text, kind, subjects, metrics, confidence, status?}],
 *               resolved?:string[], patterns?:[{id, text, kind, subjects, metrics, confidence, sampleLabel}]}
 *          400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN · 502 {error:'UPSTREAM'}
 *
 *  - No GROQ_API_KEY → 200 {degraded:true, model:null} with deterministic
 *    templated sentences built from `data` (best seller, thinnest-margin costed
 *    item, top pair, promo uplift, busiest day; courts: fullest and emptiest
 *    open hour, cancellation rate with its worst segment, cafe attach with the
 *    lowest-attach court); `patterns` mode phrases the operator-mined
 *    candidates with their `fallbackText`.
 *  - With Groq: raw fetch to the OpenAI-compatible endpoint, JSON mode, five
 *    directed scan angles per scope (cafe: profit / conversion / pricing /
 *    movement / structural; courts: occupancy / reliability / demand / attach /
 *    movement) for `insights` + `replace_rejected`, one revalidate call, and a
 *    smaller judge model for `patterns`. 25 s budget for the whole request.
 *  - Post-model gates (shared copy of packages/core insightsText.ts):
 *    isStrongFinding → drop owner rejections (normalizeFinding, the SQL twin of
 *    app.normalize_finding) → dropLowConfidenceClaims when `data.basis` is
 *    present → dropExcludedMentions → rankFindings (money cited) → cap 8.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import {
  MAX_FINDINGS,
  MIN_TREND_DAYS,
  MIN_WEEKDAY_DAYS,
  dropExcludedMentions,
  dropLowConfidenceClaims,
  dropRejectedFindings,
  isStrongFinding,
  latinDigits,
  normalizeFinding,
  rankFindings,
  rejectionKeys,
  type FindingBasis,
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
 * SEC-29 (0079) — per-request token tally.
 *
 * Module scope is safe here BECAUSE the accumulator is reset at the top of every
 * request and an edge instance serves one request at a time. It is flushed to
 * app.llm_record_usage once, at the end, rather than per model call: one
 * `insights` request fans out to six calls and six round trips to the database
 * to bill them would cost more than the calls.
 */
const tally = { calls: 0, prompt: 0, completion: 0 };
const MAX_SPAN_DAYS = 400;
const MAX_ITEM_ROWS = 40;
const MAX_SECONDARY_ROWS = 25;
const MAX_REJECTED_EXAMPLES = 15;
const MAX_PATTERN_CANDIDATES = 40;
/** Courts scope: rows the model reads per block, and the floors its prompt states. */
const MAX_COURT_ROWS = 12;
const MAX_HEAT_ROWS = 12;
const COURTS_MIN_CELL_OPEN_DAYS = 4;
const COURTS_MIN_RATE_DENOM = 20;
const COURTS_MIN_ATTACH_BOOKINGS = 10;

const configured = () => Boolean(API_KEY);

type Lang = 'ar' | 'en';
type Mode = 'insights' | 'patterns' | 'revalidate' | 'replace_rejected';
type Confidence = 'high' | 'medium' | 'low';
/** Which analytics the request describes; the cafe menu (the original) or the padel courts. */
type Scope = 'cafe' | 'courts';
const KINDS = [
  'profit', 'conversion', 'pricing', 'movement', 'structural', // cafe angles
  'occupancy', 'reliability', 'demand', 'attach', // courts angles ('movement' is shared)
  'summary',
] as const;
type Kind = (typeof KINDS)[number];

interface Insight {
  text: string;
  kind: Kind;
  subjects: string[];
  metrics: Record<string, number | string>;
  confidence: Confidence;
  /** revalidate: 'ongoing' (still true) | 'new'; other modes: 'new'. */
  status?: 'ongoing' | 'new';
}

interface PatternCandidate {
  id: string;
  kind: string;
  subjects: string[];
  metrics: Record<string, number | string>;
  confidence: Confidence;
  sampleLabel: string;
  desc?: string;
  hint?: string;
  fallbackText: string;
}

interface JudgedPattern extends PatternCandidate {
  text: string;
}

type Row = Record<string, unknown>;

interface CafeData {
  kpis: Row;
  daily: Row[];
  best_sellers: Row[];
  margins: Row | null;
  bought_together: Row[];
  price_bands: Row[];
  promo: Row | null;
  engagement?: Row;
  prior_insights: string[];
  rejections: string[];
  patterns: PatternCandidate[];
  basis: FindingBasis | null;
  excluded_names: string[];
  compare?: Row;
  coverage?: Row;
}

/**
 * Courts scope. Everything is an aggregate the operator computed from the five
 * app.analytics_courts_* RPCs; court names are display names, guests are counts.
 */
interface CourtsData {
  kpis: Row;
  /** { from, to, basis, reliable, kpis } for the comparison window. */
  compare?: Row;
  /** { days, days_with_data, ratio }. */
  coverage?: Row;
  /** bookingDays mapped to salesDays by the client. */
  basis: FindingBasis | null;
  /** <= MAX_COURT_ROWS: name, bookings, occupancy_pct, revenue_iqd, rev_per_open_hour_iqd, ... */
  per_court: Row[];
  /** business_date, bookings, revenue_iqd, cancellations, no_shows. */
  by_day: Row[];
  /** <= MAX_HEAT_ROWS each: weekday, hour, occupancy_pct, bookings, open_days. */
  heatmap_top: Row[];
  heatmap_bottom: Row[];
  /** { durations, lead_time, sources, hold_funnel, players, series }. */
  demand: Row;
  /** { cancellations: {total, rate_pct, by_notice, by_actor, top_segments}, no_shows: {...} }. */
  endings: Row;
  /** { identities, returning_pct, visit_buckets, regulars, lapsing_regulars, regulars_bookings_pct }. */
  guests: Row | null;
  /** { attach_pct, cafe_per_booking_iqd, per_court, top_items_per_court, order_timing, value_per_court_hour }. */
  cafe: Row | null;
  prior_insights: string[];
  rejections: string[];
  patterns: PatternCandidate[];
  excluded_names: string[];
}

interface ReqBase {
  mode: Mode;
  lang: Lang;
  range_from: string;
  range_to: string;
  compare_basis: string;
}
interface CafeReq extends ReqBase {
  scope: 'cafe';
  data: CafeData;
}
interface CourtsReq extends ReqBase {
  scope: 'courts';
  data: CourtsData;
}
/** `scope` discriminates `data`; the gates only touch the fields both shapes share. */
type Req = CafeReq | CourtsReq;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && ISO_DATE.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Row[] : []);
const obj = (v: unknown): Row | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

function parseBasis(v: unknown): FindingBasis | null {
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
      confidence: (['high', 'medium', 'low'] as const).includes(p.confidence as Confidence)
        ? (p.confidence as Confidence)
        : 'low',
      sampleLabel: typeof p.sampleLabel === 'string' ? p.sampleLabel : '',
      desc: typeof p.desc === 'string' ? p.desc : typeof p.hint === 'string' ? p.hint : undefined,
      fallbackText: p.fallbackText as string,
    }));
}

function parseCafeData(d: Row, patterns: PatternCandidate[]): CafeData {
  return {
    kpis: obj(d.kpis) ?? {},
    daily: rows(d.daily),
    best_sellers: rows(d.best_sellers),
    margins: obj(d.margins),
    bought_together: rows(d.bought_together),
    price_bands: rows(d.price_bands),
    promo: obj(d.promo),
    engagement: obj(d.engagement) ?? undefined,
    prior_insights: strings(d.prior_insights),
    rejections: strings(d.rejections),
    patterns,
    basis: parseBasis(d.basis),
    excluded_names: strings(d.excluded_names),
    compare: obj(d.compare) ?? undefined,
    coverage: obj(d.coverage) ?? undefined,
  };
}

/** Tolerant like the cafe parser: a missing block is an empty one, never a 400. */
function parseCourtsData(d: Row, patterns: PatternCandidate[]): CourtsData {
  return {
    kpis: obj(d.kpis) ?? {},
    compare: obj(d.compare) ?? undefined,
    coverage: obj(d.coverage) ?? undefined,
    basis: parseBasis(d.basis),
    per_court: rows(d.per_court),
    by_day: rows(d.by_day),
    heatmap_top: rows(d.heatmap_top),
    heatmap_bottom: rows(d.heatmap_bottom),
    demand: obj(d.demand) ?? {},
    endings: obj(d.endings) ?? {},
    guests: obj(d.guests),
    cafe: obj(d.cafe),
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

// ---------------------------------------------------------------------------
// Formatting (Latin digits both languages; IQD has no decimals)
// ---------------------------------------------------------------------------
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const fmt = (v: unknown) => Math.round(n(v)).toLocaleString('en-US');
const money = (v: unknown, lang: Lang) => (lang === 'ar' ? `${fmt(v)} د.ع` : `${fmt(v)} IQD`);
const nameOf = (r: Row, lang: Lang, prefix = 'name') =>
  String((lang === 'ar' ? r[`${prefix}_ar`] : r[`${prefix}_en`]) ?? r[`${prefix}_en`] ?? r[`${prefix}_ar`] ?? '');

const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
const EXTRA_WEEKDAYS = [
  { day: 0, name: 'الاحد' },
  { day: 1, name: 'الإثنين' },
  { day: 3, name: 'الاربعاء' },
];

// ---------------------------------------------------------------------------
// Degraded (no key) — deterministic templated sentences so the card still renders
// ---------------------------------------------------------------------------
function templatedInsights(req: Req): Insight[] {
  return req.scope === 'courts' ? templatedCourtsInsights(req) : templatedCafeInsights(req);
}

function templatedCafeInsights(req: CafeReq): Insight[] {
  const { lang, data } = req;
  const out: Insight[] = [];
  const ar = lang === 'ar';

  const best = data.best_sellers[0];
  if (best && n(best.qty) > 0) {
    const name = nameOf(best, lang);
    out.push({
      text: ar
        ? `${name} كان الأكثر مبيعاً: ${fmt(best.qty)} وحدة بإيراد ${money(best.revenue_iqd, lang)} (${n(best.share_pct)}% من الكمية المباعة).`
        : `${name} was the best seller: ${fmt(best.qty)} sold for ${money(best.revenue_iqd, lang)} (${n(best.share_pct)}% of units).`,
      kind: 'summary',
      subjects: [name],
      metrics: { qty: n(best.qty), revenue_iqd: n(best.revenue_iqd), share_pct: n(best.share_pct) },
      confidence: 'high',
    });
  }

  const costed = rows(data.margins?.items).filter((i) => i.has_cost === true && n(i.qty) > 0);
  if (costed.length) {
    const worst = costed.reduce((a, b) => (n(b.margin_pct) < n(a.margin_pct) ? b : a));
    const name = nameOf(worst, lang);
    const below = n(worst.margin_iqd) < 0;
    out.push({
      text: ar
        ? below
          ? `${name} يُباع بأقل من كلفته: هامش ${fmt(worst.margin_iqd)} د.ع على ${fmt(worst.qty)} وحدة — راجع السعر أو الكلفة.`
          : `${name} صاحب أضعف هامش بين الأصناف المُكلَّفة: ${n(worst.margin_pct)}% (${money(worst.margin_iqd, lang)} من ${money(worst.revenue_iqd, lang)}) — فكّر برفع السعر أو خفض الكلفة.`
        : below
          ? `${name} sells below cost: margin ${fmt(worst.margin_iqd)} IQD across ${fmt(worst.qty)} units — review its price or cost.`
          : `${name} has the thinnest margin among costed items: ${n(worst.margin_pct)}% (${money(worst.margin_iqd, lang)} of ${money(worst.revenue_iqd, lang)}) — consider a small price rise or a cheaper portion.`,
      kind: 'profit',
      subjects: [name],
      metrics: { margin_pct: n(worst.margin_pct), margin_iqd: n(worst.margin_iqd), qty: n(worst.qty) },
      confidence: n(worst.qty) >= 5 ? 'medium' : 'low',
    });
  }

  const pair = data.bought_together[0];
  if (pair && n(pair.both) > 0) {
    const a = nameOf(pair, lang, 'name_a');
    const b = nameOf(pair, lang, 'name_b');
    out.push({
      text: ar
        ? `${a} و${b} طُلبا معاً ${fmt(pair.both)} مرة (رفع ${n(pair.lift).toFixed(1)}×) — جرّب اقتراح أحدهما عند إضافة الآخر.`
        : `${a} and ${b} were ordered together ${fmt(pair.both)} times (lift ${n(pair.lift).toFixed(1)}×) — try suggesting one when the other is added.`,
      kind: 'structural',
      subjects: [a, b],
      metrics: { both: n(pair.both), lift: n(pair.lift), confidence_ab: n(pair.confidence_ab) },
      confidence: n(pair.both) >= 10 ? 'medium' : 'low',
    });
  }

  if (data.promo && n(data.promo.qty) > 0) {
    const p = data.promo;
    out.push({
      text: ar
        ? `الأصناف المروَّجة باعت ${fmt(p.qty)} وحدة بإيراد ${money(p.revenue_iqd, lang)} مقابل خصومات بقيمة ${money(p.discount_iqd, lang)} في ${fmt(p.orders)} طلب.`
        : `Promoted items sold ${fmt(p.qty)} units for ${money(p.revenue_iqd, lang)}, giving away ${money(p.discount_iqd, lang)} in discounts across ${fmt(p.orders)} orders.`,
      kind: 'pricing',
      subjects: [],
      metrics: { qty: n(p.qty), revenue_iqd: n(p.revenue_iqd), discount_iqd: n(p.discount_iqd), orders: n(p.orders) },
      confidence: 'medium',
    });
  }

  const busiest = data.daily.filter((d) => n(d.revenue_iqd) > 0)
    .reduce<Row | null>((a, b) => (!a || n(b.revenue_iqd) > n(a.revenue_iqd) ? b : a), null);
  if (busiest) {
    const date = String(busiest.business_date ?? '');
    out.push({
      text: ar
        ? `أعلى يوم مبيعاً كان ${date}: ${money(busiest.revenue_iqd, lang)} عبر ${fmt(busiest.orders)} طلب.`
        : `Busiest day was ${date}: ${money(busiest.revenue_iqd, lang)} across ${fmt(busiest.orders)} orders.`,
      kind: 'movement',
      subjects: [date],
      metrics: { revenue_iqd: n(busiest.revenue_iqd), orders: n(busiest.orders) },
      confidence: 'high',
    });
  }
  return out;
}

// Courts rows carry display names only; `name` is the contract, name_en/name_ar the fallback.
const courtName = (r: Row, lang: Lang) => (typeof r.name === 'string' && r.name) || nameOf(r, lang);
const hourLabel = (h: unknown) => `${String(Math.round(n(h))).padStart(2, '0')}:00`;
const weekdayLabel = (day: unknown, lang: Lang) => WEEKDAYS[lang][n(day)] ?? String(day ?? '');
const slotLabel = (cell: Row, lang: Lang) => `${weekdayLabel(cell.weekday ?? cell.dow, lang)} ${hourLabel(cell.hour)}`;

/** An endings segment however the client labelled it: a ready label, a court name, or a dimension + key. */
function segmentLabel(seg: Row, lang: Lang): string {
  if (typeof seg.label === 'string' && seg.label) return seg.label;
  const named = courtName(seg, lang);
  if (named) return named;
  const dim = String(seg.dim ?? seg.dimension ?? '');
  if (dim === 'dow' || dim === 'weekday') return weekdayLabel(seg.key, lang);
  if (dim === 'hour') return hourLabel(seg.key);
  return String(seg.key ?? '');
}
const segmentRate = (seg: Row) =>
  seg.rate_pct != null ? n(seg.rate_pct) : n(seg.bookings_total) > 0 ? Math.round((n(seg.n) * 1000) / n(seg.bookings_total)) / 10 : 0;

function templatedCourtsInsights(req: CourtsReq): Insight[] {
  const { lang, data } = req;
  const out: Insight[] = [];
  const ar = lang === 'ar';
  const openCells = (cells: Row[]) => cells.filter((c) => n(c.open_days) > 0);

  const fullest = openCells(data.heatmap_top)
    .reduce<Row | null>((a, b) => (!a || n(b.occupancy_pct) > n(a.occupancy_pct) ? b : a), null);
  if (fullest && n(fullest.bookings) > 0) {
    const slot = slotLabel(fullest, lang);
    out.push({
      text: ar
        ? `أكثر ساعة امتلاءً كانت ${slot}: إشغال ${n(fullest.occupancy_pct)}% عبر ${fmt(fullest.open_days)} يوم مفتوح (${fmt(fullest.bookings)} حجز)؛ الطلب هنا يفوق العرض، ففكّر برفع سعر هذه الساعة أو توجيه الحجوزات إلى الساعة المجاورة.`
        : `Fullest open hour was ${slot}: ${n(fullest.occupancy_pct)}% occupancy across ${fmt(fullest.open_days)} open days (${fmt(fullest.bookings)} bookings); demand outruns supply here, so consider pricing this hour up or steering bookings to the hour beside it.`,
      kind: 'occupancy',
      subjects: [slot],
      metrics: { occupancy_pct: n(fullest.occupancy_pct), bookings: n(fullest.bookings), open_days: n(fullest.open_days) },
      confidence: n(fullest.open_days) >= COURTS_MIN_CELL_OPEN_DAYS ? 'high' : 'low',
    });
  }

  const emptiest = openCells(data.heatmap_bottom)
    .reduce<Row | null>((a, b) => (!a || n(b.occupancy_pct) < n(a.occupancy_pct) ? b : a), null);
  if (emptiest) {
    const slot = slotLabel(emptiest, lang);
    out.push({
      text: ar
        ? `أقل ساعة إشغالاً كانت ${slot}: إشغال ${n(emptiest.occupancy_pct)}% عبر ${fmt(emptiest.open_days)} يوم مفتوح (${fmt(emptiest.bookings)} حجز)؛ سعر مخفّض خارج الذروة أو حجز ثابت أسبوعي قد يملؤها.`
        : `Emptiest open hour was ${slot}: ${n(emptiest.occupancy_pct)}% occupancy across ${fmt(emptiest.open_days)} open days (${fmt(emptiest.bookings)} bookings); a cheaper off-peak rate or a standing weekly booking would fill it.`,
      kind: 'occupancy',
      subjects: [slot],
      metrics: { occupancy_pct: n(emptiest.occupancy_pct), bookings: n(emptiest.bookings), open_days: n(emptiest.open_days) },
      confidence: n(emptiest.open_days) >= COURTS_MIN_CELL_OPEN_DAYS ? 'medium' : 'low',
    });
  }

  const canc = obj(data.endings.cancellations);
  if (canc && n(canc.total) > 0) {
    const seg = rows(canc.top_segments)[0];
    const label = seg ? segmentLabel(seg, lang) : '';
    const worst = seg && label ? { label, rate: segmentRate(seg) } : null;
    out.push({
      text: ar
        ? `أُلغي ${fmt(canc.total)} حجزاً (${n(canc.rate_pct)}% من كل الحجوزات)${worst ? `، والأسوأ في ${worst.label} بنسبة ${worst.rate}%` : ''}؛ اطلب تأكيداً قبل يوم من الموعد حيث تتكرر الإلغاءات.`
        : `${fmt(canc.total)} bookings were cancelled (${n(canc.rate_pct)}% of all bookings)${worst ? `, worst in ${worst.label} at ${worst.rate}%` : ''}; ask for a confirmation the day before where it clusters.`,
      kind: 'reliability',
      subjects: worst ? [worst.label] : [],
      metrics: { cancellations: n(canc.total), rate_pct: n(canc.rate_pct), ...(worst ? { segment_rate_pct: worst.rate } : {}) },
      confidence: n(canc.total) >= COURTS_MIN_RATE_DENOM ? 'medium' : 'low',
    });
  }

  const cafe = data.cafe;
  const attachCourts = cafe
    ? rows(cafe.per_court).filter((c) => c.attach_pct != null && n(c.live_bookings ?? c.bookings) > 0 && courtName(c, lang))
    : [];
  if (cafe && cafe.attach_pct != null && attachCourts.length) {
    const lowest = attachCourts.reduce((a, b) => (n(b.attach_pct) < n(a.attach_pct) ? b : a));
    const name = courtName(lowest, lang);
    out.push({
      text: ar
        ? `نسبة ربط الكافيه بالحجوزات ${n(cafe.attach_pct)}%، والأدنى في ${name} بنسبة ${n(lowest.attach_pct)}%؛ فتح حساب كافيه عند الوصول لحجوزات هذا الملعب هو أرخص طريقة لرفعها.`
        : `Cafe attach is ${n(cafe.attach_pct)}% of bookings, lowest on ${name} at ${n(lowest.attach_pct)}%; opening a cafe tab at check-in for that court's bookings is the cheapest lift.`,
      kind: 'attach',
      subjects: [name],
      metrics: { attach_pct: n(cafe.attach_pct), court_attach_pct: n(lowest.attach_pct) },
      confidence: n(lowest.live_bookings ?? lowest.bookings) >= COURTS_MIN_ATTACH_BOOKINGS ? 'medium' : 'low',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Post-model gates
// ---------------------------------------------------------------------------
function gate(items: Insight[], req: Req, cap = MAX_FINDINGS): Insight[] {
  const byText = new Map<string, Insight>();
  for (const it of items) {
    const key = normalizeFinding(it.text);
    if (key && !byText.has(key)) byText.set(key, it);
  }
  let texts = [...byText.values()].map((i) => i.text).filter(isStrongFinding);
  texts = dropRejectedFindings(texts, rejectionKeys(req.data.rejections)).kept;
  if (req.data.basis) {
    texts = dropLowConfidenceClaims(texts, req.data.basis, WEEKDAYS, { extraWeekdayNames: EXTRA_WEEKDAYS }).kept;
  }
  texts = dropExcludedMentions(texts, req.data.excluded_names);
  return rankFindings(texts, cap).map((t) => byText.get(normalizeFinding(t))!);
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
    // SEC-29 (0079): the bill is denominated in these and they were being
    // thrown away. Accumulated per request and flushed once at the end, so a
    // spend cap has something real to measure.
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

function toInsight(raw: unknown, fallbackKind: Kind): Insight | null {
  if (typeof raw === 'string') {
    return { text: raw.trim(), kind: fallbackKind, subjects: [], metrics: {}, confidence: 'medium' };
  }
  const r = obj(raw);
  if (!r || typeof r.text !== 'string') return null;
  const kind = (KINDS as readonly string[]).includes(String(r.kind)) ? (r.kind as Kind) : fallbackKind;
  const confidence = (['high', 'medium', 'low'] as const).includes(r.confidence as Confidence)
    ? (r.confidence as Confidence)
    : 'medium';
  const metrics: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(obj(r.metrics) ?? {})) {
    if (typeof v === 'number' || typeof v === 'string') metrics[k] = v;
  }
  return { text: r.text.trim(), kind, subjects: strings(r.subjects).slice(0, 6), metrics, confidence };
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
 "metrics": {"<figure name>": <number>}, "confidence": "high|medium|low"}`;

const COURTS_FINDING_SHAPE = `Each finding is an object:
{"text": "<one sentence for the owner>", "kind": "occupancy|reliability|demand|attach|movement",
 "subjects": ["<court names, weekdays or hours the finding is about>"],
 "metrics": {"<figure name>": <number>}, "confidence": "high|medium|low"}`;

const findingShape = (scope: Scope) => (scope === 'courts' ? COURTS_FINDING_SHAPE : CAFE_FINDING_SHAPE);

function languageRules(lang: Lang): string {
  return lang === 'ar'
    ? `WRITE THE "text" OF EVERY FINDING IN ARABIC — plain Modern Standard Arabic a cafe owner in Iraq reads
naturally, no dialect slang, no English words except item names as given. Use LATIN digits (0-9) for every
number, never Arabic-Indic digits. Write amounts as "12,500 د.ع" (number, space, د.ع). Keep item names exactly
as their name_ar in the data (fall back to name_en when name_ar is missing).`
    : `WRITE THE "text" OF EVERY FINDING IN ENGLISH. Use Latin digits and write amounts as "12,500 IQD".
Keep item names exactly as their name_en in the data.`;
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
  cancellations, no_shows, booked_total, cancellation_rate_pct, no_show_rate_pct, mobile_bookings, desk_bookings,
  holds_expired, booking_days, courts_count), and "compare": the same figures for the comparison window (basis
  "${req.compare_basis}": prev = the period before this one, 4w = four weeks earlier, 52w = the same period last
  year). NAME that window in any period-over-period sentence; calling it the wrong thing makes the finding false.
- "per_court": per court: bookings, occupancy_pct, revenue_iqd, rev_per_open_hour_iqd, cancellations, no_shows,
  attach_pct, cafe_per_linked_iqd.
- "by_day": per business day: bookings, revenue_iqd, cancellations, no_shows.
- "heatmap_top" / "heatmap_bottom": the fullest and the emptiest weekday-by-hour cells of OPEN time: weekday
  (0 = Sunday), hour, occupancy_pct, bookings, open_days (how many such days were open in the range).
- "demand": durations (bookings per slot length), lead_time (how far ahead people book), sources (app versus
  desk), hold_funnel (app holds placed, expired, converted), players (group size where recorded), series
  (standing weekly bookings).
- "endings": cancellations (total, rate_pct, by_notice = how long before the slot, by_actor = who cancelled,
  top_segments = where cancellations cluster) and no_shows (total, rate_pct, top_segments).
- "guests" (may be null): identities, returning_pct, visit_buckets, regulars, lapsing_regulars,
  regulars_bookings_pct. Counts only; there are no people in this data.
- "cafe" (null when nothing is linked): attach_pct, cafe_per_booking_iqd, per_court, top_items_per_court,
  order_timing (before, during or after the slot), value_per_court_hour (court plus linked cafe revenue per open
  hour).
- "coverage": how much of the period has booking data. Below 0.9 the totals are INCOMPLETE; missing days, not
  lost business, so never call a gap a decline.
- "basis": salesDays (days with bookings) and weekdayCounts.

DEFINITIONS, use them exactly:
- A LIVE booking is confirmed, arrived or completed. booked_total = live + cancelled + no-show;
  cancellation_rate_pct and no_show_rate_pct are shares of booked_total.
- occupancy_pct = booked minutes over open minutes. Opening hours are venue-wide: every court is open the same
  hours, so a court with low occupancy is a court guests did not pick, not a court that was closed.
- ATTACH = the share of live bookings with a till-linked cafe tab. QR orders from the phone never link to a
  booking, so a low attach means "not linked", never "did not order".
- lead_time excludes standing (series) bookings; they are booked once and repeat.
- players = null means the group size was not recorded, never that nobody played.

SAMPLE SIZE IS A HARD GATE. Never make a weekday claim unless that weekday appears at least ${MIN_WEEKDAY_DAYS}
times in basis.weekdayCounts. Never build a finding on a heat cell with fewer than ${COURTS_MIN_CELL_OPEN_DAYS}
open days, on a rate whose denominator is under ${COURTS_MIN_RATE_DENOM} bookings, or on a court's attach with
fewer than ${COURTS_MIN_ATTACH_BOOKINGS} bookings. When basis.salesDays is under ${MIN_TREND_DAYS}, describe no
trend, rise or fall at all. When a finding rests on a subset of the period, state the sample inside the sentence.
Dropping a thin finding costs nothing; publishing one costs the owner's trust.

Every finding must cite a specific number from the data AND carry a concrete action; never just restate a
number. ATTACH THE MONEY: end every finding with what acting on it is roughly worth per month in IQD, scaled to
30 days from the range length and priced from the venue's own figures (revenue_iqd over booked_minutes, or a
court's rev_per_open_hour_iqd); say "approximately" / "تقريباً". A finding with no amount is dropped. NEVER
FORECAST: describe what happened in the range, never what will happen. NEVER NAME A PERSON: guests appear only
as counts, and no name, phone number or identifier of any kind may appear in a finding.

WRITE FOR A VENUE OWNER, NOT AN ANALYST. Never name the internal fields ("heatmap_top", "endings", "kpis"…).
Do NOT restate what the dashboard already shows (occupancy per court, the busiest hour, the totals). Each finding
must expose a TENSION the owner would not catch from the boards: an open hour that sits empty while the same
hour on another day is full, a court that lags the others in the same hours, late cancellations that free hours
nobody rebooks, app holds that expire without converting, a segment that no-shows far above the base rate, a
court whose bookings rarely link a cafe tab, a reversal versus the comparison window. If many courts or slots
share a problem, that is ONE finding about the group with combined money.

${courtsLanguageRules(req.lang)}

${findingShape(req.scope)}`;
}

function cafeDataContext(req: CafeReq): string {
  return `You are a menu analytics advisor for a cafe with a QR-code digital menu (guests order from their
phone at the table; there is no online payment — they pay at the desk). Currency is Iraqi dinar (IQD), integer
amounts, no decimals. You receive, for the date range ${req.range_from}..${req.range_to}:
- "kpis": headline totals, and "compare": the same figures for the comparison window (basis "${req.compare_basis}":
  prev = the period before this one, 4w = four weeks earlier, 52w = the same period last year). NAME that window
  in any period-over-period sentence; calling it the wrong thing makes the finding false.
- "daily": per business day — revenue_iqd (money actually paid, net of refunds), orders, items_qty, tabs_settled,
  discount_iqd, waiter calls where present.
- "best_sellers": per item — qty, revenue_iqd, share_pct, orders.
- "margins": per item — cost_iqd, margin_iqd, margin_pct, has_cost, plus "coverage" (share of revenue whose
  items have a cost entered). PROFIT IS THE LANGUAGE, NOT REVENUE: a popular low-margin item ("يبيع كثيراً لكن لا
  يربح" / "sells a lot but earns little") is where the money usually is; an item with a negative margin_iqd is
  sold below cost — always worth a finding. When coverage.revenue_with_cost_pct is low, a profit finding speaks
  ONLY for the costed items — say so. When "margins" is null or every has_cost is false: never mention cost,
  margin or profit, and never estimate them.
- "bought_together": item pairs — both (co-occurrences), lift, confidence_ab/ba.
- "price_bands": units and revenue per list-price band.
- "promo": what the featured/discounted items sold and the discount given away (discount_iqd).
- "engagement" (may be absent — PostHog not configured): item views, adds to basket, abandoned views bucketed by
  dwell (5-10 s: photo/appeal weak; 10-20 s: description not convincing; 20 s+: read everything and still did not
  order — content or price), funnel, sessions. Sales are the ground truth for demand; a views→sale ratio above
  100% means guests order WITHOUT opening the page (an exposure problem, never a success).
- "coverage": how much of the period has sales data. Below 0.9 the totals are INCOMPLETE — missing days, not lost
  business — so never call a gap a decline.
- "basis": salesDays and weekdayCounts.

SAMPLE SIZE IS A HARD GATE. Never make a weekday claim unless that weekday appears at least ${MIN_WEEKDAY_DAYS}
times in basis.weekdayCounts. Never build a finding on fewer than 5 sold units or 5 views. When basis.salesDays
is under ${MIN_TREND_DAYS}, describe no trend, rise or fall at all. When a finding rests on a subset of the period,
state the sample inside the sentence. Dropping a thin finding costs nothing; publishing one costs the owner's trust.

Every finding must cite a specific number from the data AND carry a concrete action — never just restate a
number. ATTACH THE MONEY: end every finding with what acting on it is roughly worth per month in IQD, scaled to
30 days from the range length; say "approximately" / "تقريباً". A finding with no amount is dropped.

WRITE FOR A CAFE OWNER, NOT AN ANALYST. Never name the internal fields ("best_sellers", "price_bands", "kpis"…).
Do NOT restate what the dashboard already shows (rankings, best sellers, most viewed). Each finding must expose a
TENSION the owner would not catch from the tables: viewed a lot but rarely sold, a band that barely converts, a
dwell-time signal, a reversal versus the comparison window, a discount not moving sales, a popular item beaten on
profit by a quieter one. If many items share a problem, that is ONE finding about the group with combined money.

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
attention but sells poorly and what that costs per month; a band that quietly outperforms; whether the promo
discount actually moves sales — a discount that does not is margin given away for nothing, say so with the amount.`,
  },
  {
    id: 'movement',
    focus: `THIS PASS: CHANGE OVER TIME ONLY ("kpis" vs "compare", "daily", "prior_insights"). Name the comparison
window exactly. Find a headline figure that moved materially and what it is worth per month; a REVERSAL where two
figures moved in opposite directions; follow-ups on prior_insights — did earlier advice land? Respect coverage and
the trend gate.`,
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
slots where demand is being turned away, a court that lags the others in the same hours, and the weekday shape;
price each at the venue's own rate per month. A cell with fewer than ${COURTS_MIN_CELL_OPEN_DAYS} open days is
not evidence. If both heatmaps are empty, return {"findings":[]}; never estimate occupancy.`,
  },
  {
    id: 'reliability',
    focus: `THIS PASS: CANCELLATIONS AND NO-SHOWS ONLY ("endings", "per_court"). Read the notice buckets (a late
cancellation frees hours nobody rebooks), who cancels (guest versus desk), and the segments that cancel or
no-show far above the base rate; put a monthly IQD figure on the court hours freed too late to resell. A rate on
fewer than ${COURTS_MIN_RATE_DENOM} bookings is not evidence. If "endings" is absent or empty, return
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
gap between the best and the worst court is the money. Attach on fewer than ${COURTS_MIN_ATTACH_BOOKINGS}
bookings is not evidence, and QR orders never link, so never call a low attach "nobody ordered". If "cafe" is
null, return {"findings":[]}; never estimate cafe spend.`,
  },
  {
    id: 'movement',
    focus: `THIS PASS: CHANGE OVER TIME ONLY ("kpis" vs "compare", "by_day", "prior_insights"). Name the comparison
window exactly. Find a headline figure that moved materially and what it is worth per month; a REVERSAL where two
figures moved in opposite directions (more bookings but less revenue per open hour, fewer cancellations but more
no-shows); follow-ups on prior_insights: did earlier advice land? Respect coverage and the trend gate; describe
what happened, never what will happen. If "compare" is null, return {"findings":[]}.`,
  },
];

const scanAngles = (scope: Scope): ScanAngle[] => (scope === 'courts' ? COURTS_SCAN_ANGLES : CAFE_SCAN_ANGLES);

function generateSystem(req: Req, angle: ScanAngle): string {
  return `${dataContext(req)}

Return AT MOST ${MAX_FINDINGS} findings ordered by money at stake, biggest first. Fewer is fine; two sharp
findings beat eight padded ones. The user message includes "already_found": findings from earlier passes — do
NOT repeat or rephrase any of them. DIG: cross two tables against each other before you emit anything.

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
Hold "ongoing" and "added" to the full strength bar (sample, material number, action, IQD per month). "ongoing"
plus "added" must not exceed ${MAX_FINDINGS}.
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
lift, weekday over-indexing, a locale skew, a cost-based margin movement). The numbers are ground truth — never
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

// Emptied rather than deleted: a present-but-empty key says "exists, not this
// pass's subject"; a missing key would invite the model to invent it.
function trimTo(base: Row, want: string[]): Row {
  const keep = new Set(['range', 'compare_basis', 'lang', 'kpis', 'coverage', 'basis', ...want]);
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
    prior_insights: d.prior_insights.slice(0, MAX_FINDINGS),
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
    margins: d.margins
      ? { ...d.margins, items: rows(d.margins.items).slice(0, MAX_ITEM_ROWS) }
      : null,
    bought_together: d.bought_together.slice(0, MAX_SECONDARY_ROWS),
    price_bands: d.price_bands,
    promo: d.promo,
    engagement: d.engagement ?? null,
    prior_insights: d.prior_insights.slice(0, MAX_FINDINGS),
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
async function runScan(req: Req, alreadyFound: string[], deadline: number): Promise<Insight[]> {
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

async function modeInsights(req: Req, deadline: number) {
  const alreadyFound = req.mode === 'replace_rejected' ? req.data.prior_insights : [];
  const found = await runScan(req, alreadyFound, deadline);
  return { insights: gate(found, req).map((i) => ({ ...i, status: 'new' as const })) };
}

async function modeRevalidate(req: Req, deadline: number) {
  const content = await chat(
    revalidateSystem(req),
    JSON.stringify({ ...payload(req), existing: req.data.prior_insights }),
    MODEL,
    deadline,
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
  return req.data.patterns
    .filter((p) => isStrongFinding(p.fallbackText) && !banned.has(normalizeFinding(p.fallbackText)))
    .map((p) => ({ ...p, text: p.fallbackText }));
}

async function modePatterns(req: Req, deadline: number): Promise<{ patterns: JudgedPattern[]; degraded: boolean }> {
  if (!req.data.patterns.length) return { patterns: [], degraded: false };
  const candidates = req.data.patterns.map(({ fallbackText: _f, ...c }) => c);
  const content = await chat(judgeSystem(req.lang, req.scope), JSON.stringify({ candidates }), JUDGE_MODEL, deadline);
  const parsed = obj(parseJson(content));
  const keptRaw = Array.isArray(parsed?.kept) ? (parsed!.kept as unknown[]) : [];
  const byId = new Map(req.data.patterns.map((p) => [p.id, p]));
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
    out.push({ ...cand, text });
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
        parsed.data.prior_insights.map((text) => toInsight(text, 'summary')!),
        parsed,
      ).map((i) => ({ ...i, status: 'ongoing' as const }));
      return json({ degraded: true, model: null, insights: prior, resolved: [] });
    }
    if (parsed.mode === 'replace_rejected') {
      const known = new Set(parsed.data.prior_insights.map(normalizeFinding));
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
  tally.calls = 0;
  tally.prompt = 0;
  tally.completion = 0;
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
        const r = await modePatterns(parsed, deadline);
        return json({ degraded: false, model: JUDGE_MODEL, insights: [], patterns: r.patterns });
      }
      case 'revalidate': {
        const r = await modeRevalidate(parsed, deadline);
        return json({ degraded: false, model: MODEL, ...r });
      }
      default: {
        const r = await modeInsights(parsed, deadline);
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

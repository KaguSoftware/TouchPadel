/**
 * analytics-posthog — owner-only BATCH proxy over PostHog's HogQL query API
 * (db-slice.md Wave 4; contract in the reconciled plan §1.2). The operator
 * never sends HogQL: it names one of the templates below and this function
 * builds the query, so the personal API key never leaves the edge.
 *
 * Request  POST {queries:[{name, from:'YYYY-MM-DD', to:'YYYY-MM-DD', params?:{limit?}}],
 *                business_day_start_hour?: 0..12 (default 4)}
 * Response 200 {configured:boolean, floor:string|null,
 *               results:{[name]:{columns:string[], rows:unknown[][], error?:string}}}
 *
 *  - No POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID → {configured:false, floor:null, results:{}}
 *    (200 — the dashboard renders its not-configured notice; nothing throws).
 *  - Business day: every date bucket and range bound uses the venue wall clock
 *    (Asia/Baghdad) shifted back by `business_day_start_hour`, so a 01:30 view
 *    belongs to the previous evening. Hour-of-day buckets use the real clock.
 *  - POSTHOG_ENGAGEMENT_FLOOR (YYYY-MM-DD) clips `from` — events before it are
 *    unreliable; a window entirely before the floor yields empty rows without a
 *    round-trip. The floor is echoed so the client can label clipped windows.
 *  - Queries run sequentially (PostHog rate-limits per project), each behind a
 *    30 s in-memory cache keyed (name, from, to, h, params); 3 attempts on
 *    5xx/network with backoff; a failed query is reported per-name as
 *    {columns:[], rows:[], error} and never fails the batch.
 *
 * Event/property names are the guest app's (web-slice.md §5): item_viewed
 * {item_id,item_name,category_id,price_iqd,discount_pct}, item_view_abandoned
 * {dwell_ms}, item_added_to_basket {qty}, category_selected {category_id,
 * category_name_en}, basket_opened, featured_item_clicked, suggested_item_clicked
 * {item_id}, waiter_called, order_submitted, $pageview; super-properties
 * locale / has_table / table_number.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import { requireStaffRole } from '../_shared/auth.ts';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const HOST = (Deno.env.get('POSTHOG_HOST') ?? 'https://eu.posthog.com').replace(/\/$/, '');
const PROJECT_ID = Deno.env.get('POSTHOG_PROJECT_ID') ?? '';
const API_KEY = Deno.env.get('POSTHOG_PERSONAL_API_KEY') ?? '';
const FLOOR = Deno.env.get('POSTHOG_ENGAGEMENT_FLOOR') || null;

const TZ = 'Asia/Baghdad';
const CACHE_TTL_MS = 30_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 250;
const MAX_QUERIES = 32;
const MAX_SPAN_DAYS = 400;
const DEFAULT_START_HOUR = 4; // cafe_settings.analytics_business_day_start_hour default (0029)
/** Fixed pool for "top N" templates so the cache dedupes callers asking different limits. */
const TOP_POOL = 200;
/** A visit is one device's activity separated from its next by more than this. */
const VISIT_GAP_SECONDS = 2 * 60 * 60;

const configured = () => Boolean(PROJECT_ID && API_KEY);

// ---------------------------------------------------------------------------
// Query templates
// ---------------------------------------------------------------------------
type Params = { limit?: number };

interface Ctx {
  from: string;
  to: string;
  h: number;
  params: Params;
  /** Venue wall clock for the row. */
  clock: string;
  /** Wall clock shifted back by h hours — every DATE bucket and range bound uses this. */
  biz: string;
  /** Range predicate (business-day shifted). */
  inRange: string;
  /** `inRange` + session must have carried a table number at some point (seated diners). */
  seated: string;
}

interface Template {
  columns: string[];
  /** One or more HogQL statements; `merge` combines their raw results (default: first). */
  sql: (c: Ctx) => string[];
  merge?: (results: unknown[][][], c: Ctx) => unknown[][];
}

const bizDate = (c: Ctx) => `toDate(${c.biz})`;
const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const TEMPLATES: Record<string, Template> = {
  ping: {
    columns: ['ok'],
    sql: () => [`SELECT 1 AS ok`],
  },

  daily_engagement: {
    columns: ['business_date', 'pageviews', 'views', 'carts', 'sessions', 'waiter_calls', 'orders'],
    sql: (c) => [`
      SELECT ${bizDate(c)} AS d,
             countIf(event = '$pageview') AS pageviews,
             countIf(event = 'item_viewed') AS views,
             countIf(event = 'item_added_to_basket') AS carts,
             count(DISTINCT $session_id) AS sessions,
             countIf(event = 'waiter_called') AS waiter_calls,
             countIf(event = 'order_submitted') AS orders
      FROM events
      WHERE ${c.inRange}
      GROUP BY d ORDER BY d`],
  },

  // Distinct-session views measure "how many diners looked" (a curious diner
  // reopening a modal cannot inflate it); raw views are kept as context.
  top_viewed_items: {
    columns: ['item_id', 'item_name', 'sessions', 'views'],
    sql: (c) => [`
      SELECT properties.item_id AS id, any(properties.item_name) AS name,
             count(DISTINCT $session_id) AS sessions, count() AS views
      FROM events
      WHERE event = 'item_viewed' AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY id ORDER BY sessions DESC, views DESC LIMIT ${TOP_POOL}`],
    merge: (r, c) => r[0].slice(0, c.params.limit ?? TOP_POOL),
  },

  top_carted_items: {
    columns: ['item_id', 'item_name', 'sessions', 'adds', 'qty'],
    sql: (c) => [`
      SELECT properties.item_id AS id, any(properties.item_name) AS name,
             count(DISTINCT $session_id) AS sessions, count() AS adds,
             sum(toInt(coalesce(properties.qty, '1'))) AS qty
      FROM events
      WHERE event = 'item_added_to_basket' AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY id ORDER BY sessions DESC, adds DESC LIMIT ${TOP_POOL}`],
    merge: (r, c) => r[0].slice(0, c.params.limit ?? TOP_POOL),
  },

  // "Looked but didn't add", per item PER business day, bucketed by dwell:
  // 5–10 s (photo/appeal), 10–20 s (description), 20 s+ (content or price).
  // Day grain lets the operator suppress (item, day) pairs the item sold on.
  abandoned_by_dwell: {
    columns: ['item_id', 'item_name', 'business_date', 'b5_10', 'b10_20', 'b20_plus', 'total'],
    sql: (c) => [`
      SELECT properties.item_id AS id, any(properties.item_name) AS name, ${bizDate(c)} AS d,
             countIf(toFloat(properties.dwell_ms) < 10000) AS b1,
             countIf(toFloat(properties.dwell_ms) >= 10000 AND toFloat(properties.dwell_ms) < 20000) AS b2,
             countIf(toFloat(properties.dwell_ms) >= 20000) AS b3,
             count() AS total
      FROM events
      WHERE event = 'item_view_abandoned' AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY id, d ORDER BY d, total DESC`],
  },

  // Session funnel: each step counts sessions that reached it AND every earlier one.
  funnel: {
    columns: ['step', 'sessions'],
    sql: (c) => [`
      SELECT countIf(has(e, '$pageview')) AS s1,
             countIf(has(e, '$pageview') AND has(e, 'item_viewed')) AS s2,
             countIf(has(e, '$pageview') AND has(e, 'item_viewed') AND has(e, 'item_added_to_basket')) AS s3,
             countIf(has(e, '$pageview') AND has(e, 'item_viewed') AND has(e, 'item_added_to_basket')
                     AND has(e, 'order_submitted')) AS s4
      FROM (
        SELECT $session_id AS sid, groupArray(event) AS e
        FROM events
        WHERE ${c.inRange}
          AND event IN ('$pageview', 'item_viewed', 'item_added_to_basket', 'order_submitted')
        GROUP BY sid
      )`],
    merge: (r) => {
      const row = r[0][0] ?? [];
      return [
        ['pageview', num(row[0])],
        ['item_viewed', num(row[1])],
        ['item_added_to_basket', num(row[2])],
        ['order_submitted', num(row[3])],
      ];
    },
  },

  // Of the sessions that opened the basket, how many called a waiter or submitted an order.
  basket_to_call: {
    columns: ['baskets', 'called', 'ordered', 'converted', 'pct'],
    sql: (c) => [`
      SELECT countIf(has(e, 'basket_opened')) AS baskets,
             countIf(has(e, 'basket_opened') AND has(e, 'waiter_called')) AS called,
             countIf(has(e, 'basket_opened') AND has(e, 'order_submitted')) AS ordered,
             countIf(has(e, 'basket_opened') AND (has(e, 'waiter_called') OR has(e, 'order_submitted'))) AS conv
      FROM (
        SELECT $session_id AS sid, groupArray(event) AS e
        FROM events
        WHERE ${c.inRange} AND event IN ('basket_opened', 'waiter_called', 'order_submitted')
        GROUP BY sid
      )`],
    merge: (r) => {
      const row = r[0][0] ?? [];
      const baskets = num(row[0]);
      const conv = num(row[3]);
      return [[baskets, num(row[1]), num(row[2]), conv, baskets > 0 ? Math.round((conv / baskets) * 100) : 0]];
    },
  },

  locale_split: {
    columns: ['locale', 'events', 'sessions'],
    sql: (c) => [`
      SELECT properties.locale AS loc, count() AS events, count(DISTINCT $session_id) AS sessions
      FROM events
      WHERE ${c.inRange} AND isNotNull(loc) AND loc != ''
      GROUP BY loc ORDER BY events DESC`],
  },

  // Table activity from the session-level table_number super-property.
  table_activity: {
    columns: ['table_number', 'sessions', 'views', 'waiter_calls', 'orders'],
    sql: (c) => [`
      SELECT properties.table_number AS t,
             count(DISTINCT $session_id) AS sessions,
             countIf(event = 'item_viewed') AS views,
             countIf(event = 'waiter_called') AS calls,
             countIf(event = 'order_submitted') AS orders
      FROM events
      WHERE ${c.inRange} AND isNotNull(t) AND t != ''
      GROUP BY t ORDER BY sessions DESC LIMIT ${TOP_POOL}`],
    merge: (r, c) => r[0].slice(0, c.params.limit ?? 30),
  },

  // dow is the BUSINESS day's weekday, 0 = Sunday (matches app.analytics_hourly);
  // hour is the real venue clock hour.
  week_heatmap: {
    columns: ['dow', 'hour', 'views', 'sessions'],
    sql: (c) => [`
      SELECT modulo(toDayOfWeek(${c.biz}), 7) AS dow, toHour(${c.clock}) AS h,
             count() AS views, count(DISTINCT $session_id) AS sessions
      FROM events
      WHERE event = 'item_viewed' AND ${c.inRange}
      GROUP BY dow, h ORDER BY dow, h`],
  },

  peak_hours: {
    columns: ['hour', 'views', 'sessions'],
    sql: (c) => [`
      SELECT toHour(${c.clock}) AS h, count() AS views, count(DISTINCT $session_id) AS sessions
      FROM events
      WHERE event = 'item_viewed' AND ${c.inRange}
      GROUP BY h ORDER BY h`],
    merge: (r) => {
      const by = new Map(r[0].map((row) => [num(row[0]), row]));
      return Array.from({ length: 24 }, (_, h) => {
        const row = by.get(h);
        return [h, row ? num(row[1]) : 0, row ? num(row[2]) : 0];
      });
    },
  },

  // Featured banner + suggested rail: clicks, distinct sessions, and how many of
  // those sessions went on to add / order. One row per surface.
  promo_engagement: {
    columns: ['kind', 'clicks', 'sessions', 'sessions_added', 'sessions_ordered', 'top_item_ids'],
    sql: (c) => [
      `
      SELECT sum(arrayCount(x -> x = 'featured_item_clicked', e)) AS f_clicks,
             countIf(has(e, 'featured_item_clicked')) AS f_sess,
             countIf(has(e, 'featured_item_clicked') AND has(e, 'item_added_to_basket')) AS f_add,
             countIf(has(e, 'featured_item_clicked') AND has(e, 'order_submitted')) AS f_ord,
             sum(arrayCount(x -> x = 'suggested_item_clicked', e)) AS s_clicks,
             countIf(has(e, 'suggested_item_clicked')) AS s_sess,
             countIf(has(e, 'suggested_item_clicked') AND has(e, 'item_added_to_basket')) AS s_add,
             countIf(has(e, 'suggested_item_clicked') AND has(e, 'order_submitted')) AS s_ord
      FROM (
        SELECT $session_id AS sid, groupArray(event) AS e
        FROM events
        WHERE ${c.inRange}
          AND event IN ('featured_item_clicked', 'suggested_item_clicked', 'item_added_to_basket', 'order_submitted')
        GROUP BY sid
      )`,
      `
      SELECT event, properties.item_id AS id, count() AS clicks
      FROM events
      WHERE event IN ('featured_item_clicked', 'suggested_item_clicked') AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY event, id ORDER BY clicks DESC LIMIT 40`,
    ],
    merge: (r) => {
      const row = r[0][0] ?? [];
      const top = (ev: string) =>
        r[1].filter((x) => str(x[0]) === ev).slice(0, 8).map((x) => ({ item_id: str(x[1]), clicks: num(x[2]) }));
      return [
        ['featured', num(row[0]), num(row[1]), num(row[2]), num(row[3]), top('featured_item_clicked')],
        ['suggested', num(row[4]), num(row[5]), num(row[6]), num(row[7]), top('suggested_item_clicked')],
      ];
    },
  },

  // Distinct-session views per item with the price shown on the view — raw
  // material for the price-band conversion card.
  item_views_with_price: {
    columns: ['item_id', 'item_name', 'price_iqd', 'max_discount_pct', 'sessions', 'views'],
    sql: (c) => [`
      SELECT properties.item_id AS id, any(properties.item_name) AS name,
             median(toFloat(properties.price_iqd)) AS price,
             max(toFloat(coalesce(properties.discount_pct, '0'))) AS disc,
             count(DISTINCT $session_id) AS sessions, count() AS views
      FROM events
      WHERE event = 'item_viewed' AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY id ORDER BY sessions DESC LIMIT ${TOP_POOL}`],
    merge: (r) => r[0].map((x) => [str(x[0]), str(x[1]), Math.round(num(x[2])), num(x[3]), num(x[4]), num(x[5])]),
  },

  // visitors = distinct devices; visits = per-device activity stitched at a
  // 2-hour gap (posthog-js clamps session idle to 30 min, a meal runs longer);
  // median_seconds stays on the $session_id grain (continuous engagement).
  // All three restricted to sessions that carried a table number (seated diners).
  session_stats: {
    columns: ['visitors', 'visits', 'sessions', 'median_seconds'],
    sql: (c) => [
      `
      SELECT count() AS visitors, sum(visits) AS visits
      FROM (
        SELECT distinct_id,
               1 + arrayCount(g -> g > ${VISIT_GAP_SECONDS},
                     arrayDifference(arraySort(groupArray(toUnixTimestamp(timestamp))))) AS visits
        FROM events
        WHERE ${c.seated} AND distinct_id != ''
        GROUP BY distinct_id
      )`,
      `
      SELECT count() AS sessions, median(duration) AS med
      FROM (
        SELECT $session_id AS sid, dateDiff('second', min(timestamp), max(timestamp)) AS duration
        FROM events
        WHERE ${c.seated}
        GROUP BY sid
        HAVING count() >= 2
      )`,
    ],
    merge: (r) => {
      const a = r[0][0] ?? [];
      const b = r[1][0] ?? [];
      return [[num(a[0]), num(a[1]), num(b[0]), Math.round(num(b[1]))]];
    },
  },

  category_popularity: {
    columns: ['category_id', 'category_name_en', 'selections', 'sessions'],
    sql: (c) => [`
      SELECT properties.category_id AS id, any(properties.category_name_en) AS name,
             count() AS selections, count(DISTINCT $session_id) AS sessions
      FROM events
      WHERE event = 'category_selected' AND ${c.inRange}
        AND isNotNull(id) AND id != ''
      GROUP BY id ORDER BY selections DESC LIMIT ${TOP_POOL}`],
    merge: (r, c) => r[0].slice(0, c.params.limit ?? 30),
  },

  // Per menu language: sessions, median dwell, and that locale's most-viewed
  // items with their PENETRATION rate (share of the locale's own sessions).
  locale_preferences: {
    columns: ['locale', 'sessions', 'median_seconds', 'top_items'],
    sql: (c) => [
      `
      SELECT loc, count() AS sessions, median(duration) AS med
      FROM (
        SELECT $session_id AS sid, any(properties.locale) AS loc,
               dateDiff('second', min(timestamp), max(timestamp)) AS duration
        FROM events
        WHERE ${c.inRange}
        GROUP BY sid
        HAVING count() >= 2
      )
      WHERE isNotNull(loc) AND loc != ''
      GROUP BY loc`,
      `
      SELECT properties.locale AS loc, properties.item_id AS id, any(properties.item_name) AS name,
             count(DISTINCT $session_id) AS c
      FROM events
      WHERE event = 'item_viewed' AND ${c.inRange}
        AND isNotNull(id) AND id != '' AND isNotNull(loc) AND loc != ''
      GROUP BY loc, id ORDER BY c DESC LIMIT ${TOP_POOL}`,
    ],
    merge: (r, c) => {
      const per = c.params.limit ?? 5;
      const stats = new Map(r[0].map((x) => [str(x[0]), { sessions: num(x[1]), med: Math.round(num(x[2])) }]));
      const items = new Map<string, { item_id: string; item_name: string; sessions: number }[]>();
      for (const x of r[1]) {
        const loc = str(x[0]);
        const list = items.get(loc) ?? [];
        list.push({ item_id: str(x[1]), item_name: str(x[2]), sessions: num(x[3]) });
        items.set(loc, list);
      }
      return ['ar', 'en']
        .filter((loc) => stats.has(loc) || items.has(loc))
        .map((loc) => {
          const sessions = stats.get(loc)?.sessions ?? 0;
          const top = (items.get(loc) ?? [])
            .sort((a, b) => b.sessions - a.sessions)
            .slice(0, per)
            .map((it) => ({ ...it, rate: sessions > 0 ? Math.min(1, it.sessions / sessions) : 0 }));
          return [loc, sessions, stats.get(loc)?.med ?? 0, top];
        });
    },
  },
};

export const QUERY_NAMES = Object.keys(TEMPLATES);

// ---------------------------------------------------------------------------
// HogQL transport: retry on 5xx/network, never on 4xx; 30 s cache per (name, from, to, h, params)
// ---------------------------------------------------------------------------
type HogQLResult = { results?: unknown[][] };

class UpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function hogqlOnce(query: string): Promise<unknown[][]> {
  const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  });
  const text = await res.text();
  if (res.status >= 500) throw new UpstreamError(res.status, `posthog ${res.status}: ${text.slice(0, 200)}`);
  if (!res.ok) {
    // 4xx will not fix itself (bad query / auth / 429) — surface, don't retry.
    throw Object.assign(new Error(`posthog ${res.status}: ${text.slice(0, 200)}`), { permanent: true });
  }
  const parsed = JSON.parse(text) as HogQLResult;
  return parsed.results ?? [];
}

async function hogql(query: string): Promise<unknown[][]> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await hogqlOnce(query);
    } catch (err) {
      const permanent = Boolean((err as { permanent?: boolean }).permanent);
      if (permanent || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * attempt));
    }
  }
}

const cache = new Map<string, { at: number; result: Promise<unknown[][]> }>();

function runCached(key: string, work: () => Promise<unknown[][]>): Promise<unknown[][]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
  const result = work();
  cache.set(key, { at: Date.now(), result });
  // A failed run must not poison the cache for 30 s.
  result.catch(() => cache.delete(key));
  if (cache.size > 500) {
    for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_TTL_MS) cache.delete(k);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

interface QuerySpec {
  name: string;
  from: string;
  to: string;
  params: Params;
}

function parseBody(body: unknown): { queries: QuerySpec[]; h: number } | string {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.queries) || b.queries.length === 0) return 'queries must be a non-empty array';
  if (b.queries.length > MAX_QUERIES) return `at most ${MAX_QUERIES} queries per batch`;

  let h = DEFAULT_START_HOUR;
  if (b.business_day_start_hour !== undefined) {
    const v = b.business_day_start_hour;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 12) {
      return 'business_day_start_hour must be an integer 0..12';
    }
    h = v;
  }

  const queries: QuerySpec[] = [];
  const seen = new Set<string>();
  for (const q of b.queries as unknown[]) {
    if (!q || typeof q !== 'object') return 'each query must be an object';
    const { name, from, to, params } = q as Record<string, unknown>;
    if (typeof name !== 'string' || !(name in TEMPLATES)) return `unknown query name '${String(name)}'`;
    if (seen.has(name)) return `duplicate query name '${name}'`;
    seen.add(name);
    if (!isIsoDate(from) || !isIsoDate(to)) return `${name}: from/to must be YYYY-MM-DD`;
    const span = dayDiff(from, to);
    if (span < 0) return `${name}: to is before from`;
    if (span > MAX_SPAN_DAYS) return `${name}: span exceeds ${MAX_SPAN_DAYS} days`;
    const p: Params = {};
    if (params !== undefined) {
      if (!params || typeof params !== 'object') return `${name}: params must be an object`;
      const { limit, ...rest } = params as Record<string, unknown>;
      if (Object.keys(rest).length) return `${name}: unknown params ${Object.keys(rest).join(',')}`;
      if (limit !== undefined) {
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) {
          return `${name}: params.limit must be an integer 1..500`;
        }
        p.limit = limit;
      }
    }
    queries.push({ name, from, to, params: p });
  }
  return { queries, h };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
function makeCtx(q: QuerySpec, h: number): Ctx {
  const clock = `toTimeZone(timestamp, '${TZ}')`;
  const biz = h === 0 ? clock : `(${clock} - interval ${h} hour)`;
  const inRange = `${biz} >= '${q.from} 00:00:00' AND ${biz} <= '${q.to} 23:59:59'`;
  const seated = `${inRange}
      AND $session_id IN (
        SELECT $session_id FROM events
        WHERE ${inRange}
          AND isNotNull(properties.table_number) AND properties.table_number != ''
        GROUP BY $session_id
      )`;
  return { from: q.from, to: q.to, h, params: q.params, clock, biz, inRange, seated };
}

type QueryResult = { columns: string[]; rows: unknown[][]; error?: string };

async function runQuery(q: QuerySpec, h: number): Promise<QueryResult> {
  const t = TEMPLATES[q.name];
  // Clip to the engagement floor; a window entirely before it has no data.
  const from = FLOOR && q.from < FLOOR ? FLOOR : q.from;
  if (from > q.to) return { columns: t.columns, rows: [] };
  const ctx = makeCtx({ ...q, from }, h);
  const key = `${q.name}|${from}|${q.to}|${h}|${JSON.stringify(q.params)}`;
  try {
    const rows = await runCached(key, async () => {
      const raw: unknown[][][] = [];
      for (const sql of t.sql(ctx)) raw.push(await hogql(sql));
      return t.merge ? t.merge(raw, ctx) : raw[0];
    });
    return { columns: t.columns, rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[analytics-posthog] ${q.name} failed:`, message);
    return { columns: [], rows: [], error: message };
  }
}

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

  if (!configured()) return json({ configured: false, floor: null, results: {} });

  // Sequential on purpose: PostHog rate-limits the query API per project, and
  // the 30 s cache means a dashboard refresh mostly hits memory anyway.
  const results: Record<string, QueryResult> = {};
  for (const q of parsed.queries) results[q.name] = await runQuery(q, parsed.h);

  return json({ configured: true, floor: FLOOR, results });
});

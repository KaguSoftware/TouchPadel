/**
 * Monitoring page logic (/monitoring, 0393): the filters as RPC arguments, the
 * server's answers read defensively, and the small judgements the page makes
 * (which tone a level gets, how tall a bar is). Pure, node-tested.
 */
import type { MonitorLevel, MonitorSource } from '@touch/core/monitoring';

export type Period = '24h' | '7d' | '30d' | '90d';
export const PERIODS: readonly Period[] = ['24h', '7d', '30d', '90d'];
export const SOURCES: readonly MonitorSource[] = ['operator', 'mobile', 'web', 'edge', 'db', 'cron'];
export const LEVELS: readonly MonitorLevel[] = ['error', 'warn', 'info'];

/** The page refreshes this often while it is open. */
export const REFRESH_MS = 60_000;
export const PAGE_SIZE = 50;

const PERIOD_MS: Record<Period, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  '90d': 90 * 24 * 3600_000,
};

export interface Filters {
  period: Period;
  source: MonitorSource | 'all';
  level: MonitorLevel | 'all';
  kind: string | 'all';
  userReported: boolean;
}

export const DEFAULT_FILTERS: Filters = { period: '24h', source: 'all', level: 'all', kind: 'all', userReported: false };

/** Hours for a day or less, days beyond. */
export function bucketFor(period: Period): 'hour' | 'day' {
  return period === '24h' ? 'hour' : 'day';
}

export function rangeFor(period: Period, now: Date): { from: string; to: string } {
  return { from: new Date(now.getTime() - PERIOD_MS[period]).toISOString(), to: now.toISOString() };
}

/** The filter arguments both RPCs share (a filter left on "all" is sent as null). */
export function filterArgs(f: Filters, now: Date): Record<string, unknown> {
  const { from, to } = rangeFor(f.period, now);
  return {
    p_from: from,
    p_to: to,
    p_source: f.source === 'all' ? null : f.source,
    p_level: f.level === 'all' ? null : f.level,
    p_kind: f.kind === 'all' ? null : f.kind,
    p_user_reported: f.userReported ? true : null,
  };
}

export interface MonitorEvent {
  id: number;
  at: string;
  source: MonitorSource;
  level: MonitorLevel;
  kind: string;
  message: string;
  detail: Record<string, unknown>;
  appVersion: string | null;
  venueName: string | null;
  staffName: string | null;
  signedIn: boolean;
  userReported: boolean;
}

export interface EventsPage {
  rows: MonitorEvent[];
  nextBeforeId: number | null;
}

export interface CountBucket {
  bucket: string;
  error: number;
  warn: number;
  info: number;
  total: number;
}

export interface Summary {
  bucket: 'hour' | 'day';
  counts: CountBucket[];
  kinds: { kind: string; count: number; lastAt: string | null }[];
  sources: { source: MonitorSource; count: number; lastAt: string | null }[];
  totals: { total: number; error: number; warn: number; info: number; userReported: number };
  cronCheckedAt: string | null;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function readSource(v: unknown): MonitorSource {
  return (SOURCES as readonly unknown[]).includes(v) ? (v as MonitorSource) : 'web';
}
function readLevel(v: unknown): MonitorLevel {
  return (LEVELS as readonly unknown[]).includes(v) ? (v as MonitorLevel) : 'error';
}

export function readEventsPage(raw: unknown): EventsPage {
  const o = obj(raw);
  const rows = arr(o.rows).map((r): MonitorEvent => {
    const e = obj(r);
    return {
      id: num(e.id),
      at: str(e.at) ?? new Date(0).toISOString(),
      source: readSource(e.source),
      level: readLevel(e.level),
      kind: str(e.kind) ?? 'unknown',
      message: str(e.message) ?? '',
      detail: obj(e.detail),
      appVersion: str(e.appVersion),
      venueName: str(e.venueName),
      staffName: str(e.staffName),
      signedIn: e.signedIn === true,
      userReported: e.userReported === true,
    };
  });
  const next = o.nextBeforeId;
  return { rows, nextBeforeId: typeof next === 'number' ? next : next == null ? null : num(next) || null };
}

export function readSummary(raw: unknown): Summary {
  const o = obj(raw);
  const t = obj(o.totals);
  return {
    bucket: o.bucket === 'day' ? 'day' : 'hour',
    counts: arr(o.counts).map((c) => {
      const b = obj(c);
      return { bucket: str(b.bucket) ?? '', error: num(b.error), warn: num(b.warn), info: num(b.info), total: num(b.total) };
    }),
    kinds: arr(o.kinds).map((k) => {
      const x = obj(k);
      return { kind: str(x.kind) ?? 'unknown', count: num(x.count), lastAt: str(x.lastAt) };
    }),
    sources: arr(o.sources).map((s) => {
      const x = obj(s);
      return { source: readSource(x.source), count: num(x.count), lastAt: str(x.lastAt) };
    }),
    totals: { total: num(t.total), error: num(t.error), warn: num(t.warn), info: num(t.info), userReported: num(t.userReported) },
    cronCheckedAt: str(o.cronCheckedAt),
  };
}

/** The badge tone of a level. */
export function levelTone(level: MonitorLevel): 'danger' | 'warn' | 'info' {
  return level === 'error' ? 'danger' : level === 'warn' ? 'warn' : 'info';
}

/** A bar's height as a share (0..1) of the busiest bucket; an empty chart is all zero. */
export function barShare(total: number, max: number): number {
  if (max <= 0 || total <= 0) return 0;
  return Math.max(0.04, Math.min(1, total / max));
}

/** Baghdad has no daylight saving: UTC+3 all year, the clock the server buckets on. */
const BAGHDAD_OFFSET_MS = 3 * 3600_000;

/** Every bucket of the period, oldest first, so a quiet hour or day is shown as one. */
export function fillBuckets(counts: readonly CountBucket[], period: Period, now: Date): CountBucket[] {
  const step = bucketFor(period) === 'hour' ? 3600_000 : 24 * 3600_000;
  const n = Math.round(PERIOD_MS[period] / step);
  const keyOf = (t: number) => Math.floor((t + BAGHDAD_OFFSET_MS) / step);
  const byKey = new Map<number, CountBucket>();
  for (const c of counts) {
    const t = Date.parse(c.bucket);
    if (Number.isFinite(t)) byKey.set(keyOf(t), c);
  }
  const lastKey = keyOf(now.getTime());
  const out: CountBucket[] = [];
  for (let k = lastKey - n + 1; k <= lastKey; k++) {
    out.push(byKey.get(k) ?? { bucket: new Date(k * step - BAGHDAD_OFFSET_MS).toISOString(), error: 0, warn: 0, info: 0, total: 0 });
  }
  return out;
}

/** The detail as readable lines, stack last. */
export function detailEntries(detail: Record<string, unknown>): { key: string; value: string }[] {
  const entries = Object.entries(detail).map(([key, value]) => ({
    key,
    value: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }));
  return [...entries.filter((e) => e.key !== 'stack'), ...entries.filter((e) => e.key === 'stack')];
}

// ---------------------------------------------------------------------------
// The Assistant table (assistant_weekly_page, 0420-0422): one row per complete
// week, newest first. It does not follow the page's filters: its rows are the
// venue's business weeks, read by their own RPC.
// ---------------------------------------------------------------------------

/** How many complete weeks the table asks for. */
export const ASSISTANT_WEEKS = 12;

export interface AssistantWeek {
  weekStart: string;
  weekEnd: string;
  level: 'info' | 'warn';
  questions: number;
  failed: number;
  failedByCode: Record<string, number>;
  notSaved: number;
  marked: number;
  thumbsDown: number;
  rated: number;
  secondsP50: number | null;
  costPerQuestionMicros: number | null;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** `assistant_weekly_page` read defensively: unknown shapes become empty weeks, nulls stay null. */
export function readAssistantWeekly(raw: unknown): AssistantWeek[] {
  return arr(obj(raw).weeks).map((w): AssistantWeek => {
    const x = obj(w);
    const f = obj(x.figures);
    const byCode: Record<string, number> = {};
    for (const [code, n] of Object.entries(obj(f.failedByCode))) if (num(n) > 0) byCode[code] = num(n);
    return {
      weekStart: str(x.weekStart) ?? '',
      weekEnd: str(x.weekEnd) ?? '',
      level: x.level === 'warn' ? 'warn' : 'info',
      questions: num(f.questions),
      failed: num(f.failed),
      failedByCode: byCode,
      notSaved: num(f.notSaved),
      marked: num(f.marked),
      thumbsDown: num(f.thumbsDown),
      rated: num(f.rated),
      secondsP50: numOrNull(f.secondsToAnswerP50),
      costPerQuestionMicros: numOrNull(f.costPerQuestionMicros),
    };
  });
}

/** The table's empty state: no week of the twelve had a question. */
export function noAssistantQuestions(weeks: readonly AssistantWeek[]): boolean {
  return weeks.every((w) => w.questions === 0);
}

/** The failed cell's tooltip: "UPSTREAM 1, NOT_CONFIGURED 1", most frequent first, ties in the server's order. */
export function failedCodesTitle(byCode: Record<string, number>): string {
  return Object.entries(byCode)
    .filter(([, n]) => n > 0)
    .sort(([, x], [, y]) => y - x)
    .map(([code, n]) => `${code} ${n}`)
    .join(', ');
}

/** A week's date as a Date the venue formatter reads as that same day (noon UTC is that day in Baghdad). */
export function weekDate(isoDay: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDay)) return null;
  const d = new Date(`${isoDay}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

export const DASH = '—';

/** What one row shows, every figure already a string (the page only lays them out). */
export interface AssistantWeekRow {
  key: string;
  week: string;
  weekTitle: string;
  warn: boolean;
  questions: string;
  failed: string;
  failedTitle: string;
  notSaved: string;
  marked: string;
  thumbsDown: string;
  median: string;
  costPerQuestion: string;
}

export interface WeekFormatters {
  number: (n: number) => string;
  date: (d: Date) => string;
  usd: (micros: number) => string;
  /** "{n} of {rated}" in the page's language. */
  thumbsOf: (n: string, rated: string) => string;
  /** "{from} to {to}" in the page's language. */
  range: (from: string, to: string) => string;
}

/** The weeks as table rows, in the server's order (newest first). */
export function assistantWeekRows(weeks: readonly AssistantWeek[], fmt: WeekFormatters): AssistantWeekRow[] {
  return weeks.map((w) => {
    const start = weekDate(w.weekStart);
    const end = weekDate(w.weekEnd);
    const week = start ? fmt.date(start) : w.weekStart;
    return {
      key: w.weekStart,
      week,
      weekTitle: start && end ? fmt.range(week, fmt.date(end)) : week,
      warn: w.level === 'warn',
      questions: fmt.number(w.questions),
      failed: fmt.number(w.failed),
      failedTitle: failedCodesTitle(w.failedByCode),
      notSaved: fmt.number(w.notSaved),
      marked: fmt.number(w.marked),
      thumbsDown: w.rated > 0 ? fmt.thumbsOf(fmt.number(w.thumbsDown), fmt.number(w.rated)) : DASH,
      median: w.secondsP50 === null ? DASH : fmt.number(Math.round(w.secondsP50)),
      costPerQuestion: w.costPerQuestionMicros === null ? DASH : fmt.usd(w.costPerQuestionMicros),
    };
  });
}

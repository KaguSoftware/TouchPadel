/**
 * The marketing panel's payload (app.marketing_insights, 0360) and the words
 * it prints. The server already turned every figure into a level, a trend, a
 * rounded share or an "about N"; this module only parses that defensively and
 * picks the words. It never sees, and so can never print, an exact figure.
 */

export type Trend = 'up' | 'steady' | 'down' | 'unknown';
/** 0 empty, 1 light, 2 steady, 3 busy, 4 full. */
export type Level = 0 | 1 | 2 | 3 | 4;
export type Count = { kind: 'none' } | { kind: 'few' } | { kind: 'about'; value: number } | null;

export interface Slot {
  dow: number;
  hour: number;
  level: Level | null;
}
export interface Named {
  nameEn: string;
  nameAr: string;
}
export type OfferVerdict = 'strong' | 'some' | 'little' | 'unused';
export interface Offer extends Named {
  id: string;
  live: boolean;
  uses: Count;
  verdict: OfferVerdict;
}
export interface BucketShare {
  bucket: string;
  share: number | null;
}

export interface Insights {
  period: { from: string; to: string };
  compare: { from: string; to: string };
  /** The range holds a pre-system report month: no hours, channels or guests for it. */
  legacy: boolean;
  demand: {
    level: Level | null;
    levelTrend: Trend;
    bookingsTrend: Trend;
    cancelTrend: Trend;
    noShowTrend: Trend;
    heat: Slot[];
    quiet: Slot[];
    full: Slot[];
  };
  players: {
    active: Count;
    activeTrend: Trend;
    newShare: number | null;
    returningShare: number | null;
    newTrend: Trend;
    regulars: Count;
    lapsing: Count;
    lapseDays: number;
    frequency: BucketShare[];
    weeks: { weekStart: string; newIdx: number; returningIdx: number }[];
  };
  channels: {
    appShare: number | null;
    deskShare: number | null;
    appTrend: Trend;
    lead: BucketShare[];
  };
  cafe: {
    crossoverShare: number | null;
    crossoverTrend: Trend;
    spendTrend: Trend;
    heat: Slot[];
    peaks: Slot[];
    top: Named[];
    bottom: Named[];
    shopTrend: Trend;
  };
  mix: {
    courts: number | null;
    cafe: number | null;
    shop: number | null;
    trend: Trend;
    courtsTrend: Trend;
    cafeTrend: Trend;
  };
  offers: Offer[];
  events: {
    held: boolean;
    tournaments: Count;
    fillLevel: Level | null;
    players: Count;
    returningShare: number | null;
    next: (Named & { startDate: string }) | null;
  };
  loyalty: {
    enabled: boolean;
    members: Count;
    newMembers: Count;
    activeMembers: Count;
    redeemingShare: number | null;
    holdingPoints: Count;
  };
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
};
const TRENDS: readonly Trend[] = ['up', 'steady', 'down', 'unknown'];
const trend = (v: unknown): Trend => (TRENDS.includes(v as Trend) ? (v as Trend) : 'unknown');
const level = (v: unknown): Level | null => {
  const n = int(v);
  return n !== null && n >= 0 && n <= 4 ? (n as Level) : null;
};
const share = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n >= 0 && n <= 100 ? n : null;
};

export function parseCount(v: unknown): Count {
  const o = obj(v);
  if (o.kind === 'none') return { kind: 'none' };
  if (o.kind === 'few') return { kind: 'few' };
  const n = int(o.value);
  return o.kind === 'about' && n !== null && n >= 0 ? { kind: 'about', value: n } : null;
}

const slots = (v: unknown): Slot[] =>
  arr(v)
    .map((r) => {
      const s = obj(r);
      return { dow: int(s.dow) ?? -1, hour: int(s.hour) ?? -1, level: level(s.level) };
    })
    .filter((s) => s.dow >= 0 && s.dow <= 6 && s.hour >= 0 && s.hour <= 23);
const named = (v: unknown): Named[] => arr(v).map((r) => ({ nameEn: str(obj(r).nameEn), nameAr: str(obj(r).nameAr) })).filter((n) => n.nameEn !== '' || n.nameAr !== '');
const buckets = (v: unknown): BucketShare[] => arr(v).map((r) => ({ bucket: str(obj(r).bucket), share: share(obj(r).share) })).filter((b) => b.bucket !== '');
const VERDICTS: readonly OfferVerdict[] = ['strong', 'some', 'little', 'unused'];

export function parseInsights(json: unknown): Insights {
  const o = obj(json);
  const d = obj(o.demand);
  const p = obj(o.guests);
  const ch = obj(o.channels);
  const c = obj(o.cafe);
  const m = obj(o.mix);
  const e = obj(o.events);
  const l = obj(o.loyalty);
  const next = obj(e.next);
  return {
    period: { from: str(obj(o.period).from), to: str(obj(o.period).to) },
    compare: { from: str(obj(o.compare).from), to: str(obj(o.compare).to) },
    legacy: o.legacy === true,
    demand: {
      level: level(d.level),
      levelTrend: trend(d.levelTrend),
      bookingsTrend: trend(d.bookingsTrend),
      cancelTrend: trend(d.cancelTrend),
      noShowTrend: trend(d.noShowTrend),
      heat: slots(d.heat),
      quiet: slots(d.quiet),
      full: slots(d.full),
    },
    players: {
      active: parseCount(p.active),
      activeTrend: trend(p.activeTrend),
      newShare: share(p.newShare),
      returningShare: share(p.returningShare),
      newTrend: trend(p.newTrend),
      regulars: parseCount(p.regulars),
      lapsing: parseCount(p.lapsing),
      lapseDays: int(p.lapseDays) ?? 28,
      frequency: buckets(p.frequency),
      weeks: arr(p.weeks)
        .map((r) => ({ weekStart: str(obj(r).weekStart), newIdx: int(obj(r).newIdx) ?? 0, returningIdx: int(obj(r).returningIdx) ?? 0 }))
        .filter((w) => w.weekStart !== ''),
    },
    channels: { appShare: share(ch.appShare), deskShare: share(ch.deskShare), appTrend: trend(ch.appTrend), lead: buckets(ch.lead) },
    cafe: {
      crossoverShare: share(c.crossoverShare),
      crossoverTrend: trend(c.crossoverTrend),
      spendTrend: trend(c.spendTrend),
      heat: slots(c.heat),
      peaks: slots(c.peaks),
      top: named(c.top),
      bottom: named(c.bottom),
      shopTrend: trend(c.shopTrend),
    },
    mix: { courts: share(m.courts), cafe: share(m.cafe), shop: share(m.shop), trend: trend(m.trend), courtsTrend: trend(m.courtsTrend), cafeTrend: trend(m.cafeTrend) },
    offers: arr(o.offers)
      .map((r) => {
        const x = obj(r);
        return {
          id: str(x.id),
          nameEn: str(x.nameEn),
          nameAr: str(x.nameAr),
          live: x.live === true,
          uses: parseCount(x.uses),
          verdict: VERDICTS.includes(x.verdict as OfferVerdict) ? (x.verdict as OfferVerdict) : 'unused',
        };
      })
      .filter((x) => x.id !== ''),
    events: {
      held: e.held === true,
      tournaments: parseCount(e.tournaments),
      fillLevel: level(e.fillLevel),
      players: parseCount(e.entrants),
      returningShare: share(e.returningShare),
      next: str(next.startDate) ? { nameEn: str(next.nameEn), nameAr: str(next.nameAr), startDate: str(next.startDate) } : null,
    },
    loyalty: {
      enabled: l.enabled === true,
      members: parseCount(l.members),
      newMembers: parseCount(l.newMembers),
      activeMembers: parseCount(l.activeMembers),
      redeemingShare: share(l.redeemingShare),
      holdingPoints: parseCount(l.holdingPoints),
    },
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const LEVEL_KEYS = ['empty', 'light', 'steady', 'busy', 'full'] as const;
export type LevelKey = (typeof LEVEL_KEYS)[number];

export function levelKey(l: Level | null): LevelKey | null {
  return l === null ? null : LEVEL_KEYS[l];
}

/** A rounded share as plain words: 30 → "about a third". */
export type ShareWord =
  | 'none'
  | 'oneInTen'
  | 'oneInFive'
  | 'quarter'
  | 'third'
  | 'twoInFive'
  | 'half'
  | 'overHalf'
  | 'twoThirds'
  | 'threeQuarters'
  | 'fourInFive'
  | 'nineInTen'
  | 'all';

export function shareWord(s: number | null): ShareWord | null {
  if (s === null) return null;
  if (s <= 0) return 'none';
  if (s <= 10) return 'oneInTen';
  if (s <= 20) return 'oneInFive';
  if (s <= 25) return 'quarter';
  if (s <= 35) return 'third';
  if (s <= 45) return 'twoInFive';
  if (s <= 50) return 'half';
  if (s <= 60) return 'overHalf';
  if (s <= 70) return 'twoThirds';
  if (s <= 75) return 'threeQuarters';
  if (s <= 85) return 'fourInFive';
  if (s < 100) return 'nineInTen';
  return 'all';
}

export type TrendTone = 'success' | 'danger' | 'neutral';

/** Up is good unless `upIsBad` (cancellations, no-shows); steady and unknown are neutral. */
export function trendTone(t: Trend, upIsBad = false): TrendTone {
  if (t === 'up') return upIsBad ? 'danger' : 'success';
  if (t === 'down') return upIsBad ? 'success' : 'danger';
  return 'neutral';
}

/** The heatmap's value for a slot: its level, 0..4 (a closed hour is left out by the server). */
export function heatCells(cells: readonly Slot[]): { dow: number; hour: number; value: number }[] {
  return cells.filter((c) => c.level !== null).map((c) => ({ dow: c.dow, hour: c.hour, value: c.level ?? 0 }));
}

/** Every share in a list is unknown: nothing to draw. */
export function allUnknown(rows: readonly BucketShare[]): boolean {
  return rows.every((r) => r.share === null);
}

/** Which zone's answer to lead with on the courts: push the quiet hours or protect the full ones. */
export function demandAdvice(d: Insights['demand']): 'fillQuiet' | 'protectFull' | 'both' | 'none' {
  const quiet = d.quiet.length > 0 && d.quiet.some((s) => (s.level ?? 0) <= 1);
  const full = d.full.length > 0;
  if (quiet && full) return 'both';
  if (quiet) return 'fillQuiet';
  if (full) return 'protectFull';
  return 'none';
}

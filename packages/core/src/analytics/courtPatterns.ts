/**
 * Deterministic pattern miner for the COURTS side of the analytics "Patterns" card.
 *
 * The cafe twin is ./patterns.ts and this file mirrors it on purpose: the MATH lives here,
 * never an LLM. Each miner turns pre-aggregated RPC output (occupancy heatmap, per-court
 * totals, cancellation and no-show breakdowns, anonymous guest counts, court-to-cafe
 * attach figures) into candidates with their supporting numbers, a sample size, a tier and
 * a strength score. The judge downstream (the `analytics-insights` edge function) rejects
 * the obvious ones and phrases the survivors; without it, `fallbackText` renders.
 *
 * The same two guards as the cafe miner:
 *  - a BUSY-VENUE confound: a dead slot is dead RELATIVE to the venue's own rhythm for that
 *    hour, a booking shift is measured on SHARE of bookings, an ending cluster on its rate
 *    against the base rate, an attach gap against the venue attach rate;
 *  - SAMPLE SIZE by disclosure: thin candidates are still surfaced, labelled with their
 *    sample, tiered `low`, sorted beneath better-supported ones.
 *
 * Nothing here ever sees a guest identity: the input carries counts only, by design.
 * `patterns.ts` is left untouched (it is byte-parity-tested together with insightsText.ts),
 * so the widening levels, tiers and small helpers are re-declared here with court numbers.
 */
import { pickLocale, type Locale } from '../i18n/pickLocale';
import { type CourtsBasis, MIN_ATTACH_BOOKINGS, MIN_CELL_OPEN_DAYS } from './courtsBasis';
import type { PatternCandidate, PatternConfidence, PatternLevel } from './patterns';

export type CourtPatternKind =
  | 'dead-slot'
  | 'saturated-slot'
  | 'shift'
  | 'ending-cluster'
  | 'lapsing'
  | 'attach-gap'
  | 'court-basket';

/** Same shape as a cafe candidate; only the kind vocabulary differs. */
export type CourtPatternCandidate = Omit<PatternCandidate, 'kind'> & { kind: CourtPatternKind };

/** One occupancy heatmap cell: calendar-local weekday (JS index) x hour of day. */
export type HeatCellRow = {
  dow: number;
  hour: number;
  openMinutes: number;
  openDays: number;
  bookedMinutes: number;
  bookings: number;
  revenueIqd: number;
  cancellations: number;
  noShows: number;
  /** App holds that expired in this cell; absent when the caller has no hold data. */
  holdsExpired?: number;
};

/** One breakdown row of the endings RPC: `n` endings out of `bookingsTotal` booked slots. */
export type EndingSegment = { key: string; n: number; bookingsTotal: number };

export type EndingsDimension = 'byHour' | 'byDow' | 'byCourt' | 'bySource' | 'byDuration' | 'byLeadTime' | 'byNotice' | 'byType';

/** Breakdowns present in the RPC output; `byNotice` exists for cancellations only. */
export type EndingsSegments = Partial<Record<EndingsDimension, readonly EndingSegment[]>>;

export type CourtPatternsInput = {
  heatmap: readonly HeatCellRow[];
  /** The comparison window's heatmap; omit (or null) and no shift is mined. */
  compareHeatmap?: readonly HeatCellRow[] | null;
  courtsCount: number;
  perCourt: readonly { courtId: string; bookings: number; bookedTotal: number; cancellations: number; noShows: number }[];
  endings: {
    cancellations: EndingsSegments;
    noShows: EndingsSegments;
    cancellationsTotal: number;
    noShowsTotal: number;
    bookedTotal: number;
  };
  /** Anonymous guest counts; omit (or null) when the guests RPC is unavailable. */
  guests?: { regulars: number; lapsingRegulars: number; identities: number } | null;
  /** Court-to-cafe join; omit (or null) when the till has no linked tabs. */
  cafe?: {
    attachPct: number | null;
    liveBookings: number;
    linkedBookings: number;
    perCourt: readonly { courtId: string; liveBookings: number; linkedBookings: number }[];
    attachCells: readonly { dow: number; hour: number; liveBookings: number; linkedBookings: number }[];
    items: readonly { itemId: string; linkedOrdersWithItem: number; allOrdersWithItem: number }[];
    linkedOrdersTotal: number;
    allOrdersTotal: number;
  } | null;
  basis: CourtsBasis;
  courtNames: ReadonlyMap<string, { nameEn: string; nameAr: string }>;
  itemNames: ReadonlyMap<string, { nameEn: string; nameAr: string }>;
};

export type CourtPatternsCopy = {
  locale: Locale;
  weekday: (dow: number) => string;
  /** "20:00". */
  hour: (h: number) => string;
  /** "20:00-22:00"; `h1` is the EXCLUSIVE end hour. */
  hourRange: (h0: number, h1: number) => string;
  /** A weekday plus an hour label as one subject, e.g. "Friday 20:00". */
  slot: (weekday: string, hours: string) => string;
  /** Label for a breakdown key of a non-time, non-court dimension (source, duration, lead time, notice, type). */
  segment: (dimension: EndingsDimension, key: string) => string;
  regularsSubject: string;
  sample: {
    openDays: (n: number) => string;
    bookings: (n: number) => string;
    bookingsPair: (current: number, previous: number) => string;
    regulars: (n: number) => string;
    linkedOrders: (count: number, total: number) => string;
  };
  fallback: {
    deadSlot: (weekday: string, hours: string, occupancyPct: number, venuePct: number, openDays: number) => string;
    saturatedSlot: (weekday: string, hours: string, occupancyPct: number, openDays: number, holdsExpired: number) => string;
    shiftUp: (subject: string, currentPct: number, previousPct: number, points: number) => string;
    shiftDown: (subject: string, currentPct: number, previousPct: number, points: number) => string;
    cancellationCluster: (subject: string, ratePct: number, basePct: number, n: number, total: number) => string;
    noShowCluster: (subject: string, ratePct: number, basePct: number, n: number, total: number) => string;
    lapsing: (lapsing: number, regulars: number, pct: number) => string;
    attachLow: (subject: string, attachPct: number, venuePct: number, bookings: number) => string;
    attachHigh: (subject: string, attachPct: number, venuePct: number, bookings: number) => string;
    courtBasket: (item: string, lift: number, linkedWith: number, linkedTotal: number) => string;
  };
};

const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export const DEFAULT_COURT_PATTERNS_COPY_EN: CourtPatternsCopy = {
  locale: 'en',
  weekday: (d) => EN_WEEKDAYS[d] ?? String(d),
  hour: hh,
  hourRange: (h0, h1) => `${hh(h0)}-${hh(h1)}`,
  slot: (weekday, hours) => `${weekday} ${hours}`,
  segment: (dimension, key) => (dimension === 'byDuration' ? `${key} min` : key),
  regularsSubject: 'Regulars',
  sample: {
    openDays: (n) => `${n} open days`,
    bookings: (n) => `${n} bookings`,
    bookingsPair: (cur, prev) => `${cur} / ${prev} bookings`,
    regulars: (n) => `${n} regulars`,
    linkedOrders: (count, total) => `${count} / ${total} linked orders`,
  },
  fallback: {
    deadSlot: (wd, hours, occ, venue, days) =>
      `${wd} ${hours} runs at ${occ}% occupancy while the venue averages ${venue}% at that hour (${days} open days). A slot to price or promote differently.`,
    saturatedSlot: (wd, hours, occ, days, holds) =>
      `${wd} ${hours} is booked ${occ}% of its open time (${days} open days)${holds > 0 ? `, and ${holds} app holds expired there` : ''}. Demand is spilling; consider price or capacity.`,
    shiftUp: (subject, cur, prev, pts) =>
      `${subject} now carries ${cur}% of bookings, up from ${prev}% in the comparison period (${pts} points). Demand is moving toward it.`,
    shiftDown: (subject, cur, prev, pts) =>
      `${subject} now carries ${cur}% of bookings, down from ${prev}% in the comparison period (${pts} points). Demand is moving away from it.`,
    cancellationCluster: (subject, rate, base, n, total) =>
      `${subject} cancels at ${rate}% (${n} of ${total}) against ${base}% overall. Cancellations cluster there.`,
    noShowCluster: (subject, rate, base, n, total) =>
      `${subject} no-shows at ${rate}% (${n} of ${total}) against ${base}% overall. No-shows cluster there.`,
    lapsing: (lapsing, regulars, p) =>
      `${lapsing} of ${regulars} regulars (${p}%) have not booked in the last 28 days. Worth a nudge before they are gone.`,
    attachLow: (subject, attach, venue, bookings) =>
      `${subject} attaches a cafe tab on ${attach}% of bookings vs ${venue}% venue-wide (${bookings} bookings). The cafe is missing those players.`,
    attachHigh: (subject, attach, venue, bookings) =>
      `${subject} attaches a cafe tab on ${attach}% of bookings vs ${venue}% venue-wide (${bookings} bookings). Whatever happens there works; copy it.`,
    courtBasket: (item, lift, withItem, total) =>
      `${item} shows up in ${withItem} of ${total} court-linked orders, ${lift}x its share of all orders. A court-side item to place near the booking flow.`,
  },
};

/** Tier a sample against its own medium/high thresholds (private in patterns.ts, re-declared). */
function tier(sample: number, medium: number, high: number): PatternConfidence {
  if (sample >= high) return 'high';
  if (sample >= medium) return 'medium';
  return 'low';
}

const TIER_RANK: Record<PatternConfidence, number> = { high: 2, medium: 1, low: 0 };

type Thresholds = {
  minCellOpenDays: number; // open days a heat cell needs before its occupancy is read
  deadRelOcc: number; // cell occupancy at or below this ...
  deadVenueOcc: number; // ... while the venue's average for that hour is at or above this
  deadAbsOcc: number; // OR cell occupancy at or below this ...
  deadAbsOpenDays: number; // ... over at least this many open days
  saturatedOcc: number; // cell occupancy at or above this is saturated
  shiftPoints: number; // share movement (points) to call a booking shift
  shiftMinBookings: number; // bookings each side of the comparison needs
  endingRatio: number; // segment rate / base rate floor for an ending cluster
  endingMinN: number; // endings the segment needs
  endingMinTotal: number; // booked slots the segment needs
  lapsingMin: number; // lapsing regulars needed
  lapsingShare: number; // ... and their share of all regulars
  attachMinVenue: number; // venue attach rate below which attach gaps are noise
  attachMinBookings: number; // live bookings a court / slot needs
  attachLowRatio: number; // subject attach / venue attach at or below this is a gap
  attachHighRatio: number; // ... at or above this is a standout
  basketLift: number; // item lift floor (1 = same share in linked and all orders)
  basketSupport: number; // linked orders with the item needed
};

/**
 * Widening levels, same mechanism as `patterns.ts` (mine at 0; when too few survive, re-mine
 * at the next level). Level 0 holds the plan's floors; loosening never means inventing.
 */
const LEVELS: readonly Thresholds[] = [
  { minCellOpenDays: MIN_CELL_OPEN_DAYS, deadRelOcc: 0.15, deadVenueOcc: 0.4, deadAbsOcc: 0.1, deadAbsOpenDays: 6, saturatedOcc: 0.9, shiftPoints: 5, shiftMinBookings: 30, endingRatio: 1.6, endingMinN: 8, endingMinTotal: 25, lapsingMin: 3, lapsingShare: 0.2, attachMinVenue: 0.2, attachMinBookings: MIN_ATTACH_BOOKINGS, attachLowRatio: 0.5, attachHighRatio: 1.5, basketLift: 1.5, basketSupport: 5 },
  { minCellOpenDays: 3, deadRelOcc: 0.18, deadVenueOcc: 0.35, deadAbsOcc: 0.12, deadAbsOpenDays: 5, saturatedOcc: 0.85, shiftPoints: 4, shiftMinBookings: 20, endingRatio: 1.45, endingMinN: 6, endingMinTotal: 18, lapsingMin: 2, lapsingShare: 0.15, attachMinVenue: 0.15, attachMinBookings: 7, attachLowRatio: 0.6, attachHighRatio: 1.4, basketLift: 1.4, basketSupport: 4 },
  { minCellOpenDays: 2, deadRelOcc: 0.2, deadVenueOcc: 0.3, deadAbsOcc: 0.15, deadAbsOpenDays: 4, saturatedOcc: 0.8, shiftPoints: 3, shiftMinBookings: 15, endingRatio: 1.35, endingMinN: 5, endingMinTotal: 12, lapsingMin: 2, lapsingShare: 0.1, attachMinVenue: 0.1, attachMinBookings: 5, attachLowRatio: 0.65, attachHighRatio: 1.3, basketLift: 1.3, basketSupport: 3 },
];

export const MAX_COURT_PATTERN_LEVEL = LEVELS.length;

/** Sample thresholds per pattern shape: `[medium, high]`; below `medium` tiers as `low`. */
export const COURT_SAMPLE_TIERS = {
  cellOpenDays: [4, 8],
  shiftBookings: [30, 80],
  endingBookings: [25, 60],
  regulars: [5, 15],
  attachBookings: [10, 30],
  basketSupport: [5, 12],
} as const satisfies Record<string, readonly [number, number]>;

// ---------- small helpers ----------

const round1 = (n: number) => Math.round(n * 10) / 10;
/** A 0..1 ratio as a percentage with one decimal. */
const pct1 = (r: number) => round1(r * 100);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
/** Ratios such as 0.6 / 0.4 land a hair under 1.5 in binary; thresholds are compared with this slack. */
const EPS = 1e-9;
const atLeast = (value: number, floor: number) => value + EPS >= floor;
const atMost = (value: number, ceiling: number) => value - EPS <= ceiling;
const idKey = (kind: CourtPatternKind, parts: readonly string[]) => `${kind}:${[...parts].sort().join('|')}`;

type Ctx = {
  t: Thresholds;
  copy: CourtPatternsCopy;
  court: (id: string) => string;
  item: (id: string) => string;
};

/** Consecutive hours on one weekday collapsed into runs, in (dow, hour) order. */
type CellRun<T extends { dow: number; hour: number }> = { dow: number; hourFrom: number; hourTo: number; cells: T[] };

function runsOf<T extends { dow: number; hour: number }>(cells: readonly T[]): CellRun<T>[] {
  const sorted = [...cells].sort((a, b) => a.dow - b.dow || a.hour - b.hour);
  const runs: CellRun<T>[] = [];
  for (const cell of sorted) {
    const last = runs[runs.length - 1];
    if (last && last.dow === cell.dow && last.hourTo === cell.hour) {
      last.cells.push(cell);
      last.hourTo = cell.hour + 1;
    } else {
      runs.push({ dow: cell.dow, hourFrom: cell.hour, hourTo: cell.hour + 1, cells: [cell] });
    }
  }
  return runs;
}

const sum = <T,>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const occupancyOf = (bookedMinutes: number, openMinutes: number) => (openMinutes > 0 ? bookedMinutes / openMinutes : 0);

/** Venue-wide occupancy per hour across every weekday (minutes-weighted), for the busy-venue control. */
function venueHourOccupancy(heatmap: readonly HeatCellRow[]): Map<number, number> {
  const booked = new Map<number, number>();
  const open = new Map<number, number>();
  for (const c of heatmap) {
    if (c.openMinutes <= 0) continue;
    booked.set(c.hour, (booked.get(c.hour) ?? 0) + c.bookedMinutes);
    open.set(c.hour, (open.get(c.hour) ?? 0) + c.openMinutes);
  }
  const out = new Map<number, number>();
  for (const [hour, o] of open) out.set(hour, occupancyOf(booked.get(hour) ?? 0, o));
  return out;
}

// ---------- family 1: dead slots (busy-venue-controlled) ----------

function mineDeadSlots(heatmap: readonly HeatCellRow[], c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  const venue = venueHourOccupancy(heatmap);
  const dead = heatmap.filter((cell) => {
    if (cell.openMinutes <= 0 || cell.openDays < t.minCellOpenDays) return false;
    const occ = occupancyOf(cell.bookedMinutes, cell.openMinutes);
    const relative = atMost(occ, t.deadRelOcc) && atLeast(venue.get(cell.hour) ?? 0, t.deadVenueOcc);
    const absolute = atMost(occ, t.deadAbsOcc) && cell.openDays >= t.deadAbsOpenDays;
    return relative || absolute;
  });

  return runsOf(dead).map((run) => {
    const openMinutes = sum(run.cells, (x) => x.openMinutes);
    const bookedMinutes = sum(run.cells, (x) => x.bookedMinutes);
    const bookings = sum(run.cells, (x) => x.bookings);
    const openDays = Math.min(...run.cells.map((x) => x.openDays));
    const occ = occupancyOf(bookedMinutes, openMinutes);
    const venueOcc = sum(run.cells, (x) => venue.get(x.hour) ?? 0) / run.cells.length;
    const hours = run.hourTo - run.hourFrom;
    const strength = clamp01(Math.max(0.2, (venueOcc - occ) / 0.5) + 0.1 * (hours - 1));
    const wd = copy.weekday(run.dow);
    const hourLabel = copy.hourRange(run.hourFrom, run.hourTo);
    return {
      id: idKey('dead-slot', [`wd:${run.dow}`, `h:${run.hourFrom}-${run.hourTo}`]),
      kind: 'dead-slot',
      subjects: [wd, hourLabel],
      subjectIds: [],
      metrics: {
        weekday: run.dow,
        hourFrom: run.hourFrom,
        hourTo: run.hourTo,
        hours,
        occupancyPct: pct1(occ),
        houseHourPct: pct1(venueOcc),
        openDays,
        bookings,
        openMinutes,
        bookedMinutes,
      },
      sampleSize: openDays,
      confidence: tier(openDays, ...COURT_SAMPLE_TIERS.cellOpenDays),
      sampleLabel: copy.sample.openDays(openDays),
      strength,
      score: strength * Math.log2(openDays + 2),
      desc:
        `${EN_WEEKDAYS[run.dow]} ${hh(run.hourFrom)}-${hh(run.hourTo)} is booked ${pct1(occ)}% of its open time ` +
        `(${bookedMinutes} of ${openMinutes} open minutes, ${bookings} bookings, ${openDays} open days) while the venue ` +
        `averages ${pct1(venueOcc)}% across all weekdays at ${hours === 1 ? 'that hour' : 'those hours'}. The busy-venue ` +
        `effect is already removed by baselining against the venue's own hour-of-day occupancy.`,
      fallbackText: copy.fallback.deadSlot(wd, hourLabel, pct1(occ), pct1(venueOcc), openDays),
    };
  });
}

// ---------- family 2: saturated slots ----------

function mineSaturatedSlots(heatmap: readonly HeatCellRow[], c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  const full = heatmap.filter(
    (cell) => cell.openMinutes > 0 && cell.openDays >= t.minCellOpenDays && atLeast(occupancyOf(cell.bookedMinutes, cell.openMinutes), t.saturatedOcc),
  );
  return runsOf(full).map((run) => {
    const openMinutes = sum(run.cells, (x) => x.openMinutes);
    const bookedMinutes = sum(run.cells, (x) => x.bookedMinutes);
    const bookings = sum(run.cells, (x) => x.bookings);
    const holdsExpired = sum(run.cells, (x) => x.holdsExpired ?? 0);
    const revenueIqd = sum(run.cells, (x) => x.revenueIqd);
    const openDays = Math.min(...run.cells.map((x) => x.openDays));
    const occ = occupancyOf(bookedMinutes, openMinutes);
    const hours = run.hourTo - run.hourFrom;
    const spill = holdsExpired >= 2;
    // 0.6 at the floor, 0.9 when fully booked; expired app holds are demand that bounced, so they top it up.
    const strength = Math.round(clamp01(0.6 + 0.3 * clamp01((occ - t.saturatedOcc) / (1 - t.saturatedOcc)) + (spill ? 0.25 : 0)) * 1000) / 1000;
    const wd = copy.weekday(run.dow);
    const hourLabel = copy.hourRange(run.hourFrom, run.hourTo);
    return {
      id: idKey('saturated-slot', [`wd:${run.dow}`, `h:${run.hourFrom}-${run.hourTo}`]),
      kind: 'saturated-slot',
      subjects: [wd, hourLabel],
      subjectIds: [],
      metrics: {
        weekday: run.dow,
        hourFrom: run.hourFrom,
        hourTo: run.hourTo,
        hours,
        occupancyPct: pct1(occ),
        openDays,
        bookings,
        holdsExpired,
        revenueIqd,
        openMinutes,
        bookedMinutes,
      },
      sampleSize: openDays,
      confidence: tier(openDays, ...COURT_SAMPLE_TIERS.cellOpenDays),
      sampleLabel: copy.sample.openDays(openDays),
      strength,
      score: strength * Math.log2(openDays + 2),
      desc:
        `${EN_WEEKDAYS[run.dow]} ${hh(run.hourFrom)}-${hh(run.hourTo)} is booked ${pct1(occ)}% of its open time ` +
        `(${bookedMinutes} of ${openMinutes} open minutes, ${bookings} bookings, ${openDays} open days, ${revenueIqd} IQD).` +
        (spill ? ` ${holdsExpired} app holds expired in this slot: demand that could not be served.` : ''),
      fallbackText: copy.fallback.saturatedSlot(wd, hourLabel, pct1(occ), openDays, holdsExpired),
    };
  });
}

// ---------- family 3: booking shifts vs the comparison window (share-controlled) ----------

function mineShifts(current: readonly HeatCellRow[], previous: readonly HeatCellRow[], c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  const curTotal = sum(current, (x) => x.bookings);
  const prevTotal = sum(previous, (x) => x.bookings);
  if (curTotal < t.shiftMinBookings || prevTotal < t.shiftMinBookings) return [];
  const sample = Math.min(curTotal, prevTotal);

  const tally = (cells: readonly HeatCellRow[], key: (cell: HeatCellRow) => number) => {
    const m = new Map<number, number>();
    for (const cell of cells) m.set(key(cell), (m.get(key(cell)) ?? 0) + cell.bookings);
    return m;
  };
  const out: CourtPatternCandidate[] = [];
  const dims: { dimension: 'weekday' | 'hour'; key: (cell: HeatCellRow) => number; prefix: string; label: (k: number) => string; en: (k: number) => string }[] = [
    { dimension: 'weekday', key: (x) => x.dow, prefix: 'wd', label: (k) => copy.weekday(k), en: (k) => EN_WEEKDAYS[k] ?? String(k) },
    { dimension: 'hour', key: (x) => x.hour, prefix: 'h', label: (k) => copy.hour(k), en: hh },
  ];
  for (const d of dims) {
    const cur = tally(current, d.key);
    const prev = tally(previous, d.key);
    const keys = [...new Set([...cur.keys(), ...prev.keys()])].sort((a, b) => a - b);
    for (const k of keys) {
      const curN = cur.get(k) ?? 0;
      const prevN = prev.get(k) ?? 0;
      const curShare = curN / curTotal;
      const prevShare = prevN / prevTotal;
      const delta = (curShare - prevShare) * 100;
      if (!atLeast(Math.abs(delta), t.shiftPoints)) continue;
      const up = delta > 0;
      const strength = clamp01(Math.abs(delta) / 15);
      const subject = d.label(k);
      out.push({
        id: idKey('shift', [`${d.prefix}:${k}`]),
        kind: 'shift',
        subjects: [subject],
        subjectIds: [],
        metrics: {
          dimension: d.dimension,
          key: k,
          sharePct: pct1(curShare),
          prevSharePct: pct1(prevShare),
          deltaPts: round1(delta),
          currentBookings: curN,
          previousBookings: prevN,
          currentTotal: curTotal,
          previousTotal: prevTotal,
          direction: up ? 'up' : 'down',
        },
        sampleSize: sample,
        confidence: tier(sample, ...COURT_SAMPLE_TIERS.shiftBookings),
        sampleLabel: copy.sample.bookingsPair(curTotal, prevTotal),
        strength,
        score: strength * Math.log2(sample + 2),
        desc:
          `Share of bookings on ${d.dimension} ${d.en(k)} moved from ${pct1(prevShare)}% (${prevN} of ${prevTotal}) in the ` +
          `comparison period to ${pct1(curShare)}% (${curN} of ${curTotal}) now, ${round1(delta)} points. Measured on SHARE, ` +
          `so a busier or quieter period overall is already controlled for.`,
        fallbackText: up
          ? copy.fallback.shiftUp(subject, pct1(curShare), pct1(prevShare), round1(Math.abs(delta)))
          : copy.fallback.shiftDown(subject, pct1(curShare), pct1(prevShare), round1(Math.abs(delta))),
      });
    }
  }
  return out;
}

// ---------- family 4: cancellation / no-show clusters ----------

const ENDING_DIMENSIONS: readonly EndingsDimension[] = ['byHour', 'byDow', 'byCourt', 'bySource', 'byDuration', 'byLeadTime', 'byNotice', 'byType'];

function mineEndingClusters(endings: CourtPatternsInput['endings'], c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  if (endings.bookedTotal <= 0) return [];
  const out: CourtPatternCandidate[] = [];
  const families: { ending: 'cancellations' | 'no-shows'; segments: EndingsSegments; total: number }[] = [
    { ending: 'cancellations', segments: endings.cancellations, total: endings.cancellationsTotal },
    { ending: 'no-shows', segments: endings.noShows, total: endings.noShowsTotal },
  ];
  for (const fam of families) {
    if (fam.total <= 0) continue;
    const base = fam.total / endings.bookedTotal;
    if (base <= 0) continue;
    for (const dimension of ENDING_DIMENSIONS) {
      const rows = fam.segments[dimension];
      if (!rows) continue;
      for (const seg of rows) {
        if (seg.n < t.endingMinN || seg.bookingsTotal < t.endingMinTotal) continue;
        const rate = seg.n / seg.bookingsTotal;
        const ratio = rate / base;
        if (!atLeast(ratio, t.endingRatio)) continue;
        const isCourt = dimension === 'byCourt';
        const subject =
          dimension === 'byHour' ? copy.hour(Number(seg.key))
          : dimension === 'byDow' ? copy.weekday(Number(seg.key))
          : isCourt ? c.court(seg.key)
          : copy.segment(dimension, seg.key);
        const enSubject =
          dimension === 'byHour' ? hh(Number(seg.key))
          : dimension === 'byDow' ? (EN_WEEKDAYS[Number(seg.key)] ?? seg.key)
          : isCourt ? `court "${c.court(seg.key)}"`
          : `${dimension.slice(2).toLowerCase()} "${seg.key}"`;
        const strength = clamp01((ratio - 1) / 2);
        out.push({
          id: idKey('ending-cluster', [fam.ending, `${dimension}:${seg.key}`]),
          kind: 'ending-cluster',
          subjects: [subject],
          subjectIds: isCourt ? [seg.key] : [],
          metrics: {
            ending: fam.ending,
            dimension,
            key: seg.key,
            n: seg.n,
            bookingsTotal: seg.bookingsTotal,
            segRatePct: pct1(rate),
            baseRatePct: pct1(base),
            ratio: round1(ratio),
          },
          sampleSize: seg.bookingsTotal,
          confidence: tier(seg.bookingsTotal, ...COURT_SAMPLE_TIERS.endingBookings),
          sampleLabel: copy.sample.bookings(seg.bookingsTotal),
          strength,
          score: strength * Math.log2(seg.bookingsTotal + 2),
          desc:
            `${fam.ending === 'cancellations' ? 'Cancellations' : 'No-shows'} cluster on ${enSubject}: ${seg.n} of ` +
            `${seg.bookingsTotal} booked slots (${pct1(rate)}%) vs ${fam.total} of ${endings.bookedTotal} overall ` +
            `(${pct1(base)}%), ${round1(ratio)}x the base rate.`,
          fallbackText:
            fam.ending === 'cancellations'
              ? copy.fallback.cancellationCluster(subject, pct1(rate), pct1(base), seg.n, seg.bookingsTotal)
              : copy.fallback.noShowCluster(subject, pct1(rate), pct1(base), seg.n, seg.bookingsTotal),
        });
      }
    }
  }
  return out;
}

// ---------- family 5: lapsing regulars (a count, never a list) ----------

function mineLapsing(guests: NonNullable<CourtPatternsInput['guests']>, c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  if (guests.regulars <= 0) return [];
  const share = guests.lapsingRegulars / guests.regulars;
  if (guests.lapsingRegulars < t.lapsingMin || !atLeast(share, t.lapsingShare)) return [];
  const strength = clamp01(share / 0.5);
  return [
    {
      id: idKey('lapsing', ['regulars']),
      kind: 'lapsing',
      subjects: [copy.regularsSubject],
      subjectIds: [],
      metrics: { regulars: guests.regulars, lapsingRegulars: guests.lapsingRegulars, lapsingPct: pct1(share) },
      sampleSize: guests.regulars,
      confidence: tier(guests.regulars, ...COURT_SAMPLE_TIERS.regulars),
      sampleLabel: copy.sample.regulars(guests.regulars),
      strength,
      score: strength * Math.log2(guests.regulars + 2),
      desc:
        `${guests.lapsingRegulars} of ${guests.regulars} regulars (3+ bookings in 90 days) have no booking in the last ` +
        `28 days, ${pct1(share)}% of the regular base. Counts only; no individual is identified.`,
      fallbackText: copy.fallback.lapsing(guests.lapsingRegulars, guests.regulars, pct1(share)),
    },
  ];
}

// ---------- family 6: cafe attach gaps (venue-rate-controlled) ----------

function mineAttachGaps(cafe: NonNullable<CourtPatternsInput['cafe']>, c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  const venue = cafe.liveBookings > 0 ? cafe.linkedBookings / cafe.liveBookings : cafe.attachPct !== null ? cafe.attachPct / 100 : 0;
  if (!atLeast(venue, t.attachMinVenue)) return [];
  const out: CourtPatternCandidate[] = [];
  const push = (
    parts: readonly string[],
    subjects: string[],
    subjectIds: string[],
    scope: 'court' | 'cell',
    live: number,
    linked: number,
    enSubject: string,
    extra: Record<string, number | string>,
  ) => {
    if (live < t.attachMinBookings) return;
    const rate = linked / live;
    const ratio = rate / venue;
    const low = atMost(ratio, t.attachLowRatio);
    const high = atLeast(ratio, t.attachHighRatio);
    if (!low && !high) return;
    const strength = clamp01(ratio > 0 ? Math.abs(Math.log2(ratio)) : 1);
    const subject = subjects.length > 1 ? copy.slot(subjects[0]!, subjects[1]!) : subjects[0]!;
    out.push({
      id: idKey('attach-gap', parts),
      kind: 'attach-gap',
      subjects,
      subjectIds,
      metrics: {
        scope,
        direction: low ? 'low' : 'high',
        attachPct: pct1(rate),
        venueAttachPct: pct1(venue),
        ratio: round1(ratio),
        liveBookings: live,
        linkedBookings: linked,
        ...extra,
      },
      sampleSize: live,
      confidence: tier(live, ...COURT_SAMPLE_TIERS.attachBookings),
      sampleLabel: copy.sample.bookings(live),
      strength,
      score: strength * Math.log2(live + 2),
      desc:
        `Cafe attach on ${enSubject}: ${linked} of ${live} live bookings had a linked cafe tab (${pct1(rate)}%) vs ` +
        `${pct1(venue)}% venue-wide, ${round1(ratio)}x the venue rate (${low ? 'a gap' : 'a standout'}).`,
      fallbackText: low
        ? copy.fallback.attachLow(subject, pct1(rate), pct1(venue), live)
        : copy.fallback.attachHigh(subject, pct1(rate), pct1(venue), live),
    });
  };

  for (const court of [...cafe.perCourt].sort((a, b) => a.courtId.localeCompare(b.courtId))) {
    const name = c.court(court.courtId);
    push([`court:${court.courtId}`], [name], [court.courtId], 'court', court.liveBookings, court.linkedBookings, `court "${name}"`, {
      courtId: court.courtId,
    });
  }
  for (const cell of [...cafe.attachCells].sort((a, b) => a.dow - b.dow || a.hour - b.hour)) {
    push(
      [`wd:${cell.dow}`, `h:${cell.hour}`],
      [copy.weekday(cell.dow), copy.hour(cell.hour)],
      [],
      'cell',
      cell.liveBookings,
      cell.linkedBookings,
      `${EN_WEEKDAYS[cell.dow] ?? cell.dow} ${hh(cell.hour)}`,
      { weekday: cell.dow, hour: cell.hour },
    );
  }
  return out;
}

// ---------- family 7: what court-linked orders buy more of (lift) ----------

function mineCourtBasket(cafe: NonNullable<CourtPatternsInput['cafe']>, c: Ctx): CourtPatternCandidate[] {
  const { t, copy } = c;
  if (cafe.linkedOrdersTotal <= 0 || cafe.allOrdersTotal <= 0) return [];
  const out: CourtPatternCandidate[] = [];
  for (const item of [...cafe.items].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    if (item.linkedOrdersWithItem < t.basketSupport || item.allOrdersWithItem <= 0) continue;
    const linkedShare = item.linkedOrdersWithItem / cafe.linkedOrdersTotal;
    const allShare = item.allOrdersWithItem / cafe.allOrdersTotal;
    const lift = linkedShare / allShare;
    if (!atLeast(lift, t.basketLift)) continue;
    const strength = clamp01((lift - 1) / 3); // lift 4 -> ~1.0
    const name = c.item(item.itemId);
    out.push({
      id: idKey('court-basket', [item.itemId]),
      kind: 'court-basket',
      subjects: [name],
      subjectIds: [item.itemId],
      metrics: {
        lift: round1(lift),
        linkedOrdersWithItem: item.linkedOrdersWithItem,
        linkedOrdersTotal: cafe.linkedOrdersTotal,
        allOrdersWithItem: item.allOrdersWithItem,
        allOrdersTotal: cafe.allOrdersTotal,
        linkedSharePct: pct1(linkedShare),
        allSharePct: pct1(allShare),
      },
      sampleSize: item.linkedOrdersWithItem,
      confidence: tier(item.linkedOrdersWithItem, ...COURT_SAMPLE_TIERS.basketSupport),
      sampleLabel: copy.sample.linkedOrders(item.linkedOrdersWithItem, cafe.linkedOrdersTotal),
      strength,
      score: strength * Math.log2(item.linkedOrdersWithItem + 2),
      desc:
        `"${name}" is in ${item.linkedOrdersWithItem} of ${cafe.linkedOrdersTotal} court-linked orders (${pct1(linkedShare)}%) ` +
        `vs ${item.allOrdersWithItem} of ${cafe.allOrdersTotal} orders overall (${pct1(allShare)}%). Lift ${round1(lift)} ` +
        `(1 = same share): players who booked a court order it ${round1(lift)}x as often as the average order.`,
      fallbackText: copy.fallback.courtBasket(name, round1(lift), item.linkedOrdersWithItem, cafe.linkedOrdersTotal),
    });
  }
  return out;
}

/**
 * Mine every court family at a widening level and return candidates ranked by TIER first,
 * then score, then id. Deduped by id. Same contract as `minePatterns`.
 */
export function mineCourtPatterns(
  input: CourtPatternsInput,
  level: PatternLevel = 0,
  copy: CourtPatternsCopy = DEFAULT_COURT_PATTERNS_COPY_EN,
): CourtPatternCandidate[] {
  const t = LEVELS[Math.max(0, Math.min(level, LEVELS.length - 1))]!;
  const named = (names: ReadonlyMap<string, { nameEn: string; nameAr: string }>) => (id: string) => {
    const ref = names.get(id);
    return (ref ? pickLocale({ en: ref.nameEn, ar: ref.nameAr }, copy.locale) : '') || id;
  };
  const c: Ctx = { t, copy, court: named(input.courtNames), item: named(input.itemNames) };

  const all: CourtPatternCandidate[] = [
    ...mineDeadSlots(input.heatmap, c),
    ...mineSaturatedSlots(input.heatmap, c),
    ...(input.compareHeatmap ? mineShifts(input.heatmap, input.compareHeatmap, c) : []),
    ...mineEndingClusters(input.endings, c),
    ...(input.guests ? mineLapsing(input.guests, c) : []),
    ...(input.cafe ? [...mineAttachGaps(input.cafe, c), ...mineCourtBasket(input.cafe, c)] : []),
  ];

  const byId = new Map<string, CourtPatternCandidate>();
  for (const cand of all) if (!byId.has(cand.id)) byId.set(cand.id, cand);
  return [...byId.values()].sort(
    (a, b) => TIER_RANK[b.confidence] - TIER_RANK[a.confidence] || b.score - a.score || a.id.localeCompare(b.id),
  );
}

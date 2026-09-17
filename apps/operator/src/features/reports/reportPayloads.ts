/**
 * What the five report RPCs actually return, read into typed rows.
 *
 * WHY THIS FILE EXISTS
 *
 * The reports used to be one generic table fed by `columns` + `rows`, with
 * each "view" naming the snake_case columns it wanted (`revenue_iqd`,
 * `occupancy_pct`). The server never sent those. Migrations 0068 / 0096 /
 * 0097 / 0099 return camelCase keys and, for three of the five reports, the
 * figures a view is about live beside `rows`, not in it:
 *
 *   report_revenue   rows per day/week/month (one row shape for every view)
 *   report_courts    rows per court + `byHour` + `trend`
 *   report_cafe      rows per item + `summary` + `byCategory` + `wasteByReason` + `prepTimes`
 *   report_stock     NO rows at all — `stockValueIqd`, `lowStock`, `belowPar`,
 *                    `expiringSoon`, `expired`, `consumption`, `variance`
 *   report_staff_activity  rows per person with nested `discounts` / `voids` /
 *                    `refunds` / `waiterCallResponse` / `dayCloses` / `shiftContext`
 *
 * So on the running app the revenue table showed Period and Orders only (the
 * two names that happened to match), every view of a report showed the same
 * table, the stock report always said "Nothing to report", staff exceptions
 * printed as JSON, and no row could be drilled into. Each report now reads its
 * own payload here, by the keys the SQL writes.
 *
 * Nothing here adds, divides or rounds a figure. A field the payload does not
 * carry is `null`, which the screen prints as "—", never as 0.
 */

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj).filter((r): r is Raw => r !== null) : [];
}
/** A number, or null when absent. Postgres bigint/numeric can arrive as a string. */
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/** A bilingual name as the payloads carry it. */
export interface Names {
  en: string | null;
  ar: string | null;
}

// ---------------------------------------------------------------------------
// Revenue (report_revenue, 0099)
// ---------------------------------------------------------------------------

export interface RevenueFigures {
  padelIqd: number | null;
  /** Cafe sales before refunds. */
  cafeIqd: number | null;
  /** Cafe sales after refunds — the cafe half of revenue. */
  cafeNetIqd: number | null;
  /** Padel + cafe after refunds, as the server adds it. */
  totalIqd: number | null;
  cashIqd: number | null;
  cardIqd: number | null;
  discountsIqd: number | null;
  voidsIqd: number | null;
  refundsIqd: number | null;
  taxIqd: number | null;
  orders: number | null;
  bookings: number | null;
}

export interface RevenueRow extends RevenueFigures {
  /** First day of the bucket, `YYYY-MM-DD`. */
  period: string;
}

export interface RevenueReport {
  group: 'day' | 'week' | 'month' | null;
  rows: RevenueRow[];
  totals: RevenueFigures | null;
}

function revenueFigures(r: Raw): RevenueFigures {
  return {
    padelIqd: num(r.padelIqd),
    cafeIqd: num(r.cafeIqd),
    cafeNetIqd: num(r.cafeNetIqd),
    totalIqd: num(r.totalIqd),
    cashIqd: num(r.cashIqd),
    cardIqd: num(r.cardIqd),
    discountsIqd: num(r.discountsIqd),
    voidsIqd: num(r.voidsIqd),
    refundsIqd: num(r.refundsIqd),
    taxIqd: num(r.taxIqd),
    orders: num(r.orders),
    bookings: num(r.bookings),
  };
}

export function readRevenue(payload: unknown): RevenueReport {
  const p = obj(payload) ?? {};
  const group = p.group === 'day' || p.group === 'week' || p.group === 'month' ? p.group : null;
  const rows = list(p.rows)
    .map((r) => ({ period: str(r.period) ?? '', ...revenueFigures(r) }))
    .filter((r) => r.period !== '');
  const totals = obj(p.totals);
  return { group, rows, totals: totals ? revenueFigures(totals) : null };
}

// ---------------------------------------------------------------------------
// Courts (report_courts, 0097)
// ---------------------------------------------------------------------------

export interface CourtRow {
  courtId: string;
  name: Names;
  isActive: boolean;
  /** Kept bookings: confirmed, arrived or completed. */
  bookings: number | null;
  bookedMinutes: number | null;
  availableMinutes: number | null;
  occupancyPct: number | null;
  revenueIqd: number | null;
  revenuePerOpenHourIqd: number | null;
  cancellations: number | null;
  noShows: number | null;
  cancellationRatePct: number | null;
  noShowRatePct: number | null;
  peakBookings: number | null;
  offPeakBookings: number | null;
}

export interface CourtTotals {
  bookings: number | null;
  bookedMinutes: number | null;
  availableMinutes: number | null;
  occupancyPct: number | null;
  revenueIqd: number | null;
  cancellations: number | null;
  noShows: number | null;
  peakBookings: number | null;
  offPeakBookings: number | null;
}

export interface CourtsReport {
  rows: CourtRow[];
  totals: CourtTotals | null;
  /** Kept bookings by the venue-local hour they start, 0–23. */
  byHour: { hour: number; bookings: number | null }[];
  /** Only the business days that had a kept booking. */
  trend: { date: string; bookings: number | null; revenueIqd: number | null }[];
}

export function readCourts(payload: unknown): CourtsReport {
  const p = obj(payload) ?? {};
  const rows: CourtRow[] = list(p.rows)
    .filter((r) => str(r.courtId))
    .map((r) => ({
      courtId: str(r.courtId)!,
      name: { en: str(r.courtNameEn), ar: str(r.courtNameAr) },
      isActive: r.isActive !== false,
      bookings: num(r.bookings),
      bookedMinutes: num(r.bookedMinutes),
      availableMinutes: num(r.availableMinutes),
      occupancyPct: num(r.occupancyPct),
      revenueIqd: num(r.revenueIqd),
      revenuePerOpenHourIqd: num(r.revenuePerAvailableHourIqd),
      cancellations: num(r.cancellations),
      noShows: num(r.noShows),
      cancellationRatePct: num(r.cancellationRatePct),
      noShowRatePct: num(r.noShowRatePct),
      peakBookings: num(r.peakBookings),
      offPeakBookings: num(r.offPeakBookings),
    }));
  const t = obj(p.totals);
  const totals: CourtTotals | null = t
    ? {
        bookings: num(t.bookings),
        bookedMinutes: num(t.bookedMinutes),
        availableMinutes: num(t.availableMinutes),
        occupancyPct: num(t.occupancyPct),
        revenueIqd: num(t.revenueIqd),
        cancellations: num(t.cancellations),
        noShows: num(t.noShows),
        peakBookings: num(t.peakBookings),
        offPeakBookings: num(t.offPeakBookings),
      }
    : null;
  const byHour = list(p.byHour)
    .map((h) => ({ hour: num(h.hour), bookings: num(h.bookings) }))
    .filter((h): h is { hour: number; bookings: number | null } => h.hour !== null);
  const trend = list(p.trend)
    .map((d) => ({ date: str(d.date) ?? '', bookings: num(d.bookings), revenueIqd: num(d.revenueIqd) }))
    .filter((d) => d.date !== '');
  return { rows, totals, byHour, trend };
}

/** No courts, or nothing booked, cancelled or missed on any of them. */
export function courtsIsEmpty(r: CourtsReport): boolean {
  if (r.rows.length === 0) return true;
  const t = r.totals;
  return t !== null && !t.bookings && !t.cancellations && !t.noShows;
}

// ---------------------------------------------------------------------------
// Cafe (report_cafe, 0096)
// ---------------------------------------------------------------------------

export interface CafeItemRow {
  itemId: string;
  name: Names;
  category: Names;
  qty: number | null;
  orders: number | null;
  /** Net of discounts and refunds. */
  revenueIqd: number | null;
  /** Null when any line of the item had no recorded cost. */
  cogsIqd: number | null;
  grossProfitIqd: number | null;
  marginPct: number | null;
}

export interface CafeCategoryRow {
  categoryId: string;
  name: Names;
  items: number | null;
  qty: number | null;
  revenueIqd: number | null;
  cogsIqd: number | null;
  grossProfitIqd: number | null;
  marginPct: number | null;
}

export interface CafeSummary {
  orders: number | null;
  qty: number | null;
  avgOrderValueIqd: number | null;
  revenueIqd: number | null;
  cogsIqd: number | null;
  /** Profit on the items that HAVE a cost only. */
  grossProfitIqd: number | null;
  marginPct: number | null;
  /** Share of revenue from items with a cost. */
  cogsCoveragePct: number | null;
  itemsWithCogs: number | null;
  itemsTotal: number | null;
}

export interface WasteReasonRow {
  /** A reason code, or the movement type when none was given. */
  reason: string;
  count: number | null;
  costIqd: number | null;
}

export interface CafeReport {
  items: CafeItemRow[];
  categories: CafeCategoryRow[];
  summary: CafeSummary | null;
  waste: WasteReasonRow[];
  prep: { avgSeconds: number | null; p90Seconds: number | null; count: number | null } | null;
}

export function readCafe(payload: unknown): CafeReport {
  const p = obj(payload) ?? {};
  const items: CafeItemRow[] = list(p.rows)
    .filter((r) => str(r.itemId))
    .map((r) => ({
      itemId: str(r.itemId)!,
      name: { en: str(r.nameEn), ar: str(r.nameAr) },
      category: { en: str(r.categoryNameEn), ar: str(r.categoryNameAr) },
      qty: num(r.qty),
      orders: num(r.orders),
      revenueIqd: num(r.revenueIqd),
      cogsIqd: num(r.cogsIqd),
      grossProfitIqd: num(r.grossProfitIqd),
      marginPct: num(r.marginPct),
    }));
  const categories: CafeCategoryRow[] = list(p.byCategory)
    .filter((r) => str(r.categoryId))
    .map((r) => ({
      categoryId: str(r.categoryId)!,
      name: { en: str(r.categoryNameEn), ar: str(r.categoryNameAr) },
      items: num(r.items),
      qty: num(r.qty),
      revenueIqd: num(r.revenueIqd),
      cogsIqd: num(r.cogsIqd),
      grossProfitIqd: num(r.grossProfitIqd),
      marginPct: num(r.marginPct),
    }));
  const s = obj(p.summary) ?? obj(p.totals);
  const summary: CafeSummary | null = s
    ? {
        orders: num(s.orders),
        qty: num(s.qty),
        avgOrderValueIqd: num(s.avgOrderValueIqd),
        revenueIqd: num(s.revenueIqd),
        cogsIqd: num(s.cogsIqd),
        grossProfitIqd: num(s.grossProfitIqd),
        marginPct: num(s.marginPct),
        cogsCoveragePct: num(s.cogsCoveragePct),
        itemsWithCogs: num(s.itemsWithCogs),
        itemsTotal: num(s.itemsTotal),
      }
    : null;
  const waste = list(p.wasteByReason)
    .map((w) => ({ reason: str(w.reason) ?? '', count: num(w.count), costIqd: num(w.costIqd) }))
    .filter((w) => w.reason !== '');
  const pr = obj(p.prepTimes);
  const prep = pr ? { avgSeconds: num(pr.avgSeconds), p90Seconds: num(pr.p90Seconds), count: num(pr.count) } : null;
  return { items, categories, summary, waste, prep };
}

/** True when the period sold nothing and wrote nothing off. */
export function cafeIsEmpty(r: CafeReport): boolean {
  return r.items.length === 0 && r.waste.length === 0 && !(r.summary?.orders);
}

// ---------------------------------------------------------------------------
// Stock (report_stock, 0068)
// ---------------------------------------------------------------------------

interface StockBase {
  ingredientId: string;
  name: Names;
  unit: string | null;
}
export interface LowStockRow extends StockBase {
  onHand: number | null;
  threshold: number | null;
  parLevel: number | null;
}
export interface BelowParRow extends StockBase {
  onHand: number | null;
  parLevel: number | null;
  shortfall: number | null;
}
export interface ExpiryRow extends StockBase {
  batchId: string;
  qtyRemaining: number | null;
  expiryDate: string | null;
  /** Days left (expiring soon) or days since (expired). */
  days: number | null;
  valueIqd: number | null;
}
export interface ConsumptionRow extends StockBase {
  consumedQty: number | null;
  costIqd: number | null;
}
export interface VarianceRow extends StockBase {
  countId: string;
  countedAt: string | null;
  theoreticalQty: number | null;
  countedQty: number | null;
  varianceQty: number | null;
}

export interface StockReport {
  /** Everything on the shelves now, at what it cost. Not ranged. */
  valueIqd: number | null;
  low: LowStockRow[];
  belowPar: BelowParRow[];
  expiringSoon: ExpiryRow[];
  expired: ExpiryRow[];
  consumption: ConsumptionRow[];
  variance: VarianceRow[];
}

function stockBase(r: Raw): StockBase | null {
  const id = str(r.ingredientId);
  if (!id) return null;
  return { ingredientId: id, name: { en: str(r.nameEn), ar: str(r.nameAr) }, unit: str(r.unit) };
}

export function readStock(payload: unknown): StockReport {
  const p = obj(payload) ?? {};
  const each = <T,>(v: unknown, build: (base: StockBase, r: Raw) => T): T[] =>
    list(v).flatMap((r) => {
      const base = stockBase(r);
      return base ? [build(base, r)] : [];
    });
  const expiry = (key: 'daysLeft' | 'daysExpired') => (base: StockBase, r: Raw): ExpiryRow => ({
    ...base,
    batchId: str(r.batchId) ?? base.ingredientId,
    qtyRemaining: num(r.qtyRemaining),
    expiryDate: str(r.expiryDate),
    days: num(r[key]),
    valueIqd: num(r.valueIqd),
  });
  return {
    valueIqd: num(p.stockValueIqd),
    low: each(p.lowStock, (b, r) => ({ ...b, onHand: num(r.onHand), threshold: num(r.threshold), parLevel: num(r.parLevel) })),
    belowPar: each(p.belowPar, (b, r) => ({ ...b, onHand: num(r.onHand), parLevel: num(r.parLevel), shortfall: num(r.shortfall) })),
    expiringSoon: each(p.expiringSoon, expiry('daysLeft')),
    expired: each(p.expired, expiry('daysExpired')),
    consumption: each(p.consumption, (b, r) => ({ ...b, consumedQty: num(r.consumedQty), costIqd: num(r.costIqd) })),
    variance: each(p.variance, (b, r) => ({
      ...b,
      countId: str(r.countId) ?? '',
      countedAt: str(r.periodEnd),
      theoreticalQty: num(r.theoreticalQty),
      countedQty: num(r.countedQty),
      varianceQty: num(r.varianceQty),
    })),
  };
}

// ---------------------------------------------------------------------------
// Staff activity (report_staff_activity, 0068)
// ---------------------------------------------------------------------------

export interface CountAmount {
  count: number | null;
  amountIqd: number | null;
}

export interface StaffRow {
  staffId: string;
  name: string;
  role: string | null;
  isActive: boolean;
  ordersTaken: number | null;
  bookingsCreated: number | null;
  paymentsTaken: number | null;
  discounts: CountAmount;
  voids: CountAmount;
  refunds: CountAmount;
  callsAnswered: number | null;
  avgAnswerSeconds: number | null;
  /** Distinct business days with anything recorded — not rostered shifts. */
  daysActive: number | null;
  busiestDayOrders: number | null;
  dayCloses: { businessDate: string; cashVarianceIqd: number | null }[];
}

export interface DayCloseRow {
  staffId: string;
  closedBy: string;
  businessDate: string;
  cashVarianceIqd: number | null;
}

function countAmount(v: unknown): CountAmount {
  const o = obj(v);
  return { count: num(o?.count), amountIqd: num(o?.amountIqd) };
}

export function readStaff(payload: unknown): StaffRow[] {
  const p = obj(payload) ?? {};
  return list(p.rows)
    .filter((r) => str(r.staffId))
    .map((r) => {
      const calls = obj(r.waiterCallResponse);
      const shift = obj(r.shiftContext);
      return {
        staffId: str(r.staffId)!,
        name: str(r.name) ?? '—',
        role: str(r.role),
        isActive: r.isActive !== false,
        ordersTaken: num(r.ordersTaken),
        bookingsCreated: num(r.bookingsCreated),
        paymentsTaken: num(r.paymentsTaken),
        discounts: countAmount(r.discounts),
        voids: countAmount(r.voids),
        refunds: countAmount(r.refunds),
        callsAnswered: num(calls?.count),
        avgAnswerSeconds: num(calls?.avgSeconds),
        daysActive: num(shift?.daysWorked),
        busiestDayOrders: num(shift?.busiestDayOrders),
        dayCloses: list(r.dayCloses)
          .map((d) => ({ businessDate: str(d.businessDate) ?? '', cashVarianceIqd: num(d.cashVarianceIqd) }))
          .filter((d) => d.businessDate !== ''),
      };
    });
}

/** Every day close in the period, newest first, with who closed it. */
export function dayClosesOf(rows: readonly StaffRow[]): DayCloseRow[] {
  return rows
    .flatMap((r) => r.dayCloses.map((d) => ({ staffId: r.staffId, closedBy: r.name, businessDate: d.businessDate, cashVarianceIqd: d.cashVarianceIqd })))
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate));
}

// ---------------------------------------------------------------------------
// Drill-through (report_drill)
// ---------------------------------------------------------------------------

export type DrillKind = 'reservation' | 'tab' | 'payment' | 'refund' | 'adjustment' | 'waste';

export interface DrillTransaction {
  id: string;
  at: string | null;
  kind: string | null;
  label: string | null;
  amountIqd: number | null;
  staffName: string | null;
  /** The facts behind `label`, when the server sends them (0102). */
  detail: Record<string, unknown> | null;
}

export function readDrill(payload: unknown): DrillTransaction[] {
  const p = obj(payload) ?? {};
  return list(p.transactions).map((t, i) => ({
    id: str(t.id) ?? String(i),
    at: str(t.at),
    kind: str(t.kind),
    label: str(t.label),
    amountIqd: num(t.amountIqd ?? t.amount_iqd),
    staffName: str(t.staffName),
    detail: obj(t.detail),
  }));
}

// ---------------------------------------------------------------------------
// Pure helpers the screens share
// ---------------------------------------------------------------------------

/** Stable sort by an accessor; nulls sink in either direction, ties keep server order. */
export function sortBy<T>(rows: readonly T[], value: ((row: T) => string | number | null) | null, dir: 'asc' | 'desc'): T[] {
  if (!value) return [...rows];
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null && b.v === null) return a.index - b.index;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return cmp * sign || a.index - b.index;
    })
    .map((x) => x.row);
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The dates one revenue row covers, for its drill-through: a day is itself, a
 * week runs Monday to Sunday and a month to its last day — both cut to the
 * period on screen, so the transactions never spill past the range the table
 * was read for.
 */
export function bucketRange(start: string, group: 'day' | 'week' | 'month', period: { from: string; to: string }): { from: string; to: string } {
  const m = ISO.exec(start);
  if (!m || group === 'day') return { from: start, to: start };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const end = group === 'week' ? new Date(Date.UTC(y, mo - 1, d + 6)) : new Date(Date.UTC(y, mo, 0));
  const from = start < period.from ? period.from : start;
  const endIso = iso(end);
  return { from, to: endIso > period.to ? period.to : endIso };
}

// ---------------------------------------------------------------------------
// Comparison (app.report_compare, 0103)
// ---------------------------------------------------------------------------

export interface FigureChange {
  previous: number | null;
  changeAbs: number | null;
  changePct: number | null;
}

export interface Compared<T> {
  current: T;
  /** Per headline key, the server's previous value and change. */
  changes: Record<string, FigureChange>;
  period: { from: string; to: string } | null;
}

export function readCompared<T>(payload: unknown, read: (raw: unknown) => T): Compared<T> {
  const p = obj(payload) ?? {};
  const changes: Record<string, FigureChange> = {};
  for (const [key, v] of Object.entries(obj(p.changes) ?? {})) {
    const c = obj(v);
    if (c) changes[key] = { previous: num(c.previous), changeAbs: num(c.changeAbs), changePct: num(c.changePct) };
  }
  const cmp = obj(p.comparison);
  const from = cmp ? str(cmp.from) : null;
  const to = cmp ? str(cmp.to) : null;
  return { current: read(p.current), changes, period: from && to ? { from, to } : null };
}

/**
 * Pure day-grid assembly: raw DB rows -> @touch/core buildSlotGrid input ->
 * per-court slots priced via resolveRateRule. No RN / supabase imports —
 * unit-tested under plain node. The server (exclusion constraint +
 * app.price_slot) stays the authority; this only paints the grid.
 */
import {
  buildSlotGrid,
  resolveRateRule,
  localParts,
  iqd,
  type CourtSlots,
  type OpeningHours,
  type RateRule,
  type RateRulePrice,
  type ReservationInput,
  type Slot,
} from '@touch/core';

/** courts row subset (bilingual names resolved by the screen via pickLocale). */
export interface CourtRow {
  id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  indoor: boolean;
  photo_path: string | null;
  duration_options: number[];
  sort_order: number;
}

/** court_availability view row (0008): busy ranges, zero PII, holds pre-filtered by TTL. */
export interface AvailabilityRow {
  court_id: string | null;
  start_at: string | null;
  end_at: string | null;
  kind: 'booking' | 'hold' | 'maintenance' | null;
}

export interface RateRuleRow {
  id: string;
  court_id: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  priority: number;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
}

export interface RateRulePriceRow {
  rule_id: string;
  duration_min: number;
  price_iqd: number;
}

export interface VenueSettingsPublic {
  venue_name: string | null;
  timezone: string | null;
  opening_hours: unknown;
  closed_dates: string[] | null;
  cancellation_window_hours: number | null;
  /** Venue contact number for the degraded-mode message. Optional: the column
   *  lands with a later migration — treat null/absent identically. */
  phone?: string | null;
}

export const DEFAULT_TZ = 'Asia/Baghdad';

/** 'YYYY-MM-DD' for today (venue-local) plus the next `extraDays` days. */
export function listBookableDates(now: Date, tz: string, extraDays = 14): string[] {
  const today = localParts(now, tz);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const dates: string[] = [];
  for (let i = 0; i <= extraDays; i++) {
    const d = new Date(base + i * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    dates.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return dates;
}

/** HH:MM:SS -> HH:MM (rate_rules times come back with seconds). */
function hhmm(time: string): string {
  return time.slice(0, 5);
}

export interface AssembleArgs {
  /** Venue-local calendar day, 'YYYY-MM-DD'. */
  date: string;
  settings: Pick<VenueSettingsPublic, 'timezone' | 'opening_hours' | 'closed_dates'>;
  courts: readonly CourtRow[];
  availability: readonly AvailabilityRow[];
  rules: readonly RateRuleRow[];
  prices: readonly RateRulePriceRow[];
  now: Date;
}

/**
 * Build the priced per-court grid for one day.
 *
 * court_availability rows carry no status/TTL (the view already filters to
 * blocking, unexpired rows), so every row maps to a blocking ReservationInput;
 * holds use end_at as a conservative holdExpiresAt (a hold never outlives its
 * slot, and the view guaranteed it was live at fetch time).
 */
export function assembleDayGrid(args: AssembleArgs): CourtSlots[] {
  const tz = args.settings.timezone ?? DEFAULT_TZ;

  const reservations: ReservationInput[] = [];
  for (const row of args.availability) {
    if (!row.court_id || !row.start_at || !row.end_at || !row.kind) continue;
    reservations.push({
      courtId: row.court_id,
      kind: row.kind,
      status: 'confirmed', // the view only exposes blocking rows
      startAt: new Date(row.start_at),
      endAt: new Date(row.end_at),
      holdExpiresAt: row.kind === 'hold' ? new Date(row.end_at) : null,
    });
  }

  const rules: RateRule[] = args.rules.map((r) => ({
    id: r.id,
    courtId: r.court_id,
    daysOfWeek: r.days_of_week,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    priority: r.priority,
    validFrom: r.valid_from,
    validTo: r.valid_to,
    isActive: r.is_active,
  }));
  const prices: RateRulePrice[] = args.prices.map((p) => ({
    ruleId: p.rule_id,
    durationMin: p.duration_min,
    priceIqd: iqd(p.price_iqd),
  }));

  return buildSlotGrid({
    date: args.date,
    openingHours: (args.settings.opening_hours ?? {}) as OpeningHours,
    closedDates: args.settings.closed_dates ?? [],
    courts: args.courts.map((c) => ({ id: c.id, durationOptions: c.duration_options })),
    reservations,
    now: args.now,
    tz,
    price: (courtId, startAt, durationMin) =>
      resolveRateRule(rules, prices, courtId, startAt, durationMin, tz)?.priceIqd ?? null,
  });
}

/** One tappable grid cell: a start time with its bookable duration options. */
export interface GridCell {
  startAt: Date;
  /** Overall cell state = state of the shortest-duration slot at this start. */
  state: Slot['state'];
  options: Array<{ durationMin: number; state: Slot['state']; priceIqd: number | null }>;
}

/** Group a court's slots by start time for rendering (sorted by start). */
export function groupByStart(slots: readonly Slot[]): GridCell[] {
  const byStart = new Map<number, GridCell>();
  for (const s of slots) {
    const key = s.startAt.getTime();
    let cell = byStart.get(key);
    if (!cell) {
      cell = { startAt: s.startAt, state: s.state, options: [] };
      byStart.set(key, cell);
    }
    cell.options.push({ durationMin: s.durationMin, state: s.state, priceIqd: s.priceIqd });
  }
  const cells = [...byStart.values()];
  for (const cell of cells) {
    cell.options.sort((a, b) => a.durationMin - b.durationMin);
    // Cell paints "free" if ANY duration at this start is bookable.
    cell.state = cell.options.some((o) => o.state === 'free')
      ? 'free'
      : (cell.options[0]?.state ?? 'past');
  }
  cells.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return cells;
}

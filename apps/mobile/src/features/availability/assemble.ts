/**
 * Pure day-grid assembly: raw DB rows -> @touch/core buildSlotGrid input ->
 * per-court slots priced via resolveRateRule. No RN / supabase imports —
 * unit-tested under plain node. The server (exclusion constraint +
 * app.price_slot) stays the authority; this only paints the grid.
 */
import {
  buildSlotGrid,
  displayWindows,
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
  options: { durationMin: number; state: Slot['state']; priceIqd: number | null }[];
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

/**
 * Venue contact number for the degraded-mode message (venue_settings_public.phone).
 *
 * Lives here, shared, because it used to be duplicated: availability.tsx read
 * `.phone` correctly while confirm.tsx read `.venue_phone` — a column that does
 * not exist — behind an `as` cast that silenced the type error. The guest hit
 * by the degraded lockout at confirm time therefore never saw the phone number
 * the SOW requires (L676-678). One definition, one column name.
 */
export function venuePhoneOf(settings: unknown): string | null {
  const p = (settings as { phone?: unknown } | null | undefined)?.phone;
  return typeof p === 'string' && p.trim().length > 0 ? p : null;
}

// ── Merged capacity grid (design 2026-08-31) ─────────────────────────────────
// The venue has two interchangeable courts and the desk assigns the physical
// one, so the app shows ONE timeline: each start time carries how many courts
// are free and which court a hold should target. Pure — unit-tested.

export type MergedState = Slot['state'] | 'horizon';

export interface MergedCell {
  startAt: Date;
  state: MergedState;
  /** Courts free at this start for the selected duration. */
  freeCount: number;
  /** Courts offering this duration at this start at all. */
  capacity: number;
  /** Price of the cheapest free court (null when none is free/priced). */
  priceIqd: number | null;
  /** The court a hold should target — cheapest free one. */
  courtId: string | null;
}

/**
 * Collapse per-court slots into per-start capacity cells for one duration.
 *
 * State resolution: any free court -> 'free'; otherwise the "most explanatory"
 * blocked-ish state wins (blocked > held > booked); all-past -> 'past'. When
 * `horizonEnd` is set (degraded mode), every not-yet-past cell starting before
 * it renders 'horizon' ("desk only") — the server refuses those holds anyway;
 * this just says so before the tap instead of after.
 */
export function mergeAcrossCourts(
  grid: readonly CourtSlots[],
  durationMin: number,
  horizonEnd?: Date | null,
): MergedCell[] {
  const byStart = new Map<number, { startAt: Date; options: { courtId: string; slot: Slot }[] }>();
  for (const court of grid) {
    for (const slot of court.slots) {
      if (slot.durationMin !== durationMin) continue;
      const key = slot.startAt.getTime();
      let cell = byStart.get(key);
      if (!cell) {
        cell = { startAt: slot.startAt, options: [] };
        byStart.set(key, cell);
      }
      cell.options.push({ courtId: court.courtId, slot });
    }
  }

  const cells: MergedCell[] = [];
  for (const { startAt, options } of byStart.values()) {
    const free = options
      .filter((o) => o.slot.state === 'free')
      .sort((a, b) => (a.slot.priceIqd ?? Number.MAX_SAFE_INTEGER) - (b.slot.priceIqd ?? Number.MAX_SAFE_INTEGER));
    const cheapest = free[0] ?? null;
    let state: MergedState;
    if (cheapest) state = 'free';
    else if (options.every((o) => o.slot.state === 'past')) state = 'past';
    else if (options.some((o) => o.slot.state === 'blocked')) state = 'blocked';
    else if (options.some((o) => o.slot.state === 'held')) state = 'held';
    else state = 'booked';

    if (horizonEnd && state !== 'past' && startAt.getTime() < horizonEnd.getTime()) {
      state = 'horizon';
    }

    cells.push({
      startAt,
      state,
      freeCount: free.length,
      capacity: options.length,
      priceIqd: cheapest?.slot.priceIqd ?? null,
      courtId: cheapest?.courtId ?? null,
    });
  }
  cells.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return cells;
}

// ── "Open now" pill (design 2026-08-31, courts home) ─────────────────────────

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export interface OpenNowInfo {
  open: boolean;
  /** Today's display hours with the overnight tail folded ('09:00–02:00'). */
  label: string;
}

/**
 * Whether the venue is open at `now`, plus today's printable hours. Uses the
 * raw per-day windows (the post-midnight tail lives on the calendar day it
 * falls in, so a 00:30 check reads today's own '00:00–02:00' window), and
 * @touch/core's displayWindows for the human label.
 */
export function openNowInfo(
  settings: Pick<VenueSettingsPublic, 'timezone' | 'opening_hours' | 'closed_dates'> | undefined,
  now: Date,
): OpenNowInfo | null {
  if (!settings?.opening_hours) return null;
  const tz = settings.timezone ?? DEFAULT_TZ;
  const hours = settings.opening_hours as OpeningHours;
  const parts = localParts(now, tz);
  const todayKey = DAY_KEYS[parts.dayOfWeek];
  const nextKey = DAY_KEYS[(parts.dayOfWeek + 1) % 7];
  if (!todayKey || !nextKey) return null;

  const closedToday = (settings.closed_dates ?? []).includes(parts.date);

  const nowMin = parts.minutesOfDay;
  const inWindow = (w: readonly [string, string]) => {
    const openMin = hhmmToMin(w[0]);
    const closeMin = w[1] === '24:00' ? 1440 : hhmmToMin(w[1]);
    return nowMin >= openMin && nowMin < closeMin;
  };
  const open = !closedToday && (hours[todayKey] ?? []).some(inWindow);

  const shown = displayWindows(hours[todayKey], hours[nextKey]);
  const label = shown.map((w) => `${w[0]}–${w[1] === '24:00' ? '00:00' : w[1]}`).join(' · ');
  return { open, label };
}

function hhmmToMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
}

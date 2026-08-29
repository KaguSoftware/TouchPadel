import { dayOfWeekOfDate, parseHHMM, wallTimeToUtc } from '../time/tz';
import type { IQD } from '../money/iqd';

/**
 * Pure slot-grid construction for one venue-local calendar day. This mirrors what the desk
 * calendar / mobile grid render; the server's exclusion constraint remains the authority on
 * what can actually be written.
 *
 * Conventions:
 * - All ranges are half-open [startAt, endAt): a booking 18:00-19:00 does NOT collide with a
 *   slot starting at 19:00.
 * - A SINGLE window that wraps past midnight (close <= open) is unsupported and throws. Touch
 *   trades 09:00-02:00, and that is expressed as two windows on adjacent calendar days --
 *   `[["00:00","02:00"],["09:00","24:00"]]` -- which this builder already handles as an ordinary
 *   split day. See `../time/openingHours.ts` for the conversion.
 * - A slot must fit ENTIRELY inside one window, so midnight is a hard slot boundary: with 60-min
 *   durations on a 30-min grid the starts run ...22:30, 23:00 | 00:00, 00:30, 01:00. The 23:30
 *   start is deliberately not offered (decision 2026-08-29).
 * - A date listed in closedDates yields an empty slot list (nothing bookable, nothing shown).
 * - Expired holds (holdExpiresAt <= now) count as free — matching the DB's lazy-expiry reads.
 */

export type SlotState = 'free' | 'held' | 'booked' | 'blocked' | 'past';

export interface Slot {
  startAt: Date;
  endAt: Date;
  durationMin: number;
  state: SlotState;
  priceIqd: IQD | null;
}

export interface CourtSlots {
  courtId: string;
  slots: Slot[];
}

export type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

/** venue_settings.opening_hours shape: {"mon":[["09:00","23:00"]],...} (design-data.md 1.2). */
export type OpeningHours = Partial<Record<DayKey, ReadonlyArray<readonly [string, string]>>>;

/** Reservation statuses that occupy a slot (mirror of the exclusion-constraint predicate). */
const BLOCKING_STATUSES = new Set(['pending', 'confirmed', 'arrived']);

export interface ReservationInput {
  courtId: string;
  kind: 'booking' | 'maintenance' | 'hold';
  status: string; // reservation_status; only pending/confirmed/arrived block
  startAt: Date;
  endAt: Date;
  /** Required for kind='hold' rows passed here instead of via `holds`. */
  holdExpiresAt?: Date | null;
}

export interface HoldInput {
  courtId: string;
  startAt: Date;
  endAt: Date;
  holdExpiresAt: Date;
}

export interface CourtInput {
  id: string;
  /** courts.duration_options, minutes (e.g. [60, 90, 120]). */
  durationOptions: readonly number[];
}

export interface BuildSlotGridArgs {
  /** Venue-local calendar day to build, 'YYYY-MM-DD'. */
  date: string;
  openingHours: OpeningHours;
  closedDates?: readonly string[];
  courts: readonly CourtInput[];
  reservations?: readonly ReservationInput[];
  holds?: readonly HoldInput[];
  now: Date;
  /** IANA venue timezone, e.g. 'Asia/Baghdad'. */
  tz: string;
  /** Grid granularity for slot starts; default 30 minutes. */
  slotIncrementMin?: number;
  /** Optional pricing hook (wrap resolveRateRule); priceIqd is null when omitted or unmatched. */
  price?: (courtId: string, startAt: Date, durationMin: number) => IQD | null;
}

const DAY_KEYS: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function overlaps(aStartMs: number, aEndMs: number, bStart: Date, bEnd: Date): boolean {
  return bStart.getTime() < aEndMs && aStartMs < bEnd.getTime();
}

/**
 * State precedence per slot: blocked (maintenance) > booked > past (slot already started) >
 * held (unexpired hold) > free. A running booking therefore still shows as booked, while a
 * free-but-started slot shows as past; a hold whose start has passed is moot.
 */
function slotState(
  courtId: string,
  startMs: number,
  endMs: number,
  nowMs: number,
  reservations: readonly ReservationInput[],
  holds: readonly HoldInput[],
): SlotState {
  let booked = false;
  let held = false;
  for (const r of reservations) {
    if (r.courtId !== courtId) continue;
    if (!BLOCKING_STATUSES.has(r.status)) continue;
    if (!overlaps(startMs, endMs, r.startAt, r.endAt)) continue;
    if (r.kind === 'maintenance') return 'blocked';
    if (r.kind === 'hold') {
      // tolerated alternative to the `holds` array; expired holds are free
      if (r.holdExpiresAt != null && r.holdExpiresAt.getTime() > nowMs) held = true;
      continue;
    }
    booked = true;
  }
  if (booked) return 'booked';
  if (startMs < nowMs) return 'past';
  if (!held) {
    for (const h of holds) {
      if (h.courtId !== courtId) continue;
      if (h.holdExpiresAt.getTime() <= nowMs) continue; // expired => free
      if (overlaps(startMs, endMs, h.startAt, h.endAt)) {
        held = true;
        break;
      }
    }
  }
  return held ? 'held' : 'free';
}

export function buildSlotGrid(args: BuildSlotGridArgs): CourtSlots[] {
  const {
    date,
    openingHours,
    closedDates = [],
    courts,
    reservations = [],
    holds = [],
    now,
    tz,
    slotIncrementMin = 30,
    price,
  } = args;

  if (!Number.isInteger(slotIncrementMin) || slotIncrementMin <= 0) {
    throw new RangeError(`slotIncrementMin must be a positive integer, got ${slotIncrementMin}`);
  }

  const dayKey = DAY_KEYS[dayOfWeekOfDate(date)] as DayKey;
  const windows: Array<[number, number]> = [];
  if (!closedDates.includes(date)) {
    for (const [open, close] of openingHours[dayKey] ?? []) {
      const o = parseHHMM(open);
      const c = parseHHMM(close);
      if (c <= o) {
        throw new RangeError(
          `opening window ${open}-${close} wraps past midnight; store it as two windows on ` +
            `adjacent days (see @touch/core splitOvernight)`,
        );
      }
      windows.push([o, c]);
    }
  }

  const nowMs = now.getTime();

  return courts.map((court) => {
    const durations = [...court.durationOptions].sort((a, b) => a - b);
    const slots: Slot[] = [];
    for (const [open, close] of windows) {
      for (let startMin = open; startMin < close; startMin += slotIncrementMin) {
        for (const durationMin of durations) {
          if (!Number.isInteger(durationMin) || durationMin <= 0) {
            throw new RangeError(`invalid duration option ${durationMin} on court ${court.id}`);
          }
          if (startMin + durationMin > close) continue; // slot must fit inside the window
          const startAt = wallTimeToUtc(date, startMin, tz);
          const endAt = wallTimeToUtc(date, startMin + durationMin, tz);
          const state = slotState(
            court.id,
            startAt.getTime(),
            endAt.getTime(),
            nowMs,
            reservations,
            holds,
          );
          slots.push({
            startAt,
            endAt,
            durationMin,
            state,
            priceIqd: price ? price(court.id, startAt, durationMin) : null,
          });
        }
      }
    }
    slots.sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime() || a.durationMin - b.durationMin,
    );
    return { courtId: court.id, slots };
  });
}

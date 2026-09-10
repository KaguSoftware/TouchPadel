/**
 * Minimal IANA-timezone helpers built on Intl (zero runtime deps). Business logic runs in UTC;
 * the venue timezone (venue_settings.timezone, 'Asia/Baghdad') only matters when mapping wall
 * clock concepts — opening hours, rate-rule windows, days of week — onto instants.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(tz: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(tz, dtf);
  }
  return dtf;
}

const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Decomposed instants, keyed by the EXACT instant + zone.
 *
 * `formatToParts` is the single most expensive call in the whole availability
 * path, and the grid asks for the same instants over and over: `wallTimeToUtc`
 * probes twice per call (and its second probe lands on the instant it is about
 * to return), every duration option on a start time re-derives the same start,
 * both courts derive the same grid, and `resolveRateRule` then asks again for
 * the very instant the builder just produced. One trading night came to 620
 * `formatToParts` calls over ~50 distinct instants.
 *
 * That is cheap under Node's ICU and anything but cheap on the phone: Hermes
 * implements Intl over the platform's formatter, so each call crosses into
 * Java/ICU, and 620 of them is a ~200 ms block of the JS thread. On the Book
 * tab that thread is also drawing the 3D court's rally from a rAF loop, so the
 * whole assembly reads as the court freezing for a fifth of a second every
 * time a day chip is tapped (owner, 2026-09-10).
 *
 * The key is the instant itself, not a bucket or an assumed offset, so this is
 * memoisation and not an approximation: same input, same answer, DST and all.
 * Bounded and least-recently-used — the minute tick that re-derives the day
 * strip mints a fresh instant every 60 s, so an unbounded map would only ever
 * grow.
 */
const PARTS_CACHE_MAX = 512;
const partsCache = new Map<string, LocalParts>();

export interface LocalParts {
  /** Venue-local calendar date, 'YYYY-MM-DD'. */
  date: string;
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /** Minutes since venue-local midnight (0..1439). */
  minutesOfDay: number;
  seconds: number;
  /** 0=Sun .. 6=Sat, venue-local (matches rate_rules.days_of_week). */
  dayOfWeek: number;
}

/**
 * Decompose a UTC instant into venue-local wall-clock parts.
 *
 * The result is SHARED between callers for a given instant (see `partsCache`),
 * so treat it as read-only — every caller in this repo only reads it.
 */
export function localParts(instant: Date, tz: string): LocalParts {
  const ts = instant.getTime();
  const key = `${tz}|${ts}`;
  const hit = partsCache.get(key);
  if (hit !== undefined) {
    // Re-insert so the map's iteration order stays least-recently-USED and the
    // eviction below takes the coldest entry rather than the oldest one.
    partsCache.delete(key);
    partsCache.set(key, hit);
    return hit;
  }
  const built = buildLocalParts(instant, tz);
  partsCache.set(key, built);
  while (partsCache.size > PARTS_CACHE_MAX) {
    const coldest = partsCache.keys().next().value;
    if (coldest === undefined) break;
    partsCache.delete(coldest);
  }
  return built;
}

function buildLocalParts(instant: Date, tz: string): LocalParts {
  const parts = getDtf(tz).formatToParts(instant);
  // ONE pass over the parts, not `find` per field: this used to walk the
  // ~13-entry array seven times per instant, on the same JS thread the Book
  // tab's court draws from.
  let year = NaN;
  let month = NaN;
  let day = NaN;
  let hour = NaN;
  let minute = NaN;
  let seconds = NaN;
  let weekday = '';
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        year = Number(part.value);
        break;
      case 'month':
        month = Number(part.value);
        break;
      case 'day':
        day = Number(part.value);
        break;
      case 'hour':
        hour = Number(part.value);
        break;
      case 'minute':
        minute = Number(part.value);
        break;
      case 'second':
        seconds = Number(part.value);
        break;
      case 'weekday':
        weekday = part.value;
        break;
      default:
        break;
    }
  }
  // A part Intl did not return leaves its field NaN, which would otherwise
  // travel silently into a date string or a slot's minute-of-day.
  const need = (type: Intl.DateTimeFormatPartTypes, value: number): number => {
    if (Number.isNaN(value)) {
      throw new RangeError(`Intl did not return part '${type}' for timezone '${tz}'`);
    }
    return value;
  };
  const dayOfWeek = WEEKDAY_TO_INDEX[weekday];
  if (dayOfWeek === undefined) throw new RangeError(`unexpected weekday '${weekday}'`);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return {
    date: `${pad(need('year', year), 4)}-${pad(need('month', month), 2)}-${pad(need('day', day), 2)}`,
    year,
    month,
    day,
    minutesOfDay: need('hour', hour) * 60 + need('minute', minute),
    seconds: need('second', seconds),
    dayOfWeek,
  };
}

/**
 * Parse 'HH:MM' (24h) to minutes since midnight. Throws on malformed input.
 *
 * `24:00` is accepted and returns 1440 — end-of-day. Touch trades 09:00-02:00, and an
 * overnight night is stored as two windows on adjacent calendar days
 * (`[["00:00","02:00"],["09:00","24:00"]]`), so the evening window's exclusive end IS
 * midnight. Postgres already reads it that way (`'24:00'::interval` = 24 hours, which is
 * what `app.assert_bookable` compares a full day segment against); this makes the TS side
 * agree. `24:01`..`24:59` stay invalid — 1440 is a boundary, not an hour.
 */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$|^(24):(00)$/.exec(value);
  if (!m) throw new RangeError(`expected 'HH:MM' (00:00-23:59, or 24:00), got '${value}'`);
  const hh = m[1] ?? m[3];
  const mm = m[2] ?? m[4];
  return Number(hh) * 60 + Number(mm);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Day-of-week (0=Sun..6=Sat) of a calendar date string — tz-independent by construction. */
export function dayOfWeekOfDate(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`expected 'YYYY-MM-DD', got '${date}'`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/**
 * Convert a venue-local wall time (calendar date + minutes since midnight) to the UTC instant.
 * Two-pass fixed-point handles offset transitions; Asia/Baghdad currently has no DST, but this
 * stays correct for zones that do (for a skipped/ambiguous wall time it lands on a nearby valid
 * instant deterministically).
 */
export function wallTimeToUtc(date: string, minutesOfDay: number, tz: string): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new RangeError(`expected 'YYYY-MM-DD', got '${date}'`);
  if (!Number.isInteger(minutesOfDay) || minutesOfDay < 0) {
    throw new RangeError(`minutesOfDay must be a non-negative integer, got ${minutesOfDay}`);
  }
  const desired = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Math.floor(minutesOfDay / 60),
    minutesOfDay % 60,
  );
  let ts = desired;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(ts), tz);
    const actual =
      Date.UTC(p.year, p.month - 1, p.day) + p.minutesOfDay * 60_000 + p.seconds * 1_000;
    ts += desired - actual;
  }
  return new Date(ts);
}

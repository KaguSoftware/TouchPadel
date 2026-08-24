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

/** Decompose a UTC instant into venue-local wall-clock parts. */
export function localParts(instant: Date, tz: string): LocalParts {
  const parts = getDtf(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new RangeError(`Intl did not return part '${type}' for timezone '${tz}'`);
    return p.value;
  };
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const seconds = Number(get('second'));
  const weekday = get('weekday');
  const dayOfWeek = WEEKDAY_TO_INDEX[weekday];
  if (dayOfWeek === undefined) throw new RangeError(`unexpected weekday '${weekday}'`);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return {
    date: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`,
    year,
    month,
    day,
    minutesOfDay: hour * 60 + minute,
    seconds,
    dayOfWeek,
  };
}

/** Parse 'HH:MM' (24h) to minutes since midnight. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new RangeError(`expected 'HH:MM' (00:00-23:59), got '${value}'`);
  return Number(m[1]) * 60 + Number(m[2]);
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

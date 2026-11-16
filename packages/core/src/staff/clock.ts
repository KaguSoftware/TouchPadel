// Staff logging in and out at the club (0442, docs/design/clock-in/contracts-2026-11-15.md).
//
// The desk station draws a QR of `TPCLOCK:<6 digits>`. The digits are an RFC 6238 TOTP (HMAC-SHA1,
// 30-second steps) over the station's own 20-byte secret, computed here, offline, with no
// signed-in account: app.issue_station_clock_key hands the secret to the station once. The SQL
// twin is app.clock_code; packages/db/tests/staff-clock.test.ts and clock.test.ts hold both to
// the RFC 4226 vectors. The phone scans the QR (or the person types the six digits) and sends
// them to app.clock_punch with its location; the server checks both.
import { hotp } from '../loyalty/totp';

export const CLOCK_STEP_SECONDS = 30;
export const CLOCK_QR_PREFIX = 'TPCLOCK:';
const CODE_RE = /^[0-9]{6}$/;

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('clock: secret must be hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The station's code now, the QR text to draw, and seconds until it changes. */
export function clockCode(
  secretHex: string,
  nowMs: number,
): { code: string; qr: string; secondsLeft: number } {
  const secs = Math.floor(nowMs / 1000);
  const code = hotp(hexToBytes(secretHex), Math.floor(secs / CLOCK_STEP_SECONDS));
  return { code, qr: CLOCK_QR_PREFIX + code, secondsLeft: CLOCK_STEP_SECONDS - (secs % CLOCK_STEP_SECONDS) };
}

/** What the phone read or the person typed: the six digits, or null. */
export function parseClockCode(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/\s+/g, '');
  const digits = t.startsWith(CLOCK_QR_PREFIX) ? t.slice(CLOCK_QR_PREFIX.length) : t;
  return CODE_RE.test(digits) ? digits : null;
}

/** Every reason app.clock_punch refuses, in the order it checks. */
export const CLOCK_REFUSALS = [
  'TOO_MANY_TRIES',
  'NO_PLACE',
  'NO_STATION',
  'WRONG_DEVICE',
  'LOCATION_STALE',
  'MOCK_LOCATION',
  'LOCATION_ROUGH',
  'NOT_HERE',
  'CODE_WRONG',
  'ALREADY_IN',
  'NOT_IN',
] as const;
export type ClockRefusal = (typeof CLOCK_REFUSALS)[number];

export type ClockKind = 'in' | 'out';

export type ClockPunchResult =
  | {
      status: 'accepted';
      kind: ClockKind;
      at: string;
      work_date: string;
      late_minutes: number;
      early_minutes: number;
    }
  | {
      status: 'refused';
      reason: ClockRefusal;
      distance_m?: number;
      radius_m?: number;
      accuracy_m?: number;
      max_accuracy_m?: number;
    };

export interface ClockShift {
  starts: string;
  ends: string;
  role: string | null;
  block_starts?: string;
  block_ends?: string;
}

export interface ClockAttempt {
  kind: ClockKind;
  status: 'accepted' | 'refused';
  refusal: ClockRefusal | null;
  at: string;
  late_minutes: number;
  early_minutes: number;
}

/** app.my_clock */
export interface MyClock {
  now: string;
  today: string;
  /** The club's place is set and a live desk station has a code. */
  ready: boolean;
  state: 'in' | 'out';
  since: string | null;
  device_bound: boolean;
  shifts: ClockShift[];
  current: ClockShift | null;
  next: ClockShift | null;
  recent: ClockAttempt[];
}

/** One set-hours row as app.staff_shifts_get returns and app.set_staff_shifts takes it. */
export interface WeekShift {
  /** ISO weekday: 1 Monday .. 7 Sunday. */
  weekday: number;
  /** HH:MM, branch local time. */
  starts_at: string;
  /** HH:MM; at or before starts_at means the next day. */
  ends_at: string;
  /** One of the person's jobs; null = the main job. */
  role: string | null;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minutes a shift lasts (an end at or before the start runs past midnight). */
export function shiftMinutes(s: Pick<WeekShift, 'starts_at' | 'ends_at'>): number {
  const a = minutesOf(s.starts_at);
  const b = minutesOf(s.ends_at);
  return b > a ? b - a : b + 1440 - a;
}

/**
 * The server's rules for a week, checked before saving so the form can say what is wrong:
 * each shift at most 16 hours and not zero, none overlapping on the week's circle (a Sunday
 * night shift runs into Monday). Touching shifts are fine: one block, no scan at the switch.
 * Returns the index of the first bad shift and why, or null.
 */
export function weekProblem(
  week: readonly WeekShift[],
): { index: number; reason: 'empty' | 'too_long' | 'overlap' } | null {
  const spans: { i: number; a: number; b: number }[] = [];
  for (let i = 0; i < week.length; i++) {
    const s = week[i]!;
    if (s.starts_at === s.ends_at) return { index: i, reason: 'empty' };
    const len = shiftMinutes(s);
    if (len > 16 * 60) return { index: i, reason: 'too_long' };
    const a = (s.weekday - 1) * 1440 + minutesOf(s.starts_at);
    spans.push({ i, a, b: a + len }, { i, a: a + 10080, b: a + len + 10080 });
  }
  for (let x = 0; x < spans.length; x++) {
    for (let y = x + 1; y < spans.length; y++) {
      const p = spans[x]!;
      const q = spans[y]!;
      if (p.i !== q.i && p.a < q.b && q.a < p.b) return { index: Math.max(p.i, q.i), reason: 'overlap' };
    }
  }
  return null;
}

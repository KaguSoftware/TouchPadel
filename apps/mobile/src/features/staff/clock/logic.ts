/**
 * Starting and finishing work from the staff phone (0442;
 * docs/design/clock-in/contracts-2026-11-15.md): every decision the work card
 * and the clock page make, as pure functions. The two reads defensively, the
 * card's words and its one button, the steps before the camera opens, which
 * location fix to send, the punch's arguments, and what each answer says.
 *
 * The server decides everything that counts (who is in, where the club is,
 * the code, late and early minutes); the phone only words its answers.
 *
 * PURE (vitest): no react-native, no expo.
 */
import { formatNumber, type Locale, type MessageKey } from '@touch/i18n';
import type { StaffRole } from '@touch/core';
import {
  CLOCK_REFUSALS,
  type ClockAttempt,
  type ClockKind,
  type ClockPunchResult,
  type ClockRefusal,
  type ClockShift,
  type MyClock,
} from '@touch/core/staff/clock';

// ── Who logs hours ──────────────────────────────────────────────────────────

/** app.clock_member_guard: any active staff member but the owner. */
export function clocksIn(mainRole: StaffRole): boolean {
  return mainRole !== 'owner';
}

/** The page's `kind` param: 'in' or 'out', anything else is no page. */
export function kindParam(raw: unknown): ClockKind | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'in' || v === 'out' ? v : null;
}

// ── Reading the server ──────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function readShift(v: unknown): ClockShift | null {
  if (!isObject(v)) return null;
  const starts = str(v.starts);
  const ends = str(v.ends);
  if (!starts || !ends) return null;
  return {
    starts,
    ends,
    role: str(v.role),
    ...(str(v.block_starts) ? { block_starts: str(v.block_starts)! } : {}),
    ...(str(v.block_ends) ? { block_ends: str(v.block_ends)! } : {}),
  };
}

const isRefusal = (v: unknown): v is ClockRefusal =>
  typeof v === 'string' && (CLOCK_REFUSALS as readonly string[]).includes(v);

function readAttempt(v: unknown): ClockAttempt | null {
  if (!isObject(v) || (v.kind !== 'in' && v.kind !== 'out')) return null;
  if (v.status !== 'accepted' && v.status !== 'refused') return null;
  const at = str(v.at);
  if (!at) return null;
  return {
    kind: v.kind,
    status: v.status,
    refusal: isRefusal(v.refusal) ? v.refusal : null,
    at,
    late_minutes: num(v.late_minutes) ?? 0,
    early_minutes: num(v.early_minutes) ?? 0,
  };
}

/** app.my_clock as returned; a payload without its core fields reads as null (the card says it did not load). */
export function readMyClock(payload: unknown): MyClock | null {
  if (!isObject(payload) || typeof payload.ready !== 'boolean') return null;
  if (payload.state !== 'in' && payload.state !== 'out') return null;
  const list = <T>(v: unknown, read: (x: unknown) => T | null): T[] =>
    Array.isArray(v) ? v.map(read).filter((x): x is T => x !== null) : [];
  return {
    now: str(payload.now) ?? new Date().toISOString(),
    today: str(payload.today) ?? '',
    ready: payload.ready,
    state: payload.state,
    since: str(payload.since),
    device_bound: payload.device_bound === true,
    shifts: list(payload.shifts, readShift),
    current: readShift(payload.current),
    next: readShift(payload.next),
    recent: list(payload.recent, readAttempt),
  };
}

/** app.clock_punch as returned; anything that is neither answer is null (shown as a failed send). */
export function readPunchResult(payload: unknown): ClockPunchResult | null {
  if (!isObject(payload)) return null;
  if (payload.status === 'accepted') {
    const at = str(payload.at);
    if (!at || (payload.kind !== 'in' && payload.kind !== 'out')) return null;
    return {
      status: 'accepted',
      kind: payload.kind,
      at,
      work_date: str(payload.work_date) ?? '',
      late_minutes: Math.max(0, num(payload.late_minutes) ?? 0),
      early_minutes: Math.max(0, num(payload.early_minutes) ?? 0),
    };
  }
  if (payload.status === 'refused' && isRefusal(payload.reason)) {
    const out: ClockPunchResult = { status: 'refused', reason: payload.reason };
    const distance = num(payload.distance_m);
    const radius = num(payload.radius_m);
    const accuracy = num(payload.accuracy_m);
    const maxAccuracy = num(payload.max_accuracy_m);
    if (distance !== null) out.distance_m = distance;
    if (radius !== null) out.radius_m = radius;
    if (accuracy !== null) out.accuracy_m = accuracy;
    if (maxAccuracy !== null) out.max_accuracy_m = maxAccuracy;
    return out;
  }
  return null;
}

// ── Today's work card ───────────────────────────────────────────────────────

/** A shift's job; null on the server means the person's main job. */
export function shiftRole(shift: Pick<ClockShift, 'role'>, mainRole: StaffRole): StaffRole {
  return (shift.role as StaffRole | null) ?? mainRole;
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** The line under the card's state. */
export type ShiftLine =
  /** A shift is running: its job and end, and the next job when the next shift touches it. */
  | { kind: 'running'; atWork: boolean; role: StaffRole; until: string; next: StaffRole | null }
  /** Not started and nothing running: today's shifts. */
  | { kind: 'today'; shifts: { role: StaffRole; starts: string; ends: string }[] }
  /** At work between shifts, or with no hours set. */
  | { kind: 'noShiftNow' }
  | { kind: 'noHours' };

export type WorkCard =
  | { ready: false }
  | { ready: true; state: 'in' | 'out'; since: string | null; action: ClockKind; line: ShiftLine };

/**
 * The running shift, worded: "On as Waiter until 15:00, then Cashier" when the
 * next shift starts as this one ends in another job. Touching shifts in the
 * same job read as one ("until 18:00"); that is one block on the server too.
 */
export function runningLine(
  current: ClockShift,
  next: ClockShift | null,
  mainRole: StaffRole,
  atWork: boolean,
): ShiftLine {
  const role = shiftRole(current, mainRole);
  if (next && sameInstant(next.starts, current.ends)) {
    const nextRole = shiftRole(next, mainRole);
    if (nextRole === role) return { kind: 'running', atWork, role, until: next.ends, next: null };
    return { kind: 'running', atWork, role, until: current.ends, next: nextRole };
  }
  return { kind: 'running', atWork, role, until: current.ends, next: null };
}

/** What Today's card shows: the state, one button (start when out, finish when in), and the shift line. */
export function workCard(clock: MyClock, mainRole: StaffRole): WorkCard {
  if (!clock.ready) return { ready: false };
  const atWork = clock.state === 'in';
  let line: ShiftLine;
  if (clock.current) line = runningLine(clock.current, clock.next, mainRole, atWork);
  else if (atWork) line = { kind: 'noShiftNow' };
  else if (clock.shifts.length > 0)
    line = {
      kind: 'today',
      shifts: clock.shifts.map((s) => ({ role: shiftRole(s, mainRole), starts: s.starts, ends: s.ends })),
    };
  else line = { kind: 'noHours' };
  return {
    ready: true,
    state: clock.state,
    since: atWork ? clock.since : null,
    action: atWork ? 'out' : 'in',
    line,
  };
}

/** The card's button label. */
export function actionKey(action: ClockKind): MessageKey {
  return action === 'in' ? 'staff.clock.card.start' : 'staff.clock.card.finish';
}

/** The page's bar title. */
export function titleKey(kind: ClockKind): MessageKey {
  return kind === 'in' ? 'staff.clock.title.in' : 'staff.clock.title.out';
}

/** The running line's catalog key: at work or not, with or without the next job. */
export function runningKey(line: Extract<ShiftLine, { kind: 'running' }>): MessageKey {
  if (line.atWork) return line.next ? 'staff.clock.card.onAsThen' : 'staff.clock.card.onAs';
  return line.next ? 'staff.clock.card.shiftNowThen' : 'staff.clock.card.shiftNow';
}

// ── Before the camera ───────────────────────────────────────────────────────

/** A permission as expo reports it. */
export interface PermissionRead {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}

export interface ClockPermissions {
  /** `precise` is false for iOS "approximate" and Android "coarse". */
  location: PermissionRead & { precise: boolean };
  /** The phone's own location switch. */
  servicesOn: boolean;
  camera: PermissionRead;
}

export type ClockStep =
  | 'location-ask'
  | 'location-blocked'
  | 'location-off'
  | 'location-approx'
  | 'camera-ask'
  | 'camera-blocked'
  | 'ready';

/** Whether the system dialog may be shown (first time, or Android after a plain "Deny"). */
const askable = (p: PermissionRead) =>
  p.status === 'undetermined' || (p.status === 'denied' && p.canAskAgain);

/**
 * The first thing in the way, location before the camera. The system prompt
 * is asked for only when it can still be shown; once refused for good the
 * person is sent to Settings. `typing` (the 6 digits typed instead) needs no
 * camera at all.
 */
export function clockStep(p: ClockPermissions, typing = false): ClockStep {
  if (p.location.status !== 'granted') return askable(p.location) ? 'location-ask' : 'location-blocked';
  if (!p.servicesOn) return 'location-off';
  if (!p.location.precise) return 'location-approx';
  if (typing) return 'ready';
  if (p.camera.status !== 'granted') return askable(p.camera) ? 'camera-ask' : 'camera-blocked';
  return 'ready';
}

// ── The location fix ────────────────────────────────────────────────────────

/** One fix, as read from expo-location. */
export interface Fix {
  lat: number;
  lng: number;
  /** Metres, radius of 68% confidence; null when the phone gave none. */
  accuracy: number | null;
  /** The fix's own time, ms since epoch. */
  at: number;
  mocked: boolean;
}

/** A watched fix this old is still sent (the server refuses one over 2 minutes). */
export const FIX_FRESH_MS = 30_000;
/** Accurate enough to send at once. */
export const FIX_GOOD_M = 50;
/** After a code, how long to wait for a better fix before sending the best fresh one. */
export const FIX_SETTLE_MS = 8_000;
/** After a code, how long with no fresh fix at all before saying the location was not found. */
export const FIX_TIMEOUT_MS = 15_000;

const acc = (f: Fix) => f.accuracy ?? Number.POSITIVE_INFINITY;

export function fixFresh(fix: Fix | null, nowMs: number): fix is Fix {
  return !!fix && nowMs - fix.at <= FIX_FRESH_MS && fix.at - nowMs <= 60_000;
}

/**
 * The fix to keep while the camera is open: a new one replaces a stale one,
 * and a fresh one is replaced only by one at least about as accurate, so a
 * GPS fix is not thrown away for the network's rough one a second later.
 */
export function keepBest(current: Fix | null, incoming: Fix, nowMs: number): Fix {
  if (!fixFresh(current, nowMs)) return incoming;
  return acc(incoming) <= acc(current) + 5 ? incoming : current;
}

/**
 * After a code: send now, wait for a better fix, or give up. A fresh fix
 * within FIX_GOOD_M goes at once; after FIX_SETTLE_MS the best fresh one goes
 * whatever its accuracy (the server says if it is too rough); after
 * FIX_TIMEOUT_MS with nothing fresh the location was not found.
 */
export function chooseFix(
  best: Fix | null,
  nowMs: number,
  waitedMs: number,
): { use: Fix } | 'wait' | 'fail' {
  const fresh = fixFresh(best, nowMs);
  if (fresh && acc(best) <= FIX_GOOD_M) return { use: best };
  if (fresh && waitedMs >= FIX_SETTLE_MS) return { use: best };
  if (waitedMs >= FIX_TIMEOUT_MS) return 'fail';
  return 'wait';
}

// ── The punch ───────────────────────────────────────────────────────────────

/** What the server accepts as a device id (app.clock_punch: 8 to 200 characters). */
export function validDeviceId(id: string | null | undefined): id is string {
  return typeof id === 'string' && id.length >= 8 && id.length <= 200;
}

/**
 * The id kept on this phone once it has one, else the platform's own, else none yet. The kept id
 * wins so the phone always sends the id it first sent: a phone that first logged with the
 * fallback (iOS gave no identifierForVendor yet) is never refused WRONG_DEVICE once iOS does, and
 * the iOS keychain keeps it across a reinstall, where identifierForVendor can change.
 */
export function pickDeviceId(platformId: string | null, stored: string | null): string | null {
  if (validDeviceId(stored)) return stored;
  if (validDeviceId(platformId)) return platformId;
  return null;
}

/** app.clock_punch's arguments, every one sent. */
export function punchArgs(a: {
  venueId: string;
  kind: ClockKind;
  code: string;
  fix: Fix;
  deviceId: string;
  platform: 'ios' | 'android';
}): Record<string, unknown> {
  return {
    p_venue_id: a.venueId,
    p_kind: a.kind,
    p_code: a.code,
    p_lat: a.fix.lat,
    p_lng: a.fix.lng,
    // No accuracy from the phone reads as too rough on the server, never as precise.
    p_accuracy_m: a.fix.accuracy ?? 99_999,
    p_fix_at: new Date(a.fix.at).toISOString(),
    p_mocked: a.fix.mocked,
    p_device_id: a.deviceId,
    p_platform: a.platform,
  };
}

// ── The answer ──────────────────────────────────────────────────────────────

/** "850 m", "3.2 km", "41 km": metres to the nearest 10 under a kilometre. */
export function distanceText(
  metres: number,
  locale: Locale,
): { key: MessageKey; params: { n: string } } {
  const m = Math.max(0, metres);
  if (m < 1000) {
    return { key: 'staff.clock.units.m', params: { n: formatNumber(Math.max(10, Math.round(m / 10) * 10), locale) } };
  }
  const km = m / 1000;
  const shown = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return { key: 'staff.clock.units.km', params: { n: formatNumber(shown, locale) } };
}

/** "±150 m". */
export function accuracyParams(metres: number, locale: Locale): { n: string } {
  return { n: formatNumber(Math.max(1, Math.round(metres)), locale) };
}

export type RefusalAction = 'scanAgain' | 'tryAgain' | 'back';

export interface RefusalView {
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** What the body's placeholder takes: `distance` (NOT_HERE) or `accuracy` (LOCATION_ROUGH), already worded. */
  needs: 'distance' | 'accuracy' | null;
  /** The buttons, the main one first. */
  actions: RefusalAction[];
}

/**
 * Each refusal's words and next step (contract §3). The ones a person can fix
 * on the spot offer a retry; the ones only a manager can fix go back to Today.
 * A retry scans again, so a fresh code and a fresh fix go with it (eight
 * refused tries in an hour stop the phone, so nothing retries by itself).
 */
export function refusalView(reason: ClockRefusal): RefusalView {
  const keys = (r: ClockRefusal) => ({
    titleKey: `staff.clock.refused.${r}.title` as MessageKey,
    bodyKey: `staff.clock.refused.${r}.body` as MessageKey,
  });
  switch (reason) {
    case 'CODE_WRONG':
      return { ...keys(reason), needs: null, actions: ['scanAgain', 'back'] };
    case 'LOCATION_STALE':
    case 'MOCK_LOCATION':
      return { ...keys(reason), needs: null, actions: ['tryAgain', 'back'] };
    case 'LOCATION_ROUGH':
      return { ...keys(reason), needs: 'accuracy', actions: ['tryAgain', 'back'] };
    case 'NOT_HERE':
      // Not at the club is the answer; a retry is there for a phone whose GPS jumped.
      return { ...keys(reason), needs: 'distance', actions: ['back', 'tryAgain'] };
    case 'TOO_MANY_TRIES':
    case 'NO_PLACE':
    case 'NO_STATION':
    case 'WRONG_DEVICE':
    case 'ALREADY_IN':
    case 'NOT_IN':
      return { ...keys(reason), needs: null, actions: ['back'] };
  }
}

export function refusalActionKey(action: RefusalAction): MessageKey {
  return `staff.clock.actions.${action}` as MessageKey;
}

/** An accepted punch: the headline key and the late or early minutes to say, if any. */
export function acceptedView(result: Extract<ClockPunchResult, { status: 'accepted' }>): {
  titleKey: MessageKey;
  minutes: { key: 'staff.clock.result.late' | 'staff.clock.result.early'; n: number } | null;
} {
  if (result.kind === 'in') {
    return {
      titleKey: 'staff.clock.result.started',
      minutes: result.late_minutes > 0 ? { key: 'staff.clock.result.late', n: result.late_minutes } : null,
    };
  }
  return {
    titleKey: 'staff.clock.result.finished',
    minutes: result.early_minutes > 0 ? { key: 'staff.clock.result.early', n: result.early_minutes } : null,
  };
}

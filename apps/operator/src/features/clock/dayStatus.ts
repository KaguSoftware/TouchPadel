/**
 * The day board (0442, contract §4): app.clock_day read, and each person's status words derived
 * from their shifts, their accepted log-ins and log-outs, and the server's `now`. Pure, tested in
 * dayStatus.test.ts. Minutes late and early are the server's (each accepted scan carries them);
 * this module only decides which words apply.
 */
import { CLOCK_REFUSALS, type ClockRefusal } from '@touch/core/staff/clock';
import type { StaffRole } from '../../lib/auth';
import { isObject, list, num, role as readRole, str } from '../roleExtras/roleExtrasLogic';

/** The server matches a log-in to a shift that starts within this long (0442 §6). */
export const MATCH_BEFORE_MS = 3 * 3600_000;
/** An open log-in this long past its block's end reads as "No log-out". */
export const NO_LOGOUT_AFTER_MS = 4 * 3600_000;
export const DAY_WINDOW = 60;

export interface DayShift {
  starts: string;
  ends: string;
  role: StaffRole | null;
  blockStarts: string;
  blockEnds: string;
}

export interface DayEvent {
  id: string;
  kind: 'in' | 'out';
  status: 'accepted' | 'refused';
  refusal: ClockRefusal | null;
  at: string;
  lateMinutes: number;
  earlyMinutes: number;
  distanceM: number | null;
  accuracyM: number | null;
  mocked: boolean;
  stationId: string | null;
}

export interface DayPerson {
  staffId: string;
  displayName: string;
  role: StaffRole | null;
  shifts: DayShift[];
  events: DayEvent[];
  inSince: string | null;
  attendance: { id: string; lateMinutes: number; earlyLeaveMinutes: number; penaltyIqd: number; source: 'manual' | 'clock' } | null;
  deviceBound: boolean;
}

export interface ClockDay {
  date: string | null;
  today: string | null;
  now: string | null;
  people: DayPerson[];
}

const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));
const refusalOf = (v: unknown): ClockRefusal | null =>
  typeof v === 'string' && (CLOCK_REFUSALS as readonly string[]).includes(v) ? (v as ClockRefusal) : null;

export function readClockDay(payload: unknown): ClockDay {
  const p = isObject(payload) ? payload : {};
  return {
    date: str(p.date),
    today: str(p.today),
    now: str(p.now),
    people: list(p.people)
      .filter((x) => typeof x.staff_id === 'string')
      .map((x): DayPerson => {
        const a = isObject(x.attendance) ? x.attendance : null;
        return {
          staffId: str(x.staff_id) ?? '',
          displayName: str(x.display_name) ?? '',
          role: readRole(x.role),
          shifts: list(x.shifts)
            .filter((s) => typeof s.starts === 'string' && typeof s.ends === 'string')
            .map((s) => ({
              starts: str(s.starts) ?? '',
              ends: str(s.ends) ?? '',
              role: readRole(s.role),
              blockStarts: str(s.block_starts) ?? str(s.starts) ?? '',
              blockEnds: str(s.block_ends) ?? str(s.ends) ?? '',
            })),
          events: list(x.events)
            .filter((e) => typeof e.at === 'string' && (e.kind === 'in' || e.kind === 'out'))
            .map((e) => ({
              id: str(e.id) ?? String(e.at),
              kind: e.kind === 'out' ? 'out' : 'in',
              status: e.status === 'accepted' ? 'accepted' : 'refused',
              refusal: refusalOf(e.refusal),
              at: str(e.at) ?? '',
              lateMinutes: count(e.late_minutes),
              earlyMinutes: count(e.early_minutes),
              distanceM: num(e.distance_m),
              accuracyM: num(e.accuracy_m),
              mocked: e.mocked === true,
              stationId: str(e.station_id),
            })),
          inSince: str(x.in_since),
          attendance:
            a && typeof a.id === 'string'
              ? {
                  id: a.id,
                  lateMinutes: count(a.late_minutes),
                  earlyLeaveMinutes: count(a.early_leave_minutes),
                  penaltyIqd: num(a.penalty_iqd) ?? 0,
                  source: a.source === 'clock' ? 'clock' : 'manual',
                }
              : null,
          deviceBound: x.device_bound === true,
        };
      }),
  };
}

// ---------------------------------------------------------------------------
// Blocks and presence
// ---------------------------------------------------------------------------

export interface Block {
  starts: number;
  ends: number;
  shifts: DayShift[];
}

/** Touching shifts as the server grouped them (block_starts / block_ends). */
export function blocksOf(shifts: readonly DayShift[]): Block[] {
  const out: Block[] = [];
  for (const s of [...shifts].sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts))) {
    const starts = Date.parse(s.blockStarts);
    const ends = Date.parse(s.blockEnds);
    const last = out[out.length - 1];
    if (last && last.starts === starts && last.ends === ends) last.shifts.push(s);
    else out.push({ starts, ends, shifts: [s] });
  }
  return out;
}

interface Stay {
  from: number;
  /** null: no accepted log-out after it. */
  to: number | null;
}

/** Accepted log-ins paired with the log-out that closed each. */
export function staysOf(events: readonly DayEvent[]): Stay[] {
  const out: Stay[] = [];
  let open: Stay | null = null;
  for (const e of [...events].filter((x) => x.status === 'accepted').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    if (e.kind === 'in') {
      if (open) out.push(open);
      open = { from: Date.parse(e.at), to: null };
    } else if (open) {
      open.to = Date.parse(e.at);
      out.push(open);
      open = null;
    }
  }
  if (open) out.push(open);
  return out;
}

function covered(block: Block, stays: readonly Stay[], now: number): boolean {
  return stays.some((s) => {
    const to = s.to ?? now;
    // Present during the block, or logged in for it early (the server's 3 h match window).
    return (s.from < block.ends && to > block.starts) || (s.from >= block.starts - MATCH_BEFORE_MS && s.from < block.ends);
  });
}

// ---------------------------------------------------------------------------
// Status words
// ---------------------------------------------------------------------------

export type StatusWord =
  | { word: 'off' }
  | { word: 'notInYet'; at: string }
  | { word: 'lateNotIn'; since: string }
  | { word: 'atWork'; since: string; role: StaffRole | null }
  | { word: 'noLogout'; since: string }
  | { word: 'finished'; at: string }
  | { word: 'missed'; count: number }
  | { word: 'late'; minutes: number }
  | { word: 'leftEarly'; minutes: number }
  | { word: 'refused'; count: number };

export interface PersonStatus {
  /** Most urgent first; the first is the person's headline. */
  words: StatusWord[];
  /** Sort weight for the board: lower is more urgent. */
  urgency: number;
  refused: DayEvent[];
  accepted: DayEvent[];
}

const iso = (ms: number) => new Date(ms).toISOString();

/** The job of the shift running at `at`, else of the block that `at` falls in, else the person's main job. */
function roleAt(person: DayPerson, at: number): StaffRole | null {
  const running = person.shifts.find((s) => Date.parse(s.starts) <= at && at < Date.parse(s.ends));
  return running?.role ?? person.role;
}

export function personStatus(person: DayPerson, nowIso: string | null): PersonStatus {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const accepted = person.events.filter((e) => e.status === 'accepted').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const refused = person.events.filter((e) => e.status === 'refused').sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const blocks = blocksOf(person.shifts);
  const stays = staysOf(person.events);
  const words: StatusWord[] = [];

  if (blocks.length === 0 && accepted.length === 0) {
    if (refused.length > 0) words.push({ word: 'refused', count: refused.length });
    else words.push({ word: 'off' });
    return { words, urgency: refused.length > 0 ? 2 : 9, refused, accepted };
  }

  // An open log-in with no log-out long after its block ended (or one the server already let go).
  const openStay = stays.find((s) => s.to === null);
  let noLogout = false;
  if (openStay) {
    const block = blocks.find((b) => openStay.from < b.ends && openStay.from >= b.starts - MATCH_BEFORE_MS);
    noLogout = person.inSince === null || (block !== undefined && now > block.ends + NO_LOGOUT_AFTER_MS);
    if (noLogout) words.push({ word: 'noLogout', since: iso(openStay.from) });
  }
  const atWork = person.inSince !== null && !noLogout;
  if (atWork) words.push({ word: 'atWork', since: person.inSince!, role: roleAt(person, now) });

  let missed = 0;
  let lateNotIn: number | null = null;
  let upcoming: number | null = null;
  for (const b of blocks) {
    if (covered(b, stays, now)) continue;
    if (now >= b.ends) missed += 1;
    else if (now >= b.starts) lateNotIn ??= b.starts;
    else upcoming ??= b.starts;
  }
  if (!atWork && lateNotIn !== null) words.push({ word: 'lateNotIn', since: iso(lateNotIn) });
  if (missed > 0) words.push({ word: 'missed', count: missed });

  const late = accepted.reduce((n, e) => n + (e.kind === 'in' ? e.lateMinutes : 0), 0);
  const early = accepted.reduce((n, e) => n + (e.kind === 'out' ? e.earlyMinutes : 0), 0);
  if (late > 0) words.push({ word: 'late', minutes: late });
  if (early > 0) words.push({ word: 'leftEarly', minutes: early });
  if (refused.length > 0) words.push({ word: 'refused', count: refused.length });

  const headline = words[0]?.word;
  if (!atWork && !noLogout && lateNotIn === null) {
    // Nothing running: either the next block is ahead, or the day is done.
    const lastOut = [...accepted].reverse().find((e) => e.kind === 'out');
    if (upcoming !== null) words.unshift({ word: 'notInYet', at: iso(upcoming) });
    // A missed shift stays the headline; "finished" then only says when they left.
    else if (lastOut && missed > 0) words.push({ word: 'finished', at: lastOut.at });
    else if (lastOut) words.unshift({ word: 'finished', at: lastOut.at });
  }

  const urgency =
    noLogout ? 0 : lateNotIn !== null && !atWork ? 1 : missed > 0 || headline === 'refused' ? 2 : refused.length > 0 ? 3 : atWork ? 4 : upcoming !== null ? 5 : 6;
  return { words, urgency, refused, accepted };
}

/** The board's order: who needs a look first, then by name. */
export function sortForBoard<T extends { person: DayPerson; status: PersonStatus }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.status.urgency - b.status.urgency || a.person.displayName.localeCompare(b.person.displayName));
}

/** Headline counts for the summary line. */
export function boardCounts(statuses: readonly PersonStatus[]): { atWork: number; lateNotIn: number; notInYet: number; noLogout: number; missed: number } {
  const has = (s: PersonStatus, w: StatusWord['word']) => s.words.some((x) => x.word === w);
  return {
    atWork: statuses.filter((s) => has(s, 'atWork')).length,
    lateNotIn: statuses.filter((s) => has(s, 'lateNotIn')).length,
    notInYet: statuses.filter((s) => s.words[0]?.word === 'notInYet').length,
    noLogout: statuses.filter((s) => has(s, 'noLogout')).length,
    missed: statuses.filter((s) => has(s, 'missed')).length,
  };
}

// ---------------------------------------------------------------------------
// Refused attempts in plain words
// ---------------------------------------------------------------------------

/** A distance as the board says it: metres under a kilometre, else kilometres to one decimal. */
export function distanceParts(m: number): { unit: 'm' | 'km'; value: number } {
  if (m < 1000) return { unit: 'm', value: Math.max(0, Math.round(m)) };
  return { unit: 'km', value: Math.round(m / 100) / 10 };
}

export type RefusalWord =
  | 'far'
  | 'farUnknown'
  | 'fake'
  | 'otherPhone'
  | 'code'
  | 'rough'
  | 'stale'
  | 'tooMany'
  | 'notSetUp'
  | 'alreadyIn'
  | 'notIn';

export function refusalWord(e: Pick<DayEvent, 'refusal' | 'distanceM' | 'mocked'>): RefusalWord {
  // A mocked fix is the story whatever else went wrong with it.
  if (e.mocked || e.refusal === 'MOCK_LOCATION') return 'fake';
  switch (e.refusal) {
    case 'NOT_HERE':
      return e.distanceM !== null ? 'far' : 'farUnknown';
    case 'WRONG_DEVICE':
      return 'otherPhone';
    case 'CODE_WRONG':
      return 'code';
    case 'LOCATION_ROUGH':
      return 'rough';
    case 'LOCATION_STALE':
      return 'stale';
    case 'TOO_MANY_TRIES':
      return 'tooMany';
    case 'NO_PLACE':
    case 'NO_STATION':
      return 'notSetUp';
    case 'ALREADY_IN':
      return 'alreadyIn';
    case 'NOT_IN':
      return 'notIn';
    default:
      return 'code';
  }
}

/** Shifts as the board lists them: blocks, each with the job switches inside it. */
export function blockLines(person: DayPerson): { starts: string; ends: string; parts: { starts: string; role: StaffRole | null }[] }[] {
  return blocksOf(person.shifts).map((b) => ({
    starts: iso(b.starts),
    ends: iso(b.ends),
    parts: b.shifts.map((s) => ({ starts: s.starts, role: s.role ?? person.role })),
  }));
}

/** The dates the board may show: today and up to 60 days back. */
export function dayBounds(today: string): { min: string; max: string } {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - DAY_WINDOW);
  return { min: d.toISOString().slice(0, 10), max: today };
}

/**
 * Pure helpers for the Attendance page (0271): the reader of
 * app.attendance_month, the record form's rules, the live verdict on what a
 * day would cost under the branch's rule, and the refusals that name a field.
 *
 * The rule (0270): a work day costs attendance_penalty_iqd (Y) when its minutes
 * late plus minutes left early exceed attendance_grace_minutes (X); Y = 0 is
 * off. The verdict here only compares minutes: what a day costs, and every
 * total, is the server's.
 */
import type { StaffRole } from '../../lib/auth';
import { isObject, list, num, role, str } from '../roleExtras/roleExtrasLogic';
import { addDays, monthOf } from '../deductions/venueDate';

/** The server's limits (0270 staff_attendance CHECKs, app.record_attendance, cafe_setting_specs). */
export const MINUTES_MAX = 720;
export const NOTE_MAX = 300;
export const WINDOW_DAYS = 60;
export const GRACE_MAX = 720;
export const PENALTY_MAX = 2_000_000;

const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));

// ---------------------------------------------------------------------------
// app.attendance_month
// ---------------------------------------------------------------------------

export interface AttendanceRule {
  graceMinutes: number;
  penaltyIqd: number;
}

export interface AttendanceDay {
  id: string;
  /** 'YYYY-MM-DD'. */
  workDate: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** The rule in force when the day was recorded. */
  graceMinutes: number;
  penaltyRuleIqd: number;
  /** What the day costs, as the server set it. */
  penaltyIqd: number;
  /** 'YYYY-MM-01', the wage it comes off. */
  payMonth: string | null;
  /** Its pay month is paid: the day can no longer change. */
  locked: boolean;
  note: string | null;
  recordedByName: string | null;
  recordedAt: string | null;
}

export interface AttendancePerson {
  staffId: string;
  displayName: string;
  role: StaffRole | null;
  isActive: boolean;
  dayCount: number;
  penaltyDays: number;
  penaltiesIqd: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  days: AttendanceDay[];
}

export interface AttendanceTarget {
  id: string;
  displayName: string;
  role: StaffRole | null;
}

export interface AttendanceMonth {
  month: string | null;
  currentMonth: string | null;
  today: string | null;
  windowDays: number;
  rule: AttendanceRule;
  /** Who the viewer may record a day for. */
  staff: AttendanceTarget[];
  totals: { days: number; penaltyDays: number; penaltiesIqd: number; people: number };
  people: AttendancePerson[];
}

export function readAttendanceMonth(payload: unknown): AttendanceMonth {
  const p = isObject(payload) ? payload : {};
  const r = isObject(p.rule) ? p.rule : {};
  const t = isObject(p.totals) ? p.totals : {};
  return {
    month: str(p.month),
    currentMonth: str(p.current_month),
    today: str(p.today),
    windowDays: num(p.window_days) === null ? WINDOW_DAYS : count(p.window_days),
    rule: { graceMinutes: count(r.grace_minutes), penaltyIqd: num(r.penalty_iqd) ?? 0 },
    staff: list(p.staff)
      .filter((s) => typeof s.id === 'string')
      .map((s) => ({ id: str(s.id) ?? '', displayName: str(s.display_name) ?? '', role: role(s.role) })),
    totals: {
      days: count(t.days),
      penaltyDays: count(t.penalty_days),
      penaltiesIqd: num(t.penalties_iqd) ?? 0,
      people: count(t.people),
    },
    people: list(p.people)
      .filter((x) => typeof x.staff_id === 'string')
      .map(
        (x): AttendancePerson => ({
          staffId: str(x.staff_id) ?? '',
          displayName: str(x.display_name) ?? '',
          role: role(x.role),
          isActive: x.is_active !== false,
          dayCount: count(x.day_count),
          penaltyDays: count(x.penalty_days),
          penaltiesIqd: num(x.penalties_iqd) ?? 0,
          lateMinutes: count(x.late_minutes),
          earlyLeaveMinutes: count(x.early_leave_minutes),
          days: list(x.days)
            .filter((d) => typeof d.id === 'string')
            .map((d) => ({
              id: str(d.id) ?? '',
              workDate: str(d.work_date) ?? '',
              lateMinutes: count(d.late_minutes),
              earlyLeaveMinutes: count(d.early_leave_minutes),
              graceMinutes: count(d.grace_minutes),
              penaltyRuleIqd: num(d.penalty_rule_iqd) ?? 0,
              penaltyIqd: num(d.penalty_iqd) ?? 0,
              payMonth: str(d.pay_month),
              locked: d.locked === true,
              note: str(d.note),
              recordedByName: str(d.recorded_by_name),
              recordedAt: str(d.recorded_at),
            })),
        }),
      ),
  };
}

/** The day a person already has recorded on a date, in the loaded month: recording it again replaces it. */
export function recordedDay(month: AttendanceMonth, staffId: string, date: string): AttendanceDay | null {
  if (staffId === '' || date === '') return null;
  const person = month.people.find((p) => p.staffId === staffId);
  return person?.days.find((d) => d.workDate === date) ?? null;
}

/** A day that comes off a later month's wage, because its own month was already paid. */
export function paidInLaterMonth(day: Pick<AttendanceDay, 'workDate' | 'payMonth'>): boolean {
  return day.payMonth !== null && day.payMonth !== monthOf(day.workDate);
}

/** The stepper never passes the current month: no day is recorded ahead of the business date. */
export function canStepAttendanceForward(shown: string | null, current: string | null): boolean {
  return shown !== null && current !== null && shown < current;
}

// ---------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------

export type RuleVerdict = 'off' | 'within' | 'over';

/** What the rule says of a day's minutes: off when Y is 0, over when late + early exceed X. */
export function ruleVerdict(rule: AttendanceRule, late: number, early: number): RuleVerdict {
  if (rule.penaltyIqd <= 0) return 'off';
  return late + early > rule.graceMinutes ? 'over' : 'within';
}

export interface RuleDraft {
  graceMinutes: number;
  penaltyIqd: number | null;
}

/** The rule's two settings, within 0270's specs (int 0..720, int 0..2,000,000). */
export function validateRule(d: RuleDraft): 'grace' | 'penalty' | null {
  if (!Number.isInteger(d.graceMinutes) || d.graceMinutes < 0 || d.graceMinutes > GRACE_MAX) return 'grace';
  if (d.penaltyIqd === null || !Number.isInteger(d.penaltyIqd) || d.penaltyIqd < 0 || d.penaltyIqd > PENALTY_MAX) return 'penalty';
  return null;
}

// ---------------------------------------------------------------------------
// The record form
// ---------------------------------------------------------------------------

export interface AttendanceDraft {
  staffId: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  late: number;
  early: number;
  note: string;
}

export type AttendanceField = 'staffId' | 'date' | 'late' | 'early' | 'minutes' | 'note';
export type AttendanceIssueCode = 'required' | 'dateRange' | 'minutesRange' | 'bothZero' | 'tooLong';
export interface AttendanceIssue {
  field: AttendanceField;
  code: AttendanceIssueCode;
}

/** The dates a day may be recorded on: the 60 days up to the branch's business date, never ahead. */
export function attendanceWindow(today: string): { min: string; max: string } {
  return { min: addDays(today, -WINDOW_DAYS), max: today };
}

/** Every rule app.record_attendance applies, stated before it refuses. Text length counts characters, as Postgres does. */
export function validateAttendance(d: AttendanceDraft, today: string): AttendanceIssue[] {
  const issues: AttendanceIssue[] = [];
  if (d.staffId === '') issues.push({ field: 'staffId', code: 'required' });
  const { min, max } = attendanceWindow(today);
  if (d.date === '') issues.push({ field: 'date', code: 'required' });
  else if (d.date < min || d.date > max) issues.push({ field: 'date', code: 'dateRange' });
  const lateOk = Number.isInteger(d.late) && d.late >= 0 && d.late <= MINUTES_MAX;
  const earlyOk = Number.isInteger(d.early) && d.early >= 0 && d.early <= MINUTES_MAX;
  if (!lateOk) issues.push({ field: 'late', code: 'minutesRange' });
  if (!earlyOk) issues.push({ field: 'early', code: 'minutesRange' });
  if (lateOk && earlyOk && d.late + d.early === 0) issues.push({ field: 'minutes', code: 'bothZero' });
  if ([...d.note.trim()].length > NOTE_MAX) issues.push({ field: 'note', code: 'tooLong' });
  return issues;
}

/** The field a refusal of app.record_attendance names, so the form marks it. */
export function attendanceRefusalField(code: string | null, hint: string | null): AttendanceField | null {
  if (code === 'INVALID_ARGUMENT') {
    if (hint === 'date') return 'date';
    if (hint === 'late_minutes') return 'late';
    if (hint === 'early_leave_minutes') return 'early';
    if (hint === 'minutes') return 'minutes';
    return null;
  }
  if (code === 'TEXT_TOO_LONG' && hint === 'note') return 'note';
  if (code === 'FORBIDDEN' && hint === 'staff_id') return 'staffId';
  return null;
}

/** The refusals that mean the month moved under the screen: its wage was paid, or the day is gone. */
export const ATTENDANCE_STALE: ReadonlySet<string> = new Set(['WAGE_ALREADY_PAID', 'REF_NOT_FOUND']);

export function isAttendanceStale(code: string | null): boolean {
  return code !== null && ATTENDANCE_STALE.has(code);
}

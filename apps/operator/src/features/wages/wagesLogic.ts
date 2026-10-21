/**
 * Pure helpers for the owner's Wages page (0271): the readers of
 * app.wages_month and app.wages_due, the status tones, the month stepper's
 * bounds, the salary form's rules and the refusals that name a field.
 *
 * Nothing here adds money up: every salary, deduction, penalty, bonus, net
 * and total is the server's (app.wage_line is the one place a month is computed). The
 * readers take the payload as returned (the shared QK key holds it that way)
 * and read it defensively.
 */
import type { StaffRole } from '../../lib/auth';
import type { Tone } from '../../components/kit';
import { isObject, list, num, role, str } from '../roleExtras/roleExtrasLogic';
import { shiftMonth } from '../deductions/venueDate';

export const WAGE_STATUSES = ['unset', 'none', 'upcoming', 'due', 'overdue', 'paid'] as const;
export type WageStatus = (typeof WAGE_STATUSES)[number];

/** The server's limits (0270 staff_wages CHECKs, app.set_staff_wage, app.undo_wage_paid). */
export const SALARY_MIN = 0;
export const SALARY_MAX = 100_000_000;
export const PAY_DAY_MIN = 1;
export const PAY_DAY_MAX = 31;
export const UNDO_REASON_MAX = 1000;
/** app.give_wage_advance: 1 to 100,000,000 IQD, a note of at most 300 characters. */
export const ADVANCE_MAX = 100_000_000;
export const ADVANCE_NOTE_MAX = 300;
/** How far ahead "Starting" offers an explicit month: this month to three ahead. */
export const FROM_MONTHS_AHEAD = 3;

const statusOf = (v: unknown): WageStatus => ((WAGE_STATUSES as readonly unknown[]).includes(v) ? (v as WageStatus) : 'unset');
const count = (v: unknown): number => Math.max(0, Math.floor(num(v) ?? 0));
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

// ---------------------------------------------------------------------------
// app.wage_line, the shape every wages read shares
// ---------------------------------------------------------------------------

/** Where the money for a wage, an advance or a coach's pay came from (0344). */
export const PAID_FROM = ['safe', 'bank'] as const;
export type PaidFrom = (typeof PAID_FROM)[number];
const paidFromOf = (v: unknown): PaidFrom | null => ((PAID_FROM as readonly unknown[]).includes(v) ? (v as PaidFrom) : null);

export interface WagePayment {
  id: string;
  status: 'paid' | 'undone';
  /** What was handed over at Mark paid: the net less the advances, or 0 below zero. */
  paidIqd: number;
  /** The advances already given before it (0344; 0 on an older payment). */
  advancesIqd: number;
  /** null on a payment from before 0344. */
  paidFrom: PaidFrom | null;
  paidAt: string | null;
  paidByName: string | null;
  undoneAt: string | null;
  undoneByName: string | null;
  undoReason: string | null;
}

/**
 * A reward reached (0333 staff_reward_earnings) that this wage month carries:
 * written when the business month it was reached in ended, into the first
 * wage month not yet paid. A prize-only one adds nothing to the wage
 * (rewardIqd 0); it is listed so the owner remembers to hand the prize over.
 */
export interface WageBonus {
  id: string;
  /** 'YYYY-MM-01', the business month it was reached in. */
  earnedMonth: string;
  /** The orders it was for. */
  target: number;
  rewardIqd: number;
  prize: string | null;
}

/**
 * What a person earned from their Touch Shop sales in a business month (0355
 * shop_sale_reward_earnings), paid in this wage month: written when that
 * month ended. Its amount is already inside bonusesIqd and bonusCount.
 */
export interface WageShopReward {
  id: string;
  /** 'YYYY-MM-01', the business month of the sales. */
  earnedMonth: string;
  /** What the customers paid for their shop lines in it. */
  salesIqd: number;
  rewardIqd: number;
}

/** Part of a pay month handed over before pay day (0344 wage_advances). */
export interface WageAdvance {
  id: string;
  amountIqd: number;
  paidFrom: PaidFrom;
  note: string | null;
  givenAt: string | null;
  givenByName: string | null;
}

export interface NextRate {
  salaryIqd: number;
  payDay: number | null;
  /** 'YYYY-MM-01', the first pay month it applies to. */
  from: string;
}

export interface WageLine {
  /** 'YYYY-MM-01'. */
  month: string;
  status: WageStatus;
  salaryIqd: number;
  payDay: number | null;
  /** The month the rate in force started. */
  rateFrom: string | null;
  nextRate: NextRate | null;
  /** 'YYYY-MM-DD', the month's pay day (clamped to a shorter month's last day). */
  dueDate: string | null;
  /** Days from the branch's business date to the pay day: negative once it has passed. */
  daysLeft: number | null;
  deductionsIqd: number;
  deductionCount: number;
  penaltiesIqd: number;
  penaltyDays: number;
  /** The rewards' bonuses this month carries (a paid month: its snapshot). */
  bonusesIqd: number;
  /** How many of them add money (prize-only ones are not counted). */
  bonusCount: number;
  /**
   * The month only carries a bonus for someone who left and did no work in it
   * (0333): the server charges no salary for it (salaryIqd 0).
   */
  bonusOnly: boolean;
  /** salary − deductions − penalties + bonuses, as the server added it up. May be below zero. */
  netIqd: number;
  /** The advances already given against the month (0344; a paid month: its snapshot). */
  advancesIqd: number;
  advanceCount: number;
  /** Each advance standing, earliest first. */
  advances: WageAdvance[];
  /** net − advances as the server answers it: below zero when more was advanced than earned; 0 once paid. */
  owedIqd: number;
  /** What Mark paid hands over now: the owed amount, or 0 below zero; 0 once paid. */
  toPayIqd: number;
  payment: WagePayment | null;
  /** Every reward this month carries, prize-only ones too, by earned month then target. */
  bonuses: WageBonus[];
  /** The shop sales rewards this month carries (0355), by earned month. */
  shopRewards: WageShopReward[];
}

function readPayment(v: unknown): WagePayment | null {
  if (!isObject(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    status: v.status === 'paid' ? 'paid' : 'undone',
    paidIqd: num(v.paid_iqd) ?? 0,
    advancesIqd: num(v.advances_iqd) ?? 0,
    paidFrom: paidFromOf(v.paid_from),
    paidAt: str(v.paid_at),
    paidByName: str(v.paid_by_name),
    undoneAt: str(v.undone_at),
    undoneByName: str(v.undone_by_name),
    undoReason: str(v.undo_reason),
  };
}

function readNextRate(v: unknown): NextRate | null {
  if (!isObject(v) || typeof v.from !== 'string') return null;
  return { salaryIqd: num(v.salary_iqd) ?? 0, payDay: int(v.pay_day), from: v.from };
}

function readBonuses(v: unknown): WageBonus[] {
  return list(v)
    .filter((b) => typeof b.id === 'string')
    .map((b) => ({
      id: str(b.id) ?? '',
      earnedMonth: str(b.earned_month) ?? '',
      target: count(b.target),
      rewardIqd: num(b.reward_iqd) ?? 0,
      prize: str(b.prize),
    }));
}

function readShopRewards(v: unknown): WageShopReward[] {
  return list(v)
    .filter((b) => typeof b.id === 'string')
    .map((b) => ({
      id: str(b.id) ?? '',
      earnedMonth: str(b.earned_month) ?? '',
      salesIqd: num(b.sales_iqd) ?? 0,
      rewardIqd: num(b.reward_iqd) ?? 0,
    }));
}

function readAdvances(v: unknown): WageAdvance[] {
  return list(v)
    .filter((a) => typeof a.id === 'string' && paidFromOf(a.paid_from) !== null)
    .map((a) => ({
      id: str(a.id) ?? '',
      amountIqd: num(a.amount_iqd) ?? 0,
      paidFrom: paidFromOf(a.paid_from) ?? 'safe',
      note: str(a.note),
      givenAt: str(a.given_at),
      givenByName: str(a.given_by_name),
    }));
}

export function readWageLine(r: Record<string, unknown>): WageLine {
  const status = statusOf(r.status);
  const netIqd = num(r.net_iqd) ?? 0;
  // A server from before 0344 sends neither figure: it had no advances, so
  // what is owed was the net and what is paid the net or nothing (as it said).
  const owedIqd = num(r.owed_iqd) ?? (status === 'paid' ? 0 : netIqd);
  const toPayIqd = num(r.to_pay_iqd) ?? (status === 'paid' ? 0 : payableIqd(netIqd));
  return {
    month: str(r.month) ?? '',
    status,
    salaryIqd: num(r.salary_iqd) ?? 0,
    payDay: int(r.pay_day),
    rateFrom: str(r.rate_from),
    nextRate: readNextRate(r.next_rate),
    dueDate: str(r.due_date),
    daysLeft: int(r.days_left),
    deductionsIqd: num(r.deductions_iqd) ?? 0,
    deductionCount: count(r.deduction_count),
    penaltiesIqd: num(r.penalties_iqd) ?? 0,
    penaltyDays: count(r.penalty_days),
    bonusesIqd: num(r.bonuses_iqd) ?? 0,
    bonusCount: count(r.bonus_count),
    bonusOnly: r.bonus_only === true,
    netIqd,
    advancesIqd: num(r.advances_iqd) ?? 0,
    advanceCount: count(r.advance_count),
    advances: readAdvances(r.advances),
    owedIqd,
    toPayIqd,
    payment: readPayment(r.payment),
    bonuses: readBonuses(r.bonuses),
    shopRewards: readShopRewards(r.shop_rewards),
  };
}

// ---------------------------------------------------------------------------
// app.wages_month
// ---------------------------------------------------------------------------

export interface WageDeduction {
  id: string;
  amountIqd: number;
  deductionDate: string;
  reason: string;
  decidedAt: string | null;
}

export interface WageLateDay {
  id: string;
  workDate: string;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  graceMinutes: number;
  penaltyIqd: number;
  note: string | null;
}

export interface WagePerson extends WageLine {
  staffId: string;
  displayName: string;
  role: StaffRole | null;
  isActive: boolean;
  /** Active at the branch now; false for someone the month still has a record for. */
  member: boolean;
  /** Proposed deductions nobody has decided yet: they count in no month until approved. */
  waitingCount: number;
  deductions: WageDeduction[];
  lateness: WageLateDay[];
}

export interface WagesTotals {
  salaryIqd: number;
  deductionsIqd: number;
  penaltiesIqd: number;
  /** null when the server sent no bonuses total: the row is then not shown, never shown as 0. */
  bonusesIqd: number | null;
  netIqd: number;
  /** The advances given against the month (0 from a server before 0344). */
  advancesIqd: number;
  /** What Mark paid still hands over across the month. */
  toPayIqd: number;
  paidIqd: number;
  people: number;
  paid: number;
  due: number;
  overdue: number;
  upcoming: number;
  unset: number;
}

export interface WagesMonth {
  month: string | null;
  currentMonth: string | null;
  today: string | null;
  remindDays: number | null;
  totals: WagesTotals;
  people: WagePerson[];
}

export function readWagesMonth(payload: unknown): WagesMonth {
  const p = isObject(payload) ? payload : {};
  const t = isObject(p.totals) ? p.totals : {};
  return {
    month: str(p.month),
    currentMonth: str(p.current_month),
    today: str(p.today),
    remindDays: int(p.remind_days),
    totals: {
      salaryIqd: num(t.salary_iqd) ?? 0,
      deductionsIqd: num(t.deductions_iqd) ?? 0,
      penaltiesIqd: num(t.penalties_iqd) ?? 0,
      bonusesIqd: num(t.bonuses_iqd),
      netIqd: num(t.net_iqd) ?? 0,
      advancesIqd: num(t.advances_iqd) ?? 0,
      toPayIqd: num(t.to_pay_iqd) ?? 0,
      paidIqd: num(t.paid_iqd) ?? 0,
      people: count(t.people),
      paid: count(t.paid),
      due: count(t.due),
      overdue: count(t.overdue),
      upcoming: count(t.upcoming),
      unset: count(t.unset),
    },
    people: list(p.people)
      .filter((r) => typeof r.staff_id === 'string')
      .map(
        (r): WagePerson => ({
          ...readWageLine(r),
          staffId: str(r.staff_id) ?? '',
          displayName: str(r.display_name) ?? '',
          role: role(r.role),
          isActive: r.is_active !== false,
          member: r.member !== false,
          waitingCount: count(r.waiting_count),
          deductions: list(r.deductions)
            .filter((d) => typeof d.id === 'string')
            .map((d) => ({
              id: str(d.id) ?? '',
              amountIqd: num(d.amount_iqd) ?? 0,
              deductionDate: str(d.deduction_date) ?? '',
              reason: str(d.reason) ?? '',
              decidedAt: str(d.decided_at),
            })),
          lateness: list(r.lateness)
            .filter((d) => typeof d.id === 'string')
            .map((d) => ({
              id: str(d.id) ?? '',
              workDate: str(d.work_date) ?? '',
              lateMinutes: count(d.late_minutes),
              earlyLeaveMinutes: count(d.early_leave_minutes),
              graceMinutes: count(d.grace_minutes),
              penaltyIqd: num(d.penalty_iqd) ?? 0,
              note: str(d.note),
            })),
        }),
      ),
  };
}

/** The people with no salary on record at the branch: the "No salary yet" banner. */
export function unsetPeople(month: WagesMonth): WagePerson[] {
  return month.people.filter((p) => p.status === 'unset' && p.member);
}

// ---------------------------------------------------------------------------
// app.wages_due
// ---------------------------------------------------------------------------

export interface WageDueRow extends WageLine {
  staffId: string;
  displayName: string;
  role: StaffRole | null;
}

export interface WagesDue {
  today: string | null;
  remindDays: number | null;
  count: number;
  overdueCount: number;
  /** By pay day, earliest first, as the server sorted them. */
  people: WageDueRow[];
}

export function readWagesDue(payload: unknown): WagesDue {
  const p = isObject(payload) ? payload : {};
  const people = list(p.people)
    .filter((r) => typeof r.staff_id === 'string')
    .map(
      (r): WageDueRow => ({
        ...readWageLine(r),
        staffId: str(r.staff_id) ?? '',
        displayName: str(r.display_name) ?? '',
        role: role(r.role),
      }),
    );
  return {
    today: str(p.today),
    remindDays: int(p.remind_days),
    count: num(p.count) === null ? people.length : count(p.count),
    overdueCount: count(p.overdue_count),
    people,
  };
}

/** The rail badge, the panel card and Financial home: the unpaid months due now or overdue. */
export function wagesDueCount(payload: unknown): number {
  return readWagesDue(payload).count;
}

// ---------------------------------------------------------------------------
// What a line shows and offers
// ---------------------------------------------------------------------------

/** Overdue is red, due amber, paid green; upcoming, no salary and "not paid here" are neutral. */
export function wageTone(status: WageStatus): Tone {
  switch (status) {
    case 'overdue':
      return 'danger';
    case 'due':
      return 'warn';
    case 'paid':
      return 'success';
    default:
      return 'neutral';
  }
}

export type DueWhen = { kind: 'overdue'; days: number } | { kind: 'today' } | { kind: 'in'; days: number } | null;

/** Where a pay day stands from the server's days_left: "3 days overdue", "today", "due in 2 days". */
export function dueWhen(daysLeft: number | null): DueWhen {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { kind: 'overdue', days: -daysLeft };
  if (daysLeft === 0) return { kind: 'today' };
  return { kind: 'in', days: daysLeft };
}

/**
 * Mark paid is offered on a month with a salary that is not paid yet, and on a
 * month with no salary (none set, or 0) that carries a reward bonus: the
 * server pays the bonus alone (0333; WAGE_NOT_SET otherwise).
 */
export function canMarkPaid(line: Pick<WageLine, 'status' | 'bonusesIqd'>): boolean {
  if (line.status === 'due' || line.status === 'overdue' || line.status === 'upcoming') return true;
  return (line.status === 'unset' || line.status === 'none') && line.bonusesIqd > 0;
}

/** Undo is offered on a payment that stands. */
export function canUndoPaid(line: Pick<WageLine, 'payment'>): boolean {
  return line.payment?.status === 'paid';
}

/** The rewards a month carries with a prize the owner hands over (a bonus may carry one too). */
export function prizeCount(line: Pick<WageLine, 'bonuses'>): number {
  return line.bonuses.filter((b) => b.prize !== null).length;
}

/** How a reward's line reads: a bonus, a prize to hand over, or both. */
export function bonusKind(b: Pick<WageBonus, 'rewardIqd' | 'prize'>): 'amount' | 'prize' | 'both' {
  if (b.prize === null) return 'amount';
  return b.rewardIqd > 0 ? 'both' : 'prize';
}

/**
 * The amount "Mark paid" records, as app.mark_wage_paid records it: the net,
 * or nothing when deductions and penalties exceed the salary and bonuses
 * (nothing carries over). A comparison on the server's net, not a sum.
 */
export function payableIqd(netIqd: number): number {
  return netIqd < 0 ? 0 : netIqd;
}

// ---------------------------------------------------------------------------
// Advances (0344)
// ---------------------------------------------------------------------------

/**
 * app.give_wage_advance takes a pay month from last month to next month: the
 * page offers an advance only on a month in that window when it knows the
 * current one.
 */
export function advanceMonthInRange(month: string, current: string | null): boolean {
  if (current === null) return true;
  return month >= shiftMonth(current, -1) && month <= shiftMonth(current, 1);
}

/**
 * Give advance is offered on an open month with a salary that still owes
 * something: not paid, not unset or "not paid here" (WAGE_NOT_SET), not a
 * bonus-only month for someone who left, and owed above zero (the server
 * refuses more than is owed, WAGE_ADVANCE_TOO_LARGE).
 */
export function canGiveAdvance(
  line: Pick<WageLine, 'status' | 'owedIqd' | 'bonusOnly' | 'month'>,
  current: string | null = null,
): boolean {
  if (line.status !== 'due' && line.status !== 'overdue' && line.status !== 'upcoming') return false;
  if (line.bonusOnly) return false;
  return line.owedIqd > 0 && advanceMonthInRange(line.month, current);
}

/** An advance is taken back only while its month is open (WAGE_ALREADY_PAID otherwise). */
export function canUndoAdvance(line: Pick<WageLine, 'status'>): boolean {
  return line.status !== 'paid';
}

export interface AdvanceDraft {
  amount: number | null;
  note: string;
}
export type AdvanceField = 'amount' | 'note';
export type AdvanceIssueCode = 'required' | 'positive' | 'tooLarge' | 'tooLong';
export interface AdvanceIssue {
  field: AdvanceField;
  code: AdvanceIssueCode;
}

/**
 * The advance form's guard before anything is sent: an amount from 1 to what
 * is still owed this month (the server's figure), a note of at most 300
 * characters. The server is the wall; this only says it first.
 */
export function validateAdvanceDraft(d: AdvanceDraft, owedIqd: number): AdvanceIssue[] {
  const issues: AdvanceIssue[] = [];
  if (d.amount === null) issues.push({ field: 'amount', code: 'required' });
  else if (!Number.isInteger(d.amount) || d.amount <= 0) issues.push({ field: 'amount', code: 'positive' });
  else if (d.amount > owedIqd || d.amount > ADVANCE_MAX) issues.push({ field: 'amount', code: 'tooLarge' });
  if ([...d.note.trim()].length > ADVANCE_NOTE_MAX) issues.push({ field: 'note', code: 'tooLong' });
  return issues;
}

/** WAGE_ADVANCE_TOO_LARGE carries the most that may still be given as its hint. */
export function advanceMaxFromHint(hint: string | null): number | null {
  if (hint === null || !/^\d+$/.test(hint.trim())) return null;
  const n = Number(hint.trim());
  return Number.isSafeInteger(n) ? n : null;
}

// ---------------------------------------------------------------------------
// The month stepper
// ---------------------------------------------------------------------------

/**
 * The stepper reaches next month at most: app.mark_wage_paid pays a month up
 * to one ahead of the branch's business month (an early payday), never further.
 * `current` is the month the server answered for "this month".
 */
export function canStepWageForward(shown: string | null, current: string | null): boolean {
  return shown !== null && current !== null && shown < shiftMonth(current, 1);
}

/**
 * The "Starting" choices of the salary form: this month to three ahead. The
 * form's first choice, "The next pay day", sends null and the server picks.
 */
export function fromMonthOptions(current: string | null): string[] {
  if (current === null) return [];
  return Array.from({ length: FROM_MONTHS_AHEAD + 1 }, (_, i) => shiftMonth(current, i));
}

/** A pay day past the 28th falls on a shorter month's last day (app.wage_due_date). */
export function payDayClamps(day: number | null): boolean {
  return day !== null && day > 28;
}

// ---------------------------------------------------------------------------
// The salary form
// ---------------------------------------------------------------------------

export interface WageDraft {
  salary: number | null;
  payDay: number | null;
  /** 'YYYY-MM-01', or null for "the next pay day". */
  from: string | null;
}

export type WageField = 'salary' | 'payDay' | 'from' | 'staff';
export type WageIssueCode = 'required' | 'range';
export interface WageIssue {
  field: WageField;
  code: WageIssueCode;
}

/** Every rule app.set_staff_wage applies to the figures, stated before it refuses. */
export function validateWageDraft(d: Pick<WageDraft, 'salary' | 'payDay'>): WageIssue[] {
  const issues: WageIssue[] = [];
  if (d.salary === null) issues.push({ field: 'salary', code: 'required' });
  else if (!Number.isInteger(d.salary) || d.salary < SALARY_MIN || d.salary > SALARY_MAX) issues.push({ field: 'salary', code: 'range' });
  if (d.payDay === null) issues.push({ field: 'payDay', code: 'required' });
  else if (!Number.isInteger(d.payDay) || d.payDay < PAY_DAY_MIN || d.payDay > PAY_DAY_MAX) issues.push({ field: 'payDay', code: 'range' });
  return issues;
}

/** The field a refusal of app.set_staff_wage names, so the form marks it. */
export function wageRefusalField(code: string | null, hint: string | null): WageField | null {
  if (code === 'INVALID_AMOUNT') return 'salary';
  if (code === 'INVALID_ARGUMENT' && hint === 'pay_day') return 'payDay';
  if (code === 'INVALID_ARGUMENT' && hint === 'month') return 'from';
  if (code === 'FORBIDDEN' && hint === 'staff_id') return 'staff';
  return null;
}

/** An undo's reason: required, at most 1000 characters (as Postgres counts them). */
export function undoReasonIssue(reason: string): 'required' | 'tooLong' | null {
  const r = reason.trim();
  if (r === '') return 'required';
  if ([...r].length > UNDO_REASON_MAX) return 'tooLong';
  return null;
}

// ---------------------------------------------------------------------------
// A refusal that means the page is out of date
// ---------------------------------------------------------------------------

/**
 * The pay refusals that mean the month moved under the dialog: paid by
 * someone else, a deduction or a day landed (the net changed), or a payment
 * undone or gone. The dialog keeps the message on show and the page refetches,
 * so the row beside it says what happened.
 */
export const WAGE_STALE: ReadonlySet<string> = new Set(['WAGE_ALREADY_PAID', 'WAGE_CHANGED', 'REF_NOT_FOUND', 'INVALID_TRANSITION']);

export function isWageStale(code: string | null): boolean {
  return code !== null && WAGE_STALE.has(code);
}

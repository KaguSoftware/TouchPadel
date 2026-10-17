/**
 * The hiring start on the staff phone, one page a step (Sait, 2026-10-17):
 * Role, The job, Pay, Check. Each page is its own screen on the (staff) stack,
 * so the native back goes back a step; the answers live in hiringDraft.ts.
 *
 * The record is the `open_position` form's (`@touch/core` steps.ts): role,
 * why, hours, start_date, and the optional pay range. The run's title is asked
 * for on the Check page, filled in from the role. PURE (vitest).
 */
import { HIREABLE_ROLES, validateStart, type FieldIssue, type StaffRole } from '@touch/core';

export const HIRING_STEPS = ['role', 'job', 'pay', 'check'] as const;
export type HiringStep = (typeof HIRING_STEPS)[number];

/** The `step` param as a page; anything else is the first. */
export function parseHiringStep(raw: unknown): HiringStep {
  return HIRING_STEPS.find((s) => s === raw) ?? 'role';
}

/** The role cards, grouped by where the person works, in HIREABLE_ROLES' order inside a group. */
export const ROLE_GROUPS: readonly { key: 'floor' | 'bar' | 'kitchen' | 'office'; roles: readonly StaffRole[] }[] = [
  { key: 'floor', roles: ['cashier', 'waiter', 'court_desk', 'shop_staff'] },
  { key: 'bar', roles: ['head_barista', 'barista', 'assistant_barista'] },
  { key: 'kitchen', roles: ['head_chef', 'chef'] },
  { key: 'office', roles: ['manager', 'driver', 'marketing'] },
];

/** Every hireable role sits in exactly one group (a new role must be placed). */
export function groupedRoles(): StaffRole[] {
  return ROLE_GROUPS.flatMap((g) => g.roles);
}

export interface HiringAnswers {
  role: StaffRole | null;
  why: string;
  hours: string;
  /** `YYYY-MM-DD`, or '' until picked. */
  startDate: string;
  /** What was typed: digits and commas. */
  payMin: string;
  payMax: string;
}

export function emptyAnswers(): HiringAnswers {
  return { role: null, why: '', hours: '', startDate: '', payMin: '', payMax: '' };
}

/** A typed amount: digits only, commas dropped; null when empty or not a whole number. */
export function amountOf(text: string): number | null {
  const v = text.replace(/,/g, '').trim();
  if (v === '' || !/^\d+$/.test(v)) return null;
  return Number(v);
}

/** The `open_position` record, as the start sends it. */
export function hiringRecord(a: HiringAnswers): Record<string, unknown> {
  const record: Record<string, unknown> = {
    role: a.role ?? '',
    why: a.why.trim(),
    hours: a.hours.trim(),
    start_date: a.startDate,
  };
  const min = amountOf(a.payMin);
  const max = amountOf(a.payMax);
  if (a.payMin.trim() !== '') record.pay_min_iqd = min ?? Number.NaN;
  if (a.payMax.trim() !== '') record.pay_max_iqd = max ?? Number.NaN;
  return record;
}

/** The page an issue is shown on. */
export function stepOfIssue(issue: Pick<FieldIssue, 'field'>): HiringStep {
  const f = issue.field;
  if (f === 'role') return 'role';
  if (f === 'why' || f === 'hours' || f === 'start_date') return 'job';
  if (f.startsWith('pay_')) return 'pay';
  return 'check';
}

/** Everything the validator says about the start, as it would be sent. */
export function hiringIssues(
  a: HiringAnswers,
  titleEn: string | null,
  titleAr: string | null,
  byOwner: boolean,
): FieldIssue[] {
  const issues = validateStart({
    kind: 'hiring',
    variant: null,
    change: null,
    titleEn,
    titleAr,
    record: hiringRecord(a),
    byOwner,
  });
  // A range the wrong way round is the phone's to say; the server keeps both.
  const min = amountOf(a.payMin);
  const max = amountOf(a.payMax);
  if (min !== null && max !== null && max < min && !issues.some((i) => i.field === 'pay_max_iqd')) {
    issues.push({ field: 'pay_max_iqd', code: 'RECORD_INVALID' });
  }
  return issues;
}

/** The issues one page holds. */
export function issuesOnStep(issues: readonly FieldIssue[], step: HiringStep): FieldIssue[] {
  return issues.filter((i) => stepOfIssue(i) === step);
}

/** Steps finished before this one: the progress the bar shows. */
export function stepsDone(step: HiringStep): number {
  return HIRING_STEPS.indexOf(step);
}

/** A day's `YYYY-MM-DD`, `days` after `from`, in UTC. */
export function dayAfter(from: string, days: number): string {
  const [y, m, d] = from.split('-').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + days, 12));
  return at.toISOString().slice(0, 10);
}

/** Roles HIREABLE_ROLES lists that no group shows (kept empty by the test). */
export function ungroupedRoles(): StaffRole[] {
  const shown = new Set(groupedRoles());
  return HIREABLE_ROLES.filter((r) => !shown.has(r));
}

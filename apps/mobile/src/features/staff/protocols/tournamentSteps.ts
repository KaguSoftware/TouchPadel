/**
 * The tournament start on the staff phone, one plan section a page (owner,
 * 2026-10-16: "step by step, like the operator's new tournament modal").
 *
 * The plan, its record and its sections are the operator's
 * (`@touch/core/protocols` tournamentPlan.ts), so both apps send the same
 * `tournament.plan`. The type is picked on the page before (the type cards),
 * so the phone's steps are the plan's sections without it. PURE (vitest).
 */
import {
  planRecord,
  planSections,
  sectionOfIssue,
  validateStart,
  wallTimeToUtc,
  type FieldIssue,
  type PlanSection,
  type PlanState,
  type TournamentVariant,
} from '@touch/core';

/** A page of the start: the plan's sections after the type. */
export type PlanStep = Exclude<PlanSection, 'type'>;

/** The pages a type's plan takes, in order: the sponsor's only on a type 3 plan. */
export function phoneSteps(variant: TournamentVariant): PlanStep[] {
  return planSections(variant).filter((s): s is PlanStep => s !== 'type');
}

/** The `step` param as one of the type's pages; anything else is the first. */
export function parsePlanStep(raw: unknown, variant: TournamentVariant): PlanStep {
  const steps = phoneSteps(variant);
  return steps.find((s) => s === raw) ?? steps[0]!;
}

/** The page an issue is shown on: a type issue (the variant) on the first. */
export function stepOfIssue(issue: Pick<FieldIssue, 'field'>, variant: TournamentVariant): PlanStep {
  const s = sectionOfIssue(issue);
  return s === 'type' ? phoneSteps(variant)[0]! : s;
}

/**
 * Everything the validator says about the plan, as the start would send it.
 * The run's titles are the names, so a missing title is the name's to say.
 */
export function planIssues(
  plan: PlanState,
  tz: string,
  courtOrder: readonly string[],
  byOwner: boolean,
): FieldIssue[] {
  return validateStart({
    kind: 'tournament',
    variant: plan.variant,
    change: null,
    titleEn: plan.nameEn.trim(),
    titleAr: plan.nameAr.trim(),
    record: planRecord(plan, tz, courtOrder),
    byOwner,
  }).filter((i) => i.field !== 'title');
}

/** The issues one page holds. */
export function issuesOnStep(
  issues: readonly FieldIssue[],
  step: PlanStep,
  variant: TournamentVariant,
): FieldIssue[] {
  return issues.filter((i) => stepOfIssue(i, variant) === step);
}

/** The first issue on a path or under it (`sponsor` holds `sponsor.name`). */
export function issueAt(issues: readonly FieldIssue[], path: string): FieldIssue | undefined {
  return issues.find((i) => i.field === path || i.field.startsWith(`${path}.`) || i.field.startsWith(`${path}[`));
}

/** A court booking that holds the court (the desk's blocking statuses). */
export interface CourtBooking {
  court_id: string;
  start_at: string;
  end_at: string;
  kind: string;
}

/**
 * The court-hours a day's bookings hold: `courtId|startMin` → the bookings
 * over that hour, so the courts step can neither pick it nor leave it unsaid.
 */
export function bookedHours(
  bookings: readonly CourtBooking[],
  day: string,
  columns: readonly number[],
  tz: string,
): Map<string, CourtBooking[]> {
  const out = new Map<string, CourtBooking[]>();
  for (const b of bookings) {
    const s = Date.parse(b.start_at);
    const e = Date.parse(b.end_at);
    if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
    for (const m of columns) {
      const from = wallTimeToUtc(day, m, tz).getTime();
      if (s < from + 3_600_000 && e > from) {
        const key = `${b.court_id}|${m}`;
        out.set(key, [...(out.get(key) ?? []), b]);
      }
    }
  }
  return out;
}

/** A typed count or amount: Arabic digits already folded, only digits and commas kept. */
export function numericText(raw: string): string {
  return raw.replace(/[^\d,]/g, '').slice(0, 12);
}

/** The capacity stepper: one up or down from what is typed, never under 2. */
export function stepCount(text: string, by: 1 | -1): string {
  const n = Number(text.replace(/,/g, ''));
  const base = Number.isInteger(n) && n > 0 ? n : by > 0 ? 1 : 2;
  return String(Math.max(2, base + by));
}

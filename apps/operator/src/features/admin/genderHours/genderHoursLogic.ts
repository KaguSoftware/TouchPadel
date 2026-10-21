/**
 * Pure helpers for the Gender hours page (0353, `court_gender_rules`).
 *
 * The clock rules (which day an overnight window belongs to, what a clash is)
 * live in @touch/core's genderRules, shared with the phone and the desk
 * calendar; this file only shapes them for the table and the form. Display
 * only: `app.upsert_court_gender_rule` validates, and the reservation and match
 * triggers enforce.
 */
import { clockMinutes, runsPastMidnight, type GenderRuleClash } from '@touch/core';

/** "22:00", "02:00" and whether the end is on the next day. */
export function windowParts(rule: { start_time: string; end_time: string }): { from: string; to: string; overnight: boolean } {
  return {
    from: rule.start_time.slice(0, 5),
    to: rule.end_time.slice(0, 5),
    overnight: runsPastMidnight(rule),
  };
}

/** One clash, named from one rule's side: the other rule and the first weekday they meet. */
export interface ClashFromSide {
  otherId: string;
  otherName: string;
  weekday: number;
}

/** The clashes one rule is part of, named from that rule's side (the form's warning). */
export function clashesFor(
  clashes: readonly GenderRuleClash[],
  rules: readonly { id: string; name: string }[],
  ruleId: string,
): ClashFromSide[] {
  const nameOf = (id: string) => rules.find((r) => r.id === id)?.name ?? id;
  return clashes.flatMap((c) => {
    if (c.ruleId === ruleId) return [{ otherId: c.otherId, otherName: nameOf(c.otherId), weekday: c.weekday }];
    if (c.otherId === ruleId) return [{ otherId: c.ruleId, otherName: nameOf(c.ruleId), weekday: c.weekday }];
    return [];
  });
}

export type GenderChoice = 'female' | 'male' | '';

export interface GenderRuleDraft {
  name: string;
  gender: GenderChoice;
  days: ReadonlySet<number> | readonly number[];
  startTime: string;
  endTime: string;
}

/** Why Save is refused, as the key under `ws.genderHours.form.disabled`, or null when it can save. */
export function saveBlock(draft: GenderRuleDraft): 'name' | 'who' | 'days' | 'sameTime' | null {
  if (draft.name.trim().length === 0) return 'name';
  if (draft.gender === '') return 'who';
  const dayCount = Array.isArray(draft.days) ? draft.days.length : (draft.days as ReadonlySet<number>).size;
  if (dayCount === 0) return 'days';
  if (!draft.startTime || !draft.endTime || clockMinutes(draft.startTime) === clockMinutes(draft.endTime)) return 'sameTime';
  return null;
}

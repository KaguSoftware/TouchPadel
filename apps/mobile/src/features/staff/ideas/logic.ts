/**
 * New-item ideas (build-contracts-2026-09-23 §2.9 "Ideas: the pre-step",
 * role spec #65). A barista's or chef assistant's idea is a release proposal
 * with no menu category: it waits for the head of their team (the bar's head
 * barista, the kitchen's head chef), who starts a product release from it or
 * declines it with a reason. Management reviews both teams' ideas.
 *
 * PURE (vitest).
 */
import { stepForm, validateStep, type FieldDef, type FieldIssue, type StaffRole } from '@touch/core';
import type { Locale } from '@touch/i18n';

/** The proposal's fields, less the category the head or the manager picks (§2.9 `'refused'`). */
export const IDEA_FIELDS: readonly FieldDef[] = (stepForm('product_release', 'propose')?.fields ?? []).filter(
  (f) => f.name !== 'category_id',
);

export const IDEA_PHOTO_FOLDER = 'proposals' as const;
export const IDEA_PHOTOS_MAX = 6;

export type IdeaStatus = 'waiting' | 'started' | 'declined' | 'withdrawn';

/** One row of `release_ideas_to_review`. */
export interface ReviewIdea {
  id: string;
  team: 'bar' | 'kitchen';
  author_name: string | null;
  submitted_at: string;
  record: Record<string, unknown>;
  photos: string[];
}

/** One row of `my_release_ideas`: the run as its status and step names, never its record (#72). */
export interface MyIdea {
  id: string;
  team: 'bar' | 'kitchen';
  record: Record<string, unknown>;
  photos: string[];
  status: IdeaStatus;
  submitted_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  run: {
    run_id: string;
    status: string;
    title_en: string | null;
    title_ar: string | null;
    current_steps: { name_en: string; name_ar: string; status: string }[];
  } | null;
}

export const IDEA_AUTHORS: readonly StaffRole[] = ['barista', 'chef'];
export const IDEA_REVIEWERS: readonly StaffRole[] = ['head_barista', 'head_chef', 'manager', 'owner'];

export function isIdeaAuthor(role: StaffRole | null | undefined): boolean {
  return !!role && IDEA_AUTHORS.includes(role);
}

export function isIdeaReviewer(role: StaffRole | null | undefined): boolean {
  return !!role && IDEA_REVIEWERS.includes(role);
}

/**
 * An idea before it is sent: the proposal's own checks (names, kind, lines,
 * sizes, caps), with no category and up to six photos. The server's
 * `release_propose_check` stays the authority.
 */
export function validateIdea(record: Record<string, unknown>, photos: number): FieldIssue[] {
  const issues = validateStep('product_release', 'propose', record, {}, { submitterDecides: false, photos });
  if (record.category_id !== undefined && record.category_id !== null) {
    issues.push({ field: 'category_id', code: 'RECORD_INVALID' });
  }
  return issues;
}

/** An idea's name in the reader's language, else the other. */
export function ideaName(record: Record<string, unknown>, locale: Locale): string | null {
  const en = typeof record.name_en === 'string' && record.name_en.trim() ? record.name_en.trim() : null;
  const ar = typeof record.name_ar === 'string' && record.name_ar.trim() ? record.name_ar.trim() : null;
  return locale === 'ar' ? (ar ?? en) : (en ?? ar);
}

/** Only the author's waiting idea can be withdrawn (`withdraw_release_idea`). */
export function canWithdrawIdea(idea: Pick<MyIdea, 'status'>): boolean {
  return idea.status === 'waiting';
}

/** The ideas the page shows first: the one a push or a link named, then the rest in their order. */
export function focusFirst<T extends { id: string }>(rows: readonly T[], id: string | null | undefined): T[] {
  if (!id) return [...rows];
  return [...rows.filter((r) => r.id === id), ...rows.filter((r) => r.id !== id)];
}

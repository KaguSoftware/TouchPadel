/**
 * The Coaches tab's rules (docs/design/coaching/operator.md §5.13.1; C-7,
 * C-22, C-25, C-29, R43, R45, R46, R61, R63). Pure; no React.
 *
 * - Make a coach: the draft, what blocks it, and `coach_promote`'s arguments
 *   (the rail's branch ticked by default). The photo path comes from
 *   `mediaPath('coaches', …)`: a fresh random folder, never an identity (R43).
 * - The editor: the profile patch (changed keys only, through `coach_update`),
 *   the replaced photo to remove after a save, the branch set (branches the
 *   screen cannot show are kept), and the lesson-type change with the coach's
 *   own prices it would delete (R46: unlinking a type deletes the price).
 * - The list: acceptance (C-22, R61), account deleted (R63), retired coaches
 *   folded away, the order, and what the retire confirm says (C-25, R45).
 */
import type { Locale } from '@touch/i18n';
import type { AdminCoach } from '../../coaching/lessonPayloads';

/** §1.2 bounds on `coaches`. */
export const COACH_LIMITS = { name: 60, bio: 1000 } as const;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The coach's display name in the screen's language (never the account name). */
export function coachName(
  c: Pick<AdminCoach, 'display_name_en' | 'display_name_ar'>,
  locale: Locale,
): string {
  return locale === 'ar'
    ? c.display_name_ar || c.display_name_en
    : c.display_name_en || c.display_name_ar;
}

// ---------------------------------------------------------------------------
// Make a coach (coach_promote)
// ---------------------------------------------------------------------------

export interface PromoteCustomer {
  id: string;
  name: string;
  phone: string | null;
}

export interface PromoteDraft {
  customer: PromoteCustomer | null;
  nameEn: string;
  nameAr: string;
  bioEn: string;
  bioAr: string;
  /** `coaches/<random uuid>/<random uuid>.<ext>` (R43) or null. */
  photo: string | null;
  venueIds: string[];
  /** Lesson types at this branch to link after the promote. */
  typeIds: string[];
}

/**
 * A fresh Make a coach form: the rail's branch ticked. "Make a coach again"
 * passes the retired coach (`from`): their names, bios and branches come back,
 * the photo starts empty (§5.13.1).
 */
export function newPromoteDraft(
  branchId: string | null,
  customer: PromoteCustomer | null = null,
  from: Pick<
    AdminCoach,
    'display_name_en' | 'display_name_ar' | 'bio_en' | 'bio_ar' | 'venue_ids'
  > | null = null,
): PromoteDraft {
  const venues = new Set<string>(from?.venue_ids ?? []);
  if (branchId) venues.add(branchId);
  return {
    customer,
    nameEn: from?.display_name_en ?? '',
    nameAr: from?.display_name_ar ?? '',
    bioEn: from?.bio_en ?? '',
    bioAr: from?.bio_ar ?? '',
    photo: null,
    venueIds: [...venues],
    typeIds: [],
  };
}

export type PromoteProblem = 'account' | 'names' | 'branches';

export function promoteProblems(d: PromoteDraft): PromoteProblem[] {
  const out: PromoteProblem[] = [];
  if (!d.customer) out.push('account');
  if (namesBad(d.nameEn, d.nameAr)) out.push('names');
  if (d.venueIds.length === 0) out.push('branches');
  return out;
}

function namesBad(en: string, ar: string): boolean {
  const e = en.trim();
  const a = ar.trim();
  return !e || !a || e.length > COACH_LIMITS.name || a.length > COACH_LIMITS.name;
}

/** coach_promote's arguments (§1.7). Call it on a draft with no problems. */
export function promoteArgs(d: PromoteDraft): {
  p_profile_id: string;
  p_display_name_en: string;
  p_display_name_ar: string;
  p_bio_en: string;
  p_bio_ar: string;
  p_photo_path: string | null;
  p_venue_ids: string[];
} {
  return {
    p_profile_id: d.customer?.id ?? '',
    p_display_name_en: d.nameEn.trim(),
    p_display_name_ar: d.nameAr.trim(),
    p_bio_en: d.bioEn.trim().slice(0, COACH_LIMITS.bio),
    p_bio_ar: d.bioAr.trim().slice(0, COACH_LIMITS.bio),
    p_photo_path: d.photo,
    p_venue_ids: [...d.venueIds],
  };
}

/** A toggle in a list of ids (a checkbox). */
export function toggleId(ids: readonly string[], id: string, on: boolean): string[] {
  const has = ids.includes(id);
  if (on && !has) return [...ids, id];
  if (!on && has) return ids.filter((x) => x !== id);
  return [...ids];
}

// ---------------------------------------------------------------------------
// The editor: profile (coach_update)
// ---------------------------------------------------------------------------

export interface CoachProfileDraft {
  nameEn: string;
  nameAr: string;
  bioEn: string;
  bioAr: string;
  photo: string | null;
  sortOrder: number;
}

export function profileDraftOf(c: AdminCoach): CoachProfileDraft {
  return {
    nameEn: c.display_name_en,
    nameAr: c.display_name_ar,
    bioEn: c.bio_en,
    bioAr: c.bio_ar,
    photo: c.photo_path,
    sortOrder: c.sort_order ?? 0,
  };
}

export function profileProblems(d: CoachProfileDraft): ('names' | 'bio')[] {
  const out: ('names' | 'bio')[] = [];
  if (namesBad(d.nameEn, d.nameAr)) out.push('names');
  if (d.bioEn.length > COACH_LIMITS.bio || d.bioAr.length > COACH_LIMITS.bio) out.push('bio');
  return out;
}

/** coach_update's patch: only the keys that changed (§5.7). */
export function coachPatch(
  c: AdminCoach,
  d: CoachProfileDraft,
): Record<string, string | number | null> {
  const was = profileDraftOf(c);
  const patch: Record<string, string | number | null> = {};
  if (d.nameEn.trim() !== was.nameEn) patch.display_name_en = d.nameEn.trim();
  if (d.nameAr.trim() !== was.nameAr) patch.display_name_ar = d.nameAr.trim();
  if (d.bioEn.trim() !== was.bioEn) patch.bio_en = d.bioEn.trim();
  if (d.bioAr.trim() !== was.bioAr) patch.bio_ar = d.bioAr.trim();
  if (d.photo !== was.photo) patch.photo_path = d.photo;
  if (d.sortOrder !== was.sortOrder) patch.sort_order = d.sortOrder;
  return patch;
}

/**
 * The old photo to remove once a save has stored the new one (R43:
 * `app.storage_path_in_use` keeps it while anything still points at it).
 */
export function replacedPhoto(
  c: Pick<AdminCoach, 'photo_path'>,
  d: Pick<CoachProfileDraft, 'photo'>,
): string | null {
  return c.photo_path && d.photo !== c.photo_path ? c.photo_path : null;
}

// ---------------------------------------------------------------------------
// The editor: branches (set_coach_branches) and lesson types (set_coach_lesson_types)
// ---------------------------------------------------------------------------

/**
 * The branch list to send: what is ticked among the branches this screen
 * shows, plus every saved branch it cannot show (a closed branch, one the
 * caller does not work at), so a save never drops a branch by omission.
 */
export function branchSet(
  saved: readonly string[],
  ticked: readonly string[],
  shown: readonly string[],
): string[] {
  const shownSet = new Set(shown);
  const out = ticked.filter((id) => shownSet.has(id));
  for (const id of saved) if (!shownSet.has(id) && !out.includes(id)) out.push(id);
  return out;
}

export function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

export interface TypeChange {
  added: string[];
  removed: string[];
  /** Removed types the coach has an own price for: unticking deletes it (R46), so it is asked first. */
  priceLosses: string[];
}

export function typeChange(
  c: Pick<AdminCoach, 'lesson_type_ids' | 'prices'>,
  next: readonly string[],
): TypeChange {
  const added = next.filter((id) => !c.lesson_type_ids.includes(id));
  const removed = c.lesson_type_ids.filter((id) => !next.includes(id));
  const priced = new Set(c.prices.filter((p) => p.price_iqd != null).map((p) => p.lesson_type_id));
  return { added, removed, priceLosses: removed.filter((id) => priced.has(id)) };
}

/** The coach's own price for a type at this branch, or null (they use the type's price). */
export function ownPriceOf(c: Pick<AdminCoach, 'prices'>, typeId: string): number | null {
  return c.prices.find((p) => p.lesson_type_id === typeId)?.price_iqd ?? null;
}

/**
 * The branch a BRANCH_HAS_BOOKINGS refusal names (R52, R73): a branch id in
 * the detail, or `coach_lessons` meaning the removed branch(es) this save
 * sent. Empty when there is nothing to name.
 */
export function refusedBranchIds(
  detail: string | null | undefined,
  removed: readonly string[],
): string[] {
  const d = (detail ?? '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d))
    return [d.toLowerCase()];
  return [...removed];
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** C-22, R61, R63: what the acceptance line says. A deleted account outranks the rest. */
export type Acceptance = 'deleted' | 'waiting' | 'accepted';

export function acceptanceOf(
  c: Pick<AdminCoach, 'account_deleted' | 'public_accepted_at'>,
): Acceptance {
  if (c.account_deleted) return 'deleted';
  return c.public_accepted_at ? 'accepted' : 'waiting';
}

export function isRetired(c: Pick<AdminCoach, 'status'>): boolean {
  return c.status === 'retired';
}

/** The list order: `sort_order`, then the English display name. */
export function sortCoaches<T extends Pick<AdminCoach, 'sort_order' | 'display_name_en'>>(
  coaches: readonly T[],
): T[] {
  return [...coaches].sort(
    (a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
      a.display_name_en.localeCompare(b.display_name_en),
  );
}

/** Retired coaches fold behind "Show retired coaches" (§5.13.1). */
export function splitRetired(coaches: readonly AdminCoach[]): {
  current: AdminCoach[];
  retired: AdminCoach[];
} {
  const sorted = sortCoaches(coaches);
  return { current: sorted.filter((c) => !isRetired(c)), retired: sorted.filter(isRetired) };
}

/** Coaches whose hours the Hours tab sets: active and paused (§5.13.3). */
export function hoursCoaches(coaches: readonly AdminCoach[]): AdminCoach[] {
  return sortCoaches(coaches.filter((c) => !isRetired(c)));
}

/**
 * The order arrows: the `sort_order` that moves this coach one place up (-1)
 * or down (+1) among `list`, written to this coach alone through coach_update.
 * Null at either end.
 */
export function orderAfterMove(
  list: readonly Pick<AdminCoach, 'coach_id' | 'sort_order' | 'display_name_en'>[],
  coachId: string,
  delta: -1 | 1,
): number | null {
  const sorted = sortCoaches(list);
  const i = sorted.findIndex((c) => c.coach_id === coachId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return null;
  const neighbour = sorted[j]!.sort_order ?? 0;
  return delta < 0 ? neighbour - 1 : neighbour + 1;
}

/** What the retire confirm names (C-25, R45): the lessons to come, and whether the course clause shows. */
export function retireFacts(c: Pick<AdminCoach, 'upcoming_lessons' | 'open_courses'>): {
  lessons: number;
  courses: boolean;
} {
  return { lessons: c.upcoming_lessons ?? 0, courses: (c.open_courses ?? 0) > 0 };
}

/** The retire note: required, 1..200 (§5.7 `set_coach_status`). */
export const STATUS_NOTE_MAX = 200;

export function retireNoteOk(note: string): boolean {
  const n = note.trim();
  return n.length >= 1 && n.length <= STATUS_NOTE_MAX;
}

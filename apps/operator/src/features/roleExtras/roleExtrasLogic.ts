/**
 * Pure helpers for the role-spec screens (build-contracts-2026-09-23 §5.4,
 * plan #61–#74): the suggestion box, the Recipe changes card and the ideas
 * from the team. Every reader takes the RPC's payload as returned (the shared
 * QK keys hold it that way) and reads it defensively, so a missing key reads
 * as nothing rather than a crash.
 */
import type { StaffRole } from '../../lib/auth';
import { STAFF_ROLES } from '../../lib/roleResolution';

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
export const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
export const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);
export const role = (v: unknown): StaffRole | null =>
  typeof v === 'string' && (STAFF_ROLES as readonly string[]).includes(v) ? (v as StaffRole) : null;

/** A bilingual name with each side falling back to the other (§4: a row may carry one language). */
export function bilingual(locale: 'en' | 'ar', en: string | null | undefined, ar: string | null | undefined): string {
  const first = locale === 'ar' ? ar : en;
  const second = locale === 'ar' ? en : ar;
  return (first && first.trim()) || (second && second.trim()) || '';
}

// ---------------------------------------------------------------------------
// Suggestions (#63)
// ---------------------------------------------------------------------------

export const SUGGESTION_FILTERS = ['new', 'seen', 'all'] as const;
export type SuggestionFilter = (typeof SUGGESTION_FILTERS)[number];
export const SUGGESTIONS_PAGE_SIZE = 50;

export interface SuggestionRow {
  id: string;
  authorName: string | null;
  authorRole: StaffRole | null;
  body: string;
  createdAt: string;
  seenByName: string | null;
  seenAt: string | null;
}

export interface SuggestionsPage {
  rows: SuggestionRow[];
  newCount: number;
  total: number;
}

export function readSuggestionsPage(payload: unknown): SuggestionsPage {
  const p = isObject(payload) ? payload : {};
  return {
    rows: list(p.suggestions)
      .filter((s) => typeof s.id === 'string')
      .map((s) => ({
        id: s.id as string,
        authorName: str(s.author_name),
        authorRole: role(s.author_role),
        body: str(s.body) ?? '',
        createdAt: str(s.created_at) ?? '',
        seenByName: str(s.seen_by_name),
        seenAt: str(s.seen_at),
      })),
    newCount: num(p.new_count) ?? 0,
    total: num(p.total) ?? 0,
  };
}

/** The rail badge's figure: nothing unread reads as no badge at all. */
export function newSuggestionCount(payload: unknown): number {
  return readSuggestionsPage(payload).newCount;
}

// ---------------------------------------------------------------------------
// Recipe changes (#71)
// ---------------------------------------------------------------------------

export const RECIPE_CHANGE_FILTERS = ['waiting', 'decided', 'all'] as const;
export type RecipeChangeFilter = (typeof RECIPE_CHANGE_FILTERS)[number];
export type RecipeChangeStatus = 'waiting' | 'approved' | 'declined' | 'withdrawn';
const RECIPE_CHANGE_STATUSES: readonly RecipeChangeStatus[] = ['waiting', 'approved', 'declined', 'withdrawn'];

export interface RecipeLine {
  ingredientId: string;
  nameEn: string | null;
  nameAr: string | null;
  qty: number | null;
  unit: string | null;
}

export interface RecipeChangeRow {
  id: string;
  target: 'variant' | 'output';
  itemNameEn: string | null;
  itemNameAr: string | null;
  sizeNameEn: string | null;
  sizeNameAr: string | null;
  requestedByName: string | null;
  requestedAt: string;
  note: string | null;
  status: RecipeChangeStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  declineReason: string | null;
  /** A waiting request whose target no longer matches what was asked against. */
  stale: boolean;
  before: RecipeLine[];
  after: RecipeLine[];
}

export interface RecipeChangesPage {
  rows: RecipeChangeRow[];
  waitingCount: number;
  total: number;
}

function readLines(v: unknown): RecipeLine[] {
  return list(v)
    .filter((l) => typeof l.ingredient_id === 'string')
    .map((l) => ({
      ingredientId: l.ingredient_id as string,
      nameEn: str(l.name_en),
      nameAr: str(l.name_ar),
      qty: num(l.qty),
      unit: str(l.unit),
    }));
}

export function readRecipeChangesPage(payload: unknown): RecipeChangesPage {
  const p = isObject(payload) ? payload : {};
  return {
    rows: list(p.requests)
      .filter((r) => typeof r.id === 'string')
      .map((r) => ({
        id: r.id as string,
        target: r.target === 'output' ? 'output' : 'variant',
        itemNameEn: str(r.item_name_en),
        itemNameAr: str(r.item_name_ar),
        sizeNameEn: str(r.size_name_en),
        sizeNameAr: str(r.size_name_ar),
        requestedByName: str(r.requested_by_name),
        requestedAt: str(r.requested_at) ?? '',
        note: str(r.note),
        status: (RECIPE_CHANGE_STATUSES as readonly unknown[]).includes(r.status) ? (r.status as RecipeChangeStatus) : 'waiting',
        decidedByName: str(r.decided_by_name),
        decidedAt: str(r.decided_at),
        declineReason: str(r.decline_reason),
        stale: r.stale === true,
        before: readLines(r.before),
        after: readLines(r.after),
      })),
    waitingCount: num(p.waiting_count) ?? 0,
    total: num(p.total) ?? 0,
  };
}

export type LineChange = 'same' | 'changed' | 'added' | 'removed';

export interface RecipeDiffRow {
  ingredientId: string;
  nameEn: string | null;
  nameAr: string | null;
  unit: string | null;
  before: number | null;
  after: number | null;
  change: LineChange;
}

/**
 * The request's lines before and after, one row per ingredient, in the
 * recipe's own order with anything added at the end. A recipe names an
 * ingredient once (the server refuses a line named twice), so the ingredient
 * is the row's key.
 */
export function recipeDiff(before: readonly RecipeLine[], after: readonly RecipeLine[]): RecipeDiffRow[] {
  const afterBy = new Map(after.map((l) => [l.ingredientId, l]));
  const beforeIds = new Set(before.map((l) => l.ingredientId));
  const rows: RecipeDiffRow[] = before.map((b) => {
    const a = afterBy.get(b.ingredientId);
    const change: LineChange = !a ? 'removed' : a.qty === b.qty ? 'same' : 'changed';
    return { ingredientId: b.ingredientId, nameEn: b.nameEn, nameAr: b.nameAr, unit: b.unit, before: b.qty, after: a?.qty ?? null, change };
  });
  for (const a of after) {
    if (beforeIds.has(a.ingredientId)) continue;
    rows.push({ ingredientId: a.ingredientId, nameEn: a.nameEn, nameAr: a.nameAr, unit: a.unit, before: null, after: a.qty, change: 'added' });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ideas from the team (#65)
// ---------------------------------------------------------------------------

export type Team = 'bar' | 'kitchen';

export interface IdeaLine {
  ingredientId: string | null;
  label: string | null;
  qty: number | null;
  unit: string | null;
}

export interface IdeaRow {
  id: string;
  team: Team;
  authorName: string | null;
  submittedAt: string;
  nameEn: string | null;
  nameAr: string | null;
  itemKind: 'drink' | 'dessert' | 'food' | null;
  lines: IdeaLine[];
  sizes: { nameEn: string | null; nameAr: string | null }[];
  audience: string | null;
  inspiration: string | null;
  link: string | null;
  notes: string | null;
  photos: string[];
  /** The author's record as sent: a Start prefills the proposal from it. */
  record: Record<string, unknown>;
}

export interface IdeasToReview {
  ideas: IdeaRow[];
  count: number;
}

const ITEM_KINDS = ['drink', 'dessert', 'food'] as const;

export function readIdeasToReview(payload: unknown): IdeasToReview {
  const p = isObject(payload) ? payload : {};
  const ideas = list(p.ideas)
    .filter((i) => typeof i.id === 'string')
    .map((i): IdeaRow => {
      const record = isObject(i.record) ? i.record : {};
      return {
        id: i.id as string,
        team: i.team === 'kitchen' ? 'kitchen' : 'bar',
        authorName: str(i.author_name),
        submittedAt: str(i.submitted_at) ?? '',
        nameEn: str(record.name_en),
        nameAr: str(record.name_ar),
        itemKind: (ITEM_KINDS as readonly unknown[]).includes(record.item_kind) ? (record.item_kind as IdeaRow['itemKind']) : null,
        lines: list(record.lines).map((l) => ({
          ingredientId: str(l.ingredient_id),
          label: str(l.label),
          qty: num(l.qty),
          unit: str(l.unit),
        })),
        sizes: list(record.sizes).map((s) => ({ nameEn: str(s.name_en), nameAr: str(s.name_ar) })),
        audience: str(record.audience),
        inspiration: str(record.inspiration),
        link: str(record.link),
        notes: str(record.notes),
        photos: Array.isArray(i.photos) ? i.photos.filter((x): x is string => typeof x === 'string') : [],
        record,
      };
    });
  return { ideas, count: num(p.count) ?? ideas.length };
}

/** How many ideas wait; the kitchen board's My tasks count adds these for a head. */
export function ideasWaiting(payload: unknown): number {
  return readIdeasToReview(payload).count;
}

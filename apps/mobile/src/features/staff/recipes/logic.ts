/**
 * Recipes and recipe changes on the staff phone (build-contracts-2026-09-23
 * §2.24.6, §2.24.7; plan #71, #72).
 *
 * NAMES ONLY (#72, the parked default of §0 P3). `recipe_view` gives every
 * reader, the manager and the owner included, a recipe's ingredient names and
 * never a quantity or a unit. A head asks for a change without seeing the
 * current amounts: set a line to a new amount, remove a line, or add an
 * ingredient, each amount in the ingredient's base unit (which comes from
 * `staff_ingredient_options`, not from the recipe). The owner approves it,
 * which the server writes through the recipe path, or declines it with a
 * reason. Only the manager's and owner's list (`recipe_changes_page`) carries
 * amounts, before and after.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import type { StaffRole } from '@touch/core';
import { parseQty, type StockUnit } from '../supplies/production';

/** Who reads recipes: the bar and kitchen family and MGMT (§2.24.6). */
export const RECIPE_ROLES: readonly StaffRole[] = [
  'head_barista',
  'barista',
  'head_chef',
  'chef',
  'manager',
  'owner',
];

/** Who opens recipe changes: the heads ask, the owner decides, the manager reads (§6.1). */
export const RECIPE_CHANGE_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'manager', 'owner'];

export function asksRecipeChanges(role: StaffRole): boolean {
  return role === 'head_barista' || role === 'head_chef';
}

export function decidesRecipeChanges(role: StaffRole): boolean {
  return role === 'owner';
}

export function readsRecipeChanges(role: StaffRole): boolean {
  return role === 'manager' || role === 'owner';
}

// ── recipe_view ─────────────────────────────────────────────────────────────

export interface RecipeLine {
  recipe_line_id: string;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
}

export interface RecipeSize {
  variant_id: string;
  name_en: string;
  name_ar: string;
  lines: RecipeLine[];
}

export interface RecipeItem {
  menu_item_id: string;
  name_en: string;
  name_ar: string;
  category_name_en: string;
  category_name_ar: string;
  sizes: RecipeSize[];
}

export interface PreparedRecipe {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  lines: RecipeLine[];
}

export interface RecipeView {
  items: RecipeItem[];
  prepared: PreparedRecipe[];
}

/** Items whose name, category or an ingredient matches the typed text, in either language. */
export function filterRecipeItems(items: readonly RecipeItem[], query: string): RecipeItem[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...items];
  const hit = (...s: (string | null | undefined)[]) =>
    s.some((x) => typeof x === 'string' && x.toLocaleLowerCase().includes(q));
  return items.filter(
    (i) =>
      hit(i.name_en, i.name_ar, i.category_name_en, i.category_name_ar) ||
      i.sizes.some((s) => s.lines.some((l) => hit(l.name_en, l.name_ar))),
  );
}

export function filterPrepared(prepared: readonly PreparedRecipe[], query: string): PreparedRecipe[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [...prepared];
  const hit = (...s: string[]) => s.some((x) => x.toLocaleLowerCase().includes(q));
  return prepared.filter((p) => hit(p.name_en, p.name_ar) || p.lines.some((l) => hit(l.name_en, l.name_ar)));
}

// ── Targets ─────────────────────────────────────────────────────────────────

export type RecipeTargetKind = 'variant' | 'output';

/** What a change can be asked for: one size of a cafe item, or a prepared item's own recipe. */
export interface RecipeTarget {
  kind: RecipeTargetKind;
  /** The variant id, or the prepared ingredient's id. */
  id: string;
  name_en: string;
  name_ar: string;
  size_en: string | null;
  size_ar: string | null;
  lines: RecipeLine[];
}

export function recipeTargets(view: RecipeView | null | undefined): RecipeTarget[] {
  if (!view) return [];
  const sizes = view.items.flatMap((item) =>
    item.sizes.map<RecipeTarget>((size) => ({
      kind: 'variant',
      id: size.variant_id,
      name_en: item.name_en,
      name_ar: item.name_ar,
      // An item with one size is named by the item alone.
      size_en: item.sizes.length > 1 ? size.name_en : null,
      size_ar: item.sizes.length > 1 ? size.name_ar : null,
      lines: size.lines,
    })),
  );
  const prepared = view.prepared.map<RecipeTarget>((p) => ({
    kind: 'output',
    id: p.ingredient_id,
    name_en: p.name_en,
    name_ar: p.name_ar,
    size_en: null,
    size_ar: null,
    lines: p.lines,
  }));
  return [...sizes, ...prepared];
}

export function findTarget(
  targets: readonly RecipeTarget[],
  kind: string | null | undefined,
  id: string | null | undefined,
): RecipeTarget | null {
  if (!kind || !id) return null;
  return targets.find((t) => t.kind === kind && t.id === id) ?? null;
}

// ── The head's draft ────────────────────────────────────────────────────────

export type DraftOp =
  | { op: 'set'; lineId: string; ingredientId: string; qty: string }
  | { op: 'remove'; lineId: string; ingredientId: string }
  | { op: 'add'; ingredientId: string; qty: string };

export interface RecipeChangeDraft {
  target: { kind: RecipeTargetKind; id: string } | null;
  ops: DraftOp[];
  note: string;
}

export const OPS_MAX = 30;
export const NOTE_MAX = 1000;
export const REASON_MAX = 1000;

export function emptyRecipeDraft(target: RecipeChangeDraft['target'] = null): RecipeChangeDraft {
  return { target, ops: [], note: '' };
}

/** What the draft does to one current line: set it, remove it, or nothing. */
export function lineOp(draft: RecipeChangeDraft, lineId: string): DraftOp | null {
  return draft.ops.find((o) => o.op !== 'add' && o.lineId === lineId) ?? null;
}

/**
 * The draft with a current line set to a new amount, removed, or left as it is
 * (`null`). A line carries at most one op.
 */
export function withLineOp(
  draft: RecipeChangeDraft,
  line: Pick<RecipeLine, 'recipe_line_id' | 'ingredient_id'>,
  op: 'set' | 'remove' | null,
): RecipeChangeDraft {
  const others = draft.ops.filter((o) => o.op === 'add' || o.lineId !== line.recipe_line_id);
  if (op === null) return { ...draft, ops: others };
  const next: DraftOp =
    op === 'set'
      ? { op: 'set', lineId: line.recipe_line_id, ingredientId: line.ingredient_id, qty: '' }
      : { op: 'remove', lineId: line.recipe_line_id, ingredientId: line.ingredient_id };
  return { ...draft, ops: [...others, next] };
}

/** The draft with an ingredient added (once; a second add of the same one is ignored). */
export function withAdded(draft: RecipeChangeDraft, ingredientId: string): RecipeChangeDraft {
  if (draft.ops.some((o) => o.op === 'add' && o.ingredientId === ingredientId)) return draft;
  return { ...draft, ops: [...draft.ops, { op: 'add', ingredientId, qty: '' }] };
}

/** The draft without the op at `index`. */
export function withoutOp(draft: RecipeChangeDraft, index: number): RecipeChangeDraft {
  return { ...draft, ops: draft.ops.filter((_, i) => i !== index) };
}

/** The draft with the typed amount of the op at `index`. */
export function withQty(draft: RecipeChangeDraft, index: number, qty: string): RecipeChangeDraft {
  return {
    ...draft,
    ops: draft.ops.map((o, i) => (i === index && o.op !== 'remove' ? { ...o, qty } : o)),
  };
}

/** Where a draft is wrong: `target`, `ops`, `note`, or one op's amount or ingredient. */
export type RecipeIssue =
  | { field: 'target'; code: 'required' }
  | { field: 'ops'; code: 'required' | 'tooMany' | 'emptyResult' }
  | { field: 'note'; code: 'tooLong' }
  | { field: 'qty'; index: number; code: 'required' | 'invalid' }
  | { field: 'ingredient'; index: number; code: 'onRecipe' | 'twice' | 'self' };

/**
 * Check a draft against the target's current lines, with the server's rules
 * (§2.24.7), so a field is marked before the round trip. The server stays
 * the wall (RECORD_INVALID, hint `ops.<n>.<field>`).
 */
export function validateRecipeChange(
  draft: RecipeChangeDraft,
  target: RecipeTarget | null,
): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  if (!draft.target || !target) {
    issues.push({ field: 'target', code: 'required' });
    return issues;
  }
  if (draft.ops.length === 0) issues.push({ field: 'ops', code: 'required' });
  if (draft.ops.length > OPS_MAX) issues.push({ field: 'ops', code: 'tooMany' });
  const onTarget = new Set(target.lines.map((l) => l.ingredient_id));
  const added = new Set<string>();
  draft.ops.forEach((op, index) => {
    if (op.op === 'set' || op.op === 'add') {
      if (!op.qty.trim()) issues.push({ field: 'qty', index, code: 'required' });
      else if (parseQty(op.qty) === null) issues.push({ field: 'qty', index, code: 'invalid' });
    }
    if (op.op === 'add') {
      if (draft.target?.kind === 'output' && op.ingredientId === draft.target.id) {
        issues.push({ field: 'ingredient', index, code: 'self' });
      } else if (onTarget.has(op.ingredientId)) {
        issues.push({ field: 'ingredient', index, code: 'onRecipe' });
      } else if (added.has(op.ingredientId)) {
        issues.push({ field: 'ingredient', index, code: 'twice' });
      }
      added.add(op.ingredientId);
    }
  });
  const removed = new Set(draft.ops.filter((o) => o.op === 'remove').map((o) => (o as { lineId: string }).lineId));
  const kept = target.lines.filter((l) => !removed.has(l.recipe_line_id)).length;
  if (draft.ops.length > 0 && kept + added.size === 0) issues.push({ field: 'ops', code: 'emptyResult' });
  if (draft.note.trim().length > NOTE_MAX) issues.push({ field: 'note', code: 'tooLong' });
  return issues;
}

export type RecipeOpArg =
  | { op: 'set'; recipe_line_id: string; qty: number }
  | { op: 'remove'; recipe_line_id: string }
  | { op: 'add'; ingredient_id: string; qty: number };

export interface RecipeChangeArgs {
  p_target: RecipeTargetKind;
  p_target_id: string;
  p_ops: RecipeOpArg[];
  p_note?: string;
  p_venue_id: string;
}

/** The `request_recipe_change` arguments of a valid draft (the key is added by the caller). */
export function recipeChangeArgs(draft: RecipeChangeDraft, venueId: string): RecipeChangeArgs {
  const target = draft.target as NonNullable<RecipeChangeDraft['target']>;
  const ops = draft.ops.map<RecipeOpArg>((o) =>
    o.op === 'set'
      ? { op: 'set', recipe_line_id: o.lineId, qty: parseQty(o.qty) as number }
      : o.op === 'remove'
        ? { op: 'remove', recipe_line_id: o.lineId }
        : { op: 'add', ingredient_id: o.ingredientId, qty: parseQty(o.qty) as number },
  );
  const note = draft.note.trim();
  return {
    p_target: target.kind,
    p_target_id: target.id,
    p_ops: ops,
    ...(note ? { p_note: note } : {}),
    p_venue_id: venueId,
  };
}

/** The intent a request's key is kept under: the request as sent. */
export function recipeChangeIntent(args: RecipeChangeArgs): string {
  return `recipe_change:${args.p_venue_id}:${args.p_target}:${args.p_target_id}:${JSON.stringify([args.p_ops, args.p_note ?? ''])}`;
}

// ── The requests ────────────────────────────────────────────────────────────

export type RecipeChangeStatus = 'waiting' | 'approved' | 'declined' | 'withdrawn';
export const RECIPE_CHANGE_FILTERS = ['waiting', 'decided', 'all'] as const;
export type RecipeChangeFilter = (typeof RECIPE_CHANGE_FILTERS)[number];

/** One op of a head's own request, their own amount on a set or an add (`my_recipe_changes`). */
export interface MyRecipeChangeOp {
  op: 'set' | 'remove' | 'add';
  ingredient_id: string;
  name_en: string | null;
  name_ar: string | null;
  qty: number | null;
  unit: StockUnit | null;
}

export interface MyRecipeChange {
  id: string;
  target: RecipeTargetKind;
  item_name_en: string | null;
  item_name_ar: string | null;
  size_name_en: string | null;
  size_name_ar: string | null;
  ops: MyRecipeChangeOp[];
  note: string | null;
  status: RecipeChangeStatus;
  requested_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  decline_reason: string | null;
}

export interface RecipeAmountLine {
  recipe_line_id?: string;
  ingredient_id: string;
  name_en: string | null;
  name_ar: string | null;
  qty: number;
  unit: StockUnit | null;
}

/** One row of `recipe_changes_page` (MGMT): with the amounts, before and after. */
export interface RecipeChangeRow {
  id: string;
  target: RecipeTargetKind;
  variant_id: string | null;
  output_ingredient_id: string | null;
  item_name_en: string | null;
  item_name_ar: string | null;
  size_name_en: string | null;
  size_name_ar: string | null;
  requested_by_name: string | null;
  requested_at: string;
  note: string | null;
  status: RecipeChangeStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decline_reason: string | null;
  stale: boolean;
  before: RecipeAmountLine[];
  after: RecipeAmountLine[];
}

export interface RecipeChangesPage {
  requests: RecipeChangeRow[];
  waiting_count: number;
  total: number;
}

/** What a decline needs: a reason, at most 1000 characters. */
export function declineIssue(reason: string): 'required' | 'tooLong' | null {
  const text = reason.trim();
  if (!text) return 'required';
  return text.length > REASON_MAX ? 'tooLong' : null;
}

/** Whether the owner may press Approve: a waiting request whose recipe has not moved since. */
export function canApprove(row: Pick<RecipeChangeRow, 'status' | 'stale'>): boolean {
  return row.status === 'waiting' && !row.stale;
}

/**
 * How the change reads for the manager and the owner: each ingredient with its
 * amount before and after (null where it was not or will not be on the recipe).
 */
export interface ChangeLine {
  ingredient_id: string;
  name_en: string | null;
  name_ar: string | null;
  unit: StockUnit | null;
  before: number | null;
  after: number | null;
}

export function changeLines(row: Pick<RecipeChangeRow, 'before' | 'after'>): ChangeLine[] {
  const lines = new Map<string, ChangeLine>();
  for (const b of row.before) {
    lines.set(b.ingredient_id, {
      ingredient_id: b.ingredient_id,
      name_en: b.name_en,
      name_ar: b.name_ar,
      unit: b.unit,
      before: b.qty,
      after: null,
    });
  }
  for (const a of row.after) {
    const line = lines.get(a.ingredient_id);
    if (line) line.after = a.qty;
    else {
      lines.set(a.ingredient_id, {
        ingredient_id: a.ingredient_id,
        name_en: a.name_en,
        name_ar: a.name_ar,
        unit: a.unit,
        before: null,
        after: a.qty,
      });
    }
  }
  return [...lines.values()];
}

/** The ingredients a head may add: active bought-in or made-here ones, not already on the target. */
export interface IngredientOption {
  id: string;
  name_en: string;
  name_ar: string;
  unit: StockUnit;
  kind: string;
  pack_size: number | null;
}

export function addableIngredients(
  options: readonly IngredientOption[],
  target: RecipeTarget | null,
  draft: RecipeChangeDraft,
  query: string,
): IngredientOption[] {
  if (!target) return [];
  const taken = new Set([
    ...target.lines.map((l) => l.ingredient_id),
    ...draft.ops.filter((o) => o.op === 'add').map((o) => o.ingredientId),
    ...(target.kind === 'output' ? [target.id] : []),
  ]);
  const q = query.trim().toLocaleLowerCase();
  return options.filter(
    (o) =>
      (o.kind === 'purchased' || o.kind === 'prepared') &&
      !taken.has(o.id) &&
      (!q || o.name_en.toLocaleLowerCase().includes(q) || o.name_ar.toLocaleLowerCase().includes(q)),
  );
}

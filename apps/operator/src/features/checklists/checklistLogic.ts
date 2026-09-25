/**
 * Daily checklists on the operator (build-contracts-2026-09-23 §2.14, §5.5):
 * the payloads of app.checklist_board and app.checklist_day_state, and the
 * owner's draft of one list with what app.save_checklist_template accepts.
 * A line may need a photo (checklist_photos, §2.24.8): the phone ticks it only
 * with one, and the day's board carries the photo's path.
 * Pure: no supabase, no react.
 *
 * The readers never trust the payload's shape. Day close and the protocols
 * page both mount these reads, and a payload that is not what this file
 * expects must read as "nothing to show" rather than break either screen.
 */
import { HIREABLE_ROLES, type StaffRole } from '@touch/core/staff/roles';

export type ChecklistSlot = 'open' | 'close';
export const CHECKLIST_SLOTS: readonly ChecklistSlot[] = ['open', 'close'];

/**
 * The roles a list can be written for, in the Staff page's order. The server
 * refuses only prep (INVALID_ROLE, soft-retired); the owner is left out as
 * nobody works a shift as the owner, and the two roles on Majed's parked list
 * (§0 P1) do not exist yet.
 */
export const CHECKLIST_ROLES: readonly StaffRole[] = HIREABLE_ROLES;

/** save_checklist_template's limits (0165 §9). */
export const MAX_LINES = 30;
export const MAX_LINE_LENGTH = 200;
export const MAX_NAME_LENGTH = 120;

/** Feature-private keys, under the ['checklists'] root QK.checklistDayState shares. */
export const CK = {
  board: (date: string) => ['checklists', 'board', date] as const,
};

// ---------------------------------------------------------------------------
// app.checklist_day_state: how far each list got (day close, the card)
// ---------------------------------------------------------------------------

export interface DayStateList {
  role: StaffRole;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  total: number;
  done: number;
  open_items: { text_en: string; text_ar: string }[];
}

export interface DayState {
  business_date: string | null;
  lists: DayStateList[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSlot = (v: unknown): v is ChecklistSlot => v === 'open' || v === 'close';
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function texts(v: unknown): { text_en: string; text_ar: string }[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObject).map((t) => ({ text_en: str(t.text_en), text_ar: str(t.text_ar) }));
}

export function readDayState(payload: unknown): DayState {
  if (!isObject(payload)) return { business_date: null, lists: [] };
  const lists = Array.isArray(payload.lists) ? payload.lists : [];
  return {
    business_date: typeof payload.business_date === 'string' ? payload.business_date : null,
    lists: lists
      .filter((l): l is Record<string, unknown> => isObject(l) && typeof l.role === 'string' && isSlot(l.slot))
      .map((l) => ({
        role: l.role as StaffRole,
        slot: l.slot as ChecklistSlot,
        name_en: str(l.name_en),
        name_ar: str(l.name_ar),
        total: num(l.total),
        done: num(l.done),
        open_items: texts(l.open_items),
      })),
  };
}

/** A list with a line nobody ticked. A list with no lines never reaches here (the server drops it). */
export const isUnfinished = (l: Pick<DayStateList, 'done' | 'total'>): boolean => l.done < l.total;

/** The card's headline: lists finished out of lists due today. */
export function daySummary(state: DayState): { finished: number; total: number } {
  return { finished: state.lists.filter((l) => !isUnfinished(l)).length, total: state.lists.length };
}

/**
 * The card's rows: unfinished lists first (least done first), then finished
 * ones, each group in the server's role and slot order.
 */
export function cardRows(state: DayState): DayStateList[] {
  const open = state.lists.filter(isUnfinished);
  const done = state.lists.filter((l) => !isUnfinished(l));
  const ratio = (l: DayStateList) => (l.total === 0 ? 1 : l.done / l.total);
  return [...open.map((l, i) => ({ l, i })).sort((a, b) => ratio(a.l) - ratio(b.l) || a.i - b.i).map((x) => x.l), ...done];
}

// ---------------------------------------------------------------------------
// app.checklist_board: every template and its day (the sheet)
// ---------------------------------------------------------------------------

export interface BoardItem {
  text_en: string;
  text_ar: string;
  done_by_name: string | null;
  done_at: string | null;
  note: string | null;
  /** Ticked only with a photo, taken on the phone. */
  photo_required: boolean;
  /** The photo sent with the tick (a staff-media path), on any line that has one. */
  photo_path: string | null;
}

export interface TemplateLine {
  position: number;
  text_en: string;
  text_ar: string;
  photo_required: boolean;
}

export interface BoardTemplate {
  template_id: string;
  role: StaffRole;
  slot: ChecklistSlot;
  name_en: string;
  name_ar: string;
  version: number;
  items: TemplateLine[];
  /** Null when nobody opened the list that day: the template's lines, nothing done. */
  today: { run_id: string; done: number; total: number; items: BoardItem[] } | null;
}

export interface Board {
  business_date: string | null;
  templates: BoardTemplate[];
}

const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nonBlank = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export function readBoard(payload: unknown): Board {
  if (!isObject(payload)) return { business_date: null, templates: [] };
  const rows = Array.isArray(payload.templates) ? payload.templates : [];
  return {
    business_date: typeof payload.business_date === 'string' ? payload.business_date : null,
    templates: rows
      .filter((t): t is Record<string, unknown> => isObject(t) && typeof t.template_id === 'string' && typeof t.role === 'string' && isSlot(t.slot))
      .map((t) => {
        const today = isObject(t.today) ? t.today : null;
        return {
          template_id: t.template_id as string,
          role: t.role as StaffRole,
          slot: t.slot as ChecklistSlot,
          name_en: str(t.name_en),
          name_ar: str(t.name_ar),
          version: num(t.version),
          items: (Array.isArray(t.items) ? t.items : [])
            .filter(isObject)
            .map((i) => ({ position: num(i.position), text_en: str(i.text_en), text_ar: str(i.text_ar), photo_required: i.photo_required === true }))
            .sort((a, b) => a.position - b.position),
          today: today
            ? {
                run_id: str(today.run_id),
                done: num(today.done),
                total: num(today.total),
                items: (Array.isArray(today.items) ? today.items : []).filter(isObject).map((i) => ({
                  text_en: str(i.text_en),
                  text_ar: str(i.text_ar),
                  done_by_name: nullableStr(i.done_by_name),
                  done_at: nullableStr(i.done_at),
                  note: nullableStr(i.note),
                  photo_required: i.photo_required === true,
                  photo_path: nonBlank(i.photo_path),
                })),
              }
            : null,
        };
      }),
  };
}

export function findTemplate(board: Board, role: StaffRole, slot: ChecklistSlot): BoardTemplate | null {
  return board.templates.find((t) => t.role === role && t.slot === slot) ?? null;
}

/**
 * The lines the day view shows: the day's snapshot when someone opened the
 * list, else the template's lines with nothing ticked. An owner edit made after
 * the list was opened shows from the next day, as on the phone.
 */
export function dayLines(t: BoardTemplate): BoardItem[] {
  if (t.today) return t.today.items;
  return t.items.map((i) => ({ text_en: i.text_en, text_ar: i.text_ar, done_by_name: null, done_at: null, note: null, photo_required: i.photo_required, photo_path: null }));
}

/** Templates in the editor's role order, then open before close; a role outside the list goes last. */
export function sortTemplates(templates: readonly BoardTemplate[]): BoardTemplate[] {
  const rank = (r: StaffRole) => {
    const i = CHECKLIST_ROLES.indexOf(r);
    return i === -1 ? CHECKLIST_ROLES.length : i;
  };
  return [...templates].sort((a, b) => rank(a.role) - rank(b.role) || CHECKLIST_SLOTS.indexOf(a.slot) - CHECKLIST_SLOTS.indexOf(b.slot));
}

// ---------------------------------------------------------------------------
// The owner's draft of one list
// ---------------------------------------------------------------------------

export interface DraftLine {
  key: string;
  text_en: string;
  text_ar: string;
  /** "Needs a photo": the phone ticks this line only with one. */
  photo_required: boolean;
}

export interface ChecklistDraft {
  name_en: string;
  name_ar: string;
  lines: DraftLine[];
}

export type TextProblem = 'both' | 'tooLong' | null;

/** One bilingual pair: both languages, each within the limit. */
export function textProblem(en: string, ar: string, max: number): TextProblem {
  if (en.trim() === '' || ar.trim() === '') return 'both';
  if (en.trim().length > max || ar.trim().length > max) return 'tooLong';
  return null;
}

const blankLine = (l: DraftLine) => l.text_en.trim() === '' && l.text_ar.trim() === '';

/**
 * What stops the save, box by box. A line left blank in both languages is
 * dropped on save rather than refused, the way Goods in drops an untouched
 * line; a line with one language is refused (TEXT_BOTH_LANGUAGES_REQUIRED).
 */
export function draftProblems(draft: ChecklistDraft): { name: TextProblem; lines: Map<string, TextProblem>; tooMany: boolean } {
  const lines = new Map<string, TextProblem>();
  for (const l of draft.lines) {
    if (blankLine(l)) continue;
    const p = textProblem(l.text_en, l.text_ar, MAX_LINE_LENGTH);
    if (p) lines.set(l.key, p);
  }
  return {
    name: textProblem(draft.name_en, draft.name_ar, MAX_NAME_LENGTH),
    lines,
    tooMany: draft.lines.filter((l) => !blankLine(l)).length > MAX_LINES,
  };
}

export function draftIsValid(draft: ChecklistDraft): boolean {
  const p = draftProblems(draft);
  return p.name === null && p.lines.size === 0 && !p.tooMany;
}

export interface SaveItem {
  text_en: string;
  text_ar: string;
  photo_required: boolean;
}

/** The p_items save_checklist_template takes: blank lines dropped, both languages trimmed. */
export function savePayloadItems(draft: ChecklistDraft): SaveItem[] {
  return draft.lines
    .filter((l) => !blankLine(l))
    .map((l) => ({ text_en: l.text_en.trim(), text_ar: l.text_ar.trim(), photo_required: l.photo_required }));
}

/** Has anything the save would send changed since the draft was opened? */
export function draftChanged(draft: ChecklistDraft, saved: ChecklistDraft): boolean {
  if (draft.name_en.trim() !== saved.name_en.trim() || draft.name_ar.trim() !== saved.name_ar.trim()) return true;
  const a = savePayloadItems(draft);
  const b = savePayloadItems(saved);
  return a.length !== b.length || a.some((x, i) => x.text_en !== b[i]!.text_en || x.text_ar !== b[i]!.text_ar || x.photo_required !== b[i]!.photo_required);
}

/** How many lines the save would send with "Needs a photo" on. */
export const photoLineCount = (draft: ChecklistDraft): number => savePayloadItems(draft).filter((i) => i.photo_required).length;

export function moveLine<T>(list: readonly T[], index: number, dir: 'up' | 'down'): T[] {
  const to = dir === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

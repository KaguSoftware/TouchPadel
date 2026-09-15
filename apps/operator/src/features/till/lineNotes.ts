/**
 * Line notes — the preset vocabulary behind the basket's note button, and the
 * two pure functions that move a note between "a row of chips plus a free
 * line" and the single string the kitchen ticket prints.
 *
 * A note is ONE text column on order_lines (till_add_items takes `notes` as
 * text), so the presets are not a second kind of modifier: they are shortcuts
 * that type the sentence for the cashier. Anything the chips cannot say still
 * goes in the free line, and both halves survive a reopen.
 *
 * Matching on reopen is by LABEL, in the locale the dialog is drawn in — a
 * note written in English and reopened in Arabic simply lands in the free
 * line rather than lighting its chips. Nothing is lost either way, which is
 * the only property that matters: the kitchen already has the string.
 */

export type NotePresetId =
  // drinks
  | 'extraShot'
  | 'decaf'
  | 'oatMilk'
  | 'noIce'
  | 'extraIce'
  | 'noSugar'
  | 'extraHot'
  // food
  | 'noOnion'
  | 'sauceOnSide'
  | 'extraSauce'
  | 'noSalt'
  | 'wellDone'
  | 'extraSpicy'
  // service
  | 'allergy'
  | 'takeaway'
  | 'serveFirst'
  | 'serveLast';

export type NotePresetGroupId = 'drinks' | 'food' | 'service';

/**
 * Grouped so a barista's chips and a cook's chips are not one undifferentiated
 * wall — the cashier is reading this while a queue waits.
 */
export const NOTE_PRESET_GROUPS: readonly {
  id: NotePresetGroupId;
  presets: readonly NotePresetId[];
}[] = [
  { id: 'drinks', presets: ['extraShot', 'decaf', 'oatMilk', 'noIce', 'extraIce', 'noSugar', 'extraHot'] },
  { id: 'food', presets: ['noOnion', 'sauceOnSide', 'extraSauce', 'noSalt', 'wellDone', 'extraSpicy'] },
  { id: 'service', presets: ['allergy', 'takeaway', 'serveFirst', 'serveLast'] },
];

/** Every preset id in display order — the dialog's label lookup iterates this. */
export const NOTE_PRESET_IDS: readonly NotePresetId[] = NOTE_PRESET_GROUPS.flatMap((g) => g.presets);

/** What separates one clause of a note from the next, on screen and on the ticket. */
export const NOTE_JOIN = ', ';

/** Ceiling on the free-text half — the same one ItemSheet's note field uses. */
export const NOTE_MAX_LENGTH = 120;

/**
 * Chips first (in the order they were chosen), free text last. Empty parts are
 * dropped, so an all-empty note composes to '' — which is what the basket and
 * `till_add_items` both read as "no note".
 */
export function composeNote(chosen: readonly string[], free: string): string {
  return [...chosen.map((c) => c.trim()), free.trim()].filter(Boolean).join(NOTE_JOIN);
}

/**
 * The inverse, as far as an inverse exists: split a stored note back into the
 * chips it lights and the text it leaves in the free line. A clause that
 * matches a preset label (case-insensitively) becomes a chip; everything else
 * is rejoined verbatim. A clause repeated twice lights its chip once.
 */
export function splitNote(
  notes: string,
  labels: readonly string[],
): { chosen: string[]; free: string } {
  const chosen: string[] = [];
  const rest: string[] = [];
  for (const clause of notes.split(',').map((c) => c.trim()).filter(Boolean)) {
    const hit = labels.find((l) => l.trim().toLowerCase() === clause.toLowerCase());
    if (hit === undefined) rest.push(clause);
    else if (!chosen.includes(hit)) chosen.push(hit);
  }
  return { chosen, free: rest.join(NOTE_JOIN) };
}

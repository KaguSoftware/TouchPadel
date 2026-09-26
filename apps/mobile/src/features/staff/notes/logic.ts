/**
 * Notes on a new item (build-contracts-2026-09-23 §2.10, Q9): for 30 days
 * after a product release launches an item, every role may write what
 * customers and the team say about it; the notes feed its day-30 review.
 *
 * PURE (vitest).
 */

/** One row of `release_notes_for_me`: an item still in its note window. */
export interface NoteItem {
  menu_item_id: string;
  name_en: string;
  name_ar: string;
  launched_at: string;
  window_ends_at: string;
  run_id: string | null;
  notes: number;
  my_notes: number;
}

/** `release_notes_for_item`. */
export interface ItemNotes {
  item: { id: string; name_en: string; name_ar: string; window_ends_at: string; open: boolean };
  notes: { id: string; author_name: string | null; body: string; created_at: string; mine: boolean }[];
}

/** The cap on one note (§2.1: release notes are free text, 2000). */
export const NOTE_MAX = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days left to write, counting today while any of it is left: 0 once
 * the window has closed. A window closing later today is "the last day".
 */
export function daysLeft(windowEndsAt: string, now: number = Date.now()): number {
  const end = Date.parse(windowEndsAt);
  if (Number.isNaN(end) || end <= now) return 0;
  return Math.ceil((end - now) / DAY_MS);
}

/** The item the page opens on: the one a link named when it is still listed, else the newest launch. */
export function initialItemId(items: readonly Pick<NoteItem, 'menu_item_id'>[], requested: string | null | undefined): string | null {
  if (requested) return requested;
  return items[0]?.menu_item_id ?? null;
}

export type NoteIssue = 'required' | 'tooLong';

/** A note before it is sent: something written, within the cap (code points, as Postgres counts). */
export function checkNote(body: string): NoteIssue | null {
  const text = body.trim();
  if (text === '') return 'required';
  if ([...text].length > NOTE_MAX) return 'tooLong';
  return null;
}

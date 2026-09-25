/**
 * Notes on new items (build-contracts-2026-09-23 §2.10): the items still in
 * their 30-day window at the phone's venue, one item's notes, and adding one
 * (keyed, so a retried send records once).
 */
import { staffRpc } from '../api';
import type { ItemNotes, NoteItem } from './logic';

export async function fetchNoteItems(venueId: string): Promise<NoteItem[]> {
  const data = await staffRpc<{ items?: NoteItem[] } | null>('release_notes_for_me', { p_venue_id: venueId });
  return data?.items ?? [];
}

export function fetchItemNotes(menuItemId: string): Promise<ItemNotes> {
  return staffRpc<ItemNotes>('release_notes_for_item', { p_menu_item_id: menuItemId });
}

export function addReleaseNote(menuItemId: string, body: string, idempotencyKey: string): Promise<{ id: string }> {
  return staffRpc<{ id: string }>('add_release_note', {
    p_menu_item_id: menuItemId,
    p_body: body,
    p_idempotency_key: idempotencyKey,
  });
}

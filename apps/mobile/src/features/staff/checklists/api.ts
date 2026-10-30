/**
 * The checklist calls (build-contracts-2026-09-23 §2.14, §2.24.8). Venue by
 * argument on every read: a phone asserts no station.
 */
import { supabase } from '../../../lib/supabase';
import type { ChecklistHistory, ChecklistItem, ChecklistsToday, HistoryCursor, MarkArgs } from './logic';

/** Today's lists for the caller's own role; the first read of the day opens them. */
export async function fetchChecklistsToday(venueId: string): Promise<ChecklistsToday> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('my_checklists_today', { p_venue_id: venueId });
  if (error) throw error;
  return data as unknown as ChecklistsToday;
}

/** The caller's past lists (0375), newest first; `before` is the page's cursor, from the last page's `next`. */
export async function fetchChecklistHistory(
  venueId: string,
  before: HistoryCursor | null,
  limit = 20,
): Promise<ChecklistHistory> {
  const { data, error } = await supabase.schema('app').rpc('my_checklist_history', {
    p_venue_id: venueId,
    p_limit: limit,
    ...(before ? { p_before_date: before.before_date, p_before_run: before.before_run } : {}),
  });
  if (error) throw error;
  return data as unknown as ChecklistHistory;
}

/** Tick or untick one line (state-idempotent: no key). Returns the line as it now stands. */
export async function markChecklistItem(args: MarkArgs): Promise<ChecklistItem> {
  const { data, error } = await supabase.schema('app').rpc('mark_checklist_item', args);
  if (error) throw error;
  return data as unknown as ChecklistItem;
}

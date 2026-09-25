/** The teachings calls (build-contracts-2026-09-23 §2.24.3). */
import type { StaffTeam } from '@touch/core';
import { supabase } from '../../../lib/supabase';
import type { TeachingArgs, TeachingsPage } from './logic';

export async function fetchTeachings(venueId: string, team: StaffTeam | null): Promise<TeachingsPage> {
  const { data, error } = await supabase.schema('app').rpc('teachings_for_me', {
    p_venue_id: venueId,
    p_limit: 100,
    ...(team ? { p_team: team } : {}),
  });
  if (error) throw error;
  const page = data as unknown as Partial<TeachingsPage> | null;
  return { teachings: page?.teachings ?? [], total: page?.total ?? 0 };
}

/** A new teaching carries its intent's key; an edit is state-idempotent and takes none. */
export async function saveTeaching(args: TeachingArgs, idempotencyKey: string | null): Promise<{ id: string }> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('save_teaching', idempotencyKey ? { ...args, p_idempotency_key: idempotencyKey } : args);
  if (error) throw error;
  return data as unknown as { id: string };
}

export async function archiveTeaching(id: string): Promise<void> {
  const { error } = await supabase.schema('app').rpc('archive_teaching', { p_id: id });
  if (error) throw error;
}

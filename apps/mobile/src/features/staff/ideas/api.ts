/**
 * New-item ideas on the phone (build-contracts-2026-09-23 §2.9): a barista's
 * or chef assistant's own ideas and sending one, and the head's review list
 * and decline. Starting a release from an idea is `start_protocol` with
 * `p_data = {idea_id}` (staff-start.tsx). Every call names the venue the phone
 * works at: a phone has no station to resolve one (§6.5).
 */
import type { Json } from '@touch/db';
import { supabase } from '../../../lib/supabase';
import type { MyIdea, ReviewIdea } from './logic';

async function call<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

export async function fetchMyIdeas(venueId: string): Promise<MyIdea[]> {
  const data = await call<{ ideas?: MyIdea[] } | null>(
    supabase.schema('app').rpc('my_release_ideas', { p_venue_id: venueId }),
  );
  return data?.ideas ?? [];
}

export async function fetchIdeasToReview(venueId: string): Promise<{ ideas: ReviewIdea[]; count: number }> {
  const data = await call<{ ideas?: ReviewIdea[]; count?: number } | null>(
    supabase.schema('app').rpc('release_ideas_to_review', { p_venue_id: venueId }),
  );
  return { ideas: data?.ideas ?? [], count: data?.count ?? 0 };
}

export function submitIdea(args: {
  record: Record<string, unknown>;
  photos: string[];
  venueId: string;
  idempotencyKey: string;
}): Promise<{ id: string }> {
  return call<{ id: string }>(
    supabase.schema('app').rpc('submit_release_idea', {
      p_record: args.record as Json,
      p_photos: args.photos,
      p_venue_id: args.venueId,
      p_idempotency_key: args.idempotencyKey,
    }),
  );
}

export function withdrawIdea(id: string): Promise<{ status: string }> {
  return call<{ status: string }>(supabase.schema('app').rpc('withdraw_release_idea', { p_id: id }));
}

export function declineIdea(id: string, reason: string): Promise<{ status: string }> {
  return call<{ status: string }>(
    supabase.schema('app').rpc('decline_release_idea', { p_id: id, p_reason: reason }),
  );
}

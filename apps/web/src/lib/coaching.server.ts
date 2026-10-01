import 'server-only';
import { unstable_cache } from 'next/cache';
import { createStaticSupabase } from './supabase/static';
import {
  coachingStatus,
  parseCoachingPublic,
  type CoachingRead,
  type PublicCoaching,
} from './coaching';

export type { CoachingRead, CoachingStatus } from './coaching';

/**
 * The website's coaching read (docs/design/coaching/guest.md §4.14.1): `app.coaching_public`,
 * anon and public by design (R12; no student, phone or profile id, R43), shared by the
 * `/{locale}/coaching` page, the `/{locale}/c/<id>` page and the landing's coaches strip.
 *
 * One `unstable_cache` entry per branch argument (`null`: every open branch with coaching on),
 * keyed `coaching-public`, tagged `coaching`, revalidated every 60 s, read with the cookie-free
 * client. Places left may be up to a minute behind; the app re-checks on booking.
 *
 * The cached function THROWS on a failed or unreadable read and the wrapper turns that into
 * `{status: 'error'}` (the multi-venue audit lesson, menu.server.ts): `unstable_cache` keeps
 * whatever the function returns, so a fallback returned from inside it would be served for the
 * whole window. Every state is explicit (apps/web/CLAUDE.md): `ok` (at least one coach), `empty`
 * (coaching on, nobody public yet), `off` (`{off: true}`), `error`.
 */
async function fetchCoaching(venueId: string | null): Promise<PublicCoaching> {
  const { data, error } = await createStaticSupabase()
    .schema('app')
    .rpc('coaching_public', { p_venue_id: venueId });
  if (error) throw error;
  const coaching = parseCoachingPublic(data);
  if (!coaching) throw new Error('coaching_public answered in a shape the site cannot read');
  return coaching;
}

const cachedCoaching = unstable_cache(
  (venueId: string | null = null): Promise<PublicCoaching> => fetchCoaching(venueId),
  ['coaching-public'],
  { tags: ['coaching'], revalidate: 60 },
);

export async function getCachedCoaching(venueId: string | null = null): Promise<CoachingRead> {
  try {
    const coaching = await cachedCoaching(venueId);
    const status = coachingStatus(coaching);
    return { status, coaching: status === 'off' ? null : coaching };
  } catch (e) {
    // Also missing env: client creation throws synchronously.
    console.error('[coaching.server] coaching_public failed:', e);
    return { status: 'error', coaching: null };
  }
}

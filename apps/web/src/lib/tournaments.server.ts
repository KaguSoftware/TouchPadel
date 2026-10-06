import 'server-only';
import { unstable_cache } from 'next/cache';
import { createStaticSupabase } from './supabase/static';
import {
  parseTournamentPublic,
  parseTournamentsPublic,
  tournamentsStatus,
  type PublicTournaments,
  type TournamentPageRead,
  type TournamentsRead,
} from './tournaments';

export type {
  TournamentPageRead,
  TournamentPageStatus,
  TournamentsRead,
  TournamentsStatus,
} from './tournaments';

/**
 * The website's tournament reads (T-8; docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6, §1.8, §1.11), both anon and public by design (`publicByDesign`: no guest id, phone, full
 * name or court id; names only once a schedule exists, "First I." only), read with the
 * cookie-free client like coaching.server.ts:
 *
 * - `getCachedTournaments(venueId)`: `app.tournaments_public`, for the landing's event cards. One
 *   `unstable_cache` entry per branch argument (`null`: every live branch with tournaments on),
 *   keyed `tournaments-public`, tagged `tournaments`, revalidated every 60 s. Places left may be up
 *   to a minute behind; the app re-checks on registering.
 * - `getCachedTournament(id)`: `app.tournament_public`, for `/{locale}/events/<id>`. One entry per
 *   id, keyed `tournament-public`, tagged `tournaments`, revalidated every 30 s (the page refreshes
 *   itself every 30 s while play is on, so a score shows within a minute).
 *
 * The cached functions THROW on a failed or unreadable read and the wrappers turn that into
 * `{status: 'error'}` (the multi-venue audit lesson, menu.server.ts): `unstable_cache` keeps
 * whatever the function returns, so a fallback returned from inside it would be served for the
 * whole window. Every state is explicit (apps/web/CLAUDE.md): the list `ok | empty | off | error`,
 * the page `ok | missing | error`.
 */
async function fetchTournaments(venueId: string | null): Promise<PublicTournaments> {
  const { data, error } = await createStaticSupabase()
    .schema('app')
    // Every argument is sent, null included (the function has no defaults, build contracts
    // §1.6); null asks for every live branch, which the generated type cannot say.
    .rpc('tournaments_public', { p_venue_id: venueId as string });
  if (error) throw error;
  const tournaments = parseTournamentsPublic(data);
  if (!tournaments) throw new Error('tournaments_public answered in a shape the site cannot read');
  return tournaments;
}

async function fetchTournament(tournamentId: string): Promise<TournamentPageRead> {
  const { data, error } = await createStaticSupabase()
    .schema('app')
    .rpc('tournament_public', { p_id: tournamentId });
  if (error) throw error;
  const read = parseTournamentPublic(data);
  if (!read) throw new Error('tournament_public answered in a shape the site cannot read');
  return read;
}

const cachedTournaments = unstable_cache(
  (venueId: string | null = null): Promise<PublicTournaments> => fetchTournaments(venueId),
  ['tournaments-public'],
  { tags: ['tournaments'], revalidate: 60 },
);

const cachedTournament = unstable_cache(
  (tournamentId: string): Promise<TournamentPageRead> => fetchTournament(tournamentId),
  ['tournament-public'],
  { tags: ['tournaments'], revalidate: 30 },
);

export async function getCachedTournaments(
  venueId: string | null = null,
): Promise<TournamentsRead> {
  try {
    const tournaments = await cachedTournaments(venueId);
    const status = tournamentsStatus(tournaments);
    return { status, tournaments: status === 'off' ? null : tournaments };
  } catch (e) {
    // Also missing env: client creation throws synchronously.
    console.error('[tournaments.server] tournaments_public failed:', e);
    return { status: 'error', tournaments: null };
  }
}

/** The page's read; call it only with an id `parseTournamentId` accepted. */
export async function getCachedTournament(tournamentId: string): Promise<TournamentPageRead> {
  try {
    return await cachedTournament(tournamentId);
  } catch (e) {
    console.error('[tournaments.server] tournament_public failed:', e);
    return { status: 'error', tournament: null };
  }
}

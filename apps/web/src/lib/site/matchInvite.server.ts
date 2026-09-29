import 'server-only';
import { createStaticSupabase } from '@/lib/supabase/static';
import { parseMatchInvite, type MatchInvite } from './matchInvite';

/**
 * The open-match invite read (docs/design/open-matches/guest.md §4.20):
 * `app.match_invite(p_token)`, anon and public by design (DF-9: no names, ids or money).
 *
 * Per request and never cached: the seats left change with every join, and the page is
 * `force-dynamic`. The cookie-free client, because the page reads nothing of the visitor.
 * The server answers a NULL, malformed, unknown or sandbox token `{"status":"closed"}`
 * and never raises, so a failure here is a real failure: it is logged whole (the tracker
 * gets the error, the guest never does) and the page shows its `error` state.
 */
export async function readMatchInvite(token: string): Promise<MatchInvite> {
  try {
    const { data, error } = await createStaticSupabase()
      .schema('app')
      .rpc('match_invite', { p_token: token });
    if (error) {
      console.error('[matchInvite.server] match_invite failed:', error);
      return { status: 'error' };
    }
    return parseMatchInvite(data);
  } catch (e) {
    // Also missing env: client creation throws synchronously.
    console.error('[matchInvite.server] match_invite failed:', e);
    return { status: 'error' };
  }
}

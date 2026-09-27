import type { AuthState } from '../ipc-channels';

/**
 * The owner leaves a locked station without a PIN (owner call, 2026-09-27).
 *
 * Quit and Exit forced full screen otherwise take a manager's PIN that is not
 * the signed-in person's own (pin-cache.ts mayLeave). That rule exists to keep
 * staff inside the app; applied to the owner it kept the owner in too, and an
 * owner alone at the venue had no second manager to ask, so the only way out
 * was a force quit.
 *
 * Main does not take the renderer's word for the role — the same reason it
 * re-checks every PIN. The staff row is read here, with the renderer's own
 * access token, and only a server answer about THAT token's user counts: the
 * token's `sub` has to be the staff id it came with, so a valid manager token
 * paired with the owner's id is refused before any request. A forged token
 * fails at the server.
 *
 * The answer is kept for the current session only (verifiedOwner), learnt on
 * every auth push, so an owner signed in while online can still leave after
 * the connection drops. Anyone else, or an owner main could not confirm, is
 * back to the manager PIN.
 */

const LOOKUP_TIMEOUT_MS = 4000;

let verifiedOwner: string | null = null;
let generation = 0;

/** The `sub` claim of a Supabase access token, unverified: the server verifies it. */
export function tokenSubject(accessToken: string): string | null {
  const payload = accessToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
    };
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}

/** The server's answer: is this session's user an active owner? Null when it could not be asked. */
export async function lookupOwner(
  auth: AuthState,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | null> {
  if (tokenSubject(auth.accessToken) !== auth.staffId) return false;
  try {
    const res = await fetchImpl(
      `${auth.supabaseUrl}/rest/v1/staff?id=eq.${encodeURIComponent(auth.staffId)}&select=role,is_active`,
      {
        headers: { apikey: auth.anonKey, Authorization: `Bearer ${auth.accessToken}` },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    // 401/403: the token is not good, which is an answer, not an outage.
    if (res.status === 401 || res.status === 403) return false;
    if (!res.ok) return null;
    const rows = (await res.json()) as { role?: unknown; is_active?: unknown }[];
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row?.role === 'owner' && row.is_active === true;
  } catch {
    return null;
  }
}

/**
 * Called on every touch:auth-state push. A different person (or none) drops
 * the verdict at once; the new session is then looked up in the background.
 */
export function learnSession(
  auth: AuthState | null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const gen = ++generation;
  if (verifiedOwner !== (auth?.staffId ?? null)) verifiedOwner = null;
  if (!auth) return Promise.resolve();
  return lookupOwner(auth, fetchImpl).then((owner) => {
    // A later push won the race: its own lookup decides.
    if (gen !== generation) return;
    if (owner === true) verifiedOwner = auth.staffId;
    else if (owner === false) verifiedOwner = null;
    // null (offline): keep what an earlier push of the same person learnt.
  });
}

/** May the signed-in person leave without a PIN? Asks the server when the session is not yet known. */
export async function ownerMayLeave(
  auth: AuthState | null,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!auth) return false;
  if (verifiedOwner === auth.staffId) return true;
  const owner = await lookupOwner(auth, fetchImpl);
  if (owner === true) verifiedOwner = auth.staffId;
  return owner === true;
}

/** Tests only. */
export function resetOwnerExit(): void {
  verifiedOwner = null;
  generation = 0;
}

import type { AuthState } from '../ipc-channels';

/**
 * The staff session the sync worker replays with, pushed by the renderer over
 * touch:auth-state on every auth change (sign-in, TOKEN_REFRESHED, sign-out).
 *
 * MEMORY ONLY, by design. Persisting a token to disk is a liability on a kiosk,
 * and supabase-js restores its session from localStorage without network — so
 * after any reboot the renderer re-pushes within seconds, including a (possibly
 * expired) token while offline. Replay only matters once connectivity returns,
 * at which point supabase-js auto-refreshes and TOKEN_REFRESHED re-pushes a
 * fresh one. This is also the main process's only source of the backend URL:
 * the renderer resolves env loudly (resolveSupabaseEnv) and forwards it here,
 * so main needs no VITE_* baked in at all.
 */
let current: AuthState | null = null;
/**
 * The access token the replay endpoint answered 401 to. The sync worker used
 * to reset its backoff on a 401 and keep the token, so its 3 s timer resent
 * the same refused token forever. Now the token is marked here and replay
 * pauses until the renderer pushes a DIFFERENT one (TOKEN_REFRESHED, a new
 * sign-in); the same token pushed again stays refused.
 */
let rejectedToken: string | null = null;
const listeners = new Set<() => void>();

export function setAuthState(next: AuthState | null): void {
  current = next;
  if (!next || next.accessToken !== rejectedToken) rejectedToken = null;
  for (const fn of listeners) fn();
}

/** The signed-in staff session (who is at the station), refused for replay or not. */
export function getAuthState(): AuthState | null {
  return current;
}

/** The session replay may send: none while its token is the one replay refused. */
export function getReplayAuth(): AuthState | null {
  if (current && rejectedToken !== null && current.accessToken === rejectedToken) return null;
  return current;
}

/** Replay answered 401 to this token: never send it again. */
export function markTokenRejected(accessToken: string): void {
  rejectedToken = accessToken;
}

/** The sync worker subscribes so a fresh token immediately un-pauses replay. */
export function onAuthStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

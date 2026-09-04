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
const listeners = new Set<() => void>();
/** Log the backend once per distinct URL, not on every token refresh. */
let loggedUrl: string | null = null;

export function setAuthState(next: AuthState | null): void {
  current = next;
  // Which project this station actually replays into is the first thing anyone
  // asks when sync misbehaves, and until now nothing anywhere printed it — main
  // has no VITE_* of its own, so it was not even greppable from the config.
  if (next && next.supabaseUrl !== loggedUrl) {
    loggedUrl = next.supabaseUrl;
    console.log('[sync] replaying into', next.supabaseUrl);
  }
  for (const fn of listeners) fn();
}

export function getAuthState(): AuthState | null {
  return current;
}

/** The sync worker subscribes so a fresh token immediately un-pauses replay. */
export function onAuthStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

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

export function setAuthState(next: AuthState | null): void {
  current = next;
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

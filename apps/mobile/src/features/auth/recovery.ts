/**
 * "A password-recovery session was established in THIS app session."
 *
 * app/reset-password.tsx calls `updateUser({ password })`, which sets a
 * password on WHATEVER session is signed in. Until 2026-09-20 (S6) the screen
 * rendered its form for any session at all, so a stale `touchpadel://reset-password`
 * link — or simply navigating there — on an unlocked phone rotated the signed-in
 * guest's password with no proof of anything. The form now renders only while
 * this marker is set, and it is set in exactly three places, each of which has
 * just proved the guest controls the account's email or number:
 *
 *   useAuthDeepLink.ts   a recovery PKCE code exchanged for a session
 *   context.tsx          GoTrue's own PASSWORD_RECOVERY event (supabase-js
 *                        emits it after a PKCE exchange whose verifier was
 *                        minted by resetPasswordForEmail)
 *   app/verify-otp.tsx   a recovery SMS/WhatsApp code verified (mode reset)
 *
 * In memory only, on purpose: a marker that survived a restart would outlive
 * the moment it vouches for. Cleared when the password is set, on sign-out,
 * and by the app going away.
 *
 * Same tiny subscribable-store shape as booking/pendingSlot.ts, and PURE apart
 * from React's useSyncExternalStore, so it is unit-tested under plain node.
 */
import { useSyncExternalStore } from 'react';

let recovery = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Call ONLY after a recovery exchange / code verification has succeeded. */
export function markRecoverySession(): void {
  if (recovery) return;
  recovery = true;
  emit();
}

export function clearRecoverySession(): void {
  if (!recovery) return;
  recovery = false;
  emit();
}

export function hasRecoverySession(): boolean {
  return recovery;
}

export function subscribeRecoverySession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Render-time subscription: re-renders when the marker is set or cleared. */
export function useRecoverySession(): boolean {
  return useSyncExternalStore(subscribeRecoverySession, hasRecoverySession, hasRecoverySession);
}

/**
 * "Show guest view" (owner, 2026-09-28): a staff session looks at the guest
 * app as a guest sees it, and comes back with one tap. Only the gate to the
 * guest tabs changes (gate.ts guestTabsGate); the account stays staff, so the
 * staff rules elsewhere (no terms prompt, no guest reminders) still hold.
 *
 * In memory only, never saved: a restart, a sign-out or an account that is no
 * longer staff always lands back where it belongs (GuestTabsGate clears it).
 */
import { useSyncExternalStore } from 'react';

let previewing = false;
const listeners = new Set<() => void>();

export function setGuestPreview(next: boolean): void {
  if (previewing === next) return;
  previewing = next;
  for (const l of listeners) l();
}

export function isGuestPreview(): boolean {
  return previewing;
}

export function useGuestPreview(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => previewing,
    () => false,
  );
}

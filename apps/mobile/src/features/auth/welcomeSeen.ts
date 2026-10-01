/**
 * Whether this install has already shown the Welcome screen (`tp.welcomeSeen`).
 *
 * Read ONCE before the first frame by src/lib/bootPrefs.ts with the other boot
 * keys; written the moment the screen is presented on a first launch. An
 * unreadable or unwritable store costs a repeat of the Welcome screen, never a
 * crash.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';

export const WELCOME_SEEN_KEY = 'tp.welcomeSeen';

let seen = false;

export function rememberWelcomeSeen(value: string | null): void {
  seen = value === '1';
}

export function hasSeenWelcome(): boolean {
  return seen;
}

export function markWelcomeSeen(): void {
  if (seen) return;
  seen = true;
  AsyncStorage.setItem(WELCOME_SEEN_KEY, '1').catch((error) =>
    captureException(error, { label: 'welcome.seenWrite' }),
  );
}

/**
 * Whether the first-launch routing decision has been made. The boot cover waits
 * for it, so the guest goes from the splash straight to Welcome and the tabs
 * are never on show in between.
 */
let decided = false;
const listeners = new Set<() => void>();

export function settleWelcomeDecision(): void {
  if (decided) return;
  decided = true;
  for (const listener of listeners) listener();
}

export function useWelcomeDecided(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => decided,
    () => decided,
  );
}

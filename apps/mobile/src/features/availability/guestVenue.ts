/**
 * The guest's remembered branch (`tp.venue`, branch.ts) as a tiny subscribable
 * store — the staff hint's shape (staff/hint.ts).
 *
 * Read ONCE before the first frame by src/lib/bootPrefs.ts with the other boot
 * keys, so a guest who chose the second branch never sees the first branch's
 * grid flash up on a cold start; written when the guest picks a branch.
 * Every storage access is wrapped: a choice that cannot be stored costs the
 * guest the default branch at the next launch, never a crash.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';
import { GUEST_VENUE_KEY, parseStoredVenue } from './branch';

let storedVenue: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (next === storedVenue) return;
  storedVenue = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function current(): string | null {
  return storedVenue;
}

/** bootPrefs hands over the stored value it read with the other boot keys. */
export function rememberGuestVenue(raw: string | null | undefined): void {
  set(parseStoredVenue(raw));
}

export function useStoredGuestVenue(): string | null {
  return useSyncExternalStore(subscribe, current, current);
}

export async function writeGuestVenue(venueId: string): Promise<void> {
  set(parseStoredVenue(venueId));
  try {
    await AsyncStorage.setItem(GUEST_VENUE_KEY, venueId);
  } catch (error) {
    captureException(error, { scope: 'guest.venue.write' });
  }
}

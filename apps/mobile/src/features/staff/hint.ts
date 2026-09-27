/**
 * The device hint: "this phone was last signed in as staff account <uid>"
 * (build-contracts-2026-09-23 §6.5; status.ts explains what it decides).
 *
 * Read ONCE before the first frame, by src/lib/bootPrefs.ts, so a staff cold
 * start knows to wait for the row instead of mounting the guest tabs; kept in
 * memory from then on as a tiny subscribable store (the pendingSlot shape), so
 * StaffStatusProvider re-renders when it is written or cleared. Written when a
 * row resolves to staff; cleared on sign-out (auth/context.tsx) and on revoked.
 *
 * Every storage access is wrapped: a hint that cannot be stored costs a staff
 * cold start one frame of guest-or-pending, never a crash.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';
import { STAFF_HINT_KEY, parseStaffHint, serializeStaffHint } from './status';

let hintUid: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (next === hintUid) return;
  hintUid = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** bootPrefs hands over the stored value it read with the other boot keys. */
export function rememberStaffHint(raw: string | null | undefined): void {
  set(parseStaffHint(raw)?.uid ?? null);
}

export function staffHintUid(): string | null {
  return hintUid;
}

export function useStaffHintUid(): string | null {
  return useSyncExternalStore(subscribe, staffHintUid, staffHintUid);
}

export async function writeStaffHint(uid: string): Promise<void> {
  set(uid);
  try {
    await AsyncStorage.setItem(STAFF_HINT_KEY, serializeStaffHint(uid));
  } catch (error) {
    captureException(error, { scope: 'staff.hint.write' });
  }
}

export async function clearStaffHint(): Promise<void> {
  set(null);
  try {
    await AsyncStorage.removeItem(STAFF_HINT_KEY);
  } catch (error) {
    captureException(error, { scope: 'staff.hint.clear' });
  }
}

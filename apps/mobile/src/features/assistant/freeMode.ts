/**
 * Whether the owner picked "The free AI" on this phone (`tp.assistantFree`;
 * owner call 2026-10-16). Every other staff role only ever has the free one,
 * so the flag is read for the owner alone. One flag per install, not per
 * account, like `playProfile/askDismissed.ts`: a preference about this phone,
 * so it never names anyone and needs no place on the deletion purge list.
 *
 * Read once per launch and held in memory; Today's and the floating assistant
 * buttons start the read, so it is in by the time the screen opens. Until it
 * is, the screen shows the paid assistant. An unreadable store costs the
 * choice, never a crash.
 */
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';

export const FREE_MODE_KEY = 'tp.assistantFree';

/** undefined = not read yet. */
let free: boolean | undefined;
let reading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Start the read (once); safe to call from any render path's effect. */
export function loadFreeMode(): void {
  if (free !== undefined || reading) return;
  reading = true;
  AsyncStorage.getItem(FREE_MODE_KEY)
    .then((v) => {
      if (free === undefined) free = v === '1';
    })
    .catch((error) => {
      captureException(error, { label: 'assistant.freeMode.read' });
      if (free === undefined) free = false;
    })
    .finally(() => {
      reading = false;
      emit();
    });
}

const read = () => free;

/** `undefined` until read, then whether the owner chose the free AI. */
export function useFreeMode(): boolean | undefined {
  useEffect(loadFreeMode, []);
  return useSyncExternalStore(subscribe, read, read);
}

export function setFreeMode(on: boolean): void {
  free = on;
  emit();
  const write = on ? AsyncStorage.setItem(FREE_MODE_KEY, '1') : AsyncStorage.removeItem(FREE_MODE_KEY);
  write.catch((error) => captureException(error, { label: 'assistant.freeMode.write' }));
}

/** Tests only: forget the in-memory answer so the next read goes to the store. */
export function __resetFreeMode(): void {
  free = undefined;
  reading = false;
}

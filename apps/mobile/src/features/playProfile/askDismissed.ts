/**
 * Whether the Play tab's "Tell us your level" card was put away on this phone
 * (`tp.playAskDismissed`). One flag per install, not per account, on purpose:
 * a key named by the account's uuid would be a durable record that the
 * account existed, and would have to join the deletion purge list
 * (features/profile/purgeKeys.ts, SEC-16). Like the language and the theme it
 * is a preference about this phone, not about anyone.
 *
 * Read once per launch and held in memory. An unreadable store costs the card
 * coming back, never a crash.
 */
import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';

export const ASK_DISMISSED_KEY = 'tp.playAskDismissed';

/** undefined = not read yet. */
let dismissed: boolean | undefined;
let reading = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load() {
  if (dismissed !== undefined || reading) return;
  reading = true;
  AsyncStorage.getItem(ASK_DISMISSED_KEY)
    .then((v) => {
      if (dismissed === undefined) dismissed = v === '1';
    })
    .catch((error) => {
      captureException(error, { label: 'playAsk.read' });
      if (dismissed === undefined) dismissed = false;
    })
    .finally(() => {
      reading = false;
      emit();
    });
}

const read = () => dismissed;

/**
 * `undefined` until read (render nothing yet, so the card never flashes in
 * and out), then whether it was put away.
 */
export function useAskDismissed(): boolean | undefined {
  useEffect(load, []);
  return useSyncExternalStore(subscribe, read, read);
}

export function dismissAsk(): void {
  dismissed = true;
  emit();
  AsyncStorage.setItem(ASK_DISMISSED_KEY, '1').catch((error) =>
    captureException(error, { label: 'playAsk.write' }),
  );
}

/** Tests only: forget the in-memory answer so the next read goes to the store. */
export function __resetAskDismissed(): void {
  dismissed = undefined;
  reading = false;
}
